/**
 * useMonitorStream: the snapshot refresh does not cancel its own request
 *
 * A browser allows six connections per host over HTTP/1.1, so a montage of 74
 * tiles queues most of its snapshot requests. The refresh tick used to mint a
 * fresh cacheBuster for every tile regardless, and reassigning a pending
 * `<img src>` cancels the in-flight load silently - no `error` event fires, so
 * nothing reports it and the request goes to the back of the queue. Past the
 * point where a full sweep takes longer than the refresh interval, the queue
 * never drains: measured against WebKit with 74 tiles, a 3s interval and a
 * 1.2s server, 12 tiles painted in 14 seconds and zero errors were raised
 * (refs #507).
 *
 * So a tile skips its tick while its own request is still in flight, and takes
 * the next one after the load settles. A tile whose request never settles
 * still retries once snapshotInFlightCeilingMs has passed, or a genuinely
 * stuck feed would freeze for good.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import type { Profile } from '../../api/types';
import { asProfileId } from '../../api/types';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';

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

// Inert here: this file exercises the refresh tick, not the resume path.
vi.mock('../useVisibilityResume', () => ({
  useVisibilityResume: () => {},
}));

describe('useMonitorStream: snapshot refresh in-flight gate', () => {
  const mockProfile: Profile = {
    id: asProfileId('profile-1'),
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: 0,
  };

  const INTERVAL_SECONDS = 3;
  let nextConnKey = 100;

  beforeEach(() => {
    // Installed before the hook renders, or the refresh interval would be a
    // real timer that advanceTimersByTime never fires - which makes the
    // "src held" assertion pass for the wrong reason. shouldAdvanceTime lets
    // the awaits below still resolve.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    nextConnKey = 100;
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
          viewMode: 'snapshot',
          snapshotRefreshInterval: INTERVAL_SECONDS,
        },
      },
    });
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => (nextConnKey += 1)),
    });
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

  async function renderSnapshot() {
    const view = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(view.result.current.imageSrc).not.toBe(''));
    return view;
  }

  /** Advance past `ticks` refresh intervals with fake timers installed. */
  function advanceTicks(ticks: number) {
    act(() => {
      vi.advanceTimersByTime(INTERVAL_SECONDS * 1000 * ticks + 50);
    });
  }

  it('holds the src while the tile\'s own request is still in flight', async () => {
    const { result } = await renderSnapshot();
    const inFlight = result.current.imageSrc;

    // No load and no error: the request this src started has not settled.
    advanceTicks(3);

    expect(result.current.imageSrc).toBe(inFlight);
  });

  it('takes the next refresh once the load settles', async () => {
    const { result } = await renderSnapshot();
    const first = result.current.imageSrc;

    act(() => {
      result.current.reportStreamLoad();
    });

    advanceTicks(1);

    expect(result.current.imageSrc).not.toBe(first);
  });

  it('refreshes a stuck tile once the in-flight ceiling passes', async () => {
    const { result } = await renderSnapshot();
    const stuck = result.current.imageSrc;

    act(() => {
      vi.advanceTimersByTime(ZM_INTEGRATION.snapshotInFlightCeilingMs + INTERVAL_SECONDS * 1000);
    });

    expect(result.current.imageSrc).not.toBe(stuck);
  });
});
