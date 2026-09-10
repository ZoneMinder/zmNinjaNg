/**
 * useMonitorStream: the has-a-frame gate
 *
 * Asserts that `hasFrame` means "the src the <img> currently holds has
 * produced a frame", not "a stream URL exists". Refs #352: the player used to
 * treat a minted connkey as a frame, so on a mobile resume every tile showed
 * whatever the element still held - a partially written JPEG, or the browser's
 * broken-image glyph - instead of the VideoOff placeholder.
 *
 * The resume case is the reason the clear has to be synchronous: `zms` dying
 * while the app is suspended fires no `error` on the <img> at all (it keeps the
 * last frame forever, see agents/project/domain-context.md), so the resume
 * itself is the only moment that knows the frame is stale, and it must not wait
 * for the token refresh it kicks off before saying so.
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
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';
import { log, LogLevel } from '../../lib/logger';

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
}));

// Captured so a test can fire the resume the way returning to the foreground
// does, without depending on which platform signal delivered it.
let resumeCallback: (() => void) | null = null;
vi.mock('../useVisibilityResume', () => ({
  useVisibilityResume: (onResume: () => void) => {
    resumeCallback = onResume;
  },
}));

describe('useMonitorStream: has-a-frame gate', () => {
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

  beforeEach(() => {
    resumeCallback = null;
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
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', snapshotRefreshInterval: 1 },
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

  /** Renders the hook and waits for the first connkey to mint a stream URL. */
  async function renderStreaming(viewModeOverride?: 'streaming' | 'snapshot') {
    const view = renderHook(() => useMonitorStream({ monitorId: '1', viewModeOverride }));
    await waitFor(() => expect(view.result.current.imageSrc).not.toBe(''));
    return view;
  }

  it('reports no frame while the stream URL exists but nothing has loaded', async () => {
    const { result } = await renderStreaming();

    expect(result.current.imageSrc).not.toBe('');
    expect(result.current.hasFrame).toBe(false);
  });

  it('reports a frame once the <img> load handler runs', async () => {
    const { result } = await renderStreaming();

    act(() => result.current.reportStreamLoad());

    expect(result.current.hasFrame).toBe(true);
  });

  it('drops the frame when the stream errors', async () => {
    const { result } = await renderStreaming();
    act(() => result.current.reportStreamLoad());

    act(() => result.current.reportStreamError());

    expect(result.current.hasFrame).toBe(false);
  });

  it('drops the frame the moment a fresh connkey replaces the loaded one', async () => {
    const { result } = await renderStreaming();
    act(() => result.current.reportStreamLoad());
    const loadedSrc = result.current.imageSrc;

    act(() => result.current.regenerateConnection());

    expect(result.current.imageSrc).not.toBe(loadedSrc);
    expect(result.current.hasFrame).toBe(false);
  });

  it('drops the frame on resume without waiting for the token refresh', async () => {
    // A refresh that never settles: if the clear were sequenced behind the
    // await, hasFrame would still be true here.
    useAuthStore.setState({ getFreshAccessToken: vi.fn(() => new Promise<string>(() => {})) });

    const { result } = await renderStreaming();
    act(() => result.current.reportStreamLoad());
    expect(result.current.hasFrame).toBe(true);

    expect(resumeCallback).not.toBeNull();
    act(() => resumeCallback!());

    expect(result.current.hasFrame).toBe(false);
  });

  // Zooming in re-requests the stream at full size. The frame on screen is
  // still a good one and the browser holds it until the new stream decodes, so
  // withdrawing it here would blink the feed on every zoom (refs #478).
  it('keeps the frame across a scale change until the new stream loads', async () => {
    const view = renderHook(
      ({ scale }: { scale: number }) =>
        useMonitorStream({ monitorId: '1', streamOptions: { scale } }),
      { initialProps: { scale: 50 } },
    );
    await waitFor(() => expect(view.result.current.imageSrc).not.toBe(''));
    act(() => view.result.current.reportStreamLoad());
    const halfSizeSrc = view.result.current.imageSrc;

    view.rerender({ scale: 100 });
    await waitFor(() => expect(view.result.current.imageSrc).not.toBe(halfSizeSrc));

    expect(view.result.current.hasFrame).toBe(true);
    // The restart is invisible on screen, so the log is where it is visible.
    expect(log.monitor).toHaveBeenCalledWith(
      expect.stringContaining('Stream scale changed from 50 to 100'),
      LogLevel.INFO,
      expect.objectContaining({ monitorId: '1', previousScale: 50, scale: 100 }),
    );
  });

  // A held frame is a picture of the past. It stands in for a stream that is
  // about to arrive, never for one that never does.
  it('gives up the held frame when the re-requested stream never loads', async () => {
    vi.useFakeTimers();
    try {
      const view = renderHook(
        ({ scale }: { scale: number }) =>
          useMonitorStream({ monitorId: '1', streamOptions: { scale } }),
        { initialProps: { scale: 50 } },
      );
      await vi.waitFor(() => expect(view.result.current.imageSrc).not.toBe(''));
      act(() => view.result.current.reportStreamLoad());

      view.rerender({ scale: 100 });
      await vi.waitFor(() => expect(view.result.current.hasFrame).toBe(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZM_INTEGRATION.plannedRestartHoldMs + 100);
      });

      expect(view.result.current.hasFrame).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Snapshot mode swaps the src on every refresh tick (a new cacheBuster), and
  // the previous still frame stays perfectly good in the meantime. Hiding it
  // per tick would blink the tile on every interval.
  it('keeps the frame across a snapshot refresh', async () => {
    vi.useFakeTimers();
    try {
      const view = renderHook(() =>
        useMonitorStream({ monitorId: '1', viewModeOverride: 'snapshot' }),
      );
      await vi.waitFor(() => expect(view.result.current.imageSrc).not.toBe(''));
      act(() => view.result.current.reportStreamLoad());
      const firstSrc = view.result.current.imageSrc;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(view.result.current.imageSrc).not.toBe(firstSrc);
      expect(view.result.current.hasFrame).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
