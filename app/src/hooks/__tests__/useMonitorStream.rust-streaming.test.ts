/**
 * useMonitorStream: Tauri Rust MJPEG streaming path (#155)
 *
 * On Tauri desktop in streaming mode, frames are pulled by the Rust reader and
 * pushed over a Channel, then decoded with createImageBitmap and drawn to a
 * <canvas>, so the webview never opens an nph-zms socket (WebKitGTK CLOSE_WAIT
 * leak) and never creates blob: URLs (which WebKitGTK retained in the network
 * process). These tests verify the start call, the per-frame decode/draw/close
 * lifecycle, teardown on unmount, and error-driven reconnect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RefObject } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { startMjpegStream, stopMjpegStream } from '../../lib/tauri-mjpeg';
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

  let drawImage: ReturnType<typeof vi.fn>;
  let closeBitmap: ReturnType<typeof vi.fn>;
  let createImageBitmapMock: ReturnType<typeof vi.fn>;
  let mockCanvas: HTMLCanvasElement;

  let lastOnFrame: ((bytes: ArrayBuffer) => void) | undefined;
  let lastOnError: ((message: string) => void) | undefined;

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
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', streamMaxFps: 5 },
      },
    });

    let nextKey = 1000;
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => ++nextKey),
    });

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
    // Spy so the canvas path can assert it never creates blob URLs.
    URL.createObjectURL = vi.fn() as unknown as typeof URL.createObjectURL;

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
  });

  it('starts a Rust MJPEG stream and selects the canvas render path', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalled();
    });
    const [calledUrl] = mockStart.mock.calls[0];
    expect(calledUrl).toContain('/nph-zms?');
    expect(calledUrl).toContain('mode=jpeg');
    expect(result.current.useCanvas).toBe(true);
    // Streaming frames go to the canvas, never to <img src>.
    expect(result.current.imageSrc).toBe('');
  });

  it('decodes each frame to the canvas and closes the bitmap, never creating blob URLs', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    attachCanvas(result.current.canvasRef);

    act(() => lastOnFrame!(new ArrayBuffer(4)));

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(closeBitmap).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hasFrame).toBe(true));

    act(() => lastOnFrame!(new ArrayBuffer(4)));
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    expect(closeBitmap).toHaveBeenCalledTimes(2);

    // The canvas path must not touch the blob-URL registry at all.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('stops the stream on unmount', async () => {
    const { result, unmount } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    attachCanvas(result.current.canvasRef);
    act(() => lastOnFrame!(new ArrayBuffer(4)));
    await waitFor(() => expect(drawImage).toHaveBeenCalled());

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
