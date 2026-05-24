/**
 * useMonitorStream: Tauri Rust MJPEG streaming path (#155)
 *
 * On Tauri desktop in streaming mode, frames are pulled by the Rust reader and
 * pushed over a Channel, then shown as data: URLs, so the webview never opens an
 * nph-zms socket (WebKitGTK CLOSE_WAIT leak). These tests verify the start call,
 * per-frame data: URL rendering, teardown on unmount, and error-driven reconnect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { startMjpegStream, stopMjpegStream } from '../../lib/tauri-mjpeg';
import { Platform } from '../../lib/platform';
import type { Profile } from '../../api/types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

vi.mock('../../lib/tauri-mjpeg', () => ({
  startMjpegStream: vi.fn(),
  stopMjpegStream: vi.fn(),
}));

vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({ data: null, status: 200, statusText: 'OK', headers: {} }),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
    dedupe: (_k: string, _w: number, emit: (s: string) => void) => emit(''),
  },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../api/monitors', () => ({
  getStreamUrl: (cgiUrl: string, monitorId: string, options: any) => {
    const params = new URLSearchParams();
    params.set('monitor', monitorId);
    if (options.mode) params.set('mode', options.mode);
    if (options.connkey) params.set('connkey', options.connkey.toString());
    return `${cgiUrl}/nph-zms?${params.toString()}`;
  },
}));

vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string) =>
    `${portalUrl}/api/host/daemonControl.json?command=${command}&connkey=${connkey}`,
}));

vi.mock('../../lib/zm-constants', () => ({ ZMS_COMMANDS: { cmdQuit: 'quit' } }));

const mockStart = vi.mocked(startMjpegStream);
const mockStop = vi.mocked(stopMjpegStream);

describe('useMonitorStream: Tauri Rust MJPEG streaming path', () => {
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

  let lastOnFrame: ((bytes: ArrayBuffer) => void) | undefined;
  let lastOnError: ((message: string) => void) | undefined;
  let isTauriLinuxSpy: ReturnType<typeof vi.spyOn> | undefined;

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
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', streamMaxFps: 5 },
      },
    });

    let nextKey = 1000;
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => ++nextKey),
    });

    objectUrlCounter = 0;
    createObjectURL = vi.fn(() => `blob:mock-${++objectUrlCounter}`);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    let nextId = 100;
    mockStart.mockReset();
    mockStop.mockReset();
    mockStart.mockImplementation(async (_url, onFrame, onError) => {
      lastOnFrame = onFrame;
      lastOnError = onError;
      return ++nextId;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    isTauriLinuxSpy?.mockRestore();
    isTauriLinuxSpy = undefined;
  });

  it('starts a Rust MJPEG stream for the streamUrl instead of binding <img src> to it', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalled();
    });
    const [calledUrl] = mockStart.mock.calls[0];
    expect(calledUrl).toContain('/nph-zms?');
    expect(calledUrl).toContain('mode=jpeg');
    expect(result.current.imageSrc).not.toBe(result.current.streamUrl);
  });

  it('Linux desktop: renders each frame as a data: URL, never a blob URL', async () => {
    isTauriLinuxSpy = vi.spyOn(Platform, 'isTauriLinux', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    act(() => lastOnFrame!(new Uint8Array([1, 2, 3]).buffer));
    await waitFor(() => expect(result.current.imageSrc).toMatch(/^data:image\/jpeg;base64,/));

    act(() => lastOnFrame!(new Uint8Array([4, 5, 6]).buffer));
    await waitFor(() => expect(result.current.imageSrc).toMatch(/^data:image\/jpeg;base64,/));

    // data: URLs go through the purgeable resource cache; no blob registry use.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('non-Linux desktop: renders each frame as a blob URL and revokes the previous', async () => {
    isTauriLinuxSpy = vi.spyOn(Platform, 'isTauriLinux', 'get').mockReturnValue(false);
    const { result, unmount } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    act(() => lastOnFrame!(new Uint8Array([1, 2, 3]).buffer));
    await waitFor(() => expect(result.current.imageSrc).toBe('blob:mock-1'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => lastOnFrame!(new Uint8Array([4, 5, 6]).buffer));
    await waitFor(() => expect(result.current.imageSrc).toBe('blob:mock-2'));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    // Replacing a frame revokes the prior one so WKWebView/WebView2 free it.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');

    // The outstanding URL is revoked on unmount.
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-2');
  });

  it('stops the stream on unmount', async () => {
    const { result, unmount } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    act(() => lastOnFrame!(new Uint8Array([1, 2, 3]).buffer));
    await waitFor(() => expect(result.current.imageSrc).toBeTruthy());

    unmount();

    expect(mockStop).toHaveBeenCalled();
  });

  it('reconnects with backoff after an error by regenerating the connkey', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    const firstUrl = result.current.streamUrl;

    act(() => lastOnError!('stream ended'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
    expect(result.current.streamUrl).not.toBe(firstUrl);
  });
});
