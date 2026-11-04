/**
 * Pull-to-Refresh Hook
 *
 * Detects pull-down gesture at top of scrollable container and triggers refresh callback.
 * Features:
 * - Only activates when scrolled to top
 * - Visual feedback with spinner
 * - Customizable threshold
 * - Touch-based gesture detection
 */

import { useRef, useState, type RefObject } from 'react';
import { useDrag } from '@use-gesture/react';
import { Platform } from '../lib/platform';

interface UsePullToRefreshOptions {
  /** The scroll container to watch. Owned by the caller, as in useEventMontageGrid. */
  containerRef: RefObject<HTMLDivElement | null>;
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  enabled?: boolean;
}

export function usePullToRefresh({
  containerRef,
  onRefresh,
  threshold = 80,
  enabled = true,
}: UsePullToRefreshOptions) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullDistance = useRef(0);

  const bind = useDrag(
    async ({ movement: [, my], first, last, memo = 0 }) => {
      // Only activate if enabled and at top of scroll
      if (!enabled) return;
      const container = containerRef.current;
      if (!container) return;

      const isAtTop = container.scrollTop === 0;

      if (first) {
        // Start of drag
        if (!isAtTop) return 0; // Don't start if not at top
        return container.scrollTop;
      }

      if (!isAtTop && memo === 0) return; // Not at top when drag started

      // Calculate pull distance
      const distance = Math.max(0, my - memo);
      pullDistance.current = distance;

      if (distance > 10) {
        setIsPulling(true);
      }

      if (last) {
        // End of drag
        setIsPulling(false);

        if (distance > threshold && !isRefreshing) {
          setIsRefreshing(true);
          try {
            await onRefresh();
          } finally {
            setIsRefreshing(false);
            pullDistance.current = 0;
          }
        } else {
          pullDistance.current = 0;
        }
      }

      return memo;
    },
    {
      axis: 'y',
      // On touch the browser already drops the click after a drag, and a mouse
      // click sends no touch events, so filterTaps would eat every mouse click
      // (iOS app on a Mac, refs #582). Keep it for pointer-driven desktop.
      filterTaps: !Platform.hasTouchEvents,
      pointer: { touch: true },
    }
  );

  return {
    bind,
    isPulling,
    isRefreshing,
    pullDistance: pullDistance.current,
    threshold,
  };
}
