/**
 * Fires a callback when the window returns to the foreground after being away.
 *
 * Three signals feed this. `visibilitychange` covers tab switches and window
 * minimize. On Electron desktop, covering the window with another app does not
 * fire visibilitychange (only minimize does), but it does fire window
 * blur/focus, so those are also used there. On native, Capacitor's
 * `appStateChange` covers the app being backgrounded: the WebView suspends with
 * the app and freezes its timers, and a WebView is not obliged to fire
 * visibilitychange for that (notifications hit the same wall in #274). In every
 * case the stream's connection can drop while the app or window is in the
 * background, and recovery has to happen on return. refs #150, refs #352
 *
 * Debounces a rapid away→back flicker (e.g., quick alt-tab) so a brief blur
 * does not trigger a reconnect storm. The minimum time away before a return is
 * considered worth acting on is `minHiddenMs` (default 1500ms).
 */

import { useCallback, useEffect, useRef } from 'react';
import { Platform } from '../lib/platform';
import { useCapacitorListener } from './useCapacitorListener';

export interface UseVisibilityResumeOptions {
  enabled?: boolean;
  minHiddenMs?: number;
}

export function useVisibilityResume(
  onResume: () => void,
  { enabled = true, minHiddenMs = 1500 }: UseVisibilityResumeOptions = {},
): void {
  // Only an away-transition observed after mount counts. Do not seed from the
  // initial visibility state: on Electron the window starts hidden/unfocused
  // (created with show:false, revealed later), and seeding would make the first
  // reveal look like a return-from-away and fire a needless reconnect that
  // flashes the montage tiles black on startup. refs #150
  const hiddenAtRef = useRef<number | null>(null);
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  // Record when the window left the foreground. The first signal wins so a
  // following pair (blur plus visibilitychange, or appStateChange plus
  // visibilitychange) does not reset the away timer. Shared by every signal, so
  // one background/foreground round trip resumes once however many of them fire.
  const markAway = useCallback(() => {
    if (hiddenAtRef.current === null) hiddenAtRef.current = Date.now();
  }, []);

  const tryResume = useCallback(() => {
    const awayAt = hiddenAtRef.current;
    hiddenAtRef.current = null;
    if (awayAt === null) return;
    if (Date.now() - awayAt < minHiddenMs) return;
    onResumeRef.current();
  }, [minHiddenMs]);

  // Native: the app being backgrounded and foregrounded. Inert on web and
  // desktop, where the two signals below cover it.
  useCapacitorListener<{ isActive: boolean }>(
    () => import('@capacitor/app').then((m) => ({ plugin: m.App })),
    'appStateChange',
    ({ isActive }) => {
      if (isActive) tryResume();
      else markAway();
    },
    { enabled: enabled && Platform.isNative },
  );

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markAway();
        return;
      }
      if (document.visibilityState === 'visible') tryResume();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Electron-only: occlusion behind another app fires blur/focus but not
    // visibilitychange, so add those to cover the window-covered case.
    const useFocus = Platform.isElectron;
    if (useFocus) {
      window.addEventListener('blur', markAway);
      window.addEventListener('focus', tryResume);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (useFocus) {
        window.removeEventListener('blur', markAway);
        window.removeEventListener('focus', tryResume);
      }
      // Drop any pending away-marker with the subscription that recorded it.
      // A caller can be disabled mid-away and re-enabled later (a montage tile
      // pausing while hidden, refs #337); keeping the marker would measure the
      // next return from an away-time this subscription never watched, and a
      // brief flick would resume as if the page had been gone for hours.
      hiddenAtRef.current = null;
    };
  }, [enabled, minHiddenMs, markAway, tryResume]);
}
