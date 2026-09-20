/**
 * useViewportGating
 *
 * Reports which montage tiles are far enough outside the scroll container to
 * hold no connection at all. All Servers mode turns this on through
 * `allModeViewportGating` (refs #337): a wall of cameras across several
 * servers is taller than any screen, so most of its tiles are streaming into
 * scrollback nobody is looking at.
 *
 * ONE observer for the whole grid, not one per tile: a montage can carry
 * dozens of tiles, and an observer each would mean dozens of registrations
 * against the same root doing the same work. Tiles hand their element to
 * `registerTile`, which is also how the observer learns the composite tile id
 * an entry belongs to - raw monitor ids collide across servers (Aggregation
 * contract).
 *
 * No scroll listener. react-grid-layout positions tiles with transforms, and
 * IntersectionObserver measures the element's real box every frame, so a tile
 * dragged or resized into view is reported without re-observing anything.
 *
 * Two asymmetries are deliberate:
 *
 * - A tile nobody has measured yet counts as gated. The alternative - assume
 *   in view until told otherwise - mints a connkey for every off-screen tile
 *   on mount and quits it a frame later, which is the expensive half of a
 *   teardown for no streaming at all.
 * - Coming into view connects at once; leaving it disconnects only after
 *   `lingerMs`. Scrolling through a montage would otherwise quit and remint a
 *   connkey for every tile the user passes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const NO_TILES: ReadonlySet<string> = new Set();

export interface ViewportGatingOptions {
  /** Whether gating applies at all. False keeps every tile ungated and
   *  observes nothing; turning it off releases whatever was gated. */
  enabled: boolean;
  /** Scroll container the tiles live in. The margin below only expands THIS
   *  root: an intermediate scroller clips without it, so rooting at the
   *  viewport instead would collapse the pre-load margin to nothing. */
  root: HTMLElement | null;
  /** How far beyond the container a tile still counts as in view, as an
   *  IntersectionObserver rootMargin. */
  rootMargin: string;
  /** How long a tile stays connected after leaving view. */
  lingerMs: number;
}

export interface ViewportGating {
  /** Whether this tile must hold no connection right now. */
  isTileGated: (tileId: string) => boolean;
  /** Ref callback for the tile's element, stable per tile id so a grid
   *  re-render does not detach and re-observe every tile. */
  registerTile: (tileId: string) => (el: HTMLElement | null) => void;
}

export function useViewportGating({
  enabled,
  root,
  rootMargin,
  lingerMs,
}: ViewportGatingOptions): ViewportGating {
  // The tiles currently in view. Gating is the complement of this rather than
  // a set of gated ids, so a tile that has not been measured yet - not in any
  // set - is gated, per the asymmetry above.
  const [visibleTileIds, setVisibleTileIds] = useState<ReadonlySet<string>>(NO_TILES);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementByTile = useRef(new Map<string, HTMLElement>());
  const tileByElement = useRef(new Map<HTMLElement, string>());
  const refCallbacks = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const cancelLeave = useCallback((tileId: string) => {
    const timer = leaveTimers.current.get(tileId);
    if (!timer) return;
    clearTimeout(timer);
    leaveTimers.current.delete(tileId);
  }, []);

  const dropTile = useCallback(
    (tileId: string) => {
      cancelLeave(tileId);
      setVisibleTileIds((prev) => {
        if (!prev.has(tileId)) return prev;
        const next = new Set(prev);
        next.delete(tileId);
        return next;
      });
    },
    [cancelLeave]
  );

  // Deliberately NOT gated on `root`. The root arrives from a ref, so it is
  // null for the first render, and a tile that renders ungated even once has
  // already minted a connkey - which the next render, once the root lands,
  // immediately quits. That mint-and-quit on every cold start is most of what
  // this feature exists to avoid. Gating from the first render costs nothing
  // in return: the scroll container is rendered unconditionally alongside the
  // tiles, so the root lands in that same first commit and the observer is
  // built before anything could have streamed. The effect below still guards
  // on it, since an observer needs a real element to root on.
  const active = enabled && typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    if (!active || !root) return;

    const timers = leaveTimers.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const entering: string[] = [];
        for (const entry of entries) {
          const tileId = tileByElement.current.get(entry.target as HTMLElement);
          if (!tileId) continue;
          cancelLeave(tileId);
          if (entry.isIntersecting) {
            entering.push(tileId);
          } else {
            timers.set(
              tileId,
              setTimeout(() => {
                timers.delete(tileId);
                dropTile(tileId);
              }, lingerMs)
            );
          }
        }
        if (entering.length === 0) return;
        setVisibleTileIds((prev) => {
          if (entering.every((id) => prev.has(id))) return prev;
          const next = new Set(prev);
          for (const id of entering) next.add(id);
          return next;
        });
      },
      { root, rootMargin }
    );
    observerRef.current = observer;
    for (const el of elementByTile.current.values()) observer.observe(el);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      // Unmounting, or turning the setting off, must not leave a tile gated
      // with nothing left running to un-gate it.
      setVisibleTileIds(NO_TILES);
    };
  }, [active, root, rootMargin, lingerMs, cancelLeave, dropTile]);

  const registerTile = useCallback(
    (tileId: string) => {
      const cached = refCallbacks.current.get(tileId);
      if (cached) return cached;

      const callback = (el: HTMLElement | null) => {
        const previous = elementByTile.current.get(tileId);
        if (previous) {
          observerRef.current?.unobserve(previous);
          tileByElement.current.delete(previous);
          elementByTile.current.delete(tileId);
        }
        if (!el) {
          // The tile is gone (unmounted, or moved between grid sections). Drop
          // what we knew about it: a stale "in view" would let it come back
          // streaming from a position nobody has measured.
          //
          // The callback itself STAYS cached. Dropping it here would hand the
          // next render a different function for the same tile, React would
          // detach the old one, this branch would run again, and the tile
          // would be observed, dropped and re-observed on every render.
          // React's own StrictMode attach/detach/attach on mount is enough to
          // start that, and it left every tile gated with nothing streaming.
          // The map holds one closure per tile id this page has rendered,
          // which is bounded by the montage itself.
          dropTile(tileId);
          return;
        }
        elementByTile.current.set(tileId, el);
        tileByElement.current.set(el, tileId);
        observerRef.current?.observe(el);
      };

      refCallbacks.current.set(tileId, callback);
      return callback;
    },
    [dropTile]
  );

  const isTileGated = useCallback(
    (tileId: string) => active && !visibleTileIds.has(tileId),
    [active, visibleTileIds]
  );

  return { isTileGated, registerTile };
}
