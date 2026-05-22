/**
 * useMonitorStream: Tauri blob snapshot path (#150)
 *
 * On Linux desktop (Tauri/WebKitGTK) the network process leaks CLOSE_WAIT
 * sockets when an <img src> points directly at ZoneMinder's nph-zms CGI in
 * snapshot mode. The fix: on Tauri desktop in snapshot mode only, fetch each
 * frame through the Rust mjpeg_snapshot command and display it as a blob:
 * object URL so the webview never opens a socket to ZoneMinder.
 *
 * These tests verify the URL lifecycle (create on success, revoke the previous
 * frame, revoke on unmount), and that the path is strictly gated to Tauri +
 * snapshot. They exercise real behavior, not mock construction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { fetchMjpegSnapshot } from '../../lib/tauri-mjpeg';
import { httpGet } from '../../lib/http';
import type { Profile } from '../../api/types';

// Force the Tauri code path. Platform.isTauri reads isTauri() lazily, and
// Platform.isNative reads Capacitor (mocked non-native in tests/setup.ts).
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({ data: null, status: 200, statusText: 'OK', headers: {} }),
}));

vi.mock('../../lib/tauri-mjpeg', () => ({
  startMjpegStream: vi.fn().mockResolvedValue(1),
  stopMjpegStream: vi.fn(),
  fetchMjpegSnapshot: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
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
    if (options.cacheBuster) params.set('rand', options.cacheBuster.toString());
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

const mockFetchMjpegSnapshot = vi.mocked(fetchMjpegSnapshot);
// httpGet is used by useStreamLifecycle for CMD_QUIT; needs a Promise return.
const mockHttpGet = vi.mocked(httpGet);

describe('useMonitorStream: Tauri blob snapshot path', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  let objectUrlCounter = 0;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: 'profile-1',
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useAuthStore.setState({
      accessToken: 'test-token',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      refreshToken: null,
      isAuthenticated: false,
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
          // Long interval by default so the periodic refresh does not fire
          // mid-assertion. Tests that need a second frame use fake timers.
          snapshotRefreshInterval: 600,
        },
      },
    });

    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => 12345),
    });

    // jsdom does not implement object URL APIs. Stub them with counting spies.
    objectUrlCounter = 0;
    createObjectURL = vi.fn(() => `blob:mock-${++objectUrlCounter}`);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    vi.clearAllMocks();
    // clearAllMocks resets mock implementations; restore them.
    createObjectURL.mockImplementation(() => `blob:mock-${++objectUrlCounter}`);
    mockFetchMjpegSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    // useStreamLifecycle calls httpGet for CMD_QUIT; must return a Promise.
    mockHttpGet.mockResolvedValue({ data: null, status: 200, statusText: 'OK', headers: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the frame via the Rust mjpeg_snapshot command and exposes the object URL as imageSrc', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('mode=single');
    });

    await waitFor(() => {
      expect(mockFetchMjpegSnapshot).toHaveBeenCalled();
    });

    // It must fetch the nph-zms snapshot URL through the Rust mjpeg_snapshot
    // command instead of pointing <img src> at it directly.
    const [calledUrl] = mockFetchMjpegSnapshot.mock.calls[0];
    expect(calledUrl).toContain('/nph-zms?');
    expect(calledUrl).toContain('mode=single');
    expect(calledUrl).toContain('connkey=12345');

    await waitFor(() => {
      expect(result.current.imageSrc).toBe('blob:mock-1');
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the previous object URL when a newer frame is fetched', async () => {
    // Incrementing connKey so a refresh produces a different streamUrl and
    // drives a second fetch deterministically (no reliance on timers).
    let nextKey = 1000;
    useMonitorStore.setState({ regenerateConnKey: vi.fn(() => ++nextKey) });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.imageSrc).toBe('blob:mock-1');
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Trigger a new connection → new streamUrl → second frame fetch.
    act(() => {
      result.current.regenerateConnection();
    });

    await waitFor(() => {
      expect(result.current.imageSrc).toBe('blob:mock-2');
    });

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    // The first frame's URL must be revoked; the current one must not.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:mock-2');
  });

  it('revokes the outstanding object URL on unmount', async () => {
    const { result, unmount } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.imageSrc).toBe('blob:mock-1');
    });

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('streaming mode on Tauri uses the Rust reader, not the snapshot httpGet path', async () => {
    const { startMjpegStream } = await import('../../lib/tauri-mjpeg');
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamMaxFps: 5,
        },
      },
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('mode=jpeg');
    });

    await waitFor(() => {
      expect(startMjpegStream).toHaveBeenCalled();
    });
    expect(mockFetchMjpegSnapshot).not.toHaveBeenCalled();
    expect(result.current.imageSrc).not.toBe(result.current.streamUrl);
  });

  it('does not throw when a fetch fails and logs the error', async () => {
    const { log } = await import('../../lib/logger');
    mockFetchMjpegSnapshot.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(mockFetchMjpegSnapshot).toHaveBeenCalled();
    });

    // No object URL was created, imageSrc stays empty, component did not crash.
    await waitFor(() => {
      expect(log.monitor).toHaveBeenCalled();
    });
    expect(result.current.imageSrc).toBe('');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
