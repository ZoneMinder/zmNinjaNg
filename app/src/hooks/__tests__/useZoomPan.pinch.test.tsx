import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';

// jsdom cannot stage a two-finger pinch, so this reads the gesture config the
// hook hands to use-gesture instead. Both values here are the fix for a real
// report: touching a feed shrank it below its frame, leaving a pinch out as
// the only way back.
const captured: {
  pinch?: { scaleBounds?: { min?: number }; threshold?: number; from?: () => [number, number] };
} = {};
vi.mock('@use-gesture/react', () => ({
  useGesture: (_handlers: unknown, config: typeof captured) => {
    Object.assign(captured, config);
    return () => ({});
  },
}));

const { useZoomPan } = await import('../useZoomPan');

describe('useZoomPan pinch limits', () => {
  it('never pinches below fit, and ignores a touch too small to be a pinch', () => {
    // No DOM needed: the config is built on the first render.
    function Harness() {
      useZoomPan();
      return null;
    }
    render(<Harness />);

    expect(captured.pinch?.scaleBounds?.min).toBe(1);
    expect(captured.pinch?.threshold).toBeGreaterThan(0);
  });

  // use-gesture keeps a pinch's offset between gestures, so without `from` a
  // pinch after a reset (fullscreen toggle, next monitor) resumed from the
  // previous pinch's scale instead of the picture's (refs #489).
  it('starts each pinch from the current scale, including after a reset', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.ref(document.createElement('div')));

    act(() => result.current.zoomIn());
    expect(captured.pinch?.from?.()[0]).toBe(1.5);

    act(() => result.current.reset());
    expect(captured.pinch?.from?.()[0]).toBe(1);
  });
});
