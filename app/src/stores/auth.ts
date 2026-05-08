/**
 * Auth Store
 * 
 * Manages authentication state including access and refresh tokens.
 * Handles login, logout, and token refresh operations.
 * 
 * Key features:
 * - Persists refresh tokens to localStorage (access tokens are memory-only for security)
 * - Automatically calculates token expiration times
 * - Provides actions for login and logout
 * - Integrates with API layer for authentication requests
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../api/auth';
import type { LoginResponse } from '../api/types';
import { log, LogLevel } from '../lib/logger';
import { encrypt, decrypt, isCryptoAvailable } from '../lib/crypto';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpires: number | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  isAuthenticated: boolean;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  setTokens: (response: LoginResponse) => void;
  getFreshAccessToken: () => Promise<string | null>;
  setReLoginCallback: (callback: (() => Promise<boolean>) | null) => void;
}

interface PersistedAuthState {
  refreshToken: string | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
}

/**
 * Custom storage adapter that encrypts the refresh token before writing to localStorage
 * and decrypts it on read. Falls back to plaintext if Web Crypto is unavailable.
 * If decryption fails (e.g. key changed, corrupted data), clears the refresh token
 * so the user will be prompted to re-login.
 */
function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const encryptedAuthStorage: PersistStorage<PersistedAuthState> = {
  getItem: async (name: string): Promise<StorageValue<PersistedAuthState> | null> => {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StorageValue<PersistedAuthState>;
      if (parsed?.state?.refreshToken && isCryptoAvailable()) {
        try {
          parsed.state.refreshToken = await decrypt(parsed.state.refreshToken);
        } catch {
          try { log.auth('Failed to decrypt refresh token — clearing stored token', LogLevel.ERROR); } catch { /* */ }
          parsed.state.refreshToken = null;
        }
      }
      return parsed;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: StorageValue<PersistedAuthState>): Promise<void> => {
    const storage = getStorage();
    if (!storage) return;
    try {
      const toStore: StorageValue<PersistedAuthState> = {
        ...value,
        state: { ...value.state },
      };
      if (toStore.state.refreshToken && isCryptoAvailable()) {
        toStore.state.refreshToken = await encrypt(toStore.state.refreshToken);
      }
      storage.setItem(name, JSON.stringify(toStore));
    } catch {
      try { log.auth('Failed to encrypt refresh token — storing plaintext fallback', LogLevel.ERROR); } catch { /* */ }
      try { storage.setItem(name, JSON.stringify(value)); } catch { /* */ }
    }
  },
  removeItem: (name: string): void => {
    const storage = getStorage();
    if (storage) storage.removeItem(name);
  },
};

/**
 * Module-level dedup for login(). Multiple callers (profile bootstrap +
 * api/client.ts proactive auth) can race a fresh-start login; without this
 * guard we'd POST /login.json twice. The promise is shared across all
 * entry points so any caller that arrives mid-flight attaches to the same
 * pending login.
 */
let pendingLogin: Promise<void> | null = null;

/**
 * Module-level dedup for getFreshAccessToken(). Concurrent callers (multiple
 * monitor tiles, hover previews, services) share the same in-flight refresh
 * so we only hit /host/login.json once per stale window.
 */
let pendingFreshToken: Promise<string | null> | null = null;

/**
 * Credentials-based re-login callback registered by the profile store at app
 * init. Decoupled via a setter to avoid a circular import between auth and
 * profile stores.
 */
let reLoginCallback: (() => Promise<boolean>) | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      accessTokenExpires: null,
      refreshTokenExpires: null,
      version: null,
      apiVersion: null,
      isAuthenticated: false,

      /**
       * Authenticate with the ZoneMinder server.
       * 
       * @param username - The username
       * @param password - The password
       */
      login: async (username: string, password: string) => {
        // If a login is already in flight, attach to it instead of starting a new one.
        if (pendingLogin) {
          log.auth('Login already in flight — attaching to pending request', LogLevel.DEBUG);
          return pendingLogin;
        }
        log.auth(`Login attempt for user: ${username}`);
        pendingLogin = (async () => {
          try {
            const response = await apiLogin({ user: username, pass: password });
            get().setTokens(response);
            const state = get();
            log.auth('Login successful', LogLevel.INFO, {
              accessTokenExpires: state.accessTokenExpires ? new Date(state.accessTokenExpires).toLocaleString() : 'N/A',
              refreshTokenExpires: state.refreshTokenExpires ? new Date(state.refreshTokenExpires).toLocaleString() : 'N/A',
              zmVersion: response.version,
              apiVersion: response.apiversion,
            });
          } catch (error) {
            log.auth('Login failed', LogLevel.ERROR, error);
            throw error;
          }
        })();
        try {
          return await pendingLogin;
        } finally {
          pendingLogin = null;
        }
      },

      /**
       * Clear all authentication state.
       * Removes tokens and resets authentication status.
       */
      logout: () => {
        set({
          accessToken: null,
          refreshToken: null,
          accessTokenExpires: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
        });
        log.auth('Logged out, auth state cleared');
      },

      /**
       * Refresh the access token using the stored refresh token.
       * If refresh fails, logs the user out.
       */
      refreshAccessToken: async () => {
        const { refreshToken, refreshTokenExpires } = get();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }
        if (!refreshTokenExpires || refreshTokenExpires <= Date.now()) {
          log.auth('Refresh token expired or missing expiry; skipping network call', LogLevel.WARN);
          get().logout();
          throw new Error('Refresh token expired');
        }

        try {
          const response = await apiRefreshToken(refreshToken);
          get().setTokens(response);
        } catch (error) {
          log.auth('Token refresh failed', LogLevel.ERROR, error);
          get().logout();
          throw error;
        }
      },

      /**
       * Update state with new tokens from API response.
       * Calculates absolute expiration times based on relative seconds from response.
       */
      setTokens: (response: LoginResponse) => {
        const now = Date.now();
        const currentState = get();

        // Handle case where server returns success but no tokens (no auth required)
        const accessToken = response.access_token || null;
        const accessTokenExpires = response.access_token_expires
          ? now + response.access_token_expires * 1000
          : null;

        set({
          accessToken,
          refreshToken: response.refresh_token || currentState.refreshToken,
          accessTokenExpires,
          refreshTokenExpires: response.refresh_token_expires
            ? now + response.refresh_token_expires * 1000
            : currentState.refreshTokenExpires,
          version: response.version || currentState.version,
          apiVersion: response.apiversion || currentState.apiVersion,
          isAuthenticated: true,
        });
      },

      setReLoginCallback: (callback) => {
        reLoginCallback = callback;
      },

      getFreshAccessToken: async () => {
        if (pendingFreshToken) {
          return pendingFreshToken;
        }

        const state = get();
        const now = Date.now();
        const hasFresh =
          !!state.accessToken &&
          !!state.accessTokenExpires &&
          state.accessTokenExpires - now > ZM_INTEGRATION.accessTokenLeewayMs;
        if (hasFresh) {
          return state.accessToken;
        }

        pendingFreshToken = (async (): Promise<string | null> => {
          try {
            await get().refreshAccessToken();
            return get().accessToken;
          } catch (refreshError) {
            log.auth(
              'Refresh failed in getFreshAccessToken; falling through to reLogin',
              LogLevel.WARN,
              { error: refreshError },
            );
            if (!reLoginCallback) {
              return null;
            }
            try {
              const ok = await reLoginCallback();
              if (!ok) return null;
              return get().accessToken;
            } catch (reLoginError) {
              log.auth(
                'reLogin failed in getFreshAccessToken',
                LogLevel.ERROR,
                { error: reLoginError },
              );
              return null;
            }
          }
        })();

        try {
          return await pendingFreshToken;
        } finally {
          pendingFreshToken = null;
        }
      },
    }),
    {
      name: 'zmng-auth',
      storage: encryptedAuthStorage,
      // Only persist refresh token and server version info
      // Access token is kept in memory for better security
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        refreshTokenExpires: state.refreshTokenExpires,
        version: state.version,
        apiVersion: state.apiVersion,
      }),
      onRehydrateStorage: () => (state) => {
        try {
          if (state) {
            log.auth('Auth store rehydrated from localStorage', LogLevel.INFO, {
              hasRefreshToken: !!state.refreshToken,
              refreshTokenExpires: state.refreshTokenExpires
                ? new Date(state.refreshTokenExpires).toLocaleString()
                : 'N/A',
              version: state.version,
              apiVersion: state.apiVersion,
            });
            log.auth('NOTE: These tokens may be from previous profile and will be cleared by profile initialization', LogLevel.INFO);
          } else {
            log.auth('No persisted auth state found');
          }
        } catch { /* log may be unavailable during test teardown */ }
      }, })
);

// NOTE: Token auto-refresh is now handled by the useTokenRefresh hook
// See app/src/hooks/useTokenRefresh.ts
