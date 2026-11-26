/**
 * useMonitorStream: token freshness gate
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
import { asProfileId } from '../../api/types';

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

vi.mock('../../lib/zm/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string, options: any) => {
    const params = new URLSearchParams();
    params.set('command', command);
    params.set('connkey', connkey);
    if (options?.token) params.set('token', options.token);
    return `${portalUrl}/api/host/daemonControl.json?${params.toString()}`;
  },
}));

vi.mock('../../lib/zm/zm-constants', () => ({
  ZMS_COMMANDS: {
    cmdQuit: 'quit',
  },
}));

describe('useMonitorStream: token freshness gate', () => {
  const mockProfile: Profile = {
    id: asProfileId('profile-1'),
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
      currentProfileId: mockProfile.id,
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
    useAuthStore.setState({ slices: {} });

    vi.clearAllMocks();
  });

  const EMPTY_SLICE = {
    accessToken: null,
    refreshToken: null,
    accessTokenExpires: null,
    refreshTokenExpires: null,
    version: null,
    apiVersion: null,
    isAuthenticated: false,
    requiresAuth: true,
  };

  function setAuthSlice(patch: Record<string, unknown>) {
    useAuthStore.setState((s) => ({
      slices: {
        ...s.slices,
        [mockProfile.id]: { ...(s.slices[mockProfile.id] ?? EMPTY_SLICE), ...patch },
      },
    }));
  }

  it('emits empty streamUrl when the access token has less than the leeway remaining', async () => {
    // Token expires in 5 minutes, under the 30-min leeway, so isFresh = false.
    setAuthSlice({
      accessToken: 'STALE-MARKER',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    // Stub getFreshAccessToken so the freshness hook's effect doesn't error.
    useAuthStore.setState({ getFreshAccessToken: vi.fn().mockResolvedValue(null) });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    // Give the connKey effect a chance to run; the gate should still hold.
    await waitFor(() => {
      // connKey is set, but isAccessTokenFresh = false → empty URL.
      expect(result.current.streamUrl).toBe('');
    });
  });

  it('emits a streamUrl containing the new token after a refresh lands', async () => {
    setAuthSlice({
      accessToken: 'STALE-MARKER',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    useAuthStore.setState({ getFreshAccessToken: vi.fn().mockResolvedValue(null) });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBe('');
    });

    // Simulate the refresh landing.
    act(() => {
      setAuthSlice({
        accessToken: 'FRESH-MARKER',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
      });
    });

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('token=FRESH-MARKER');
    });
    expect(result.current.streamUrl).not.toContain('STALE-MARKER');
  });

  // A new token on a live stream gets a new connkey (useStreamLifecycle), but
  // the render that brings the token runs before that effect. Building the URL
  // there sends the old connkey again under a new URL while zms still holds
  // the first request: the duplicate left Montage tiles black after a profile
  // switch (refs #609). No URL may pair a connkey with a token it was not
  // minted under.
  it('never pairs a connkey with a token it was not minted under', async () => {
    let next = 100;
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey: vi.fn(() => ++next) });
    setAuthSlice({
      accessToken: 'TOKEN-A',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
    });
    useAuthStore.setState({ getFreshAccessToken: vi.fn().mockResolvedValue(null) });

    const urls: string[] = [];
    const { result } = renderHook(() => {
      const r = useMonitorStream({ monitorId: '1' });
      if (r.streamUrl) urls.push(r.streamUrl);
      return r;
    });

    await waitFor(() => expect(result.current.streamUrl).toContain('token=TOKEN-A'));
    const firstKey = new URL(result.current.streamUrl).searchParams.get('connkey');

    act(() => {
      setAuthSlice({ accessToken: 'TOKEN-B', accessTokenExpires: Date.now() + 60 * 60 * 1000 });
    });

    await waitFor(() => expect(result.current.streamUrl).toContain('token=TOKEN-B'));
    const pairedWithB = urls.filter((u) => u.includes('token=TOKEN-B'))
      .map((u) => new URL(u).searchParams.get('connkey'));
    expect(pairedWithB).not.toContain(firstKey);
  });

  // Same for the host: the server map can move a monitor to another server
  // after login, and the old connkey must not go out to the new host (#609).
  it('never pairs a connkey with a stream host it was not minted for', async () => {
    let next = 200;
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey: vi.fn(() => ++next) });
    setAuthSlice({
      accessToken: 'TOKEN-A',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
    });
    useAuthStore.setState({ getFreshAccessToken: vi.fn().mockResolvedValue(null) });

    const urls: string[] = [];
    const { result } = renderHook(() => {
      const r = useMonitorStream({ monitorId: '1' });
      if (r.streamUrl) urls.push(r.streamUrl);
      return r;
    });

    await waitFor(() => expect(result.current.streamUrl).toContain('https://test.com/cgi-bin'));
    const firstKey = new URL(result.current.streamUrl).searchParams.get('connkey');

    act(() => {
      useProfileStore.setState({
        profiles: [{ ...mockProfile, portalUrl: 'https://other.com', cgiUrl: 'https://other.com/cgi-bin' }],
      });
    });

    await waitFor(() => expect(result.current.streamUrl).toContain('https://other.com/cgi-bin'));
    const onNewHost = urls.filter((u) => u.startsWith('https://other.com'))
      .map((u) => new URL(u).searchParams.get('connkey'));
    expect(onNewHost).not.toContain(firstKey);
  });
});
