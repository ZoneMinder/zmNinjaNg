/**
 * useMonitorStream: Tauri canvas snapshot path (#150)
 *
 * On Linux desktop (Tauri/WebKitGTK) the network process leaks CLOSE_WAIT
 * sockets when an <img src> points directly at ZoneMinder's nph-zms CGI in
 * snapshot mode. The fix: on Tauri desktop in snapshot mode, fetch each frame
 * through the Rust mjpeg_snapshot command, decode it with createImageBitmap, and
 * draw it to a <canvas>. No blob: URLs are created (WebKitGTK retained their
 * decoded bytes in the network process).
 *
 * These tests verify the fetch goes through Rust, frames are decoded and drawn to
 * the canvas (bitmaps closed, no blob URLs), the path is gated to Tauri snapshot,
 * and fetch failures are handled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RefObject } from 'react';
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

describe('useMonitorStream: Tauri canvas snapshot path', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  let drawImage: ReturnType<typeof vi.fn>;
  let closeBitmap: ReturnType<typeof vi.fn>;
  let createImageBitmapMock: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let mockCanvas: HTMLCanvasElement;

  // Attach a mock canvas to the hook's canvasRef so the decode loop has a target.
  function attachCanvas(canvasRef: RefObject<HTMLCanvasElement | null>) {
    canvasRef.current = mockCanvas;
  }

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
          // mid-assertion. Tests that need a second frame use regenerateConnection.
          snapshotRefreshInterval: 600,
        },
      },
    });

    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => 12345),
    });

    vi.clearAllMocks();

    // Fresh decode/draw spies created after clearAllMocks so they start clean.
    drawImage = vi.fn();
    closeBitmap = vi.fn();
    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    createImageBitmapMock = vi.fn(async () => ({
      width: 640,
      height: 480,
      close: closeBitmap,
    }));
    global.createImageBitmap = createImageBitmapMock as unknown as typeof createImageBitmap;
    // Spy so we can assert the canvas path never creates blob URLs.
    createObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;

    // Re-establish module mock implementations cleared by clearAllMocks.
    mockFetchMjpegSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mockHttpGet.mockResolvedValue({ data: null, status: 200, statusText: 'OK', headers: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the frame via the Rust mjpeg_snapshot command and draws it to the canvas', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    attachCanvas(result.current.canvasRef);

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

    // The frame is decoded and drawn to the canvas, then the bitmap is freed.
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(closeBitmap).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hasFrame).toBe(true));

    // Canvas path: no blob URLs, and <img src> is never used for Tauri.
    expect(result.current.useCanvas).toBe(true);
    expect(result.current.imageSrc).toBe('');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('decodes a new frame on refresh without creating blob URLs', async () => {
    // Incrementing connKey so a refresh produces a different streamUrl and
    // drives a second fetch deterministically (no reliance on timers).
    let nextKey = 1000;
    useMonitorStore.setState({ regenerateConnKey: vi.fn(() => ++nextKey) });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    attachCanvas(result.current.canvasRef);

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    expect(closeBitmap).toHaveBeenCalledTimes(1);

    // Trigger a new connection -> new streamUrl -> second frame fetch.
    act(() => {
      result.current.regenerateConnection();
    });

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    expect(closeBitmap).toHaveBeenCalledTimes(2);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('streaming mode on Tauri uses the Rust reader, not the snapshot fetch path', async () => {
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
    expect(result.current.useCanvas).toBe(true);
    expect(result.current.imageSrc).toBe('');
  });

  it('does not throw when a fetch fails and logs the error', async () => {
    const { log } = await import('../../lib/logger');
    mockFetchMjpegSnapshot.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    attachCanvas(result.current.canvasRef);

    await waitFor(() => {
      expect(mockFetchMjpegSnapshot).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(log.monitor).toHaveBeenCalled();
    });

    // No frame drawn, hasFrame stays false, nothing crashed, no blob URLs.
    expect(result.current.hasFrame).toBe(false);
    expect(drawImage).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
