/**
 * useMonitorStream Hook Tests
 *
 * Basic tests for the useMonitorStream hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { httpGet } from '../../lib/http';
import type { Profile } from '../../api/types';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';

// Mock dependencies
vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

const mockHttpGet = vi.mocked(httpGet);

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
    if (options.frames) params.set('frames', options.frames.toString());
    if (options.connkey) params.set('connkey', options.connkey.toString());
    if (options.scale) params.set('scale', options.scale.toString());
    if (options.maxfps) params.set('maxfps', options.maxfps.toString());
    if (options.cacheBuster) params.set('rand', options.cacheBuster.toString());
    if (options.token) params.set('token', options.token);
    if (options.minStreamingPort) params.set('minStreamingPort', options.minStreamingPort.toString());
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
    cmdAnalyzeOn: 'analyzeOn',
    cmdAnalyzeOff: 'analyzeOff',
  },
  ZMS_FRAMES_PARAM_MIN_VERSION: '1.37.61',
  ZM_DECODING_ONDEMAND: 'Ondemand',
}));

describe('useMonitorStream', () => {
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
    // Reset stores
    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: mockProfile.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useAuthStore.setState({
      slices: {
        [mockProfile.id]: {
          accessToken: 'test-token',
          accessTokenExpires: Date.now() + 60 * 60 * 1000,
          refreshToken: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        },
      },
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
      regenerateConnKey: vi.fn((monitorId: string) => {
        const key = Date.now() + parseInt(monitorId);
        useMonitorStore.setState((state) => ({
          connKeys: { ...state.connKeys, [monitorId]: key },
        }));
        return key;
      }),
    });

    vi.clearAllMocks();
  });

  it('generates connKey on mount', async () => {
    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    renderHook(() => useMonitorStream({ monitorId: '1' }));

    // Keyed by profileId:monitorId (refs #337), even in single mode, so the
    // key stays unique alongside any other profile sharing monitor id '1'.
    await waitFor(() => {
      expect(regenerateConnKey).toHaveBeenCalledWith('profile-1:1');
    });
  });

  it('returns empty streamUrl when no profile exists', async () => {
    useProfileStore.setState({
      profiles: [],
      currentProfileId: null,
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    expect(result.current.streamUrl).toBe('');
  });

  it('returns empty streamUrl when connKey is 0', async () => {
    const regenerateConnKey = vi.fn(() => 0);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBe('');
    });
  });

  it('provides imgRef for image element', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    expect(result.current.imgRef).toBeTruthy();
    expect(result.current.imgRef.current).toBeNull(); // Initially null
  });

  it('includes correct parameters in streaming mode', async () => {
    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    // Check streaming mode parameters
    // Note: Normal bandwidth mode uses 100% image scale
    expect(result.current.streamUrl).toContain('mode=jpeg');
    expect(result.current.streamUrl).toContain('connkey=12345');
    expect(result.current.streamUrl).toContain('scale=100');
    expect(result.current.streamUrl).toContain('maxfps=5');
    expect(result.current.streamUrl).not.toContain('rand='); // No cacheBuster in streaming
  });

  it('includes correct parameters in snapshot mode', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    // Check snapshot mode parameters
    // Note: Normal bandwidth mode uses 100% image scale
    expect(result.current.streamUrl).toContain('mode=single');
    // No connkey in snapshot: zms never opens a command socket for a
    // single-frame request, and nothing ever sends CMD_QUIT for it (refs #383).
    expect(result.current.streamUrl).not.toContain('connkey');
    expect(result.current.streamUrl).toContain('scale=100');
    expect(result.current.streamUrl).not.toContain('maxfps'); // No maxfps in snapshot
    expect(result.current.streamUrl).toContain('rand='); // cacheBuster in snapshot
  });

  it('drops a caller-supplied maxfps in snapshot mode (refs #461)', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
        },
      },
    });
    useMonitorStore.setState({ regenerateConnKey: vi.fn(() => 12345) });

    // LiveMonitorPlayer always passes maxfps through streamOptions; the
    // spread used to put it back on a request that has no frame rate.
    const { result } = renderHook(() =>
      useMonitorStream({ monitorId: '1', streamOptions: { maxfps: 10, scale: 50 } })
    );

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    expect(result.current.streamUrl).toContain('scale=50');
    expect(result.current.streamUrl).not.toContain('maxfps');
  });

  describe('snapshot request shape by monitor decoding', () => {
    // mode=single reads shared memory without marking the monitor as viewed, so
    // a monitor that decodes on demand stops decoding and the snapshot freezes
    // (refs #383). mode=jpeg&frames=1 runs one pass of the streaming loop, which
    // does mark the monitor as viewed, then stops after a single frame.
    const snapshotOn = (version: string | null) => {
      useSettingsStore.setState({
        profileSettings: {
          'profile-1': {
            ...DEFAULT_SETTINGS,
            viewMode: 'snapshot',
          },
        },
      });
      useAuthStore.setState({
        slices: {
          [mockProfile.id]: {
            ...useAuthStore.getState().slices[mockProfile.id],
            version,
          },
        },
      });
    };

    it('polls a one-frame jpeg stream for a monitor that decodes on demand', async () => {
      snapshotOn('1.38.0');

      const { result } = renderHook(() =>
        useMonitorStream({ monitorId: '1', decoding: 'Ondemand' }),
      );

      await waitFor(() => {
        expect(result.current.streamUrl).toBeTruthy();
      });

      expect(result.current.streamUrl).toContain('mode=jpeg');
      expect(result.current.streamUrl).toContain('frames=1');
      expect(result.current.streamUrl).not.toContain('connkey');
      expect(result.current.streamUrl).not.toContain('maxfps');
      expect(result.current.streamUrl).toContain('rand=');
    });

    it('keeps mode=single for a monitor on Decoding=Always', async () => {
      // It never stops decoding, so the cheaper single-image request is enough.
      snapshotOn('1.38.0');

      const { result } = renderHook(() =>
        useMonitorStream({ monitorId: '1', decoding: 'Always' }),
      );

      await waitFor(() => {
        expect(result.current.streamUrl).toBeTruthy();
      });

      expect(result.current.streamUrl).toContain('mode=single');
      expect(result.current.streamUrl).not.toContain('frames=');
    });

    // Only pure on-demand decoding has nothing decoded between viewers. The two
    // keyframe modes keep decoding keyframes whether or not anyone is watching,
    // so shared memory always holds a recent picture and the cheap mode=single
    // read is enough. frames=1 starts a streaming pass per poll, which across a
    // large montage is what made it crawl (refs #507).
    it.each(['KeyFrames', 'KeyFrames+Ondemand'])(
      'sends a plain snapshot to a monitor decoding %s',
      async (decoding) => {
        snapshotOn('1.38.0');

        const { result } = renderHook(() => useMonitorStream({ monitorId: '1', decoding }));

        await waitFor(() => {
          expect(result.current.streamUrl).toBeTruthy();
        });

        expect(result.current.streamUrl).toContain('mode=single');
        expect(result.current.streamUrl).not.toContain('frames=');
      },
    );

    it('keeps mode=single when the server reports no decoding value', async () => {
      // Pre-1.37 servers have no Decoding field and no frames= either; their zms
      // logs unknown parameters and would stream forever on every poll.
      snapshotOn('1.36.35');

      const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

      await waitFor(() => {
        expect(result.current.streamUrl).toBeTruthy();
      });

      expect(result.current.streamUrl).toContain('mode=single');
      expect(result.current.streamUrl).not.toContain('frames=');
    });

    it('keeps mode=single on 1.37 builds that have Decoding but no frames=', async () => {
      snapshotOn('1.37.44');

      const { result } = renderHook(() =>
        useMonitorStream({ monitorId: '1', decoding: 'Ondemand' }),
      );

      await waitFor(() => {
        expect(result.current.streamUrl).toBeTruthy();
      });

      expect(result.current.streamUrl).toContain('mode=single');
      expect(result.current.streamUrl).not.toContain('frames=');
    });
  });

  it('on web, snapshot mode mirrors streamUrl into imageSrc without fetching frames', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('mode=single');
    });

    // Web/native snapshot is unchanged: the <img> loads streamUrl directly.
    expect(result.current.imageSrc).toBe(result.current.streamUrl);
    // No per-frame fetch happens for the <img> path.
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('snapshot refresh fires at the user-set interval, not the bandwidth default', async () => {
    // Normal bandwidth mode has a 3s snapshotRefreshInterval default. The user
    // sets 7s. The refresh must honor the user value, not the bandwidth default.
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
          bandwidthMode: 'normal',
          snapshotRefreshInterval: 7,
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

      // Let mount effects (connKey, cacheBuster, interval registration) settle.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const getRand = () =>
        new URLSearchParams(result.current.streamUrl.split('?')[1] ?? '').get('rand');

      const initialRand = getRand();
      expect(initialRand).toBeTruthy();

      // Settle the first request. A tile skips its tick while its own load is
      // still in flight (refs #507), and this test is about which interval is
      // honored, not about that gate - see useMonitorStream.snapshot-refresh.
      act(() => {
        result.current.reportStreamLoad();
      });

      // At 3s (the bandwidth-mode default) the snapshot must NOT have refreshed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(getRand()).toBe(initialRand);

      // At 7s (the user-set interval) it refreshes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(getRand()).not.toBe(initialRand);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries quickly when a fresh stream errors, releasing the errored connkey first', async () => {
    let key = 100;
    const regenerateConnKey = vi.fn((monitorId: string) => {
      const k = ++key;
      useMonitorStore.setState((s) => ({ connKeys: { ...s.connKeys, [monitorId]: k } }));
      return k;
    });
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.streamUrl).toContain('connkey=101');

      mockHttpGet.mockClear();

      // Stream errors seconds after it appeared, which is the profile-switch
      // case: a reconnect is scheduled at the early interval, and must not
      // fire before it.
      act(() => {
        result.current.reportStreamError();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZM_INTEGRATION.mjpegEarlyRetryDelayMs - 100);
      });
      expect(mockHttpGet).not.toHaveBeenCalled();

      // Then the reconnect CMD_QUITs the old connkey (101) before minting a
      // fresh one (102).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('connkey=101'),
        expect.anything(),
      );
      expect(result.current.streamUrl).toContain('connkey=102');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps retrying a young stream instead of spending its give-up budget', async () => {
    // The profile-switch case: a screenful of tiles opens into a server still
    // freeing the slots the outgoing profile just quit, so every one of them
    // errors several times in a row. Before the opening window existed, six
    // such errors used the whole allowance and the tile went dark until a
    // remount - which is why changing screens "fixed" it.
    let key = 100;
    const regenerateConnKey = vi.fn((monitorId: string) => {
      const k = ++key;
      useMonitorStore.setState((s) => ({ connKeys: { ...s.connKeys, [monitorId]: k } }));
      return k;
    });
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Seven failures inside the window, one more than the cap allows.
      for (let i = 0; i < 7; i++) {
        act(() => {
          result.current.reportStreamError();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ZM_INTEGRATION.mjpegEarlyRetryDelayMs);
        });
      }

      // Still streaming on a fresh key rather than given up: the connkey is
      // live in the store, and the URL carries one.
      expect(result.current.streamUrl).toContain('connkey=');
      expect(useMonitorStore.getState().connKeys['profile-1:1']).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the connkey after giving up at the reconnect cap', async () => {
    let key = 100;
    const regenerateConnKey = vi.fn((monitorId: string) => {
      const k = ++key;
      useMonitorStore.setState((s) => ({ connKeys: { ...s.connKeys, [monitorId]: k } }));
      return k;
    });
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => {
      expect(result.current.streamUrl).toContain('connkey=101');
    });

    mockHttpGet.mockClear();

    // Past the opening window, where retries start spending the budget: inside
    // it they are free, so a saturated server cannot exhaust the allowance
    // meant for a server that is actually gone. Fake timers scoped to this
    // block: a leaked system-time mock breaks every test that follows.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + ZM_INTEGRATION.mjpegEarlyRetryWindowMs + 1000);

      // mjpegReconnectMaxAttempts is 6: the first six errors schedule retries,
      // the seventh hits the cap and gives up.
      act(() => {
        for (let i = 0; i < 7; i++) result.current.reportStreamError();
      });

      // On give-up the current connkey (101) is released via CMD_QUIT and
      // cleared from the store, not orphaned until unmount.
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('connkey=101'),
        expect.anything(),
      );
      expect(useMonitorStore.getState().connKeys['profile-1:1']).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('empties streamUrl and imageSrc while disabled, and mints a fresh connkey on re-enable', async () => {
    // The Go2RTC fallback case: the MJPEG placeholder streams while WebRTC
    // negotiates, gets disabled once video frames arrive, and comes back when
    // WebRTC drops. Nothing may mount an <img> on the dead first connkey.
    let key = 200;
    const regenerateConnKey = vi.fn((monitorId: string) => {
      const k = ++key;
      useMonitorStore.setState((s) => ({ connKeys: { ...s.connKeys, [monitorId]: k } }));
      return k;
    });
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMonitorStream({ monitorId: '1', enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('connkey=201');
    });

    rerender({ enabled: false });

    await waitFor(() => {
      expect(result.current.imageSrc).toBe('');
    });
    expect(result.current.streamUrl).toBe('');
    // The first key was quit, not orphaned.
    expect(mockHttpGet).toHaveBeenCalledWith(
      expect.stringContaining('connkey=201'),
      expect.anything(),
    );

    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('connkey=202');
    });
    expect(result.current.streamUrl).not.toContain('connkey=201');
    await waitFor(() => {
      expect(result.current.imageSrc).toContain('connkey=202');
    });
  });

  it('drops an armed reconnect timer when disabled, so no key is minted while disabled', async () => {
    let key = 300;
    const regenerateConnKey = vi.fn((monitorId: string) => {
      const k = ++key;
      useMonitorStore.setState((s) => ({ connKeys: { ...s.connKeys, [monitorId]: k } }));
      return k;
    });
    useMonitorStore.setState({ connKeys: {}, regenerateConnKey });

    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useMonitorStream({ monitorId: '1', enabled }),
        { initialProps: { enabled: true } },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.streamUrl).toContain('connkey=301');

      // The <img> errors and arms a backoff reconnect, then WebRTC frames
      // arrive and the MJPEG side is disabled before the timer fires.
      act(() => {
        result.current.reportStreamError();
      });
      rerender({ enabled: false });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // A disabled hook mints nothing: a key minted here could not stream and
      // would be reused on re-enable instead of a fresh one.
      expect(regenerateConnKey).toHaveBeenCalledTimes(1);
      expect(result.current.streamUrl).toBe('');

      rerender({ enabled: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(regenerateConnKey).toHaveBeenCalledTimes(2);
      expect(result.current.streamUrl).toContain('connkey=302');
    } finally {
      vi.useRealTimers();
    }
  });

  it('viewModeOverride forces streaming when settings say snapshot', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
          streamMaxFps: 5,
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() =>
      useMonitorStream({ monitorId: '1', viewModeOverride: 'streaming' })
    );

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    expect(result.current.streamUrl).toContain('mode=jpeg');
    expect(result.current.streamUrl).toContain('maxfps=5');
    expect(result.current.streamUrl).not.toContain('mode=single');
    expect(result.current.streamUrl).not.toContain('rand=');
  });
});

describe('useMonitorStream: explicit profileId (All mode)', () => {
  const profileA: Profile = {
    id: asProfileId('profile-a'),
    name: 'Profile A',
    apiUrl: 'https://a.example.com',
    portalUrl: 'https://a.example.com',
    cgiUrl: 'https://a.example.com/cgi-bin',
    minStreamingPort: 30000,
    isDefault: true,
    createdAt: Date.now(),
  };

  const profileB: Profile = {
    id: asProfileId('profile-b'),
    name: 'Profile B',
    apiUrl: 'https://b.example.com',
    portalUrl: 'https://b.example.com',
    cgiUrl: 'https://b.example.com/cgi-bin',
    minStreamingPort: 40000,
    isDefault: false,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [profileA, profileB],
      currentProfileId: profileA.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useAuthStore.setState({
      slices: {
        [profileA.id]: {
          accessToken: 'token-a',
          accessTokenExpires: Date.now() + 60 * 60 * 1000,
          refreshToken: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        },
        [profileB.id]: {
          accessToken: 'token-b',
          accessTokenExpires: Date.now() + 60 * 60 * 1000,
          refreshToken: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        },
      },
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-a': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamMaxFps: 5,
        },
        'profile-b': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamMaxFps: 5,
        },
      },
    });

    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn((monitorId: string) => {
        const key = Date.now() + parseInt(monitorId);
        useMonitorStore.setState((state) => ({
          connKeys: { ...state.connKeys, [monitorId]: key },
        }));
        return key;
      }),
    });

    vi.clearAllMocks();
  });

  it('builds the stream URL from the explicit profileId, not the current profile', async () => {
    const regenerateConnKey = vi.fn(() => 999);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() =>
      useMonitorStream({ monitorId: '1', profileId: profileB.id })
    );

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    expect(result.current.streamUrl).toContain('https://b.example.com/cgi-bin');
    expect(result.current.streamUrl).toContain('token=token-b');
    expect(result.current.streamUrl).toContain('minStreamingPort=40000');
    expect(result.current.streamUrl).not.toContain('a.example.com');
    expect(result.current.streamUrl).not.toContain('token=token-a');
    expect(result.current.streamUrl).not.toContain('minStreamingPort=30000');
  });

  it('defaults to the current profile when profileId is omitted', async () => {
    const regenerateConnKey = vi.fn(() => 999);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    expect(result.current.streamUrl).toContain('https://a.example.com/cgi-bin');
    expect(result.current.streamUrl).toContain('token=token-a');
    expect(result.current.streamUrl).toContain('minStreamingPort=30000');
    expect(result.current.streamUrl).not.toContain('minStreamingPort=40000');
  });
});

// Two-tier view preferences (refs #337): a tile streams under its owning
// server's viewMode and analysis setting in single mode, but under the ALL
// bucket's while aggregating, so one toolbar toggle governs every tile no
// matter which server it came from.
describe('useMonitorStream: view preferences resolve two-tier', () => {
  const profileB: Profile = {
    id: asProfileId('profile-b'),
    name: 'Profile B',
    apiUrl: 'https://b.example.com',
    portalUrl: 'https://b.example.com',
    cgiUrl: 'https://b.example.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [profileB],
      currentProfileId: profileB.id,
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useAuthStore.setState({
      slices: {
        [profileB.id]: {
          accessToken: 'token-b',
          accessTokenExpires: Date.now() + 60 * 60 * 1000,
          refreshToken: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        },
      },
    });

    // The owning server sits on streaming with analysis off; the ALL bucket
    // imposes snapshot and turns analysis on.
    useSettingsStore.setState({
      profileSettings: {
        'profile-b': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          showAnalysisFrames: false,
        },
        [ALL_PROFILES_ID]: {
          ...DEFAULT_SETTINGS,
          allModeViewMode: 'snapshot',
          showAnalysisFrames: true,
        },
      },
    });

    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => 4242),
    });

    vi.clearAllMocks();
  });

  const renderTile = () =>
    renderHook(() => useMonitorStream({ monitorId: '1', profileId: profileB.id }));

  it('streams under the owning profile in single mode', async () => {
    const { result } = renderTile();

    await waitFor(() => expect(result.current.streamUrl).toBeTruthy());
    expect(result.current.streamUrl).toContain('mode=jpeg');
  });

  it('sends no analysis command in single mode when the owner has it off', async () => {
    const { result } = renderTile();
    await waitFor(() => expect(result.current.streamUrl).toBeTruthy());

    act(() => { result.current.reportStreamLoad(); });

    expect(mockHttpGet).not.toHaveBeenCalledWith(
      expect.stringContaining('command=analyzeOn'),
      expect.anything(),
    );
  });

  it('keeps streaming under the owning profile in All mode while the mode is per-server', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-b': { ...DEFAULT_SETTINGS, viewMode: 'streaming', showAnalysisFrames: false },
      },
    });
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

    const { result } = renderTile();

    await waitFor(() => expect(result.current.streamUrl).toBeTruthy());
    expect(result.current.streamUrl).toContain('mode=jpeg');
  });

  it("uses the ALL bucket's snapshot viewMode in All mode", async () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

    const { result } = renderTile();

    await waitFor(() => expect(result.current.streamUrl).toBeTruthy());
    expect(result.current.streamUrl).toContain('mode=single');
  });

  it("applies the ALL bucket's analysis setting to an owned tile in All mode", async () => {
    useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
    // Analysis commands only reach a live streaming process, so keep the ALL
    // bucket on streaming for this one.
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      allModeViewMode: 'streaming',
    });

    const { result } = renderTile();
    await waitFor(() => expect(result.current.streamUrl).toBeTruthy());

    act(() => { result.current.reportStreamLoad(); });

    expect(mockHttpGet).toHaveBeenCalledWith(
      expect.stringContaining('command=analyzeOn'),
      expect.anything(),
    );
  });
});
