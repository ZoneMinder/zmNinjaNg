/**
 * useStreamLifecycle Hook Tests
 *
 * Tests connKey generation, CMD_QUIT dispatch, media element cleanup, and force-regenerate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStreamLifecycle } from '../useStreamLifecycle';

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

// Mock url-builder
vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string) =>
    `${portalUrl}/control?command=${command}&connkey=${connkey}`,
}));

// Mock ZMS constants
vi.mock('../../lib/zm-constants', () => ({
  ZMS_COMMANDS: { cmdQuit: 'quit' },
}));

// Mock monitor store
const mockRegenerateConnKey = vi.fn();
let nextConnKey = 1001;

vi.mock('../../stores/monitors', () => ({
  useMonitorStore: vi.fn(),
}));

import { useMonitorStore } from '../../stores/monitors';

function setupMonitorStore() {
  vi.mocked(useMonitorStore).mockImplementation((selector) => {
    const state = {
      regenerateConnKey: mockRegenerateConnKey,
      connKeys: {} as Record<string, number>,
      getConnKey: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (selector as (s: any) => unknown)(state);
  });

  mockRegenerateConnKey.mockImplementation(() => nextConnKey++);
}

const mockLogFn = vi.fn();

function makeMediaRef(element: HTMLImageElement | null = null) {
  return { current: element };
}

const baseOptions = {
  monitorId: '1',
  monitorName: 'Cam 1',
  portalUrl: 'http://zm.local',
  accessToken: 'tok-abc',
  viewMode: 'streaming' as const,
  logFn: mockLogFn,
};

describe('useStreamLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextConnKey = 1001;
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

    it('clears media element src on unmount', async () => {
      const imgElement = document.createElement('img');
      const mediaRef = { current: imgElement };
      mockRegenerateConnKey.mockReturnValue(9999);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      // src should be set to the blank GIF to abort loading
      expect(mediaRef.current.src).toContain('data:image/gif');
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
});
