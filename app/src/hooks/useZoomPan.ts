/**
 * Zoom/Pan Hook
 *
 * Button-driven zoom and pan with pinch-to-zoom on touch devices.
 * Uses direct DOM manipulation for smooth transforms.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';

interface UseZoomPanOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeEnabled?: boolean;
}

interface TransformState {
  scale: number;
  x: number;
  y: number;
}

const ZOOM_THRESHOLD = 1.05;
const ZOOM_STEP = 0.5;
const PAN_STEP = 80;
// Per wheel notch: multiply/divide the scale by this fraction.
const WHEEL_STEP = 0.15;

export function useZoomPan({
  onSwipeLeft,
  onSwipeRight,
  swipeEnabled = false,
}: UseZoomPanOptions = {}) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [displayScale, setDisplayScale] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const innerElRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<TransformState>({ scale: 1, x: 0, y: 0 });

  // The container is tracked in state as well as in a ref. useGesture binds to
  // `target` from an effect that runs on every render and reads `.current` at
  // that moment, so a container that only enters the DOM in a later commit -
  // anything rendered through a portal, such as a Radix dialog - is null on the
  // first bind and would never be retried without a re-render (refs #272).
  // The effects below depend on this value for the same reason.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setContainerEl(el);
  }, []);

  // Callback ref for the inner (transformed) element
  const innerRef = useCallback((el: HTMLDivElement | null) => {
    innerElRef.current = el;
    if (el) {
      el.style.transformOrigin = '0 0';
      el.style.width = '100%';
      el.style.height = '100%';
    }
  }, []);

  // Same rule as the container above, on the transformed child.
  useEffect(() => {
    const el = innerElRef.current;
    if (!el) return;
    el.style.touchAction = isZoomed ? 'none' : 'pan-y';
  }, [isZoomed, containerEl]);

  // Write transform directly to the DOM
  const applyTransform = useCallback(
    (s: number, x: number, y: number, animate: boolean) => {
      // Fit is the floor. Smaller than the frame is never a state a user
      // asked for, and it used to be one they could only leave by pinching out.
      // There is no ceiling: a 400% one stopped short of the detail people
      // zoom in for, and the picture's own resolution is the real limit
      // (refs #478).
      const scale = Math.max(1, s);
      let cx = x;
      let cy = y;

      if (scale > 1 && containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        cx = Math.max(width * (1 - scale), Math.min(0, x));
        cy = Math.max(height * (1 - scale), Math.min(0, y));
      } else if (scale <= 1) {
        cx = 0;
        cy = 0;
      }

      stateRef.current = { scale, x: cx, y: cy };

      if (innerElRef.current) {
        const el = innerElRef.current;
        el.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
        // At identity, no transform at all: a transformed (or will-change:
        // transform) element is the containing block for every fixed-position
        // descendant, which trapped video.js's full-window player inside the
        // card instead of the viewport (refs #462).
        const identity = scale === 1 && cx === 0 && cy === 0;
        el.style.transform = identity ? '' : `translate(${cx}px, ${cy}px) scale(${scale})`;
        el.style.willChange = identity ? '' : 'transform';
      }
    },
    [],
  );

  const syncState = useCallback(() => {
    const { scale } = stateRef.current;
    setIsZoomed(scale > ZOOM_THRESHOLD);
    setDisplayScale(scale);
  }, []);

  const reset = useCallback(() => {
    applyTransform(1, 0, 0, true);
    setIsZoomed(false);
    setDisplayScale(1);
  }, [applyTransform]);

  const zoomIn = useCallback(() => {
    const cur = stateRef.current;
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    const newScale = cur.scale + ZOOM_STEP;
    const ratio = newScale / cur.scale;
    const cx = width / 2;
    const cy = height / 2;
    applyTransform(newScale, cx - (cx - cur.x) * ratio, cy - (cy - cur.y) * ratio, true);
    syncState();
  }, [applyTransform, syncState]);

  const zoomOut = useCallback(() => {
    const cur = stateRef.current;
    const newScale = Math.max(1, cur.scale - ZOOM_STEP);
    if (newScale < ZOOM_THRESHOLD) {
      reset();
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    const ratio = newScale / cur.scale;
    const cx = width / 2;
    const cy = height / 2;
    applyTransform(newScale, cx - (cx - cur.x) * ratio, cy - (cy - cur.y) * ratio, true);
    syncState();
  }, [applyTransform, reset, syncState]);

  const panLeft = useCallback(() => {
    const cur = stateRef.current;
    if (cur.scale <= ZOOM_THRESHOLD) return;
    applyTransform(cur.scale, cur.x + PAN_STEP, cur.y, true);
    syncState();
  }, [applyTransform, syncState]);

  const panRight = useCallback(() => {
    const cur = stateRef.current;
    if (cur.scale <= ZOOM_THRESHOLD) return;
    applyTransform(cur.scale, cur.x - PAN_STEP, cur.y, true);
    syncState();
  }, [applyTransform, syncState]);

  const panUp = useCallback(() => {
    const cur = stateRef.current;
    if (cur.scale <= ZOOM_THRESHOLD) return;
    applyTransform(cur.scale, cur.x, cur.y + PAN_STEP, true);
    syncState();
  }, [applyTransform, syncState]);

  const panDown = useCallback(() => {
    const cur = stateRef.current;
    if (cur.scale <= ZOOM_THRESHOLD) return;
    applyTransform(cur.scale, cur.x, cur.y - PAN_STEP, true);
    syncState();
  }, [applyTransform, syncState]);

  // Wheel zoom around the cursor (desktop), pinch-to-zoom (touch),
  // drag-to-pan (mouse + touch), and swipe navigation.
  useGesture(
    {
      onWheel: ({ event, direction: [, dirY], active }) => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;
        event.preventDefault();

        const rect = container.getBoundingClientRect();
        const fx = event.clientX - rect.left;
        const fy = event.clientY - rect.top;

        const cur = stateRef.current;
        // Scroll up zooms in, scroll down zooms out. Lower bound is 1 (fit) so
        // the wheel never shrinks the image below the container.
        const factor = dirY < 0 ? 1 + WHEEL_STEP : 1 - WHEEL_STEP;
        const newScale = Math.max(1, cur.scale * factor);
        if (newScale === cur.scale) return;
        const ratio = newScale / cur.scale;
        applyTransform(newScale, fx - (fx - cur.x) * ratio, fy - (fy - cur.y) * ratio, false);
        syncState();
      },

      onPinch: ({ offset: [newScale], origin: [ox, oy], first, last, memo }) => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const fx = ox - rect.left;
        const fy = oy - rect.top;

        if (first) {
          return { prevScale: stateRef.current.scale };
        }
        if (!memo) return;

        const ratio = newScale / memo.prevScale;
        const cur = stateRef.current;
        applyTransform(
          newScale,
          fx - (fx - cur.x) * ratio,
          fy - (fy - cur.y) * ratio,
          false,
        );

        if (last) {
          if (newScale < ZOOM_THRESHOLD) {
            applyTransform(1, 0, 0, true);
          }
          syncState();
        }

        return { prevScale: newScale };
      },

      onDrag: ({
        delta: [dx, dy],
        movement: [mx],
        direction: [xDir],
        velocity: [vx],
        last,
        pinching,
        cancel,
        tap,
        event,
      }) => {
        if (pinching) { cancel(); return; }
        if (tap) return;

        const cur = stateRef.current;

        if (cur.scale > ZOOM_THRESHOLD) {
          // Mouse/touch drag pan when zoomed
          applyTransform(cur.scale, cur.x + dx, cur.y + dy, false);
          if (last) syncState();
        } else if (swipeEnabled && last) {
          // Swipe navigation when not zoomed. Touch only: a mouse drag at 1x
          // would otherwise switch monitors unexpectedly on desktop.
          if ((event as PointerEvent).pointerType === 'mouse') return;
          const didSwipe = Math.abs(mx) > 80 || vx > 0.5;
          if (didSwipe) {
            if (xDir < 0) onSwipeLeft?.();
            else if (xDir > 0) onSwipeRight?.();
          }
        }
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      pinch: {
        // Floor at fit, not at minScale: the wheel path already clamps to 1,
        // and a pinch that reached 0.5 left the picture smaller than its frame
        // with no way back but pinching out. Now that touch-action is pan-y
        // while unzoomed, the browser can claim a touch and cancel a pinch
        // half way through, and a half-recognised one used to land on that
        // floor - which is the "it zooms out the moment I touch a feed".
        scaleBounds: { min: 1, max: Infinity },
        // And it takes a real pinch to start one: a stray touch that the
        // browser is about to turn into a scroll should not nudge the zoom.
        threshold: 0.1,
        rubberband: true,
      },
      // Pointer events (no touch:true) so mouse drag pans on desktop too.
      drag: { filterTaps: true },
      // Non-passive so the wheel handler can preventDefault page scroll.
      wheel: { eventOptions: { passive: false } },
    },
  );

  // Keyboard pan when zoomed (desktop). Only intercepts arrows while zoomed so
  // native page scrolling and other shortcuts keep working at 1x. Ignores
  // arrows while typing in a form field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (stateRef.current.scale <= ZOOM_THRESHOLD) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          panLeft();
          break;
        case 'ArrowRight':
          e.preventDefault();
          panRight();
          break;
        case 'ArrowUp':
          e.preventDefault();
          panUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          panDown();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panLeft, panRight, panUp, panDown]);

  // Grab cursor when zoomed so desktop users discover drag-to-pan.
  useEffect(() => {
    // Read through the ref: `containerEl` is only the dependency that re-runs
    // this once the node exists, and styling a value held in state trips
    // react-hooks/immutability.
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = isZoomed ? 'grab' : '';
  }, [isZoomed, containerEl]);

  // Apply touch/drag styles to container and block the browser's native image
  // drag (ghost image) so a mouse drag pans instead of dragging the picture.
  //
  // touch-action follows the zoom, which is what lets a tablet scroll the page
  // with a finger anywhere on the feed:
  //  - not zoomed: `pan-y` hands vertical drags to the browser, so the page
  //    scrolls from over the video instead of only from whatever strip is left
  //    beside it. Horizontal is still ours, so swiping between monitors works,
  //    and pinch is two-fingered, so zooming still starts here.
  //  - zoomed: `none`, because a one-finger drag now has to pan the image, and
  //    the page must not steal it.
  useEffect(() => {
    // Read through the ref: `containerEl` is only the dependency that re-runs
    // this once the node exists, and styling a value held in state trips
    // react-hooks/immutability.
    const el = containerRef.current;
    if (!el) return;
    el.classList.add('no-native-drag');
    el.style.touchAction = isZoomed ? 'none' : 'pan-y';
    const onDragStart = (e: Event) => e.preventDefault();
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.classList.remove('no-native-drag');
      el.style.touchAction = '';
      el.removeEventListener('dragstart', onDragStart);
    };
  }, [containerEl, isZoomed]);

  return {
    ref: setContainer,
    innerRef,
    // The element itself, for callers that have to measure it rather than only
    // bind gestures to it (useScrollAffordance, refs #365).
    containerEl,
    scale: displayScale,
    isZoomed,
    reset,
    zoomIn,
    zoomOut,
    panLeft,
    panRight,
    panUp,
    panDown,
  };
}
