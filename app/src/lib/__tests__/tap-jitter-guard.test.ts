import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTapJitterGuard } from '../tap-jitter-guard';

/** A touch event at (x, y) per finger; jsdom has no Touch constructor. */
function touch(type: string, ...points: [number, number][]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : list });
  document.body.dispatchEvent(ev);
  return ev;
}

// Stands in for react-remove-scroll, which every Radix modal mounts: it
// cancels any touchmove over content that cannot scroll, and WebKit then
// drops the tap's click (refs #534).
const scrollLock = vi.fn((ev: Event) => ev.preventDefault());
let uninstall: () => void;

beforeEach(() => {
  uninstall = installTapJitterGuard();
  document.addEventListener('touchmove', scrollLock, { passive: false });
});

afterEach(() => {
  uninstall();
  document.removeEventListener('touchmove', scrollLock);
  scrollLock.mockClear();
});

describe('installTapJitterGuard', () => {
  it('keeps a tap jitter away from scroll locks, so the tap is not cancelled', () => {
    touch('touchstart', [100, 100]);
    const move = touch('touchmove', [103, 98]);
    expect(move.defaultPrevented).toBe(false);
    expect(scrollLock).not.toHaveBeenCalled();
  });

  it('lets a real drag through, from its first move past the slop onwards', () => {
    touch('touchstart', [100, 100]);
    touch('touchmove', [100, 104]);
    expect(touch('touchmove', [100, 120]).defaultPrevented).toBe(true);
    // Back near the start is still part of the drag.
    expect(touch('touchmove', [100, 102]).defaultPrevented).toBe(true);
    expect(scrollLock).toHaveBeenCalledTimes(2);
  });

  it('never holds back a pinch', () => {
    touch('touchstart', [100, 100], [200, 200]);
    expect(touch('touchmove', [101, 100], [199, 200]).defaultPrevented).toBe(true);
  });

  it('starts over with each touch', () => {
    touch('touchstart', [100, 100]);
    touch('touchmove', [100, 140]);
    touch('touchend');
    touch('touchstart', [300, 300]);
    expect(touch('touchmove', [302, 301]).defaultPrevented).toBe(false);
  });
});
