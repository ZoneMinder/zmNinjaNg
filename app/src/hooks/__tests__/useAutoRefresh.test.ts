import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoRefresh } from '../useAutoRefresh';

describe('useAutoRefresh', () => {
  afterEach(() => vi.useRealTimers());

  it('calls the latest tick every interval and stops on unmount', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ tick }) => useAutoRefresh(30, tick), { initialProps: { tick: first } });

    vi.advanceTimersByTime(30_000);
    rerender({ tick: second });
    vi.advanceTimersByTime(30_000);
    unmount();
    vi.advanceTimersByTime(60_000);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('never ticks at 0', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    renderHook(() => useAutoRefresh(0, tick));
    vi.advanceTimersByTime(3_600_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
