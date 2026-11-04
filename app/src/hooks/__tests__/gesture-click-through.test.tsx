/**
 * Mouse clicks inside a pull-to-refresh or swipe container must reach their
 * target on builds whose browser exposes touch events but is driven by a mouse
 * (the iOS app on an Apple Silicon Mac, refs #582).
 *
 * @use-gesture reads touch support once at import, so each test sets
 * `window.ontouchstart` and re-imports the hooks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createRef } from 'react';

async function loadHooks() {
  vi.resetModules();
  const { usePullToRefresh } = await import('../usePullToRefresh');
  const { useSwipeNavigation } = await import('../useSwipeNavigation');
  return { usePullToRefresh, useSwipeNavigation };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).ontouchstart;
});

describe('gesture container click filtering', () => {
  it('pull-to-refresh lets a mouse click reach a child', async () => {
    (window as unknown as Record<string, unknown>).ontouchstart = null;
    const { usePullToRefresh } = await loadHooks();
    const onClick = vi.fn();
    const containerRef = createRef<HTMLDivElement>();

    function List() {
      const { bind } = usePullToRefresh({ containerRef, onRefresh: () => {} });
      return (
        <div ref={containerRef} {...bind()}>
          <button onClick={onClick}>event</button>
        </div>
      );
    }

    const { getByText } = render(<List />);
    fireEvent.click(getByText('event'), { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the tap filter on pointer-driven desktop', async () => {
    // No touch events: @use-gesture tracks pointers and filterTaps stays on,
    // so a click with no recorded tap (no pointerdown/up) is still dropped.
    const { usePullToRefresh } = await loadHooks();
    const onClick = vi.fn();
    const containerRef = createRef<HTMLDivElement>();

    function List() {
      const { bind } = usePullToRefresh({ containerRef, onRefresh: () => {} });
      return (
        <div ref={containerRef} {...bind()}>
          <button onClick={onClick}>event</button>
        </div>
      );
    }

    const { getByText } = render(<List />);
    fireEvent.click(getByText('event'), { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('swipe navigation lets a mouse click reach a child', async () => {
    (window as unknown as Record<string, unknown>).ontouchstart = null;
    const { useSwipeNavigation } = await loadHooks();
    const onClick = vi.fn();

    function Detail() {
      const { bind } = useSwipeNavigation({ onSwipeLeft: () => {}, onSwipeRight: () => {} });
      return (
        <div {...bind()}>
          <button onClick={onClick}>control</button>
        </div>
      );
    }

    const { getByText } = render(<Detail />);
    fireEvent.click(getByText('control'), { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
