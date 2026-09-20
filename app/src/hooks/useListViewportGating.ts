/**
 * Viewport gating for a page that scrolls inside the app shell.
 *
 * `useViewportGating` needs the element that actually scrolls, and a page's own
 * container is usually not it - the app's `<main>` is (see `findScrollParent`).
 * This finds that element, decides whether gating applies at all, and hands
 * back the tile plumbing unchanged.
 *
 * Why a long list needs this: a browser opens six connections to one host, so
 * the cards below the fold queue requests ahead of the ones on screen and the
 * visible feeds stay blank - silently, because a queued image load reports
 * nothing (refs #507).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { findScrollParent } from '../lib/dom/scroll-parent';
import { log, LogLevel } from '../lib/logger';
import { MONTAGE_GRID } from '../lib/zmninja-ng-constants';
import { useViewportGating, type ViewportGating } from './useViewportGating';

export interface ListViewportGating extends ViewportGating {
  /** Ref for the element the list renders into. */
  setListContainer: (element: HTMLElement | null) => void;
}

export function useListViewportGating({
  itemCount,
}: {
  /** Tiles the list is rendering. Below the threshold gating stays off. */
  itemCount: number;
}): ListViewportGating {
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);

  // Resolved as the container mounts rather than in an effect: reading
  // scrollHeight forces the layout the answer depends on, so it is already
  // true here, and an effect would cost a second render pass for the same
  // element. The ceiling is that it is resolved once - a page that only starts
  // scrolling later (a list that grew, a view mode that stacks taller) keeps
  // gating off until this container mounts again. The case that matters, a
  // page opened with more tiles than fit, scrolls in this very commit.
  const setListContainer = useCallback((element: HTMLElement | null) => {
    setScrollRoot(element ? findScrollParent(element) : null);
  }, []);

  // No scroll root means the cards all fit, so every one of them is in view and
  // gating has nothing to hold: leave it off rather than root an observer on
  // nothing and hold the whole page closed.
  const enabled = !!scrollRoot && itemCount > MONTAGE_GRID.viewportGatingMinTiles;

  // Nothing else in a device log says whether a page is gating: a tile reports
  // on its own stream, not on whether the page let it have one, and #507 was
  // debugged for six rounds against logs that could not answer that. Emitted
  // only when the answer changes, so a scroll does not flood the log.
  const lastLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    const line = `${enabled}:${itemCount}:${!!scrollRoot}`;
    if (lastLoggedRef.current === line) return;
    lastLoggedRef.current = line;
    log.monitor('List viewport gating', LogLevel.INFO, {
      enabled,
      tiles: itemCount,
      rooted: !!scrollRoot,
    });
  }, [enabled, itemCount, scrollRoot]);

  const gating = useViewportGating({
    enabled,
    root: scrollRoot,
    rootMargin: MONTAGE_GRID.viewportGatingRootMargin,
    lingerMs: MONTAGE_GRID.viewportGatingLingerMs,
  });

  return { ...gating, setListContainer };
}
