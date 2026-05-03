/**
 * Hook for container resize observation
 *
 * Uses ResizeObserver to track container width changes.
 * First measurement fires immediately; subsequent changes are debounced
 * (GRID_LAYOUT.resizeDebounceMs) so height recalculation only happens after
 * resizing stops.
 */

import { useCallback, useRef } from 'react';
import { GRID_LAYOUT } from '../../../lib/zmninja-ng-constants';

interface UseContainerResizeOptions {
  onWidthChange: (width: number) => void;
  currentWidthRef: React.MutableRefObject<number>;
}

interface UseContainerResizeReturn {
  containerRef: (element: HTMLDivElement | null) => void;
}

export function useContainerResize({
  onWidthChange,
  currentWidthRef,
}: UseContainerResizeOptions): UseContainerResizeReturn {
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useCallback(
    (element: HTMLDivElement | null) => {
      // Clean up previous observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (!element) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          if (width > 0 && currentWidthRef.current !== width) {
            // First measurement fires immediately so initial layout can build
            if (currentWidthRef.current === 0) {
              onWidthChange(width);
            } else {
              // Update width ref immediately (WidthProvider handles column scaling),
              // but debounce the height recalculation callback until resizing stops.
              currentWidthRef.current = width;
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = setTimeout(() => {
                onWidthChange(width);
              }, GRID_LAYOUT.resizeDebounceMs);
            }
          }
        }
      });

      observer.observe(element);
      resizeObserverRef.current = observer;
    },
    [onWidthChange, currentWidthRef]
  );

  return { containerRef };
}
