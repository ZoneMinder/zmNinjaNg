/**
 * useIsMobile (refs #246)
 *
 * A runtime match for the Tailwind `sm` breakpoint. The assistant renders a
 * genuinely different shell below `sm` (a bottom sheet with pointer-drag and
 * keyboard math) than at/above it (a resizable desktop card), so the choice
 * has to be a real conditional render, not a CSS `hidden`: mounting both would
 * run two `AskPanel`s and two sets of listeners.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { ASSISTANT_PANEL } from '../lib/zmninja-ng-constants';

// One below the breakpoint so it agrees with Tailwind's `sm:` (min-width:640px):
// at exactly 640 the desktop styles apply, so isMobile must be false there.
const QUERY = `(max-width: ${ASSISTANT_PANEL.mobileBreakpointPx - 1}px)`;
// A phone turned sideways is wider than `sm` but still a phone: a touch screen
// that short. Tablets are taller than the breakpoint either way round.
const PHONE_QUERY = `${QUERY}, (max-height: ${ASSISTANT_PANEL.mobileBreakpointPx - 1}px) and (pointer: coarse)`;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((callback: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  }, [query]);
  const getSnapshot = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  // SSR/no-window snapshot is `false` (desktop): there is no viewport to be
  // narrow, and the assistant never renders server-side anyway.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsMobile(): boolean {
  return useMediaQuery(QUERY);
}

/** Below `sm`, or a phone in landscape. For full-screen views that should not
 *  turn into a desktop dialog when the phone is rotated (refs #534). */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
