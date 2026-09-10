/**
 * useStreamLifecycle Hook Tests
 *
 * Tests connKey generation, CMD_QUIT dispatch, media element cleanup, and force-regenerate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { useStreamLifecycle } from '../useStreamLifecycle';
import { quitAllActiveStreams } from '../../lib/monitor/active-streams';
import { asProfileId } from '../../api/types';

// Mock logger
vi.mock('../../lib/logger', () => ({
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
  // log.dedupe runs the callback unconditionally in tests so we don't have
  // to model the throttle window; the callback receives an empty suffix.
  log: {
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
}));

// Mock HTTP client
const mockHttpGet = vi.fn().mockResolvedValue({});
vi.mock('../../lib/http', () => ({
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

// Mock url-builder. The port math mirrors applyMultiPort in the real builder
// (monitor N's ZMS traffic lives on minStreamingPort + N), because that is
// what decides whether a CMD_QUIT reaches the process it is meant to kill: on
// a multi-port install the portal's default port answers, reports success, and
// leaves the stream running. A mock that dropped the options argument would
// let that failure through while still counting the request.
vi.mock('../../lib/zm/url-builder', () => ({
  getZmsControlUrl: (
    portalUrl: string,
    command: string,
    connkey: string,
    options: { minStreamingPort?: number; monitorId?: string } = {},
  ) => {
    const url = new URL(`${portalUrl}/control`);
    url.searchParams.set('command', command);
    url.searchParams.set('connkey', connkey);
    const monitorIdNum = parseInt(options.monitorId ?? '', 10);
    if (options.minStreamingPort && !isNaN(monitorIdNum)) {
      url.port = String(options.minStreamingPort + monitorIdNum);
    }
    return url.toString();
  },
}));

// Mock ZMS constants
vi.mock('../../lib/zm/zm-constants', () => ({
  ZMS_COMMANDS: { cmdQuit: 'quit' },
}));

// Mock monitor store
const mockRegenerateConnKey = vi.fn();
const mockClearConnKey = vi.fn();
let nextConnKey = 1001;
let mockConnKeys: Record<string, number> = {};

vi.mock('../../stores/monitors', () => ({
  useMonitorStore: vi.fn(),
  monitorCacheKey: (profileId: string | null | undefined, monitorId: string) =>
    profileId ? `${profileId}:${monitorId}` : monitorId,
}));

import { useMonitorStore } from '../../stores/monitors';

function setupMonitorStore() {
  const state = {
    regenerateConnKey: mockRegenerateConnKey,
    clearConnKey: mockClearConnKey,
    connKeys: mockConnKeys,
    getConnKey: vi.fn(),
  };

  vi.mocked(useMonitorStore).mockImplementation((selector) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (selector as (s: any) => unknown)(state);
  });
  (useMonitorStore as unknown as { getState: () => typeof state }).getState = () => state;

  mockRegenerateConnKey.mockImplementation((monitorId: string) => {
    const key = nextConnKey++;
    mockConnKeys[monitorId] = key;
    return key;
  });
  mockClearConnKey.mockImplementation((monitorId: string) => {
    delete mockConnKeys[monitorId];
  });
}

const mockLogFn = vi.fn();

function makeMediaRef(element: HTMLImageElement | null = null) {
  return { current: element };
}

/** Stands in for the nph-zms URL a live tile's <img> carries. */
const STREAM_SRC = 'http://zm.local/cgi-bin/nph-zms?mode=jpeg&connkey=9999';

const baseOptions = {
  monitorId: '1',
  monitorName: 'Cam 1',
  portalUrl: 'http://zm.local',
  accessToken: 'tok-abc',
  viewMode: 'streaming' as 'streaming' | 'snapshot',
  logFn: mockLogFn,
};

describe('useStreamLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextConnKey = 1001;
    mockConnKeys = {};
    setupMonitorStore();
  });

  describe('initial state', () => {
    it('starts with connKey 0 before mount effect runs', () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );
      // connKey should be 0 synchronously before effect
      // After the effect runs it will be non-zero
      expect(typeof result.current.connKey).toBe('number');
    });

    it('generates a connKey on mount when enabled', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      expect(mockRegenerateConnKey).toHaveBeenCalledWith('1');
    });

    it('does not generate connKey when disabled', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef, enabled: false }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });

    it('does not generate connKey when monitorId is undefined', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, monitorId: undefined, mediaRef }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });
  });

  describe('connKey generation', () => {
    it('returns the key produced by regenerateConnKey', async () => {
      mockRegenerateConnKey.mockReturnValue(5555);
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(5555);
      });
    });
  });

  describe('forceRegenerate', () => {
    it('returns a new connKey and updates state', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      let newKey: number;
      act(() => {
        newKey = result.current.forceRegenerate();
      });

      await waitFor(() => {
        expect(result.current.connKey).toBe(2002);
      });

      expect(newKey!).toBe(2002);
    });

    it('returns 0 when monitorId is undefined', async () => {
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, monitorId: undefined, mediaRef }),
      );

      let returned: number;
      act(() => {
        returned = result.current.forceRegenerate();
      });

      expect(returned!).toBe(0);
    });

    it('does not send CMD_QUIT (force bypasses normal quit)', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.forceRegenerate();
      });

      // forceRegenerate should not fire a CMD_QUIT request
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('sends CMD_QUIT for the previous connkey when killPrevious is set', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.forceRegenerate({ killPrevious: true });
      });

      // The old connkey (1001) is quit before minting the new one.
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('connkey=1001'),
        expect.objectContaining({ timeoutMs: 3000 }),
      );
    });
  });

  describe('releaseConnection', () => {
    it('sends CMD_QUIT for the current connkey and clears the stored key', async () => {
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const activeKey = result.current.connKey;
      expect(mockConnKeys['1']).toBe(activeKey);

      mockHttpGet.mockClear();

      act(() => {
        result.current.releaseConnection();
      });

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(`connkey=${activeKey}`),
        expect.objectContaining({ timeoutMs: 3000 }),
      );
      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('is a no-op in snapshot mode', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(4004);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(4004);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.releaseConnection();
      });

      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('does not re-quit the released key on a later forceRegenerate', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(5005).mockReturnValueOnce(6006);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(5005);
      });

      act(() => {
        result.current.releaseConnection();
      });

      mockHttpGet.mockClear();

      // The released key (5005) must not be quit again; prevConnKeyRef was reset.
      act(() => {
        result.current.forceRegenerate({ killPrevious: true });
      });

      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });

  describe('cleanup on unmount', () => {
    it('sends CMD_QUIT in streaming mode on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(7777);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      // CMD_QUIT should be sent for the active connKey
      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining('connkey=7777'),
          expect.objectContaining({ timeoutMs: 3000 }),
        );
      });
    });

    it('does not send CMD_QUIT in snapshot mode on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(8888);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      mockHttpGet.mockClear();
      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('does not send CMD_QUIT when connKey is still 0', () => {
      // Keep connKey at 0 by having regenerate return 0
      mockRegenerateConnKey.mockReturnValue(0);
      const mediaRef = makeMediaRef();

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('removes the media element src on unmount to abort the stream', async () => {
      const imgElement = document.createElement('img');
      imgElement.src = 'http://zm.local/cgi-bin/nph-zms?mode=jpeg&connkey=9999';
      const mediaRef = { current: imgElement };
      mockRegenerateConnKey.mockReturnValue(9999);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      // src attribute is removed (not set to ''), which aborts the in-flight
      // nph-zms connection and frees the browser connection slot.
      expect(imgElement.hasAttribute('src')).toBe(false);
    });

    // The two tests below pin the difference between a cleanup that means
    // "this component is going away" and one that does not. React runs the
    // cleanup of an empty-dependency effect against a live tree whenever it
    // remounts effects without unmounting: the StrictMode mount double-invoke
    // here, and in the app also a revealed Suspense subtree or a Fast Refresh
    // update. Tearing down there leaves a mounted <img> with no src that React
    // never restores, because its virtual DOM still holds the same URL and the
    // next diff writes nothing. The element being connected to the document is
    // what separates the two: React detaches the subtree in the mutation
    // phase, before this passive cleanup runs.
    it('keeps the src when the cleanup runs against a still-connected element', () => {
      const mediaRef: { current: HTMLImageElement | null } = { current: null };

      render(
        createElement(
          StrictMode,
          null,
          createElement(function Tile() {
            useStreamLifecycle({ ...baseOptions, mediaRef });
            return createElement('img', { ref: mediaRef, src: STREAM_SRC, alt: 'Cam 1' });
          }),
        ),
      );

      const img = document.querySelector('img');
      expect(img?.isConnected).toBe(true);
      expect(img?.getAttribute('src')).toBe(STREAM_SRC);
    });

    it('still aborts a rendered element on a real unmount', async () => {
      const mediaRef: { current: HTMLImageElement | null } = { current: null };

      const { unmount } = render(
        createElement(function Tile() {
          useStreamLifecycle({ ...baseOptions, mediaRef });
          return createElement('img', { ref: mediaRef, src: STREAM_SRC, alt: 'Cam 1' });
        }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });
      // React nulls the ref during unmount, so hold the element to assert on.
      const img = mediaRef.current;

      unmount();

      expect(img?.isConnected).toBe(false);
      expect(img?.hasAttribute('src')).toBe(false);
    });

    it('clears the stored connkey on unmount in streaming mode', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      expect(mockConnKeys['1']).toBe(result.current.connKey);

      unmount();

      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('does not clear the stored connkey when the store holds a newer key', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      // Another mount of the same monitor regenerated the key after this
      // instance's last render. The cleanup must not remove the newer key.
      mockConnKeys['1'] = result.current.connKey + 1;

      unmount();

      expect(mockClearConnKey).not.toHaveBeenCalled();
      expect(mockConnKeys['1']).toBe(result.current.connKey + 1);
    });

    it('does not clear the stored connkey in snapshot mode', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      unmount();

      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('generates a fresh connkey on remount after the previous key was cleared', async () => {
      const mediaRef = makeMediaRef();

      const first = renderHook(() => useStreamLifecycle({ ...baseOptions, mediaRef }));
      await waitFor(() => {
        expect(first.result.current.connKey).not.toBe(0);
      });
      const oldKey = first.result.current.connKey;

      first.unmount();
      expect(mockConnKeys['1']).toBeUndefined();

      const second = renderHook(() => useStreamLifecycle({ ...baseOptions, mediaRef }));
      await waitFor(() => {
        expect(second.result.current.connKey).not.toBe(0);
      });

      expect(second.result.current.connKey).not.toBe(oldKey);
      expect(mockConnKeys['1']).toBe(second.result.current.connKey);
      second.unmount();
    });

    it('StrictMode double-mount does not clear the active connkey', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(
        () => useStreamLifecycle({ ...baseOptions, mediaRef }),
        { wrapper: StrictMode },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      // The throwaway-mount cleanup ran with connKey 0 and must not have
      // cleared the key the surviving mount is using.
      expect(mockClearConnKey).not.toHaveBeenCalled();
      expect(mockConnKeys['1']).toBe(result.current.connKey);

      const activeKey = result.current.connKey;
      unmount();

      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();

      // The cleared key is the one that was quit on unmount.
      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining(`connkey=${activeKey}`),
          expect.objectContaining({ timeoutMs: 3000 }),
        );
      });
    });

    it('skips media cleanup when mediaRef.current is null', async () => {
      const mediaRef = makeMediaRef(null);
      mockRegenerateConnKey.mockReturnValue(1111);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('cleanup params tracking', () => {
    it('sends CMD_QUIT with correct portalUrl on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(4444);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({
          ...baseOptions,
          portalUrl: 'http://my-zm-server',
          mediaRef,
        }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining('http://my-zm-server'),
          expect.objectContaining({ timeoutMs: 3000 }),
        );
      });
    });

    it('skips CMD_QUIT when portalUrl is undefined', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(5555);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({
          ...baseOptions,
          portalUrl: undefined,
          mediaRef,
        }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });

  describe('enabled flag', () => {
    it('does not generate connKey when enabled is false', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, enabled: false, mediaRef }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });

    it('defaults to enabled when enabled is omitted', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
    });
  });

  describe('disable teardown', () => {
    /**
     * How many CMD_QUIT requests were sent for a specific connkey. Matches the
     * whole value so a key that is a prefix of another is not over-counted.
     */
    function quitCountFor(key: number): number {
      const pattern = new RegExp(`connkey=${key}(?![0-9])`);
      return mockHttpGet.mock.calls.filter(
        (call) => typeof call[0] === 'string' && pattern.test(call[0] as string),
      ).length;
    }

    it('sends CMD_QUIT for the held connkey and clears it when disabled', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;
      mockHttpGet.mockClear();

      rerender({ enabled: false });

      await waitFor(() => {
        expect(quitCountFor(firstKey)).toBe(1);
      });
      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
      expect(result.current.connKey).toBe(0);
    });

    it('mints a connkey different from the pre-disable one when re-enabled', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;

      rerender({ enabled: false });
      rerender({ enabled: true });

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      expect(result.current.connKey).not.toBe(firstKey);
      expect(mockConnKeys['1']).toBe(result.current.connKey);
    });

    it('enable, disable, enable quits the first key exactly once and ends on a live key', async () => {
      // The Go2RTC fallback case: MJPEG placeholder mints a key, WebRTC takes
      // over and disables it, WebRTC drops and MJPEG comes back.
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;

      rerender({ enabled: false });
      await waitFor(() => {
        expect(result.current.connKey).toBe(0);
      });

      rerender({ enabled: true });
      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      const secondKey = result.current.connKey;
      expect(secondKey).not.toBe(firstKey);
      // Exactly one quit for the orphan-prone first key, none for the live one.
      expect(quitCountFor(firstKey)).toBe(1);
      expect(quitCountFor(secondKey)).toBe(0);
      // The live key is the one the store holds, so the <img> mounts on a
      // connkey whose nph-zms process is actually running.
      expect(mockConnKeys['1']).toBe(secondKey);
    });

    it('does not quit twice when a disabled hook is then unmounted', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender, unmount } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;

      rerender({ enabled: false });
      await waitFor(() => {
        expect(quitCountFor(firstKey)).toBe(1);
      });

      unmount();

      expect(quitCountFor(firstKey)).toBe(1);
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });

    it('quits the key it minted when monitorId changes in the same commit as the disable', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled, monitorId }: { enabled: boolean; monitorId: string }) =>
          useStreamLifecycle({ ...baseOptions, monitorId, mediaRef, enabled }),
        { initialProps: { enabled: true, monitorId: '1' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;
      mockHttpGet.mockClear();

      // The tile is disabled and repointed at another monitor in one commit.
      // The teardown owns the stream it minted, so it must quit that key under
      // monitor 1 and clear monitor 1's stored key, not monitor 2's.
      rerender({ enabled: false, monitorId: '2' });

      await waitFor(() => {
        expect(quitCountFor(firstKey)).toBe(1);
      });
      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('sends no request when disabling a hook that never minted a key', async () => {
      const mediaRef = makeMediaRef();
      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, monitorId: undefined, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      rerender({ enabled: false });

      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('sends no request when disabling a snapshot-mode hook', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      mockHttpGet.mockClear();

      rerender({ enabled: false });

      // Hovering off a snapshot tile must not add a pointless request.
      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('a hook enabled for its whole lifetime mints one key and quits once on unmount', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender, unmount } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled }),
        { initialProps: { enabled: true } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const onlyKey = result.current.connKey;

      // Unrelated re-renders must not churn the key or add requests.
      rerender({ enabled: true });
      rerender({ enabled: true });

      expect(mockRegenerateConnKey).toHaveBeenCalledTimes(1);
      expect(result.current.connKey).toBe(onlyKey);
      expect(mockHttpGet).not.toHaveBeenCalled();

      unmount();

      await waitFor(() => {
        expect(quitCountFor(onlyKey)).toBe(1);
      });
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });
  });

  // A streaming key is a running nph-zms process; a snapshot request is not.
  // Switching a live hook from streaming to snapshot therefore has to close
  // the stream, exactly as disabling it does. Reached from the Streaming Mode
  // setting, the All-mode idle downgrade (refs #337), and any other viewMode
  // flip on a mounted tile.
  describe('view-mode teardown', () => {
    function quitCountFor(key: number): number {
      const pattern = new RegExp(`connkey=${key}(?![0-9])`);
      return mockHttpGet.mock.calls.filter(
        (call) => typeof call[0] === 'string' && pattern.test(call[0] as string),
      ).length;
    }

    it('quits the streaming key when the hook flips to snapshot', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, viewMode }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;
      mockHttpGet.mockClear();

      rerender({ viewMode: 'snapshot' });

      await waitFor(() => {
        expect(quitCountFor(streamingKey)).toBe(1);
      });
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });

    // A running nph-zms keeps sending the size it was started at, so a scale
    // change is a different stream, not a different frame. Zooming in asks for
    // the full-size one; without a fresh key the old process stays open on the
    // server and the <img> reconnects to the small picture (refs #478).
    it('quits and re-opens the stream when the requested scale changes', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ scale }: { scale: number }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, scale }),
        { initialProps: { scale: 50 } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const halfSizeKey = result.current.connKey;
      mockHttpGet.mockClear();

      rerender({ scale: 100 });

      await waitFor(() => {
        expect(quitCountFor(halfSizeKey)).toBe(1);
      });
      expect(result.current.connKey).not.toBe(halfSizeKey);
      // The quit says why, so a log from a zoomed session is readable.
      expect(mockLogFn).toHaveBeenCalledWith(
        expect.stringContaining('CMD_QUIT on scale'),
        expect.anything(),
        expect.objectContaining({ connkey: halfSizeKey }),
      );
    });

    it('quits a multi-port stream on the port it was opened on', async () => {
      // useMonitorStream computes minStreamingPort from the view mode, so a
      // flip to snapshot drops it to undefined in the same commit as the flip.
      // The key being quit was opened on the streaming port, and a CMD_QUIT to
      // the portal's default port is answered by a server that knows nothing
      // about it: the request succeeds, the log says the stream was closed,
      // and the nph-zms process keeps running.
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({
            ...baseOptions,
            mediaRef,
            viewMode,
            minStreamingPort: viewMode === 'streaming' ? 30000 : undefined,
          }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;
      mockHttpGet.mockClear();

      rerender({ viewMode: 'snapshot' });

      // Monitor 1 on a base of 30000 streams from port 30001.
      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining(`:30001/`),
          expect.objectContaining({ timeoutMs: 3000 }),
        );
      });
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(`connkey=${streamingKey}`),
        expect.objectContaining({ timeoutMs: 3000 }),
      );
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
    });

    it('mints a fresh key for snapshot mode rather than reusing the quit one', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, viewMode }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;

      rerender({ viewMode: 'snapshot' });

      // A quit key can collide with server-side state, and the snapshot view
      // still needs a key to fetch with, so the hook must hand back a new one.
      await waitFor(() => {
        expect(result.current.connKey).not.toBe(streamingKey);
      });
      expect(result.current.connKey).not.toBe(0);
      expect(mockConnKeys['1']).toBe(result.current.connKey);
    });

    it('mints another fresh key on the way back to streaming', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, viewMode }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;

      rerender({ viewMode: 'snapshot' });
      await waitFor(() => {
        expect(result.current.connKey).not.toBe(streamingKey);
      });
      const snapshotKey = result.current.connKey;

      rerender({ viewMode: 'streaming' });

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(snapshotKey);
      });
      // Nothing to quit on the way back: a snapshot key holds no nph-zms
      // process, so the only request in the whole cycle is the first quit.
      expect(quitCountFor(snapshotKey)).toBe(0);
      expect(quitCountFor(streamingKey)).toBe(1);
    });

    it('does not quit the streaming key twice when the flip is followed by an unmount', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender, unmount } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, viewMode }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;

      rerender({ viewMode: 'snapshot' });
      await waitFor(() => {
        expect(quitCountFor(streamingKey)).toBe(1);
      });

      unmount();

      expect(quitCountFor(streamingKey)).toBe(1);
    });

    it('leaves the freshly minted key alone when a re-enable and a flip land together', async () => {
      // The montage resume case: a paused tile comes back at the same moment
      // the idle downgrade clears. The regeneration effect owns the new key in
      // that commit, and quitting it here would kill the stream on arrival.
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ enabled, viewMode }: { enabled: boolean; viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled, viewMode }),
        { initialProps: { enabled: true, viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      rerender({ enabled: false, viewMode: 'streaming' });
      await waitFor(() => {
        expect(result.current.connKey).toBe(0);
      });
      mockHttpGet.mockClear();

      rerender({ enabled: true, viewMode: 'snapshot' });

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const liveKey = result.current.connKey;
      expect(quitCountFor(liveKey)).toBe(0);
      expect(mockConnKeys['1']).toBe(liveKey);
      // One mint on mount, one on the re-enable - and none from this effect.
      // Without the `prev.enabled !== enabled` half of its stand-down guard it
      // would mint a third key in this same commit, orphaning the one the
      // regeneration effect just handed the tile.
      expect(mockRegenerateConnKey).toHaveBeenCalledTimes(2);
    });

    it('quits on the port the stream moved to, not the one it started on', async () => {
      // minStreamingPort can change without a view-mode flip: turning off
      // multi-port repoints a live stream at the portal's own port. The
      // identity ref has to follow it, or the eventual flip sends CMD_QUIT to
      // the port the stream was opened on months of settings ago and a server
      // that knows nothing about the key answers happily.
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ viewMode, minStreamingPort }: { viewMode: 'streaming' | 'snapshot'; minStreamingPort?: number }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, viewMode, minStreamingPort }),
        {
          initialProps: {
            viewMode: 'streaming' as 'streaming' | 'snapshot',
            minStreamingPort: 30000 as number | undefined,
          },
        },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const streamingKey = result.current.connKey;

      // Port-only change: same mode, same monitor, still enabled.
      rerender({ viewMode: 'streaming', minStreamingPort: 40000 });
      await act(async () => {});
      mockHttpGet.mockClear();

      rerender({ viewMode: 'snapshot', minStreamingPort: undefined });

      // Monitor 1 on a base of 40000 streams from port 40001.
      await waitFor(() => {
        expect(quitCountFor(streamingKey)).toBe(1);
      });
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(':40001/'),
        expect.objectContaining({ timeoutMs: 3000 }),
      );
      expect(mockHttpGet).not.toHaveBeenCalledWith(
        expect.stringContaining(':30001/'),
        expect.anything(),
      );
    });

    it('stays out of the way when a flip lands with a monitor change', async () => {
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ monitorId, viewMode }: { monitorId: string; viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, monitorId, viewMode }),
        { initialProps: { monitorId: '1', viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;
      mockHttpGet.mockClear();

      // A tile repointed at another monitor in the same commit as a mode flip.
      // By now every value this effect could quit from describes monitor 2,
      // while the key it holds was opened against monitor 1's URL and port, so
      // a quit would close a stream on the wrong port and a mint would strand
      // monitor 1's key with no owner. Monitor changes are the regeneration
      // effect's business; this one stands down.
      rerender({ monitorId: '2', viewMode: 'snapshot' });

      await act(async () => {});
      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(quitCountFor(firstKey)).toBe(0);
    });

    it('mints nothing when a flip lands with a monitor change', async () => {
      // Separate from the quit assertion above so both halves of the stand-down
      // are pinned: a mint here would hand the tile a key for monitor 2 while
      // monitor 1's stream is still open and unowned.
      const mediaRef = makeMediaRef();
      const { result, rerender } = renderHook(
        ({ monitorId, viewMode }: { monitorId: string; viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, monitorId, viewMode }),
        { initialProps: { monitorId: '1', viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const firstKey = result.current.connKey;

      rerender({ monitorId: '2', viewMode: 'snapshot' });
      await act(async () => {});

      expect(mockRegenerateConnKey).toHaveBeenCalledTimes(1);
      expect(result.current.connKey).toBe(firstKey);
    });

    it('sends nothing when a disabled hook changes view mode', async () => {
      const mediaRef = makeMediaRef();
      const { rerender } = renderHook(
        ({ viewMode }: { viewMode: 'streaming' | 'snapshot' }) =>
          useStreamLifecycle({ ...baseOptions, mediaRef, enabled: false, viewMode }),
        { initialProps: { viewMode: 'streaming' as 'streaming' | 'snapshot' } },
      );

      rerender({ viewMode: 'snapshot' });

      // A disabled hook owns no stream, so there is nothing to quit and no
      // key to mint.
      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });
  });

  // refs #337: two profiles pointed at independent ZM servers can report the
  // same monitor id. Without profileId scoping, both tiles fought over one
  // connKeys slot; with it, each profile gets its own entry so both stream
  // key lifecycles coexist.
  describe('profile-scoped cache key', () => {
    it('stores the connKey under profileId:monitorId when profileId is given', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef, profileId: asProfileId('profile-b') }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      expect(mockRegenerateConnKey).toHaveBeenCalledWith('profile-b:1');
      expect(mockConnKeys['profile-b:1']).toBe(result.current.connKey);
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('gives two profiles sharing a monitorId distinct, coexisting connKey entries', async () => {
      const mediaRefA = makeMediaRef();
      const mediaRefB = makeMediaRef();

      const a = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef: mediaRefA, profileId: asProfileId('profile-a') }),
      );
      const b = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef: mediaRefB, profileId: asProfileId('profile-b') }),
      );

      await waitFor(() => {
        expect(a.result.current.connKey).not.toBe(0);
        expect(b.result.current.connKey).not.toBe(0);
      });

      // Both entries coexist under distinct keys: profile B's mint did not
      // evict profile A's, which a shared monitorId-only key would have done.
      expect(a.result.current.connKey).not.toBe(b.result.current.connKey);
      expect(mockConnKeys['profile-a:1']).toBe(a.result.current.connKey);
      expect(mockConnKeys['profile-b:1']).toBe(b.result.current.connKey);
    });

    it('releaseConnection clears only its own profile-scoped entry', async () => {
      const mediaRefA = makeMediaRef();
      const mediaRefB = makeMediaRef();

      const a = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef: mediaRefA, profileId: asProfileId('profile-a') }),
      );
      const b = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef: mediaRefB, profileId: asProfileId('profile-b') }),
      );

      await waitFor(() => {
        expect(mockConnKeys['profile-a:1']).toBe(a.result.current.connKey);
        expect(mockConnKeys['profile-b:1']).toBe(b.result.current.connKey);
      });
      const bKey = b.result.current.connKey;

      act(() => {
        a.result.current.releaseConnection();
      });

      expect(mockConnKeys['profile-a:1']).toBeUndefined();
      expect(mockConnKeys['profile-b:1']).toBe(bKey);
    });
  });

  describe('profile-switch teardown registry', () => {
    it('registers a teardown that quits the stream, and unregisters on unmount', async () => {
      const mediaRef = makeMediaRef();
      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const activeKey = result.current.connKey;

      mockHttpGet.mockClear();
      // A profile switch quits all registered streams before tearing down.
      await quitAllActiveStreams();
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(`connkey=${activeKey}`),
        expect.objectContaining({ timeoutMs: 3000 }),
      );

      unmount();
      mockHttpGet.mockClear();
      // After unmount the tile is unregistered, so a later switch ignores it.
      await quitAllActiveStreams();
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('does not register a teardown in snapshot mode', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      mockHttpGet.mockClear();
      await quitAllActiveStreams();
      // Snapshot mode never sends CMD_QUIT.
      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });
});
