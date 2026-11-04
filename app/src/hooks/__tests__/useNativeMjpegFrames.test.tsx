import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const platform = vi.hoisted(() => ({ isNative: true }));
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return platform.isNative;
    },
  },
}));

vi.mock('../../lib/logger', async (orig) => {
  const actual = await orig<typeof import('../../lib/logger')>();
  return { ...actual, log: { monitor: vi.fn() } };
});

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

import { useNativeMjpegFrames, resetNativeReclaimForTests } from '../useNativeMjpegFrames';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';

const URL_A = 'http://zm/nph-zms?monitor=1';
const URL_B = 'http://zm/nph-zms?monitor=2';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function img(currentSrc: string) {
  return { currentSrc } as HTMLImageElement;
}

describe('useNativeMjpegFrames', () => {
  beforeEach(() => {
    Object.values(plugin).forEach((fn) => fn.mockReset());
    resetNativeReclaimForTests();
    platform.isNative = true;
    plugin.open.mockResolvedValue({ streamId: 's1' });
    plugin.close.mockResolvedValue(undefined);
    plugin.closeAll.mockResolvedValue(undefined);
  });

  it('opens with the given url and stall ceiling, then exposes frames/<id>/0', async () => {
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.frameSrc).toBe('zmframe://frames/s1/0'));
    expect(plugin.open).toHaveBeenCalledWith({
      url: URL_A,
      stallTimeoutMs: ZM_INTEGRATION.nativeFrameStallMs,
    });
    expect(result.current.streamId).toBe('s1');
  });

  it('advance bumps n only for a load from the current stream', async () => {
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));

    let accepted = false;
    act(() => {
      accepted = result.current.advance(img('zmframe://frames/s1/0'));
    });
    expect(accepted).toBe(true);
    expect(result.current.frameSrc).toBe('zmframe://frames/s1/1');

    act(() => {
      accepted = result.current.advance(img('zmframe://frames/old/4'));
    });
    expect(accepted).toBe(false);
    expect(result.current.frameSrc).toBe('zmframe://frames/s1/1');

    act(() => {
      accepted = result.current.advance(null);
    });
    expect(accepted).toBe(false);
  });

  it('advance falls back to the src attribute when currentSrc is empty', async () => {
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));

    // zmframe is not a special scheme, and neither WKWebView nor Chromium is
    // under any obligation to report currentSrc for one. Empty there must not
    // stop the chain: the attribute still names the frame that loaded.
    let accepted = false;
    act(() => {
      accepted = result.current.advance({
        currentSrc: '',
        src: 'zmframe://frames/s1/0',
      } as HTMLImageElement);
    });
    expect(accepted).toBe(true);
    expect(result.current.frameSrc).toBe('zmframe://frames/s1/1');
  });

  it('a new url closes the previous stream before exposing the new one', async () => {
    plugin.open
      .mockResolvedValueOnce({ streamId: 's1' })
      .mockResolvedValueOnce({ streamId: 's2' });
    const { result, rerender } = renderHook(({ u }) => useNativeMjpegFrames(u, true), {
      initialProps: { u: URL_A },
    });
    await waitFor(() => expect(result.current.streamId).toBe('s1'));

    rerender({ u: URL_B });
    expect(plugin.close).toHaveBeenCalledWith({ streamId: 's1' });
    expect(result.current.frameSrc).toBe('');
    await waitFor(() => expect(result.current.frameSrc).toBe('zmframe://frames/s2/0'));
    expect(result.current.streamId).toBe('s2');
  });

  it('closes on unmount', async () => {
    const { result, unmount } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));
    unmount();
    expect(plugin.close).toHaveBeenCalledWith({ streamId: 's1' });
  });

  it('closes a stream whose open resolved after unmount, and never exposes it', async () => {
    const d = deferred<{ streamId: string }>();
    plugin.open.mockReturnValueOnce(d.promise);
    const { result, unmount } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(plugin.open).toHaveBeenCalled());
    unmount();
    await act(async () => d.resolve({ streamId: 'late' }));
    await waitFor(() => expect(plugin.close).toHaveBeenCalledWith({ streamId: 'late' }));
    expect(result.current.frameSrc).toBe('');
  });

  it('closes a stream whose open resolved after the url changed', async () => {
    const first = deferred<{ streamId: string }>();
    plugin.open
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ streamId: 's2' });
    const { result, rerender } = renderHook(({ u }) => useNativeMjpegFrames(u, true), {
      initialProps: { u: URL_A },
    });
    await waitFor(() => expect(plugin.open).toHaveBeenCalledTimes(1));
    rerender({ u: URL_B });
    await waitFor(() => expect(result.current.streamId).toBe('s2'));

    await act(async () => first.resolve({ streamId: 'stale' }));
    await waitFor(() => expect(plugin.close).toHaveBeenCalledWith({ streamId: 'stale' }));
    expect(result.current.streamId).toBe('s2');
    expect(result.current.frameSrc).toBe('zmframe://frames/s2/0');
  });

  it('does nothing when inactive', async () => {
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, false));
    await act(async () => {});
    expect(plugin.open).not.toHaveBeenCalled();
    expect(plugin.closeAll).not.toHaveBeenCalled();
    expect(result.current.frameSrc).toBe('');
    expect(result.current.streamId).toBeNull();
  });

  it('an empty url closes and clears', async () => {
    const { result, rerender } = renderHook(({ u }) => useNativeMjpegFrames(u, true), {
      initialProps: { u: URL_A },
    });
    await waitFor(() => expect(result.current.streamId).toBe('s1'));
    rerender({ u: '' });
    expect(plugin.close).toHaveBeenCalledWith({ streamId: 's1' });
    expect(result.current.frameSrc).toBe('');
    expect(result.current.streamId).toBeNull();
  });

  it('reclaims leaked native streams once, before the first open', async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    plugin.closeAll.mockImplementation(() => {
      order.push('closeAll');
      return gate.promise;
    });
    plugin.open.mockImplementation(async () => {
      order.push('open');
      return { streamId: 's1' };
    });
    renderHook(() => useNativeMjpegFrames(URL_A, true));
    renderHook(() => useNativeMjpegFrames(URL_B, true));
    await waitFor(() => expect(plugin.closeAll).toHaveBeenCalled());
    // open must wait for the reclaim to settle
    await act(async () => {});
    expect(plugin.open).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    await waitFor(() => expect(plugin.open).toHaveBeenCalledTimes(2));
    expect(order[0]).toBe('closeAll');
    expect(plugin.closeAll).toHaveBeenCalledTimes(1);
  });

  it('still opens when the startup reclaim fails', async () => {
    plugin.closeAll.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));
  });

  it('closes every native stream on pagehide', async () => {
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));
    expect(plugin.closeAll).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(plugin.closeAll).toHaveBeenCalledTimes(2));
  });

  it('keeps the pagehide reclaim while another tile is still mounted', async () => {
    const a = renderHook(() => useNativeMjpegFrames(URL_A, true));
    const b = renderHook(() => useNativeMjpegFrames(URL_B, true));
    await waitFor(() => expect(plugin.open).toHaveBeenCalledTimes(2));
    a.unmount();
    expect(plugin.closeAll).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(plugin.closeAll).toHaveBeenCalledTimes(2));
    b.unmount();
  });

  it('stops listening for pagehide after unmount', async () => {
    const { result, unmount } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await waitFor(() => expect(result.current.streamId).toBe('s1'));
    unmount();
    window.dispatchEvent(new Event('pagehide'));
    await act(async () => {});
    expect(plugin.closeAll).toHaveBeenCalledTimes(1);
  });

  it('does not reclaim or open off native', async () => {
    platform.isNative = false;
    const { result } = renderHook(() => useNativeMjpegFrames(URL_A, true));
    await act(async () => {});
    expect(plugin.closeAll).not.toHaveBeenCalled();
    expect(plugin.open).not.toHaveBeenCalled();
    expect(result.current.frameSrc).toBe('');
  });
});
