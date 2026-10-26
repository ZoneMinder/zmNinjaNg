/**
 * useMonitorStream on iOS and Android: the native frame transport.
 *
 * A webview opens six connections per host, so a montage of MJPEG tiles
 * starves. On native the stream is held by native code and served one JPEG at
 * a time from zmframe://frames/<streamId>/<n>, so `imageSrc` is a frame URL
 * rather than the nph-zms URL, and every `load` chains to the next frame.
 * Snapshot mode, the web build and Electron keep the nph-zms URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const platform = vi.hoisted(() => ({ isNative: true }));
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return platform.isNative;
    },
    get isDesktopOrWeb() {
      return !platform.isNative;
    },
    get isWeb() {
      return !platform.isNative;
    },
    isDev: false,
    isIOS: true,
    isAndroid: false,
    isElectron: false,
    shouldUseProxy: false,
    isTVDevice: false,
  },
}));

const plugin = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  closeAll: vi.fn(),
}));
vi.mock('../../plugins/zm-stream', async () => {
  const actual = await vi.importActual<typeof import('../../plugins/zm-stream')>(
    '../../plugins/zm-stream'
  );
  return { ...actual, ZmStream: plugin };
});

vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
    auth: vi.fn(),
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../api/monitors', () => ({
  getStreamUrl: (cgiUrl: string, monitorId: string, options: Record<string, unknown>) => {
    const params = new URLSearchParams();
    params.set('monitor', monitorId);
    if (options.mode) params.set('mode', String(options.mode));
    if (options.connkey) params.set('connkey', String(options.connkey));
    if (options.cacheBuster) params.set('cacheBuster', String(options.cacheBuster));
    return `${cgiUrl}/nph-zms?${params.toString()}`;
  },
}));

vi.mock('../../lib/zm/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string) =>
    `${portalUrl}/zms?command=${command}&connkey=${connkey}`,
}));

vi.mock('../../lib/zm/zm-constants', () => ({
  ZMS_COMMANDS: { cmdQuit: 'quit' },
  ZMS_FRAMES_PARAM_MIN_VERSION: '1.38.0',
  ZM_DECODING_ONDEMAND: 'Ondemand',
}));

vi.mock('../useVisibilityResume', () => ({
  useVisibilityResume: () => {},
}));

import { useMonitorStream } from '../useMonitorStream';
import { resetNativeReclaimForTests } from '../useNativeMjpegFrames';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';
import type { Profile } from '../../api/types';
import { asProfileId } from '../../api/types';

describe('useMonitorStream: native frame transport', () => {
  const mockProfile: Profile = {
    id: asProfileId('profile-1'),
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: 0,
  };

  let nextConnKey = 100;
  let regenerateConnKey = vi.fn(() => (nextConnKey += 1));

  beforeEach(() => {
    platform.isNative = true;
    nextConnKey = 100;
    regenerateConnKey = vi.fn(() => (nextConnKey += 1));
    Object.values(plugin).forEach((fn) => fn.mockReset());
    plugin.open.mockResolvedValue({ streamId: 's1' });
    plugin.close.mockResolvedValue(undefined);
    plugin.closeAll.mockResolvedValue(undefined);
    resetNativeReclaimForTests();

    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: mockProfile.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', snapshotRefreshInterval: 1 },
      },
    });

    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    useAuthStore.setState({
      slices: {
        [mockProfile.id]: {
          accessToken: 'FRESH',
          refreshToken: null,
          accessTokenExpires: Date.now() + 60 * 60 * 1000,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
      getFreshAccessToken: vi.fn().mockResolvedValue('FRESH'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Renders a streaming tile and waits for the first native frame URL. */
  async function renderNative() {
    const view = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(view.result.current.imageSrc).toBe('zmframe://frames/s1/0'));
    return view;
  }

  /** Stands in for the `<img>` reporting which URL it actually loaded. */
  function reportLoadOf(
    view: Awaited<ReturnType<typeof renderNative>>,
    currentSrc: string,
  ) {
    // A real element: the stream lifecycle teardown calls removeAttribute on
    // whatever the ref holds. jsdom never populates currentSrc, so define it.
    const img = document.createElement('img');
    Object.defineProperty(img, 'currentSrc', { value: currentSrc, configurable: true });
    act(() => {
      view.result.current.imgRef.current = img;
      view.result.current.reportStreamLoad();
    });
  }

  it('streaming on native binds imageSrc to a zmframe URL, never to nph-zms', async () => {
    const { result } = await renderNative();

    expect(result.current.streamUrl).toContain('nph-zms');
    expect(result.current.imageSrc).toBe('zmframe://frames/s1/0');
    expect(plugin.open).toHaveBeenCalledWith({
      url: result.current.streamUrl,
      stallTimeoutMs: ZM_INTEGRATION.nativeFrameStallMs,
    });
  });

  it('snapshot on native still binds imageSrc to the nph-zms URL', async () => {
    const { result } = renderHook(() =>
      useMonitorStream({ monitorId: '1', viewModeOverride: 'snapshot' }),
    );
    await waitFor(() => expect(result.current.imageSrc).not.toBe(''));

    expect(result.current.imageSrc).toContain('nph-zms');
    expect(result.current.imageSrc).toBe(result.current.streamUrl);
    expect(plugin.open).not.toHaveBeenCalled();
  });

  it('hasFrame is false after open and true after reportStreamLoad for the current stream', async () => {
    const view = await renderNative();
    expect(view.result.current.hasFrame).toBe(false);

    reportLoadOf(view, 'zmframe://frames/s1/0');

    expect(view.result.current.hasFrame).toBe(true);
  });

  it('hasFrame stays true across frame advances', async () => {
    const view = await renderNative();
    reportLoadOf(view, 'zmframe://frames/s1/0');
    expect(view.result.current.hasFrame).toBe(true);

    // The accepted load bumped n, so the element is already asking for the
    // next frame. The picture on screen is still good throughout.
    expect(view.result.current.imageSrc).toBe('zmframe://frames/s1/1');
    expect(view.result.current.hasFrame).toBe(true);

    reportLoadOf(view, 'zmframe://frames/s1/1');

    expect(view.result.current.imageSrc).toBe('zmframe://frames/s1/2');
    expect(view.result.current.hasFrame).toBe(true);
  });

  it('a new connkey resets hasFrame until the new stream loads', async () => {
    plugin.open
      .mockResolvedValueOnce({ streamId: 's1' })
      .mockResolvedValueOnce({ streamId: 's2' });
    const view = await renderNative();
    reportLoadOf(view, 'zmframe://frames/s1/0');
    expect(view.result.current.hasFrame).toBe(true);

    act(() => view.result.current.regenerateConnection());

    expect(view.result.current.hasFrame).toBe(false);
    await waitFor(() => expect(view.result.current.imageSrc).toBe('zmframe://frames/s2/0'));
    // A frame off the dead stream is not a frame off this one.
    expect(view.result.current.hasFrame).toBe(false);

    reportLoadOf(view, 'zmframe://frames/s2/0');

    expect(view.result.current.hasFrame).toBe(true);
  });

  it('reportStreamLoad ignores a load whose src names the previous stream', async () => {
    const view = await renderNative();
    // An error arms a reconnect. A load off a stream that is already gone must
    // not count as proof this one works, so it must not disarm it either.
    act(() => view.result.current.reportStreamError());

    reportLoadOf(view, 'zmframe://frames/gone/7');

    expect(view.result.current.hasFrame).toBe(false);
    expect(view.result.current.imageSrc).toBe('zmframe://frames/s1/0');
    const keysBefore = regenerateConnKey.mock.calls.length;
    await waitFor(
      () => expect(regenerateConnKey.mock.calls.length).toBeGreaterThan(keysBefore),
      { timeout: ZM_INTEGRATION.mjpegEarlyRetryDelayMs + 2000 },
    );
  });

  it('recovers through the reconnect backoff when the native open fails', async () => {
    plugin.open
      .mockRejectedValueOnce(new Error('no native stream'))
      .mockResolvedValue({ streamId: 's2' });
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(plugin.open).toHaveBeenCalledTimes(1));

    // No <img> error fires for a src that was never set, so without a recovery
    // path of its own the tile would stay blank for good.
    expect(result.current.imageSrc).toBe('');
    await waitFor(() => expect(result.current.imageSrc).toBe('zmframe://frames/s2/0'), {
      timeout: ZM_INTEGRATION.mjpegEarlyRetryDelayMs + 2000,
    });
  });
});
