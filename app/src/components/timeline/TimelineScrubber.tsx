/**
 * TimelineScrubber
 *
 * A draggable scrubber bar below the timeline canvas. Dragging the handle
 * moves a playhead through the timeline and shows thumbnail previews of
 * all events overlapping the playhead time.
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query/query-keys';
import { buildThumbnailChainForEvent } from '../../lib/event/thumbnail-chain';
import { EventThumbnail } from '../events/EventThumbnail';
import { HoverPreview } from '../ui/hover-preview';
import { EventZmsHoverPlayer } from '../events/EventThumbnailHoverPreview';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { asProfileId, type MonitorsResponse } from '../../api/types';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { LAYOUT, type TimelineEvent } from './timeline-layout';
import type { MonitorRow } from './timeline-renderer';

/** Serializable scrubber state for navigation restore. */
export interface ScrubberState {
  handleNorm: number;
  playheadMs: number;
  activeEventIds: string[];
}

interface TimelineScrubberProps {
  events: TimelineEvent[];
  monitors: MonitorRow[];
  viewStartMs: number;
  viewEndMs: number;
  onPlayheadChange: (timeMs: number | null) => void;
  /** Called when a scrubber thumbnail is tapped. All mode: profileId is the
   *  owning profile straight off the tapped event, so colliding event ids
   *  across two profiles resolve correctly (refs #337 Task 3) - never a
   *  reverse by-id lookup. Undefined in single mode. */
  onEventTap: (eventId: string, profileId?: string) => void;
  /** Called whenever scrubber state changes: parent can save for restore. */
  onStateChange?: (state: ScrubberState | null) => void;
  /** Restore scrubber to this state on mount. */
  initialState?: ScrubberState | null;
  /** Where to show thumbnails relative to the scrubber bar. */
  thumbnailPosition?: 'above' | 'below';
}

/**
 * Find events near a timestamp. Tolerance scales with zoom level so that
 * the scrubber "snaps" to events even when bars are visually thin.
 * At minimum 30s tolerance, plus 1% of the visible range.
 */
/**
 * Find events whose rendered bar overlaps the handle position in pixel space.
 * Matches the same min-width logic used by the canvas renderer and hit-test.
 */
function eventsAtHandle(
  events: TimelineEvent[],
  handleNorm: number,
  viewStartMs: number,
  viewEndMs: number,
  trackWidthPx: number,
): TimelineEvent[] {
  const handlePx = handleNorm * trackWidthPx;
  const range = viewEndMs - viewStartMs;
  const minBarPx = LAYOUT.eventMinWidth;

  return events.filter((ev) => {
    let leftPx = ((ev.startMs - viewStartMs) / range) * trackWidthPx;
    let rightPx = ((ev.endMs - viewStartMs) / range) * trackWidthPx;
    const barWidth = rightPx - leftPx;
    // Match canvas min-width expansion
    if (barWidth < minBarPx) {
      const center = (leftPx + rightPx) / 2;
      leftPx = center - minBarPx / 2;
      rightPx = center + minBarPx / 2;
    }
    return handlePx >= leftPx && handlePx <= rightPx;
  });
}

function ScrubberThumbnail({
  event,
  monitorName,
  onTap,
}: {
  event: TimelineEvent;
  monitorName: string;
  onTap: (eventId: string, profileId?: string) => void;
}) {
  // All mode: resolve THIS event's owning profile instead of the (absent or
  // wrong) current profile, and use the real (bare) monitor id preserved
  // under realMonitorId - event.monitorId itself is the composite
  // `${profileId}:${monitorId}` key in All mode (see Timeline.tsx's
  // canvasEvents mapping), not a real monitor id (refs #337 Task 2).
  // Single mode: both fields are undefined, falling back to the current
  // profile and the plain monitorId, matching prior behavior exactly.
  const ownerProfileId = event.profileId ? asProfileId(event.profileId) : undefined;
  const { profile: ownerProfile, settings } = useProfileById(ownerProfileId);
  // Previews are selection-scoped: they follow the current selection, not
  // the owning server (refs #536).
  const { settings: selectionSettings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(ownerProfileId);
  const { fmtTimeShort } = useDateTimeFormat();
  const queryClient = useQueryClient();
  const realMonitorId = event.realMonitorId ?? event.monitorId;

  const profilePortalUrl = ownerProfile?.portalUrl ?? '';
  const monitors = (queryClient.getQueryData<MonitorsResponse>(queryKeys.monitors(ownerProfile?.id)))?.monitors ?? [];
  const thumbnailUrls = buildThumbnailChainForEvent(realMonitorId, monitors, profilePortalUrl, event.id, settings.thumbnailFallbackChain, {
    token: isAccessTokenFresh ? accessToken ?? undefined : undefined,
    minStreamingPort: resolveMinStreamingPort(ownerProfile?.minStreamingPort, settings.forceDisableMultiPort),
    monitorId: realMonitorId,
    // A timeline row carries the ratio rather than the raw count, but zero
    // still means no alarm frame to ask for (refs #331).
    hasAlarmFrame: event.alarmRatio > 0,
    profileId: ownerProfileId,
  });

  const button = (
    <button
      type="button"
      className="relative shrink-0 w-24 h-16 rounded overflow-hidden bg-black border border-border/50 hover:border-primary/50 transition-colors cursor-pointer"
      onClick={() => onTap(event.id, event.profileId)}
      title={`${monitorName} · #${event.id}`}
      data-testid={`scrubber-thumb-${event.id}`}
    >
      <EventThumbnail
        urls={thumbnailUrls}
        cacheKey={`scrubber-${event.id}`}
        alt=""
        className="w-full h-full"
        objectFit="cover"
      />
      <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/70 px-1 flex min-w-0">
        <span className="truncate">{monitorName}</span>
        <span className="shrink-0"> · {fmtTimeShort(new Date(event.startMs))}</span>
      </span>
    </button>
  );

  if (!selectionSettings.hoverPreview.timeline) return button;

  return (
    <HoverPreview
      aspectRatio={16 / 9}
      testId="event-thumbnail-hover-preview"
      className="shrink-0"
      renderPreview={() => (
        <EventZmsHoverPlayer
          descriptor={{ eventId: event.id, monitorId: realMonitorId, profileId: event.profileId }}
        />
      )}
    >
      {button}
    </HoverPreview>
  );
}

function TimelineScrubberComponent({
  events,
  monitors,
  viewStartMs,
  viewEndMs,
  onPlayheadChange,
  onEventTap,
  onStateChange,
  initialState,
  thumbnailPosition = 'above',
}: TimelineScrubberProps) {
  const { t } = useTranslation();
  const { fmtDateTime } = useDateTimeFormat();
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [handleNorm, setHandleNorm] = useState(initialState?.handleNorm ?? 0.5);
  const [activeEvents, setActiveEvents] = useState<TimelineEvent[]>([]);
  const [hasInteracted, setHasInteracted] = useState(!!initialState);

  // Restore state when initialState changes (e.g., navigating back)
  const lastRestoredRef = useRef<ScrubberState | null>(null);
  useEffect(() => {
    if (!initialState || events.length === 0) return;
    if (lastRestoredRef.current === initialState) return;
    lastRestoredRef.current = initialState;
    const ids = new Set(initialState.activeEventIds);
    const restored = events.filter((ev) => ids.has(ev.id));
    if (restored.length > 0) {
      setActiveEvents(restored);
      setHandleNorm(initialState.handleNorm);
      onPlayheadChange(initialState.playheadMs);
    }
  }, [initialState, events, onPlayheadChange]);

  const monitorNameMap = new Map(monitors.map((m) => [m.id, m.name]));

  const normToTime = useCallback(
    (norm: number) => viewStartMs + norm * (viewEndMs - viewStartMs),
    [viewStartMs, viewEndMs],
  );

  // Debounce event lookup to reduce server load from thumbnail fetches
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateScrubNorm = useCallback(
    (norm: number) => {
      const clamped = Math.max(0, Math.min(1, norm));
      setHandleNorm(clamped);
      const timeMs = normToTime(clamped);
      // Playhead line updates immediately
      onPlayheadChange(timeMs);
      // Debounce thumbnail lookup (150ms)
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const track = trackRef.current;
        if (!track) return;
        setActiveEvents(eventsAtHandle(events, clamped, viewStartMs, viewEndMs, track.getBoundingClientRect().width));
      }, 150);
    },
    [events, normToTime, onPlayheadChange, viewStartMs, viewEndMs],
  );

  const updateScrub = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      updateScrubNorm((clientX - rect.left) / rect.width);
    },
    [updateScrubNorm],
  );

  // Keyboard seeking: arrow keys nudge by 1%, Home/End jump to the ends.
  const onTrackKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 0.01;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveEvents([]);
        setHasInteracted(true);
        updateScrubNorm(handleNorm - step);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveEvents([]);
        setHasInteracted(true);
        updateScrubNorm(handleNorm + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveEvents([]);
        setHasInteracted(true);
        updateScrubNorm(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveEvents([]);
        setHasInteracted(true);
        updateScrubNorm(1);
      }
    },
    [handleNorm, updateScrubNorm],
  );

  // Mouse handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setActiveEvents([]); // clear stale thumbnails so they don't block
      setScrubbing(true);
      setHasInteracted(true);
      updateScrub(e.clientX);
    },
    [updateScrub],
  );

  useEffect(() => {
    if (!scrubbing) return;

    const onMouseMove = (e: MouseEvent) => updateScrub(e.clientX);
    const onMouseUp = () => setScrubbing(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scrubbing, updateScrub]);

  // Touch handlers
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setActiveEvents([]); // clear stale thumbnails so they don't block
      setScrubbing(true);
      setHasInteracted(true);
      updateScrub(e.touches[0].clientX);
    },
    [updateScrub],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (scrubbing) updateScrub(e.touches[0].clientX);
    },
    [scrubbing, updateScrub],
  );

  const onTouchEnd = useCallback(() => {
    setScrubbing(false);
  }, []);

  // Dismiss thumbnails when tapping outside
  const dismissThumbnails = useCallback(() => {
    setActiveEvents([]);
    setHasInteracted(false);
    onPlayheadChange(null);
    onStateChange?.(null);
  }, [onPlayheadChange, onStateChange]);

  // Notify parent of scrubber state when thumbnails are visible (for save/restore)
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    if (!scrubbing && activeEvents.length > 0) {
      onStateChangeRef.current?.({
        handleNorm,
        playheadMs: normToTime(handleNorm),
        activeEventIds: activeEvents.map((ev) => ev.id),
      });
    }
  }, [scrubbing, activeEvents, handleNorm, normToTime]);

  const playheadTime = normToTime(handleNorm);

  const below = thumbnailPosition === 'below';

  const timeLabelEl = (
    <div className="text-[10px] text-center text-muted-foreground pointer-events-none whitespace-nowrap">
      {fmtDateTime(new Date(playheadTime))}
    </div>
  );

  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(0);

  useEffect(() => {
    if (thumbRef.current) {
      setThumbHeight(thumbRef.current.offsetHeight);
    } else {
      setThumbHeight(0);
    }
  }, [activeEvents]);

  const thumbnailStrip = activeEvents.length > 0 && (
    <div
      ref={thumbRef}
      className={`absolute ${below ? 'top-full mt-2' : 'bottom-full mb-2'} ${scrubbing ? 'pointer-events-none' : 'pointer-events-auto'} z-20`}
      style={{
        left: `${handleNorm * 100}%`,
        transform: 'translateX(-50%)',
        maxWidth: '90%',
      }}
    >
      <div
        className="flex gap-1.5 p-2 rounded-lg bg-popover/95 border border-border shadow-xl backdrop-blur-sm overflow-x-auto"
        style={{ touchAction: 'pan-x' }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {activeEvents.map((ev) => (
          <ScrubberThumbnail
            key={ev.id}
            event={ev}
            monitorName={monitorNameMap.get(ev.monitorId) ?? ''}
            onTap={onEventTap}
          />
        ))}
      </div>
    </div>
  );

  // Floating time label: below thumbnails when visible, otherwise just below the bar.
  // Extra 20px gap when thumbnails show to clear any horizontal scrollbar.
  const timeLabel = (scrubbing || hasInteracted) && (
    <div
      className={`absolute ${below ? 'top-full' : 'bottom-full'} bg-popover/95 border border-border rounded px-1.5 py-0.5 -translate-x-1/2 pointer-events-none z-30 backdrop-blur-sm`}
      style={{
        left: `${handleNorm * 100}%`,
        ...(thumbHeight > 0
          ? below
            ? { marginTop: `${thumbHeight + 24}px` }
            : { marginBottom: `${thumbHeight + 24}px` }
          : below
            ? { marginTop: '0.25rem' }
            : { marginBottom: '0.25rem' }),
      }}
    >
      {timeLabelEl}
    </div>
  );

  return (
    <div className="relative" data-testid="timeline-scrubber">
      {/* Backdrop to dismiss thumbnails when tapping outside */}
      {!scrubbing && activeEvents.length > 0 && (
        <div className="fixed inset-0 z-10" role="presentation" onClick={dismissThumbnails} />
      )}

      {/* Thumbnails + floating time label */}
      {thumbnailStrip}
      {timeLabel}

      {/* Scrubber track: z-30 so it's always above the dismiss backdrop (z-10) and thumbnails (z-20) */}
      <div
        ref={trackRef}
        className="relative z-30 h-8 cursor-pointer select-none touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.scrubber_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(handleNorm * 100)}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onKeyDown={onTrackKeyDown}
        data-testid="scrubber-track"
      >
        {/* Track background */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-border/50" />

        {/* Event density markers */}
        {events.map((ev) => {
          const left = ((ev.startMs - viewStartMs) / (viewEndMs - viewStartMs)) * 100;
          const right = ((ev.endMs - viewStartMs) / (viewEndMs - viewStartMs)) * 100;
          const width = Math.max(right - left, 0.3);
          if (left > 100 || right < 0) return null;
          return (
            <div
              key={ev.id}
              data-testid={`scrubber-density-${ev.id}`}
              className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-primary/30"
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(width, 100 - left)}%` }}
            />
          );
        })}

        {/* Draggable handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-2 border-background shadow-lg transition-transform"
          style={{
            backgroundColor: '#00a8ff',
            left: `${handleNorm * 100}%`,
            transform: `translate(-50%, -50%) scale(${scrubbing ? 1.2 : 1})`,
          }}
        />
      </div>
    </div>
  );
}

export const TimelineScrubber = memo(TimelineScrubberComponent);
