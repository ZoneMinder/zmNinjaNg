import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// jsdom cannot stage a two-finger pinch, so this reads the gesture config the
// hook hands to use-gesture instead. Both values here are the fix for a real
// report: touching a feed shrank it below its frame, leaving a pinch out as
// the only way back.
const captured: { pinch?: { scaleBounds?: { min?: number }; threshold?: number } } = {};
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
});
