/**
 * Hover / long-press preview primitive.
 *
 * Enlarges its children in place after a short trigger delay.
 *
 * **Desktop** (`Platform.isDesktopOrWeb`): mouseenter/mouseleave with a
 * configurable hover delay. The portal is rendered with
 * `pointer-events: none` so the underlying trigger remains clickable.
 *
 * **Native mobile**: long-press to open, tap-anywhere to close.
 * - Pointer down + hold for `UI_INTERACTIONS.longPressMs` opens the preview.
 * - Movement beyond `UI_INTERACTIONS.moveCancelPx` before the timer fires
 *   cancels it so list scrolling still works.
 * - While open, three things conspire to fully isolate the preview:
 *
 *   1. `#root` element gets `pointer-events: none`. Because the property
 *      is inherited, every descendant of `#root` (the entire React app)
 *      is excluded from pointer-event hit-testing. No card, no button,
 *      no list item underneath can receive any tap.
 *
 *   2. A fullscreen transparent backdrop is rendered in the portal at
 *      `z-index: 9998` with `pointer-events: auto`. It lives in
 *      `document.body` outside `#root`, so it stays interactive. Every
 *      tap on the screen — except those landing inside the preview
 *      itself — hit-tests to the backdrop.
 *
 *   3. Dismissal closes on `click`, not on `pointerdown`. Closing on
 *      pointerdown would unmount the backdrop and restore `#root`'s
 *      pointer-events BEFORE the synthetic click fires, causing the
 *      click to leak through to the underlying card. Closing on click
 *      ensures the click has already been delivered to the backdrop
 *      and consumed before any state changes.
 *
 * - The release of the long-press itself fires a click on the preview
 *   IMG (because the preview is now over the original tap location).
 *   That click must NOT close the preview — `expectingReleaseClickRef`
 *   tracks the first click after open and treats it as the release-click:
 *   blocked, but doesn't close. Subsequent clicks close.
 *
 * - Explicit pointer capture is taken on the long-press start so
 *   pointermove / pointerup keep flowing to the wrapper even after
 *   `#root` goes inert.
 *
 * The portal starts at the trigger's bounding rect and animates out to
 * the target size, with the zoom origin anchored to whichever corner of
 * the trigger is closest to the screen center — so the enlarged frame
 * stays on-screen. `renderPreview` is only invoked while the preview is
 * open, so inner components (live stream players) are created on open
 * and torn down on close.
 */

import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Platform } from '../../lib/platform';
import { UI_INTERACTIONS } from '../../lib/zmninja-ng-constants';

/**
 * Module-level reference count of open hover previews. Multiple
 * HoverPreview instances may exist on the page; the inertia on `#root`
 * is shared, so we apply it on first open and unconditionally clear it
 * when the count returns to zero. This avoids a stale-prev-value bug
 * where an instance could capture `pointer-events: none` (set by an
 * earlier instance), then on cleanup write that stale value back and
 * leave `#root` permanently inert.
 */
let rootInertOpenCount = 0;

const acquireRootInert = () => {
  if (Platform.isDesktopOrWeb) return;
  rootInertOpenCount += 1;
  if (rootInertOpenCount === 1) {
    const root = document.getElementById('root');
    if (root) root.style.pointerEvents = 'none';
  }
};

const releaseRootInert = () => {
  if (Platform.isDesktopOrWeb) return;
  rootInertOpenCount = Math.max(0, rootInertOpenCount - 1);
  if (rootInertOpenCount === 0) {
    const root = document.getElementById('root');
    if (root) root.style.pointerEvents = '';
  }
};

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HoverPreviewProps {
  /** Aspect ratio (width / height) used to size the preview box. */
  aspectRatio: number;
  /** Render prop called only while the preview is open. */
  renderPreview: () => ReactNode;
  /** Trigger element(s). */
  children: ReactNode;
  /** Width of the preview in pixels. Defaults to 400. */
  previewWidth?: number;
  /** Delay before opening, in ms. Defaults to 400. */
  hoverDelayMs?: number;
  /** data-testid on the preview portal root. */
  testId?: string;
  /** Extra className applied to the outer trigger wrapper. */
  className?: string;
}

export function HoverPreview({
  aspectRatio,
  renderPreview,
  children,
  previewWidth = UI_INTERACTIONS.previewWidthPx,
  hoverDelayMs = UI_INTERACTIONS.hoverDelayMs,
  testId,
  className = 'w-full h-full',
}: HoverPreviewProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRectRef = useRef<Rect | null>(null);
  const pressStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const expectingReleaseClickRef = useRef(false);
  // Mirrors the `open` state but updates synchronously. Used to gate
  // the reference-counted inertia on `#root` so that every transition
  // open→closed (no matter the path: tap, visibility change, app
  // background, unmount) decrements exactly once.
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const openFromAnchor = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (openRef.current) return;
    const r = anchor.getBoundingClientRect();
    startRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    setTargetRect(null);
    expectingReleaseClickRef.current = true;
    openRef.current = true;
    acquireRootInert();
    setOpen(true);
  };

  const closePreview = () => {
    clearTimer();
    expectingReleaseClickRef.current = false;
    if (openRef.current) {
      openRef.current = false;
      releaseRootInert();
    }
    setOpen(false);
    setTargetRect(null);
  };

  const handleEnter = () => {
    if (!Platform.isDesktopOrWeb) return;
    clearTimer();
    timerRef.current = window.setTimeout(openFromAnchor, hoverDelayMs);
  };

  const handleLeave = () => {
    if (!Platform.isDesktopOrWeb) return;
    closePreview();
  };

  const handlePointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (Platform.isDesktopOrWeb) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    clearTimer();
    pressStartRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    // Take explicit pointer capture so move/up keep flowing to this
    // element even after #root goes inert below.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      openFromAnchor();
    }, UI_INTERACTIONS.longPressMs);
  };

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const start = pressStartRef.current;
    if (!start || start.id !== e.pointerId) return;
    if (open) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > UI_INTERACTIONS.moveCancelPx * UI_INTERACTIONS.moveCancelPx) {
      clearTimer();
      pressStartRef.current = null;
    }
  };

  const handlePointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const start = pressStartRef.current;
    if (!start || start.id !== e.pointerId) return;
    pressStartRef.current = null;
    if (!open) clearTimer(); // normal tap: let click propagate
  };

  const handlePointerCancel = () => {
    pressStartRef.current = null;
    if (!open) clearTimer();
  };

  // The click handler is the linchpin of mobile dismissal. While open:
  //   - First click after open = the long-press release click. Block
  //     it (so navigation doesn't fire) but keep the preview open.
  //   - Any subsequent click = a real tap. Block AND close.
  //
  // This handler sees clicks from anywhere in the wrapper's React
  // subtree, including the portal contents (backdrop + preview) since
  // React's event tree treats portal children as descendants of the
  // wrapper. Clicks on the backdrop hit-test correctly because #root
  // is inert and the backdrop is the topmost element with
  // pointer-events: auto across the whole viewport.
  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    if (expectingReleaseClickRef.current) {
      expectingReleaseClickRef.current = false;
      return;
    }
    closePreview();
  };

  useEffect(() => {
    if (!open) return;
    const start = startRectRef.current;
    if (!start) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw - UI_INTERACTIONS.previewEdgeMarginPx * 2;
    const maxH = vh - UI_INTERACTIONS.previewEdgeMarginPx * 2;
    let w = Math.max(previewWidth, start.width * 2);
    w = Math.min(w, maxW);
    let h = w / aspectRatio;
    if (h > maxH) {
      h = maxH;
      w = h * aspectRatio;
    }
    const cx = start.left + start.width / 2;
    const cy = start.top + start.height / 2;

    let left = cx < vw / 2 ? start.left : start.left + start.width - w;
    let top = cy < vh / 2 ? start.top : start.top + start.height - h;

    const margin = UI_INTERACTIONS.previewEdgeMarginPx;
    left = Math.max(margin, Math.min(left, vw - margin - w));
    top = Math.max(margin, Math.min(top, vh - margin - h));

    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setTargetRect({ left, top, width: w, height: h });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
    };
  }, [open, aspectRatio, previewWidth]);

  useEffect(() => {
    if (!open) return;
    // All dismissal paths funnel through closePreview so the inertia
    // reference count is decremented exactly once.
    const dismiss = () => closePreview();
    if (Platform.isDesktopOrWeb) {
      window.addEventListener('scroll', dismiss, true);
      window.addEventListener('wheel', dismiss, { passive: true });
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dismiss();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let removeAppStateListener: (() => void) | null = null;
    if (Platform.isNative) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          const handle = await App.addListener('appStateChange', (state) => {
            if (!state.isActive) dismiss();
          });
          removeAppStateListener = () => handle.remove();
        } catch { /* plugin unavailable */ }
      })();
    }
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('wheel', dismiss);
      document.removeEventListener('visibilitychange', onVisibility);
      if (removeAppStateListener) removeAppStateListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Safety net: if the wrapper unmounts while the preview is open
  // (e.g. parent list re-renders mid-hover), release the inert lock
  // and tear down the timer.
  useEffect(() => {
    return () => {
      clearTimer();
      if (openRef.current) {
        openRef.current = false;
        releaseRootInert();
      }
    };
  }, []);

  const rect = targetRect ?? startRectRef.current;
  const isNative = !Platform.isDesktopOrWeb;

  return (
    <div
      ref={anchorRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onPointerDown={isNative ? handlePointerDown : undefined}
      onPointerMove={isNative ? handlePointerMove : undefined}
      onPointerUp={isNative ? handlePointerUp : undefined}
      onPointerCancel={isNative ? handlePointerCancel : undefined}
      onClickCapture={isNative ? handleClickCapture : undefined}
      className={className}
      style={
        isNative
          ? {
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
            }
          : undefined
      }
    >
      {children}
      {open && rect && createPortal(
        <>
          {isNative && (
            <div
              data-testid="hover-preview-backdrop"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9998,
                pointerEvents: 'auto',
                background: 'transparent',
              }}
            />
          )}
          <div
            data-testid={testId}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              pointerEvents: isNative ? 'auto' : 'none',
              zIndex: 9999,
              transition: `left ${UI_INTERACTIONS.previewAnimationMs}ms ease-out, top ${UI_INTERACTIONS.previewAnimationMs}ms ease-out, width ${UI_INTERACTIONS.previewAnimationMs}ms ease-out, height ${UI_INTERACTIONS.previewAnimationMs}ms ease-out`,
            }}
            className="rounded-md overflow-hidden shadow-2xl ring-1 ring-border bg-card"
          >
            {renderPreview()}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
