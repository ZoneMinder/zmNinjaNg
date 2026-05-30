/**
 * Fires a callback when the page transitions to visible after being hidden.
 *
 * Debounces a rapid hidden→visible→hidden flicker (e.g., quick alt-tab) so
 * a brief blur does not trigger a reconnect storm. The minimum hidden
 * duration before a return is considered worth acting on is
 * `minHiddenMs` (default 1500ms).
 *
 * Used to recover live streams after the OS/browser suspends the page:
 * Wake Lock keeps the display on but does not prevent background tab
 * throttling, so MJPEG/WebRTC streams can exhaust their retry budgets
 * while the window has no focus. refs #150
 */

import { useEffect, useRef } from 'react';

export interface UseVisibilityResumeOptions {
  enabled?: boolean;
  minHiddenMs?: number;
}

export function useVisibilityResume(
  onResume: () => void,
  { enabled = true, minHiddenMs = 1500 }: UseVisibilityResumeOptions = {},
): void {
  const hiddenAtRef = useRef<number | null>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : null,
  );
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState !== 'visible') return;

      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null) return;
      if (Date.now() - hiddenAt < minHiddenMs) return;

      onResumeRef.current();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, minHiddenMs]);
}
