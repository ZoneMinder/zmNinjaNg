/**
 * Profile Store Initialization
 *
 * Handles profile store rehydration from localStorage and initial app bootstrap.
 * This module is separated from profile.ts to reduce complexity and improve maintainability.
 *
 * The initialization process:
 * 1. Rehydrate profile data from localStorage (handled by Zustand persist middleware)
 * 2. Clear stale auth and cache
 * 3. Initialize API client with current profile
 * 4. Run bootstrap tasks (auth, timezone, zms path, multi-port) in background
 * 5. Set initialization flags to allow UI to render
 */

import type { Profile } from '../api/types';
import { createApiClient, setApiClient } from '../api/client';
import { log, LogLevel } from '../lib/logger';
import { BOOTSTRAP_TIMEOUTS } from '../lib/zmninja-ng-constants';
import { performBootstrap, type BootstrapContext } from './profile-bootstrap';

function safeLog(message: string, level: LogLevel, details?: Record<string, unknown>) {
  try { log.profileService(message, level, details); } catch { /* Logger may not be initialized in test env */ }
}

interface ProfileState {
  profiles: Profile[];
  currentProfileId: string | null;
  isInitialized: boolean;
  isBootstrapping: boolean;
  bootstrapStep: 'start' | 'auth' | 'timezone' | 'zms' | 'finalize' | null;
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
  reLogin: () => Promise<boolean>;
}

/**
 * Wraps a promise with a timeout to prevent hanging
 */
async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number = BOOTSTRAP_TIMEOUTS.stepTimeoutMs
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Logs operation duration with context
 */
function logDuration(
  message: string,
  startTime: number,
  context: Record<string, unknown> = {}
): void {
  log.profileService(message, LogLevel.INFO, {
    ...context,
    durationMs: Date.now() - startTime,
  });
}

/**
 * Sets initialization state flags
 */
function setInitializationState(
  storeSet: (partial: Partial<ProfileState>) => void,
  bootstrapping: boolean
): void {
  storeSet({
    isBootstrapping: bootstrapping,
    isInitialized: true,
    bootstrapStep: bootstrapping ? 'start' : null,
  });
}

/**
 * Clears stale authentication and cache data
 */
async function clearStaleState(): Promise<void> {
  const clearStart = Date.now();
  log.profileService('Clearing stale auth and cache', LogLevel.INFO);

  const { useAuthStore } = await import('../stores/auth');
  useAuthStore.getState().logout();

  const { clearQueryCache } = await import('../stores/query-cache');
  clearQueryCache();

  logDuration('Bootstrap step: cleared auth and cache', clearStart);
}

/**
 * Initializes API client for the given profile
 */
async function initializeApiClient(
  profile: Profile,
  reLogin: () => Promise<boolean>
): Promise<void> {
  const apiClientStart = Date.now();
  log.profileService('Initializing API client', LogLevel.INFO, {
    apiUrl: profile.apiUrl,
  });

  setApiClient(createApiClient(profile.apiUrl, reLogin));

  // Wire the same credentials reLogin into the auth store so
  // getFreshAccessToken can fall through to it when refresh fails.
  const { useAuthStore } = await import('../stores/auth');
  useAuthStore.getState().setReLoginCallback(reLogin);

  logDuration('Bootstrap step: API client ready', apiClientStart, {
    apiUrl: profile.apiUrl,
  });
}

/**
 * Runs bootstrap tasks in background with timeout protection
 */
async function runBootstrapTasks(
  profile: Profile,
  bootstrapContext: BootstrapContext,
  storeSet: (partial: Partial<ProfileState>) => void,
  storeGet: () => ProfileState,
  bootstrapStart: number
): Promise<void> {
  let overallTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Set overall timeout to prevent bootstrap from hanging forever
    overallTimeoutId = setTimeout(() => {
      if (storeGet().isBootstrapping) {
        log.profileService(
          'Profile bootstrap exceeded timeout; allowing UI to continue',
          LogLevel.WARN,
          { timeoutMs: BOOTSTRAP_TIMEOUTS.totalTimeoutMs }
        );
        storeSet({ isBootstrapping: false, bootstrapStep: null });
      }
    }, BOOTSTRAP_TIMEOUTS.totalTimeoutMs);

    storeSet({ bootstrapStep: 'start' });
    log.profileService('Running bootstrap tasks on app load', LogLevel.INFO);

    // Run all bootstrap steps with timeout protection
    await withTimeout(
      'Bootstrap tasks',
      performBootstrap(profile, bootstrapContext),
      BOOTSTRAP_TIMEOUTS.totalTimeoutMs
    );

    storeSet({ bootstrapStep: 'finalize' });
  } finally {
    logDuration('Profile bootstrap completed', bootstrapStart, {
      profileId: profile.id,
    });
    if (overallTimeoutId) {
      clearTimeout(overallTimeoutId);
    }
    storeSet({ isBootstrapping: false, bootstrapStep: null });
  }
}

/**
 * Main rehydration handler called by Zustand persist middleware
 *
 * This is invoked when the app loads and profile data is restored from localStorage.
 * It handles initialization in a non-blocking way to prevent UI from hanging.
 */
export async function handleProfileRehydration(
  state: ProfileState | undefined,
  storeSet: (partial: Partial<ProfileState>) => void,
  storeGet: () => ProfileState
): Promise<void> {
  const bootstrapStart = Date.now();

  safeLog('onRehydrateStorage called', LogLevel.INFO, {
    hasState: !!state,
    currentProfileId: state?.currentProfileId,
  });

  // Case 1: No profile exists - just mark as initialized
  if (!state?.currentProfileId) {
    safeLog('No current profile found on app load', LogLevel.INFO, { state });
    setInitializationState(storeSet, false);
    safeLog('isInitialized set to true (no profile)', LogLevel.INFO);
    return;
  }

  // Case 2: Profile ID exists but profile not found - error case
  const profile = state.profiles.find((p) => p.id === state.currentProfileId);
  if (!profile) {
    safeLog('Current profile ID exists but profile not found', LogLevel.ERROR, {
      profileId: state.currentProfileId,
    });
    // Set isInitialized even on error to prevent hanging
    setInitializationState(storeSet, false);
    return;
  }

  safeLog('App loading with profile', LogLevel.INFO, {
    name: profile.name,
    id: profile.id,
    portalUrl: profile.portalUrl,
    apiUrl: profile.apiUrl,
    cgiUrl: profile.cgiUrl,
    username: profile.username || '(not set)',
    hasPassword: !!profile.password,
    passwordLength: profile.password?.length,
    isDefault: profile.isDefault,
    createdAt: new Date(profile.createdAt).toLocaleString(),
    lastUsed: profile.lastUsed
      ? new Date(profile.lastUsed).toLocaleString()
      : 'never',
  });

  // Case 3: Valid profile - perform initialization and bootstrap
  try {
    // Clear stale state from previous session
    await clearStaleState();

    // Initialize API client
    await initializeApiClient(profile, storeGet().reLogin);
  } catch (error) {
    log.profileService(
      'Profile bootstrap failed during early initialization',
      LogLevel.ERROR,
      error
    );
    setInitializationState(storeSet, false);
    return;
  }

  // Mark as initialized and bootstrapping
  setInitializationState(storeSet, true);

  // Run bootstrap tasks in background (non-blocking)
  const bootstrapContext: BootstrapContext = {
    getDecryptedPassword: storeGet().getDecryptedPassword,
    updateProfile: storeGet().updateProfile,
  };

  // Run bootstrap tasks asynchronously (don't await)
  void runBootstrapTasks(
    profile,
    bootstrapContext,
    storeSet,
    storeGet,
    bootstrapStart
  );
}
