import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibilityResume } from '../useVisibilityResume';

let visibilityState: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibilityState = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisibilityResume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback when returning to visible after being hidden long enough', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire if the hidden interval is too short (flicker)', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1500 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(200);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire when the page becomes visible without a prior hidden state', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb));

    // No hidden transition first; spurious visible event should be a no-op.
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();
  });

  it('is inert when enabled is false', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { enabled: false, minHiddenMs: 1000 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('uses the latest callback reference without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useVisibilityResume(cb, { minHiddenMs: 500 }), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    setVisibility('hidden');
    vi.advanceTimersByTime(1000);
    setVisibility('visible');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibilityResume(cb, { minHiddenMs: 500 }));
    unmount();

    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });
});
