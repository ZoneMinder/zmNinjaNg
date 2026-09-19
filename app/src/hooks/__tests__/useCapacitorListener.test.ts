/**
 * useCapacitorListener Hook Tests
 *
 * Tests listener registration, teardown on unmount, the late-resolving
 * handle race, the enabled gate, and handler freshness across re-renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCapacitorListener, type CapacitorListenerHandle } from '../useCapacitorListener';

// Default enabled gate reads Platform.isNative; force native for these tests.
vi.mock('../../lib/platform', () => ({
  Platform: {
    isNative: true,
  },
}));

type Listener = (data: unknown) => void;

function makeFakePlugin() {
  const listeners = new Map<string, Listener>();
  const remove = vi.fn();
  const addListener = vi.fn(async (eventName: string, listener: Listener): Promise<CapacitorListenerHandle> => {
    listeners.set(eventName, listener);
    return { remove };
  });
  return {
    plugin: { addListener },
    addListener,
    remove,
    emit: (eventName: string, data: unknown) => listeners.get(eventName)?.(data),
  };
}

const flushAsync = () => act(async () => {});

describe('useCapacitorListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the listener and fires the handler with event data', async () => {
    const fake = makeFakePlugin();
    const handler = vi.fn();

    renderHook(() =>
      useCapacitorListener(async () => ({ plugin: fake.plugin }), 'appStateChange', handler),
    );
    await flushAsync();

    expect(fake.addListener).toHaveBeenCalledTimes(1);
    expect(fake.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    act(() => {
      fake.emit('appStateChange', { isActive: false });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ isActive: false });
  });

  it('registers against a registerPlugin proxy, which answers every property', async () => {
    // The real plugin is a Proxy that turns any property access into a native
    // method call, so it looks like a thenable: a promise resolved with one
    // adopts it, probes `.then` as a plugin method, and never settles (refs
    // #507). The `{ plugin }` wrapper is what keeps the await below finite.
    const remove = vi.fn();
    const addListener = vi.fn(async () => ({ remove }));
    const proxy = new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) =>
        prop === 'addListener'
          ? addListener
          : () => Promise.reject(new Error(`App.${String(prop)}() is not implemented on ios`)),
    }) as unknown as CapacitorListenerHandle & { addListener: typeof addListener };
    const onError = vi.fn();

    renderHook(() =>
      useCapacitorListener(async () => ({ plugin: proxy }), 'appStateChange', vi.fn(), { onError }),
    );
    await flushAsync();

    expect(onError).not.toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
  });

  it('removes the listener on unmount', async () => {
    const fake = makeFakePlugin();

    const { unmount } = renderHook(() =>
      useCapacitorListener(async () => ({ plugin: fake.plugin }), 'pause', vi.fn()),
    );
    await flushAsync();

    expect(fake.remove).not.toHaveBeenCalled();

    unmount();

    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it('removes a handle that resolves after unmount', async () => {
    const remove = vi.fn();
    let resolveAddListener!: (handle: CapacitorListenerHandle) => void;
    const addListener = vi.fn(
      () => new Promise<CapacitorListenerHandle>((resolve) => { resolveAddListener = resolve; }),
    );

    const { unmount } = renderHook(() =>
      useCapacitorListener(async () => ({ plugin: { addListener } }), 'backButton', vi.fn()),
    );
    await flushAsync();

    expect(addListener).toHaveBeenCalledTimes(1);

    // Unmount while addListener is still pending, then resolve it late.
    unmount();
    await act(async () => {
      resolveAddListener({ remove });
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const fake = makeFakePlugin();
    const getPlugin = vi.fn(async () => ({ plugin: fake.plugin }));

    renderHook(() =>
      useCapacitorListener(getPlugin, 'appStateChange', vi.fn(), { enabled: false }),
    );
    await flushAsync();

    expect(getPlugin).not.toHaveBeenCalled();
    expect(fake.addListener).not.toHaveBeenCalled();
  });

  it('registers when enabled flips from false to true and removes on the way back', async () => {
    const fake = makeFakePlugin();

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCapacitorListener(async () => ({ plugin: fake.plugin }), 'appStateChange', vi.fn(), { enabled }),
      { initialProps: { enabled: false } },
    );
    await flushAsync();
    expect(fake.addListener).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await flushAsync();
    expect(fake.addListener).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    await flushAsync();
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the handler fresh across re-renders without re-registering', async () => {
    const fake = makeFakePlugin();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const { rerender } = renderHook(
      ({ handler }: { handler: (data: unknown) => void }) =>
        useCapacitorListener(async () => ({ plugin: fake.plugin }), 'appStateChange', handler),
      { initialProps: { handler: firstHandler } },
    );
    await flushAsync();

    rerender({ handler: secondHandler });
    await flushAsync();

    expect(fake.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      fake.emit('appStateChange', { isActive: true });
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledWith({ isActive: true });
  });

  it('swallows plugin load failures', async () => {
    const handler = vi.fn();

    const { unmount } = renderHook(() =>
      useCapacitorListener(
        async () => { throw new Error('plugin unavailable'); },
        'appStateChange',
        handler,
      ),
    );
    await flushAsync();

    expect(handler).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });

  it('reports plugin load failures via onError when provided', async () => {
    const onError = vi.fn();
    const failure = new Error('plugin unavailable');

    renderHook(() =>
      useCapacitorListener(
        async () => { throw failure; },
        'appStateChange',
        vi.fn(),
        { onError },
      ),
    );
    await flushAsync();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
