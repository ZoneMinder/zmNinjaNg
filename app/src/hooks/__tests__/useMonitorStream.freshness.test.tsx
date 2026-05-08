/**
 * useMonitorStream — token freshness gate
 *
 * Asserts that:
 * - When the access token has less than the 30-min leeway remaining,
 *   useMonitorStream emits an empty streamUrl. The browser would render
 *   the existing VideoOff placeholder; no `<img src=>` request goes out.
 * - When the auth store updates with a fresh token, the hook re-renders
 *   and emits a stream URL containing the new token.
 *
 * This is the React-tree counterpart of the e2e scenario described in
 * tests/features/.wip/auth-token-freshness.feature. Refs #145.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import type { Profile } from '../../api/types';

vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
    auth: vi.fn(),
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

vi.mock('../../api/monitors', () => ({
  getStreamUrl: (cgiUrl: string, monitorId: string, options: any) => {
    const params = new URLSearchParams();
    params.set('monitor', monitorId);
    if (options.mode) params.set('mode', options.mode);
    if (options.connkey) params.set('connkey', options.connkey.toString());
    if (options.token) params.set('token', options.token);
    return `${cgiUrl}/nph-zms?${params.toString()}`;
  },
}));

vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string, options: any) => {
    const params = new URLSearchParams();
    params.set('command', command);
    params.set('connkey', connkey);
    if (options?.token) params.set('token', options.token);
    return `${portalUrl}/api/host/daemonControl.json?${params.toString()}`;
  },
}));

vi.mock('../../lib/zm-constants', () => ({
  ZMS_COMMANDS: {
    cmdQuit: 'quit',
  },
}));

describe('useMonitorStream — token freshness gate', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: 'profile-1',
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamScale: 50,
          streamMaxFps: 5,
          snapshotRefreshInterval: 1,
        },
      },
    });

    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => 12345),
    });

    // Reset auth state between tests
    useAuthStore.setState({
      accessToken: null,
      accessTokenExpires: null,
      refreshToken: null,
      refreshTokenExpires: null,
      isAuthenticated: false,
    });

    vi.clearAllMocks();
  });

  it('emits empty streamUrl when the access token has less than the leeway remaining', async () => {
    // Token expires in 5 minutes — under the 30-min leeway, so isFresh = false.
    useAuthStore.setState({
      accessToken: 'STALE-MARKER',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
      // Stub getFreshAccessToken so the freshness hook's effect doesn't error.
      getFreshAccessToken: vi.fn().mockResolvedValue(null),
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    // Give the connKey effect a chance to run; the gate should still hold.
    await waitFor(() => {
      // connKey is set, but isAccessTokenFresh = false → empty URL.
      expect(result.current.streamUrl).toBe('');
    });
  });

  it('emits a streamUrl containing the new token after a refresh lands', async () => {
    useAuthStore.setState({
      accessToken: 'STALE-MARKER',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: vi.fn().mockResolvedValue(null),
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBe('');
    });

    // Simulate the refresh landing.
    act(() => {
      useAuthStore.setState({
        accessToken: 'FRESH-MARKER',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
      });
    });

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('token=FRESH-MARKER');
    });
    expect(result.current.streamUrl).not.toContain('STALE-MARKER');
  });
});
