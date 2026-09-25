/* The canvas extent memo below reads Date.now() so the NOW marker is inside the
 * fitted range. The extent is refitted per filter change, so "now" already means
 * "now as of that change", and a ticking clock would refit the canvas under the
 * user. The React Compiler lint rules only honour file-scope disables, so this
 * covers the whole page; keep any other render-time clock reads out of here. */
/* eslint-disable react-hooks/purity */

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { FilterX, Clock } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { ScrollPad } from '../components/ui/scroll-pad';
import { NinjiiToolbarButton } from '../components/assistant/NinjiiToolbarButton';
import { useScrollPad } from '../hooks/useScrollPad';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { subDays } from 'date-fns';
import { formatLocalDateTime, formatForServerInTz } from '../lib/time';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/ui/empty-state';
import { NotificationBadge } from '../components/NotificationBadge';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTimelineData } from '../hooks/useTimelineData';
import { useScopedTimelineEvents, type ScopedTimelineEvent } from '../hooks/useScopedTimelineEvents';
import { useProfileScope } from '../hooks/useProfileScope';
import { useGroupByServerScope } from '../hooks/useGroupByServerScope';
import { GroupByServerToggle } from '../components/profiles/GroupByServerToggle';
import { usePermissions } from '../hooks/usePermissions';
import { canViewEvents } from '../lib/permissions/zm-permissions';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useScopedEventTagMapping, type ScopedEventRef } from '../hooks/useScopedEventTags';
import { monitorCacheKey } from '../stores/monitors';
import { asProfileId } from '../api/types';
import { TimelineCanvas, type ViewportAction, type ViewportActionType } from '../components/timeline/TimelineCanvas';
import { TimelineFiltersPanel } from '../components/timeline/TimelineFiltersPanel';
import { TimelineToolbar } from '../components/timeline/TimelineToolbar';
import { TimelineStats } from '../components/timeline/TimelineStats';
import { DetectionFilterTabs } from '../components/timeline/DetectionFilterTabs';
import { useDetectionCategories } from '../components/timeline/useDetectionCategories';
import { EventPreviewPopover } from '../components/timeline/EventPreviewPopover';
import type { TimelineEvent } from '../components/timeline/timeline-layout';
import type { MonitorRow } from '../components/timeline/timeline-renderer';
import type { ScrubberState } from '../components/timeline/TimelineScrubber';

export default function Timeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const filters = useTimelineFilters();
  const { selectedMonitorIds, onlyDetectedObjects, causeFilter } = filters;

  // Stable default dates: computed once, not every render
  const defaultDates = useRef({
    start: formatLocalDateTime(subDays(new Date(), 1)),
    end: formatLocalDateTime(new Date()),
  });
  const startDate = filters.startDateInput || defaultDates.current.start;
  const endDate = filters.endDateInput || defaultDates.current.end;

  // Brush-to-zoom mode toggle
  const [brushMode, setBrushMode] = useState(false);
  // The canvas sets touch-action: none to own pan and pinch, so a swipe over
  // it never scrolls this page. The pad takes the canvas area: it walks up
  // from what it is given to find the scrolling ancestor.
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const [showScrollPad, toggleScrollPad] = useScrollPad();

  // Live mode: subscribe to notification store for new events, fall back to polling
  const [liveMode, setLiveMode] = useState(false);

  // One-shot viewport actions; a new seq triggers the action in TimelineCanvas
  const [viewportAction, setViewportAction] = useState<ViewportAction | null>(null);
  const fireViewportAction = useCallback((type: ViewportActionType) => {
    setViewportAction((prev) => ({ type, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  useTvKeyHandler({
    ArrowLeft: () => fireViewportAction('panLeft'),
    ArrowRight: () => fireViewportAction('panRight'),
    ArrowUp: () => fireViewportAction('zoomIn'),
    ArrowDown: () => fireViewportAction('zoomOut'),
  });

  // Scrubber state: persisted to sessionStorage so it survives any back navigation
  const SCRUBBER_KEY = 'timeline-scrubber-state';
  const scrubberStateRef = useRef<ScrubberState | null>(null);
  const [initialScrubberState, setInitialScrubberState] = useState<ScrubberState | null>(null);

  // Re-check sessionStorage on every navigation to this page (location.key changes)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SCRUBBER_KEY);
      if (saved) {
        sessionStorage.removeItem(SCRUBBER_KEY);
        setInitialScrubberState(JSON.parse(saved));
      }
    } catch { /* ignore */ }
  }, [location.key]);

  const handleScrubberStateChange = useCallback((state: ScrubberState | null) => {
    scrubberStateRef.current = state;
  }, []);

  /** Navigate to event, saving scrubber state for return. All mode routes
   *  through the /all/ deep route so EventDetail resolves its session from
   *  the owning profile instead of the (absent) current one (refs #337). */
  const navigateToEvent = useCallback((eventId: string, profileId?: string) => {
    if (scrubberStateRef.current) {
      sessionStorage.setItem(SCRUBBER_KEY, JSON.stringify(scrubberStateRef.current));
    }
    const path = profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`;
    navigate(path, { state: { from: '/timeline' } });
  }, [navigate]);

  // Event preview popover state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: TimelineEvent;
    position: { x: number; y: number };
  } | null>(null);

  // Single code path picked between two hooks (not one shared hook): the
  // single-profile path keeps live-mode notification injection and the
  // per-monitor cause-filter fan-out, neither of which the All-mode
  // aggregate implements yet (see useScopedTimelineEvents' doc comment).
  // Both hooks are always called (React hooks rules); each disables its own
  // queries via `enabled` so only the active mode's hook actually fetches.
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  const groupByServer = !!useGroupByServerScope('eventsGroupByServer');

  // Single mode only: in All mode the events come from several accounts, and
  // one verdict cannot speak for all of them (refs #344).
  const { permissions: scopePermissions } = usePermissions(
    scope?.mode === 'single' ? scope.profile.id : null,
  );
  const eventsDenied = canViewEvents(scopePermissions) === 'denied';
  const totalScopeProfiles = scope?.profiles.length ?? 0;

  const single = useTimelineData({
    startDate,
    endDate,
    liveMode,
    selectedMonitorIds,
    onlyDetectedObjects,
    causeFilter,
    enabled: !isAllMode,
  });
  const scoped = useScopedTimelineEvents({
    startDate,
    endDate,
    selectedMonitorIds,
    onlyDetectedObjects,
    causeFilter,
    enabled: isAllMode,
  });

  const data = single.data;
  const isLoading = isAllMode ? scoped.isLoading : single.isLoading;
  const eventIds = isAllMode ? scoped.eventIds : single.eventIds;
  const allTimelineEvents: TimelineEvent[] = isAllMode ? scoped.events : single.allTimelineEvents;
  // Every profile in scope failed and none ever produced an event: distinct
  // from "no events in range" (refs #337, same suppression semantics as the
  // Monitors/Events all-failed state).
  const allFailed = isAllMode && scoped.errors.length > 0 && scoped.errors.length === totalScopeProfiles && scoped.events.length === 0;
  const visibleErrors = isAllMode ? scoped.errors.filter((err) => !scoped.events.some((e) => e.profileId === err.profileId)) : [];

  // In live mode, scroll to NOW after data arrives (not before, to avoid blank canvas)
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (liveMode && data !== prevDataRef.current) {
      prevDataRef.current = data;
      fireViewportAction('followNow');
    }
  }, [liveMode, data, fireViewportAction]);

  // Build monitor lookup map. All mode keys by `${profileId}:${monitorId}`
  // since the same numeric monitor id can exist on two servers.
  const monitorNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (isAllMode) {
      for (const s of scoped.enabledMonitors) {
        map.set(`${s.profileId}:${s.item.Monitor.Id}`, s.item.Monitor.Name);
      }
    } else {
      for (const { Monitor } of single.enabledMonitors) {
        map.set(Monitor.Id, Monitor.Name);
      }
    }
    return map;
  }, [isAllMode, scoped.enabledMonitors, single.enabledMonitors]);

  // Flat monitor list for the filter panel - unwrapped in both modes (the
  // panel doesn't group by server for Timeline; see the hook's doc comment
  // for the accepted v1 scope on colliding monitor ids across profiles).
  const enabledMonitors = isAllMode ? scoped.enabledMonitors.map((s) => s.item) : single.enabledMonitors;

  // Detection category state, counts, and filtered events
  const {
    category: detectionCategory,
    setCategory: setDetectionCategory,
    counts: detectionCounts,
    filteredEvents,
  } = useDetectionCategories(allTimelineEvents);

  // Build MonitorRow[] for canvas: only monitors that have events in the filtered set.
  // All mode keys rows by the composite `${profileId}:${monitorId}` - a bare
  // monitor id is only unique within one ZM server, so two profiles' servers
  // reporting the same numeric id would otherwise collide onto one row and
  // silently merge their events (refs #337 I4).
  const monitorRows: MonitorRow[] = useMemo(() => {
    if (isAllMode) {
      const activeKeys = new Set(
        filteredEvents.map((ev) => monitorCacheKey(asProfileId((ev as ScopedTimelineEvent).profileId), ev.monitorId))
      );
      const rows: MonitorRow[] = [];
      const seen = new Set<string>();
      let lastProfileId: string | undefined;
      for (const s of scoped.enabledMonitors) {
        const key = monitorCacheKey(asProfileId(s.profileId), s.item.Monitor.Id);
        if (activeKeys.has(key) && !seen.has(key)) {
          seen.add(key);
          // Rows already run one server after another in scope order, so
          // grouping by server names each server once, on its first row,
          // and marks where each server after the first starts.
          const firstOfServer = s.profileId !== lastProfileId;
          lastProfileId = s.profileId;
          rows.push(groupByServer
            ? { id: key, name: s.item.Monitor.Name, profileChip: firstOfServer ? s.profileName : undefined, serverStart: firstOfServer && rows.length > 0 }
            : { id: key, name: s.item.Monitor.Name, profileChip: s.profileName });
        }
      }
      return rows;
    }
    const activeIds = new Set(filteredEvents.map((ev) => ev.monitorId));
    const rows: MonitorRow[] = [];
    // Deduplicate and maintain stable order
    const seen = new Set<string>();
    for (const { Monitor } of single.enabledMonitors) {
      if (activeIds.has(Monitor.Id) && !seen.has(Monitor.Id)) {
        seen.add(Monitor.Id);
        rows.push({ id: Monitor.Id, name: Monitor.Name });
      }
    }
    return rows;
  }, [isAllMode, groupByServer, scoped.enabledMonitors, single.enabledMonitors, filteredEvents]);

  // Events fed to the canvas: All mode overrides monitorId to the same
  // composite key monitorRows uses above, so the renderer's (profile-unaware)
  // event->row matching lands events on the correct row instead of merging
  // colliding ids from two profiles onto whichever row happened to be
  // indexed last (refs #337 I4). The real monitorId is preserved under
  // realMonitorId for consumers (the popover) that need it back - kept out
  // of filteredEvents/scoped.events themselves so nothing else observes the
  // composite value.
  const canvasEvents: TimelineEvent[] = useMemo(() => {
    if (!isAllMode) return filteredEvents;
    return filteredEvents.map((ev) => {
      const scopedEv = ev as ScopedTimelineEvent;
      return {
        ...scopedEv,
        monitorId: monitorCacheKey(asProfileId(scopedEv.profileId), scopedEv.monitorId),
        realMonitorId: scopedEv.monitorId,
      };
    });
  }, [isAllMode, filteredEvents]);

  // Canvas time range: fit to actual event extent + "now" (with padding), fall back to filter range
  const { startMs, endMs } = useMemo(() => {
    const filterStart = new Date(startDate).getTime();
    const filterEnd = new Date(endDate).getTime();
    const now = Date.now();

    if (filteredEvents.length === 0) {
      return { startMs: filterStart, endMs: filterEnd };
    }

    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const ev of filteredEvents) {
      if (ev.startMs < minMs) minMs = ev.startMs;
      if (ev.endMs > maxMs) maxMs = ev.endMs;
    }

    // Include "now" in the extent so the NOW marker is always visible on load
    if (now >= filterStart && now <= filterEnd) {
      if (now > maxMs) maxMs = now;
      if (now < minMs) minMs = now;
    }

    // Add 5% padding on each side so events aren't flush with edges
    const span = maxMs - minMs;
    const padding = Math.max(span * 0.05, 60_000); // at least 1 minute
    return {
      startMs: Math.max(filterStart, minMs - padding),
      endMs: maxMs + padding,
    };
  }, [filteredEvents, startDate, endDate]);

  // Tags for the loaded events, fanned out per owning profile so All mode
  // shows them too (refs #337, audit D4). Event ids collide across servers, so
  // every lookup goes through the owning profile - never a bare id.
  const tagRefs = useMemo<ScopedEventRef[]>(() => {
    if (isAllMode) return scoped.events.map((e) => ({ profileId: e.profileId, eventId: e.id }));
    const ownProfileId = scope?.profiles[0]?.id;
    return ownProfileId ? eventIds.map((id) => ({ profileId: ownProfileId, eventId: id })) : [];
  }, [isAllMode, scoped.events, eventIds, scope]);
  const { getTagsForEvent } = useScopedEventTagMapping({ events: tagRefs });

  const handleEventClick = useCallback((ev: TimelineEvent) => {
    // All mode: the clicked event object IS a ScopedTimelineEvent at runtime
    // (it came straight from `scoped.events`), so its own fields cover the
    // popover - no raw-event lookup needed there. Single mode still looks up
    // the raw API event for fields TimelineEvent doesn't carry.
    if (!isAllMode && !single.rawEventMap.get(ev.id)) return;
    setSelectedEvent({
      event: ev,
      position: { x: window.innerWidth / 2 - 144, y: 200 },
    });
  }, [isAllMode, single.rawEventMap]);

  const handleEventHover = useCallback((_event: TimelineEvent | null, _x: number, _y: number) => {
    // Hover is handled by the canvas renderer (highlight effect)
  }, []);

  // The popover's "open" action always targets whichever event is currently
  // selected, so its profileId comes straight from that (already-correct)
  // selection instead of a fresh by-id search - a search would pick the
  // wrong profile whenever two profiles' events collide on the same id
  // (refs #337 I5).
  const handleOpenEvent = useCallback((eventId: string) => {
    const profileId = isAllMode ? (selectedEvent?.event as ScopedTimelineEvent | undefined)?.profileId : undefined;
    setSelectedEvent(null);
    navigateToEvent(eventId, profileId);
  }, [navigateToEvent, isAllMode, selectedEvent]);

  // profileId comes straight off the tapped event object (ScrubberThumbnail
  // reads it directly, refs #337 Task 3) - never a reverse by-id lookup,
  // which breaks whenever two profiles' events collide on the same id.
  const handleScrubberEventTap = useCallback((eventId: string, profileId?: string) => {
    navigateToEvent(eventId, profileId);
  }, [navigateToEvent]);

  const handleClosePopover = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // Single mode: unchanged full-page error wall on any query error. All
  // mode: only when EVERY profile failed with zero data (allFailed above) -
  // a partial failure instead renders normally with the strips below.
  if (!isAllMode ? single.error : allFailed) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-bold mb-6">{t('timeline.title')}</h1>
        <ErrorBanner message={
          isAllMode
            ? resolveQueryError(scoped.errors[0]?.error, t, { fallbackKey: 'timeline.load_error' })
            : resolveQueryError(single.error, t, { fallbackKey: 'timeline.load_error' })
        } />
      </div>
    );
  }

  // Build popover event data from selected event. All mode synthesizes a
  // wall-clock `startDateTime` string from the true instant via
  // formatForServerInTz(startMs, owning profile's tz) so the SAME
  // parseISO+fmtDate/fmtTime round-trip every other event display uses
  // renders it correctly, with no timezone-aware formatAppDate call needed
  // here (refs #337).
  const popoverEvent = selectedEvent ? (() => {
    if (isAllMode) {
      const scopedEv = selectedEvent.event as ScopedTimelineEvent;
      const realMonitorId = scopedEv.realMonitorId ?? scopedEv.monitorId;
      const ownerTz = scope?.profiles.find((p) => p.id === scopedEv.profileId)?.timezone ?? 'UTC';
      return {
        id: scopedEv.id,
        monitorId: realMonitorId,
        cause: scopedEv.cause,
        startDateTime: formatForServerInTz(new Date(scopedEv.startMs), ownerTz),
        duration: String(Math.max(0, (scopedEv.endMs - scopedEv.startMs) / 1000)),
        alarmFrames: '0',
        notes: scopedEv.notes,
        monitorName: monitorNameMap.get(`${scopedEv.profileId}:${realMonitorId}`) ?? realMonitorId,
        tags: getTagsForEvent(scopedEv.profileId, scopedEv.id).map((tag) => tag.Name),
        // The owning profile, so the popover (and its embedded ZMS hover
        // preview) resolve THAT profile's portal/token instead of the
        // (absent or wrong) current profile (refs #337 Task 2).
        profileId: scopedEv.profileId,
      };
    }
    const raw = single.rawEventMap.get(selectedEvent.event.id);
    if (!raw) return null;
    return {
      id: raw.Event.Id,
      monitorId: raw.Event.MonitorId,
      cause: raw.Event.Cause,
      startDateTime: raw.Event.StartDateTime,
      duration: raw.Event.Length,
      alarmFrames: raw.Event.AlarmFrames,
      notes: raw.Event.Notes,
      monitorName: monitorNameMap.get(raw.Event.MonitorId) ?? raw.Event.Name,
      // Single-mode rows carry no profileId, and the map is keyed to match.
      tags: getTagsForEvent(undefined, raw.Event.Id).map((tag) => tag.Name),
    };
  })() : null;

  return (
    <PageContainer spacing="none" className="space-y-3 sm:space-y-4 md:space-y-6" data-testid="timeline-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('timeline.title')}</h1>
            <NotificationBadge />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
            <span className="hidden sm:inline">{t('timeline.subtitle')}</span>
            {selectedMonitorIds.length > 0 && ` (${t('timeline.cameras_selected', { count: selectedMonitorIds.length })})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GroupByServerToggle setting="eventsGroupByServer" testId="timeline-group-by-server" className="h-8 w-8 sm:h-9 sm:w-9" />
          <NinjiiToolbarButton />
          <Button onClick={() => { filters.clearFilters(); filters.setActiveQuickRange(null); defaultDates.current = { start: formatLocalDateTime(subDays(new Date(), 1)), end: formatLocalDateTime(new Date()) }; }} variant="outline" size="sm" className="h-8 sm:h-9" data-testid="timeline-clear-button">
            <FilterX className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.clear')}</span>
          </Button>
        </div>
      </div>

      {/* Per-profile errors: same suppression semantics as Monitors/Events -
          a strip only for a profile that produced zero events. */}
      {visibleErrors.length > 0 && (
        <div className="space-y-2">
          {visibleErrors.map((err) => (
            <div
              key={err.profileId}
              className="flex items-center gap-2"
              data-testid={`profile-error-strip-${err.profileId}`}
            >
              <ErrorBanner
                className="flex-1"
                message={`${err.profileName}: ${resolveQueryError(err.error, t, { fallbackKey: 'timeline.load_error' })}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => scoped.refetchProfile(err.profileId)}
                data-testid={`profile-error-strip-retry-${err.profileId}`}
              >
                {t('common.retry')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <TimelineFiltersPanel
        filters={filters}
        startDate={startDate}
        endDate={endDate}
        monitors={enabledMonitors}
      />

      {/* Detection Filter Tabs */}
      {allTimelineEvents.length > 0 && (
        <div className="flex items-center justify-between gap-4" data-testid="timeline-detection-filters">
          <DetectionFilterTabs
            selected={detectionCategory}
            onSelect={setDetectionCategory}
            counts={detectionCounts}
          />
        </div>
      )}

      {/* Timeline Canvas */}
      <Card className="shadow-lg">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-[600px] gap-4" data-testid="timeline-loading">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <div className="text-muted-foreground">{t('timeline.loading')}</div>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="h-[600px] flex items-center justify-center" data-testid="timeline-empty-state">
              <EmptyState
                icon={Clock}
                title={
                  eventsDenied
                    ? t('events.no_event_permission')
                    : detectionCategory !== 'all'
                      ? t('timeline.no_events_in_range')
                      : t('timeline.no_events_found')
                }
                description={eventsDenied ? undefined : t('timeline.adjust_filters')}
              />
            </div>
          ) : (
            <div className="p-4" data-testid="timeline-content">
              <TimelineToolbar
                scrollPadOn={showScrollPad}
                onToggleScrollPad={toggleScrollPad}
                brushMode={brushMode}
                liveMode={liveMode}
                onToggleBrush={() => setBrushMode((b) => !b)}
                onToggleLive={() => setLiveMode((v) => !v)}
                onZoomIn={() => fireViewportAction('zoomIn')}
                onZoomOut={() => fireViewportAction('zoomOut')}
                onCenter={() => fireViewportAction('reset')}
                onGoToNow={() => fireViewportAction('goToNow')}
              />
              <div ref={canvasAreaRef}>
              <TimelineCanvas
                monitors={monitorRows}
                events={canvasEvents}
                startMs={startMs}
                endMs={endMs}
                viewportAction={viewportAction}
                onEventClick={handleEventClick}
                onEventHover={handleEventHover}
                onScrubberEventTap={handleScrubberEventTap}
                onScrubberStateChange={handleScrubberStateChange}
                initialScrubberState={initialScrubberState}
                brushMode={brushMode}
                liveMode={liveMode}
              />
              </div>
              {showScrollPad && <ScrollPad targetRef={canvasAreaRef} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Preview Popover */}
      {selectedEvent && popoverEvent && (
        <EventPreviewPopover
          event={popoverEvent}
          position={selectedEvent.position}
          onOpenEvent={handleOpenEvent}
          onClose={handleClosePopover}
        />
      )}

      {/* Event Statistics */}
      <TimelineStats events={isAllMode ? scoped.rawEvents : (data?.events ?? [])} />
    </PageContainer>
  );
}
