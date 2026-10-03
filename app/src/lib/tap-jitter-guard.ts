/**
 * Keep a tap's jitter from reaching scroll locks (refs #534).
 *
 * On iPhone in landscape, WebKit sends one small touchmove with most taps.
 * Every Radix modal (Dialog, Sheet, AlertDialog, modal DropdownMenu) mounts
 * react-remove-scroll, which cancels any touchmove over content that cannot
 * scroll, however small. WebKit then drops the tap's click, so buttons in a
 * dialog that does not scroll ignored most taps. Measured on device: every
 * failed tap had exactly one touchmove, and it was cancelled.
 *
 * A capture listener on window runs before anything else sees the event. It
 * stops single-finger moves that stay within a tap's slop of the touch start;
 * once the finger passes the slop, the gesture is a drag and every move goes
 * through. App gesture handlers measure from the touchstart point, so they
 * lose nothing by not seeing the first few pixels.
 */
import { UI_INTERACTIONS } from './zmninja-ng-constants';

export function installTapJitterGuard(): () => void {
  let start: { x: number; y: number } | null = null;

  const onStart = (ev: TouchEvent) => {
    const t = ev.touches[0];
    start = ev.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onMove = (ev: TouchEvent) => {
    const t = ev.touches[0];
    if (!start || ev.touches.length !== 1 || !t) return;
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > UI_INTERACTIONS.moveCancelPx) {
      start = null;
      return;
    }
    ev.stopImmediatePropagation();
  };

  const opts = { capture: true, passive: true };
  window.addEventListener('touchstart', onStart, opts);
  window.addEventListener('touchmove', onMove, opts);
  return () => {
    window.removeEventListener('touchstart', onStart, opts);
    window.removeEventListener('touchmove', onMove, opts);
  };
}
