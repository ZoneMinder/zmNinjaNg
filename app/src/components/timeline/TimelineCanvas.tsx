/**
 * TimelineCanvas — main canvas component that wires together
 * the viewport, gestures, rendering, and hit-testing.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useTimelineViewport } from './useTimelineViewport';
import { useTimelineGestures } from './useTimelineGestures';
import { renderTimeline, type MonitorRow, type RenderViewport } from './timeline-renderer';
import { hitTest } from './timeline-hit-test';
import { canvasHeight, LAYOUT, getMonitorColor, type TimelineEvent } from './timeline-layout';
import { TimelineScrubber, type ScrubberState } from './TimelineScrubber';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { useBandwidthSettings } from '../../hooks/useBandwidthSettings';
import { TIMELINE } from '../../lib/zmninja-ng-constants';

interface TimelineCanvasProps {
  monitors: MonitorRow[];
  events: TimelineEvent[];
  startMs: number;
  endMs: number;
  /** Increment to force viewport reset to startMs/endMs */
  resetKey?: number;
  /** Increment to zoom in by 2x centered */
  zoomInKey?: number;
  /** Increment to zoom out by 2x centered */
  zoomOutKey?: number;
  /** Increment to scroll viewport so NOW is visible */
  goToNowKey?: number;
  /** Increment to pan left */
  panLeftKey?: number;
  /** Increment to pan right */
  panRightKey?: number;
  onEventClick: (event: TimelineEvent) => void;
  onEventHover: (event: TimelineEvent | null, x: number, y: number) => void;
  /** Called when a scrubber thumbnail is tapped. */
  onScrubberEventTap: (eventId: string) => void;
  /** Called when scrubber state changes (for save/restore). */
  onScrubberStateChange?: (state: ScrubberState | null) => void;
  /** Restore scrubber to this state on mount. */
  initialScrubberState?: ScrubberState | null;
  /** When true, drag selects a region to zoom into instead of panning. */
  brushMode?: boolean;
  /** Increment to shift viewport so NOW is at the right edge (keeps zoom level). */
  followNowKey?: number;
  /** When true, prop changes to startMs/endMs won't reset the viewport. */
  liveMode?: boolean;
}

const TimelineCanvasInner = ({
  monitors,
  events,
  startMs,
  endMs,
  resetKey,
  zoomInKey,
  zoomOutKey,
  goToNowKey,
  panLeftKey,
  panRightKey,
  onEventClick,
  onEventHover,
  onScrubberEventTap,
  onScrubberStateChange,
  initialScrubberState,
  brushMode,
  followNowKey,
  liveMode,
}: TimelineCanvasProps) => {
  const { formatSettings } = useDateTimeFormat();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubberWrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrubberHeight, setScrubberHeight] = useState(0);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  const [brushSelection, setBrushSelection] = useState<[number, number] | null>(null);

  const viewport = useTimelineViewport({ startMs, endMs });

  // Track filter range changes and sync viewport (skip in live mode to preserve zoom)
  const prevRangeRef = useRef(`${startMs}-${endMs}`);
  useEffect(() => {
    if (liveMode) return;
    const key = `${startMs}-${endMs}`;
    if (key !== prevRangeRef.current) {
      prevRangeRef.current = key;
      viewport.setRange(startMs, endMs);
    }
  }, [startMs, endMs, viewport, liveMode]);

  // Reset viewport when resetKey changes (center/fit button)
  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== undefined && resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey;
      viewport.animateToRange(startMs, endMs);
    }
  }, [resetKey, startMs, endMs, viewport]);

  // Zoom in/out keeping current center
  const prevZoomInRef = useRef(zoomInKey);
  useEffect(() => {
    if (zoomInKey !== undefined && zoomInKey !== prevZoomInRef.current) {
      prevZoomInRef.current = zoomInKey;
      const mid = (viewport.startMs + viewport.endMs) / 2;
      const dur = viewport.durationMs * 0.5;
      viewport.animateToRange(mid - dur / 2, mid + dur / 2);
    }
  }, [zoomInKey, viewport]);

  const prevZoomOutRef = useRef(zoomOutKey);
  useEffect(() => {
    if (zoomOutKey !== undefined && zoomOutKey !== prevZoomOutRef.current) {
      prevZoomOutRef.current = zoomOutKey;
      const mid = (viewport.startMs + viewport.endMs) / 2;
      const dur = viewport.durationMs * 2;
      viewport.animateToRange(mid - dur / 2, mid + dur / 2);
    }
  }, [zoomOutKey, viewport]);

  // Scroll viewport so NOW is centered, keeping current zoom level
  const prevGoToNowRef = useRef(goToNowKey);
  useEffect(() => {
    if (goToNowKey !== undefined && goToNowKey !== prevGoToNowRef.current) {
      prevGoToNowRef.current = goToNowKey;
      const now = Date.now();
      const dur = viewport.durationMs;
      viewport.animateToRange(now - dur / 2, now + dur / 2);
    }
  }, [goToNowKey, viewport]);

  // Follow NOW — shift viewport so NOW is near the right edge (keeps zoom level)
  const prevFollowNowRef = useRef(followNowKey);
  useEffect(() => {
    if (followNowKey !== undefined && followNowKey !== prevFollowNowRef.current) {
      prevFollowNowRef.current = followNowKey;
      const now = Date.now();
      const dur = viewport.durationMs;
      // Place NOW at ~90% from left so there's a small buffer on the right
      viewport.animateToRange(now - dur * 0.9, now + dur * 0.1);
    }
  }, [followNowKey, viewport]);

  // Pan left/right by 20% of current viewport duration
  const prevPanLeftRef = useRef(panLeftKey);
  useEffect(() => {
    if (panLeftKey !== undefined && panLeftKey !== prevPanLeftRef.current) {
      prevPanLeftRef.current = panLeftKey;
      const dur = viewport.durationMs;
      viewport.animateToRange(viewport.startMs - dur * 0.2, viewport.endMs - dur * 0.2);
    }
  }, [panLeftKey, viewport]);

  const prevPanRightRef = useRef(panRightKey);
  useEffect(() => {
    if (panRightKey !== undefined && panRightKey !== prevPanRightRef.current) {
      prevPanRightRef.current = panRightKey;
      const dur = viewport.durationMs;
      viewport.animateToRange(viewport.startMs + dur * 0.2, viewport.endMs + dur * 0.2);
    }
  }, [panRightKey, viewport]);

  // Observe container width + scrubber height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) {
          setContainerWidth(entry.contentRect.width);
        } else if (entry.target === scrubberWrapRef.current) {
          setScrubberHeight(entry.contentRect.height + 8); // +8 for pt-2 padding
        }
      }
    });
    ro.observe(el);
    if (scrubberWrapRef.current) ro.observe(scrubberWrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Current time refresh — interval comes from bandwidth settings
  const bandwidth = useBandwidthSettings();
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), bandwidth.timelineNowRefreshInterval);
    return () => clearInterval(id);
  }, [bandwidth.timelineNowRefreshInterval]);

  const pulseRafRef = useRef<number | null>(null);

  const monitorIds = monitors.map((m) => m.id);
  const height = canvasHeight(monitors.length);

  // Gesture callbacks
  const handlePan = useCallback(
    (deltaPx: number) => viewport.pan(deltaPx, containerWidth),
    [viewport, containerWidth],
  );

  const handleZoom = useCallback(
    (factor: number, anchorNormX: number) => viewport.zoom(factor, anchorNormX),
    [viewport],
  );

  const handleHover = useCallback(
    (x: number, y: number) => {
      const hit = hitTest(x, y, events, monitorIds, {
        startMs: viewport.startMs,
        endMs: viewport.endMs,
        canvasWidth: containerWidth,
      });
      setHoveredEventId(hit?.id ?? null);
      onEventHover(hit, x, y);
    },
    [events, monitorIds, viewport.startMs, viewport.endMs, containerWidth, onEventHover],
  );

  const handleHoverEnd = useCallback(() => {
    setHoveredEventId(null);
    onEventHover(null, 0, 0);
  }, [onEventHover]);

  const handleClick = useCallback(
    (x: number, y: number) => {
      const hit = hitTest(x, y, events, monitorIds, {
        startMs: viewport.startMs,
        endMs: viewport.endMs,
        canvasWidth: containerWidth,
      });
      if (hit) onEventClick(hit);
    },
    [events, monitorIds, viewport.startMs, viewport.endMs, containerWidth, onEventClick],
  );

  const handleBrushZoom = useCallback(
    (startNorm: number, endNorm: number) => {
      const rangeStart = viewport.normToTime(startNorm);
      const rangeEnd = viewport.normToTime(endNorm);
      viewport.animateToRange(rangeStart, rangeEnd);
      setBrushSelection(null);
    },
    [viewport],
  );

  const handleBrushUpdate = useCallback(
    (startNorm: number, endNorm: number) => {
      if (startNorm === 0 && endNorm === 0) {
        setBrushSelection(null);
      } else {
        setBrushSelection([startNorm, endNorm]);
      }
    },
    [],
  );

  const canvasRef = useTimelineGestures({
    onPan: handlePan,
    onZoom: handleZoom,
    onHover: handleHover,
    onHoverEnd: handleHoverEnd,
    onClick: handleClick,
    brushMode,
    onBrushZoom: handleBrushZoom,
    onBrushUpdate: handleBrushUpdate,
  });

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderVp: RenderViewport = {
      startMs: viewport.startMs,
      endMs: viewport.endMs,
      width: containerWidth,
      height,
      dpr,
    };

    const paintFrame = () => {
      renderTimeline(ctx, canvas, monitors, events, monitorIds, renderVp, hoveredEventId, playheadMs, formatSettings, liveMode ? Date.now() : undefined);

      // Draw brush selection overlay
      if (brushSelection) {
        const [lo, hi] = brushSelection;
        const x1 = lo * containerWidth * dpr;
        const x2 = hi * containerWidth * dpr;
        const bh = height * dpr;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, x1, bh);
        ctx.fillRect(x2, 0, containerWidth * dpr - x2, bh);

        ctx.fillStyle = 'rgba(0, 168, 255, 0.15)';
        ctx.fillRect(x1, 0, x2 - x1, bh);

        ctx.strokeStyle = '#00a8ff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, bh);
        ctx.moveTo(x2, 0);
        ctx.lineTo(x2, bh);
        ctx.stroke();
      }
    };

    // Initial paint
    paintFrame();

    // If any events are pulsing, run a rAF loop to animate the halo
    if (pulseRafRef.current) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    const hasPulsingEvents = liveMode && events.some((e) => e.arrivedAt !== undefined && Date.now() - e.arrivedAt < TIMELINE.pulseDurationMs);
    if (hasPulsingEvents) {
      const animate = () => {
        paintFrame();
        if (events.some((e) => e.arrivedAt !== undefined && Date.now() - e.arrivedAt < TIMELINE.pulseDurationMs)) {
          pulseRafRef.current = requestAnimationFrame(animate);
        } else {
          pulseRafRef.current = null;
        }
      };
      pulseRafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (pulseRafRef.current) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }
    };
  });

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-background"
    >
      {/* Scrubber bar — above time labels */}
      <div ref={scrubberWrapRef} className="px-2 pt-2">
        <TimelineScrubber
          events={events}
          monitors={monitors}
          viewStartMs={viewport.startMs}
          viewEndMs={viewport.endMs}
          onPlayheadChange={setPlayheadMs}
          onEventTap={onScrubberEventTap}
          onStateChange={onScrubberStateChange}
          initialState={initialScrubberState}
          thumbnailPosition="below"
        />
      </div>
      <canvas
        ref={canvasRef}
        className="w-full"
        data-testid="timeline-canvas"
      />
      {/* Monitor name sidebar with gradient fade to avoid obscuring events */}
      <div
        className="absolute left-0 z-10 pointer-events-none"
        style={{ top: scrubberHeight + LAYOUT.headerHeight }}
        data-testid="timeline-monitor-labels"
      >
        {monitors.map((monitor, index) => (
          <div
            key={monitor.id}
            className="flex items-center gap-1.5 pl-2 pr-4 pointer-events-auto"
            style={{
              height: LAYOUT.rowHeight,
              background: 'linear-gradient(to right, hsl(var(--background)) 70%, transparent)',
            }}
            title={monitor.name}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: getMonitorColor(index) }}
            />
            <span className="text-xs font-medium text-foreground/80 truncate max-w-28">
              {monitor.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TimelineCanvas = memo(TimelineCanvasInner);
