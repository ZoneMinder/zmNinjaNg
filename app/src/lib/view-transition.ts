/**
 * Reorder motion through the browser's native View Transitions API.
 *
 * A DOM change made inside `startViewTransition` animates between the before
 * and after snapshots, so an element that moved slides to its new position
 * instead of jumping. Elements need a `view-transition-name` for the browser
 * to pair them up across the change.
 *
 * The API is absent from older Chromium (Electron) and from some Capacitor
 * webviews, so a caller must be able to run without it; there the change is
 * applied directly and the layout updates instantly. A user who asked for
 * reduced motion gets the same instant path: this is decorative motion, which
 * is exactly what that preference is about.
 */

import { flushSync } from 'react-dom';

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Run `apply` (a React state update, typically) inside a view transition when
 * the browser supports one, and directly otherwise.
 */
export function runViewTransition(apply: () => void): void {
  const doc = typeof document === 'undefined' ? undefined : (document as DocumentWithViewTransition);

  if (typeof doc?.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply();
    return;
  }

  // flushSync so React has committed before the browser captures the "after"
  // snapshot. A normally scheduled render lands after the capture, and the
  // transition then animates from the old layout to the same old layout.
  doc.startViewTransition(() => flushSync(apply));
}
