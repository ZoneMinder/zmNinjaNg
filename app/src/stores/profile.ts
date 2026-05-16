/**
 * Profile Store
 * 
 * Manages the list of ZoneMinder server profiles and the current active profile.
 * Handles secure storage of passwords and profile switching logic.
 * 
 * Key features:
 * - Persists profiles to localStorage (excluding passwords)
 * - Stores passwords in secure storage (native Keychain/Keystore or encrypted in localStorage)
 * - Handles profile switching with full state cleanup (auth, cache, API client)
 * - Manages app initialization state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '../api/types';
import { createApiClient, setApiClient } from '../api/client';
import { getServerTimeZone } from '../api/time';
import { ProfileService } from '../services/profile';
import { log, LogLevel } from '../lib/logger';
import { useAuthStore } from './auth';
import { performBootstrap } from '../services/profile-bootstrap';
import { handleProfileRehydration } from '../services/profile-initialization';

interface ProfileState {
  profiles: Profile[];
  currentProfileId: string | null;
  isInitialized: boolean;
  isBootstrapping: boolean;
  bootstrapStep: 'start' | 'auth' | 'timezone' | 'zms' | 'finalize' | null;

  // Computed
  profileExists: (name: string, excludeId?: string) => boolean;


  // Actions
  addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>) => Promise<string>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  deleteAllProfiles: () => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  setDefaultProfile: (id: string) => void;
  reLogin: () => Promise<boolean>;
  cancelBootstrap: () => void;

  // Helpers
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
}

let storeSet: ((partial: Partial<ProfileState>) => void) | null = null;
let storeGet: (() => ProfileState) | null = null;

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => {
      storeSet = set;
      storeGet = get;
      return {
        profiles: [],
        currentProfileId: null,
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,

        /**
         * Check if a profile with the given name already exists.
         * Case-insensitive.
         */
        profileExists: (name, excludeId) => {
          const { profiles } = get();
          return profiles.some(
            (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId
          );
        },

        /**
         * Add a new profile.
         * 
         * Generates a UUID, encrypts the password (if provided), and adds to the list.
         * If it's the first profile, it becomes the default and current profile.
         */
        addProfile: async (profileData) => {
          // Check for duplicate names
          if (!ProfileService.validateNameAvailability(profileData.name, get().profiles)) {
            throw new Error(`Profile "${profileData.name}" already exists`);
          }

          const newProfileId = crypto.randomUUID();

          // Store password in secure storage (native keystore on mobile, encrypted on web)
          if (profileData.password) {
            await ProfileService.savePassword(newProfileId, profileData.password);
          }

          // Don't store password in Zustand state - it's in secure storage
          const newProfile: Profile = {
            ...profileData,
            password: profileData.password ? 'stored-securely' : undefined, // Flag indicating password exists
            id: newProfileId,
            createdAt: Date.now(),
          };

          set((state) => {
            // If this is the first profile, make it default
            const isFirst = state.profiles.length === 0;
            const profiles = [...state.profiles, newProfile];

            return {
              profiles,
              currentProfileId: isFirst ? newProfile.id : state.currentProfileId,
            };
          });

          // If this is now the current profile, initialize API client
          if (get().currentProfileId === newProfile.id) {
            setApiClient(createApiClient(newProfile.apiUrl));

            // Fetch timezone for new profile
            try {
              // Get token from auth store state
              const { useAuthStore } = await import('./auth');
              const { accessToken } = useAuthStore.getState();
              const timezone = await getServerTimeZone(accessToken || undefined);
              get().updateProfile(newProfile.id, { timezone });
            } catch (e) {
              log.profileService('Failed to fetch timezone for new profile', LogLevel.WARN, { error: e });
            }
          }

          return newProfileId;
        },

        /**
         * Update an existing profile.
         * 
         * Handles password updates by re-encrypting and storing in secure storage.
         * Re-initializes API client if the current profile's URL changes.
         */
        updateProfile: async (id, updates) => {
          log.profileService(`updateProfile called for profile ID: ${id}`, LogLevel.INFO, updates);

          // Check for duplicate names if name is being updated
          if (updates.name && !ProfileService.validateNameAvailability(updates.name, get().profiles, id)) {
            throw new Error(`Profile "${updates.name}" already exists`);
          }

          // Store password in secure storage if provided
          let processedUpdates = { ...updates };
          if (updates.password) {
            await ProfileService.savePassword(id, updates.password);
            // Set flag instead of actual password
            processedUpdates.password = 'stored-securely';
          }

          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...processedUpdates } : p)),
          }));

          // If updating current profile's API URL, reinitialize client
          const { profiles, currentProfileId } = get();
          const currentProfile = profiles.find(p => p.id === currentProfileId);
          if (currentProfile?.id === id && updates.apiUrl) {
            setApiClient(createApiClient(updates.apiUrl, get().reLogin));
          }

          log.profileService('updateProfile complete', LogLevel.INFO);
        },

        /**
         * Delete a profile.
         * 
         * Removes the profile from the list and deletes its password from secure storage.
         * If the current profile is deleted, switches to another available profile or null.
         */
        deleteProfile: async (id) => {
          // Remove password from secure storage
          await ProfileService.deletePassword(id);

          set((state) => {
            const profiles = state.profiles.filter((p) => p.id !== id);
            const currentProfileId =
              state.currentProfileId === id
                ? profiles.length > 0
                  ? profiles[0].id
                  : null
                : state.currentProfileId;

            return { profiles, currentProfileId };
          });

          // Reinitialize API client if current profile changed
          const { profiles: updatedProfiles, currentProfileId: newCurrentId } = get();
          const newCurrentProfile = updatedProfiles.find(p => p.id === newCurrentId);
          if (newCurrentProfile) {
            setApiClient(createApiClient(newCurrentProfile.apiUrl, get().reLogin));
          }
        },

        /**
         * Delete all profiles.
         * 
         * Clears all profiles and removes all passwords from secure storage.
         * Resets the API client.
         */
        deleteAllProfiles: async () => {
          const { profiles } = get();

          // Remove all passwords from secure storage
          for (const profile of profiles) {
            await ProfileService.deletePassword(profile.id);
          }

          // Clear all profiles and reset state
          set({ profiles: [], currentProfileId: null });

          // Reset API client
          const { resetApiClient } = await import('../api/client');
          resetApiClient();

          log.profileService('All profiles deleted', LogLevel.INFO);
        },

        /**
         * Switch to a different profile.
         * 
         * Performs a full context switch:
         * 1. Clears auth state (logout)
         * 2. Clears query cache (React Query)
         * 3. Resets API client
         * 4. Sets new profile as current
         * 5. Initializes API client with new URL
         * 6. Attempts to authenticate with stored credentials
         * 
         * Includes rollback logic if switching fails.
         */
        switchProfile: async (id) => {
          const profile = get().profiles.find((p) => p.id === id);
          if (!profile) {
            throw new Error(`Profile ${id} not found`);
          }

          // Save previous profile for rollback
          const previousProfileId = get().currentProfileId;
          const previousProfile = previousProfileId
            ? get().profiles.find((p) => p.id === previousProfileId)
            : null;

          log.profileService('Starting profile switch', LogLevel.INFO, {
            from: previousProfile?.name || 'None',
            to: profile.name,
            targetPortal: profile.portalUrl,
            targetAPI: profile.apiUrl,
          });

          try {
            // STEP 1: Clear ALL existing state FIRST (critical for avoiding data mixing)
            log.profileService('Step 1: Clearing all existing state', LogLevel.INFO);

            const { useAuthStore } = await import('./auth');
            log.profileService('Clearing auth state (logout)', LogLevel.INFO);
            useAuthStore.getState().logout();

            const { clearQueryCache } = await import('./query-cache');
            log.profileService('Clearing query cache', LogLevel.INFO);
            clearQueryCache();

            const { resetApiClient } = await import('../api/client');
            log.profileService('Resetting API client', LogLevel.INFO);
            resetApiClient();

            // STEP 2: Update current profile ID
            log.profileService('Step 2: Setting new profile as current', LogLevel.INFO);
            set({ currentProfileId: id });

            // Update last used timestamp (don't await this)
            get().updateProfile(id, { lastUsed: Date.now() });

            // STEP 3: Initialize API client with new profile
            log.profileService('Step 3: Initializing API client', LogLevel.INFO, { apiUrl: profile.apiUrl });
            setApiClient(createApiClient(profile.apiUrl, get().reLogin));
            log.profileService('API client initialized', LogLevel.INFO);

            // STEP 4-6: Run bootstrap tasks (auth, timezone, zms path, multi-port)
            log.profileService('Step 4-6: Running bootstrap tasks', LogLevel.INFO);
            await performBootstrap(profile, {
              getDecryptedPassword: get().getDecryptedPassword,
              updateProfile: get().updateProfile,
            });

            log.profileService('Profile switch completed successfully', LogLevel.INFO, { currentProfile: profile.name });

          } catch (error) {
            log.profileService('Profile switch FAILED', LogLevel.ERROR, error);

            // ROLLBACK: Restore previous profile if it exists
            if (previousProfile) {
              log.profileService('Starting rollback to previous profile', LogLevel.INFO, {
                previousProfile: previousProfile.name,
              });

              try {
                // Clear state again to ensure clean rollback
                const { useAuthStore } = await import('./auth');
                useAuthStore.getState().logout();

                const { clearQueryCache } = await import('./query-cache');
                clearQueryCache();

                const { resetApiClient } = await import('../api/client');
                resetApiClient();

                // Restore previous profile
                log.profileService('Restoring previous profile ID', LogLevel.INFO);
                set({ currentProfileId: previousProfileId });

                // Re-initialize with previous profile
                log.profileService('Re-initializing API client', LogLevel.INFO, { apiUrl: previousProfile.apiUrl });
                setApiClient(createApiClient(previousProfile.apiUrl, get().reLogin));

                // Run bootstrap for previous profile
                log.profileService('Running bootstrap for rollback profile', LogLevel.INFO);
                await performBootstrap(previousProfile, {
                  getDecryptedPassword: get().getDecryptedPassword,
                  updateProfile: get().updateProfile,
                });
                log.profileService('Rollback successful', LogLevel.INFO, { restoredTo: previousProfile.name });
              } catch (rollbackError) {
                log.profileService('Rollback FAILED - user may need to manually re-authenticate', LogLevel.ERROR, { rollbackError });
              }
            }

            // Re-throw the original error
            throw error;
          }
        }, setDefaultProfile: (id) => {
          set((state) => ({
            profiles: state.profiles.map((p) => ({
              ...p,
              isDefault: p.id === id,
            })),
          }));
        },

        reLogin: async () => {
          const { currentProfileId, getDecryptedPassword, profiles } = get();
          if (!currentProfileId) return false;

          const profile = profiles.find((p) => p.id === currentProfileId);
          if (!profile) return false;

          // No credentials means no auth required (public server) - not a failure
          if (!profile.username || !profile.password) return true;

          try {
            const password = await getDecryptedPassword(currentProfileId);
            if (!password) return false;

            const { useAuthStore } = await import('./auth');
            await useAuthStore.getState().login(profile.username, password);
            return true;
          } catch (e) {
            log.profileService('Re-login helper failed', LogLevel.ERROR, { error: e });
            return false;
          }
        },

        /**
         * Cancel ongoing bootstrap and clear current profile.
         * Used when user wants to abort loading a profile that's taking too long.
         */
        cancelBootstrap: () => {
          log.profileService('Bootstrap cancelled by user', LogLevel.INFO);
          set({
            isBootstrapping: false,
            bootstrapStep: null,
            currentProfileId: null,
          });
        },

        /**
         * Retrieve decrypted password for a profile.
         * 
         * Fetches the encrypted password from secure storage and decrypts it.
         */
        getDecryptedPassword: async (profileId) => {
          const profile = get().profiles.find((p) => p.id === profileId);
          if (!profile?.password || profile.password !== 'stored-securely') {
            return undefined;
          }

          return ProfileService.getPassword(profileId);
        },
      };
    },
    {
      name: 'zmng-profiles',
      // On load, initialize API client with current profile and authenticate
      // Complex initialization logic is extracted to services/profile-initialization.ts for maintainability
      onRehydrateStorage: () => {
        try {
          log.profileService('onRehydrateStorage: Zustand persist starting rehydration', LogLevel.INFO);
        } catch {
          // Logger might not be initialized in test environment
        }

        return async (state) => {
          try {
            // Ensure store references are available
            if (!storeSet || !storeGet) {
              throw new Error('Profile store not ready');
            }

            // Delegate to initialization module
            await handleProfileRehydration(state, storeSet, storeGet);
          } catch (error) {
            // CRITICAL: Catch any unexpected errors in onRehydrateStorage to prevent app from hanging
            try {
              log.profileService(
                'CRITICAL: Unexpected error in onRehydrateStorage - forcing initialization',
                LogLevel.ERROR,
                { error }
              );
            } catch {
              // Logger might not be initialized in test environment
            }
            // Force initialization to prevent hanging
            if (storeSet) {
              storeSet({ isInitialized: true, isBootstrapping: false, bootstrapStep: null });
            }
          }
        };
      },
    }
  )
);

// Subscribe to auth store to update refresh token in profile
useAuthStore.subscribe((state) => {
  const { refreshToken } = state;
  const { currentProfileId, updateProfile, profiles } = useProfileStore.getState();

  if (currentProfileId && refreshToken) {
    const profile = profiles.find(p => p.id === currentProfileId);
    if (profile && profile.refreshToken !== refreshToken) {
      log.profileService('Updating profile with new refresh token', LogLevel.INFO, { profileId: currentProfileId });
      updateProfile(currentProfileId, { refreshToken });
    }
  }
});
