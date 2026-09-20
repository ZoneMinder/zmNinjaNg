/**
 * Viewport gating for a page that renders a long list of live tiles.
 *
 * `useViewportGating` does the observing; this decides whether the page is long
 * enough to need it, and reports the answer to the log.
 *
 * Why a long list needs this: a browser opens six connections to one host, so
 * the cards below the fold queue requests ahead of the ones on screen and the
 * visible feeds stay blank - silently, because a queued image load reports
 * nothing (refs #507).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { log, LogLevel } from '../lib/logger';
import { MONTAGE_GRID } from '../lib/zmninja-ng-constants';
import { useViewportGating, type ViewportGating } from './useViewportGating';

export interface ListViewportGating extends ViewportGating {
  /** Ref for the element the list renders into. */
  setListContainer: (element: HTMLElement | null) => void;
}

export function useListViewportGating({
  itemIds,
}: {
  /** One id per tile, in render order. Below the threshold gating stays off,
   *  and the ids are what the gated count below is measured over. */
  itemIds: string[];
}): ListViewportGating {
  const [listContainer, setListContainer] = useState<HTMLElement | null>(null);

  const enabled = itemIds.length > MONTAGE_GRID.viewportGatingMinTiles;

  const gating = useViewportGating({
    enabled,
    root: listContainer,
    // The list's height changes with its length, and which ancestor scrolls is
    // read from that height.
    rootEpoch: itemIds.length,
    rootMargin: MONTAGE_GRID.viewportGatingRootMargin,
    lingerMs: MONTAGE_GRID.viewportGatingLingerMs,
  });

  // How many tiles hold no connection right now. Nothing else in a device log
  // distinguishes a gated tile from a streaming one - the stream status a tile
  // reports is about its own URL, not about whether the page let it have one -
  // so #507 was debugged for rounds against logs that could not answer it.
  // Emitted only when the count changes, so a scroll does not flood the log.
  const gated = itemIds.reduce((total, id) => total + (gating.isTileGated(id) ? 1 : 0), 0);
  const lastLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    const line = `${gated}:${itemIds.length}:${enabled}`;
    if (lastLoggedRef.current === line) return;
    lastLoggedRef.current = line;
    log.monitor('List viewport gating', LogLevel.INFO, {
      gated,
      tiles: itemIds.length,
      enabled,
    });
  }, [gated, itemIds.length, enabled]);

  const setContainer = useCallback((element: HTMLElement | null) => {
    setListContainer(element);
  }, []);

  return { ...gating, setListContainer: setContainer };
}
