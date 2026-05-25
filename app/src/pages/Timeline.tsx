import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { getEvents } from '../api/events';
import type { EventData } from '../api/types';
import { getMonitors } from '../api/monitors';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RefreshCw, Filter, Clock, ScanSearch, X, Crosshair, ZoomIn, ZoomOut, ChevronDown, SkipForward, RectangleHorizontal, Info, Move, HandMetal, Radio } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { subDays } from 'date-fns';
import { filterEnabledMonitors } from '../lib/filters';
import { formatForServer, formatLocalDateTime } from '../lib/time';
import { TIMELINE } from '../lib/zmninja-ng-constants';
import { mapWithConcurrency } from '../lib/async-pool';
import {
  CAUSE_ALL,
  TIMELINE_CAUSE_OPTIONS,
  causeToEventFilter,
  isCauseActive,
  mergeMonitorEvents,
} from '../lib/timeline-cause-filter';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { useTranslation } from 'react-i18next';
import { QuickDateRangeButtons } from '../components/ui/quick-date-range-buttons';
import { MonitorFilterPopoverContent } from '../components/filters/MonitorFilterPopover';
import { EmptyState } from '../components/ui/empty-state';
import { NotificationBadge } from '../components/NotificationBadge';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useEventTagMapping } from '../hooks/useEventTags';
import { log, LogLevel } from '../lib/logger';
import { TimelineCanvas } from '../components/timeline/TimelineCanvas';
import { DetectionFilterTabs, categorizeEvent, type DetectionCategory } from '../components/timeline/DetectionFilterTabs';
import { EventPreviewPopover } from '../components/timeline/EventPreviewPopover';
import type { TimelineEvent } from '../components/timeline/timeline-layout';
import type { MonitorRow } from '../components/timeline/timeline-renderer';
import type { ScrubberState } from '../components/timeline/TimelineScrubber';

export default function Timeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const {
    selectedMonitorIds, startDateInput, endDateInput, onlyDetectedObjects, causeFilter, activeQuickRange,
    setSelectedMonitorIds, setStartDateInput, setEndDateInput, setOnlyDetectedObjects, setCauseFilter, setActiveQuickRange,
    clearFilters, activeFilterCount,
  } = useTimelineFilters();

  // Stable default dates — computed once, not every render
  const defaultDates = useRef({
    start: formatLocalDateTime(subDays(new Date(), 1)),
    end: formatLocalDateTime(new Date()),
  });
  const startDate = startDateInput || defaultDates.current.start;
  const endDate = endDateInput || defaultDates.current.end;

  // Detection filter state
  const [detectionCategory, setDetectionCategory] = useState<DetectionCategory>('all');

  // Brush-to-zoom mode toggle
  const [brushMode, setBrushMode] = useState(false);

  // Filters section collapsed state
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  // Live mode — subscribe to notification store for new events, fall back to polling
  const [liveMode, setLiveMode] = useState(false);
  const queryClient = useQueryClient();
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
  const notificationsEnabled = useNotificationStore(
    (s) => currentProfileId ? s.getProfileSettings(currentProfileId).enabled : false,
  );
  const bandwidth = useBandwidthSettings();

  // Viewport control keys — increment to trigger action
  const [resetKey, setResetKey] = useState(0);
  const [zoomInKey, setZoomInKey] = useState(0);
  const [zoomOutKey, setZoomOutKey] = useState(0);
  const [goToNowKey, setGoToNowKey] = useState(0);
  const [panLeftKey, setPanLeftKey] = useState(0);
  const [panRightKey, setPanRightKey] = useState(0);
  const [followNowKey, setFollowNowKey] = useState(0);

  useTvKeyHandler({
    ArrowLeft: () => setPanLeftKey((k) => k + 1),
    ArrowRight: () => setPanRightKey((k) => k + 1),
    ArrowUp: () => setZoomInKey((k) => k + 1),
    ArrowDown: () => setZoomOutKey((k) => k + 1),
  });

  // Scrubber state — persisted to sessionStorage so it survives any back navigation
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

  /** Navigate to event, saving scrubber state for return. */
  const navigateToEvent = useCallback((eventId: string) => {
    if (scrubberStateRef.current) {
      sessionStorage.setItem(SCRUBBER_KEY, JSON.stringify(scrubberStateRef.current));
    }
    navigate(`/events/${eventId}`, { state: { from: '/timeline' } });
  }, [navigate]);

  // Event preview popover state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: TimelineEvent;
    position: { x: number; y: number };
  } | null>(null);

  // Fetch monitors
  const { data: monitorsData } = useQuery({
    queryKey: ['monitors'],
    queryFn: () => getMonitors(),
  });

  // Get enabled monitors
  const enabledMonitors = useMemo(
    () => monitorsData?.monitors ? filterEnabledMonitors(monitorsData.monitors) : [],
    [monitorsData]
  );

  // Build monitor lookup map
  const monitorNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const { Monitor } of enabledMonitors) {
      map.set(Monitor.Id, Monitor.Name);
    }
    return map;
  }, [enabledMonitors]);

  // Build monitor filter string for API
  const monitorFilter = useMemo(() => {
    if (selectedMonitorIds.length === 0) return undefined;
    return selectedMonitorIds.join(',');
  }, [selectedMonitorIds]);

  // In live mode without notifications, fall back to polling
  const livePolling = liveMode && !notificationsEnabled;

  // When a cause filter is active, fan the query out per monitor so one busy
  // camera can't consume the entire page budget.
  const monitorsToQuery = useMemo(() => {
    if (!isCauseActive(causeFilter)) return [];
    if (selectedMonitorIds.length > 0) return selectedMonitorIds;
    return enabledMonitors.map(({ Monitor }) => Monitor.Id);
  }, [causeFilter, selectedMonitorIds, enabledMonitors]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['timeline-events', startDate, endDate, monitorFilter, onlyDetectedObjects, causeFilter],
    queryFn: async () => {
      const startDateTime = formatForServer(new Date(startDate));
      const endDateTime = formatForServer(liveMode ? new Date() : new Date(endDate));
      const causeFields = causeToEventFilter(causeFilter, onlyDetectedObjects);

      if (isCauseActive(causeFilter) && monitorsToQuery.length > 0) {
        const perMonitorResults = await mapWithConcurrency(
          monitorsToQuery,
          TIMELINE.fanoutConcurrency,
          (id) =>
            getEvents({
              startDateTime,
              endDateTime,
              monitorId: id,
              ...causeFields,
              sort: 'StartDateTime',
              direction: 'desc',
              limit: TIMELINE.perMonitorEventsLimit,
            }),
        );
        const events = mergeMonitorEvents(perMonitorResults.map((r) => r.events));
        const count = perMonitorResults.reduce(
          (sum, r) => sum + (r.pagination?.count ?? r.events.length),
          0,
        );
        const base = perMonitorResults[0]?.pagination;
        return { events, pagination: base ? { ...base, count } : undefined };
      }

      return getEvents({
        startDateTime,
        endDateTime,
        monitorId: monitorFilter,
        ...causeFields,
        sort: 'StartDateTime',
        direction: 'desc',
        limit: TIMELINE.eventsLimit,
      });
    },
    refetchInterval: livePolling ? bandwidth.timelineHeatmapInterval : false,
  });

  // Log live mode source when it changes
  useEffect(() => {
    if (!liveMode) return;
    if (notificationsEnabled) {
      log.timeline('Live mode using notification store events', LogLevel.INFO);
    } else {
      log.timeline('Live mode falling back to polling (notifications not enabled)', LogLevel.INFO, {
        interval: bandwidth.timelineHeatmapInterval,
      });
    }
  }, [liveMode, notificationsEnabled, bandwidth.timelineHeatmapInterval]);

  // Live-injected events — synthetic events from notifications, shown immediately
  // before the API refetch returns the real data
  const [liveInjectedEvents, setLiveInjectedEvents] = useState<TimelineEvent[]>([]);

  // Track arrival timestamps for live events — survives the synthetic→API event swap
  // so the pulse halo keeps animating after API data replaces the synthetic
  const liveArrivalTimesRef = useRef<Map<string, number>>(new Map());

  // In live mode with notifications enabled, subscribe to store — inject event + schedule refetch
  // Track by latest receivedAt, not count (store is capped at 100, count stays flat once full)
  // Delay refetch slightly so ZM has time to index the new event
  const prevReceivedAtRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!liveMode || !notificationsEnabled || !currentProfileId) return;
    const events = useNotificationStore.getState().profileEvents[currentProfileId];
    prevReceivedAtRef.current = events?.[0]?.receivedAt ?? 0;
    const unsub = useNotificationStore.subscribe((state) => {
      const latest = state.profileEvents[currentProfileId]?.[0];
      const latestTs = latest?.receivedAt ?? 0;
      if (latestTs > prevReceivedAtRef.current) {
        log.timeline('New notification event, injecting + scheduling refetch', LogLevel.INFO, {
          eventId: latest?.EventId,
          monitor: latest?.MonitorName,
        });
        prevReceivedAtRef.current = latestTs;

        // Inject a synthetic event so the bar + monitor row appear immediately
        if (latest) {
          const now = Date.now();
          liveArrivalTimesRef.current.set(String(latest.EventId), now);
          setLiveInjectedEvents((prev) => [
            ...prev.filter((e) => e.id !== String(latest.EventId)),
            {
              id: String(latest.EventId),
              monitorId: String(latest.MonitorId),
              startMs: now,
              endMs: now + 1000, // 1s minimum width so it's visible
              cause: latest.Cause ?? 'Motion',
              alarmRatio: 1,
              notes: latest.Notes ?? '',
              arrivedAt: now,
            },
          ]);
        }

        // Debounce: if multiple events arrive in quick succession, only refetch once
        if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = setTimeout(() => {
          log.timeline('Refetching timeline after delay', LogLevel.DEBUG);
          queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
        }, 2000);
      }
    });
    return () => {
      unsub();
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, [liveMode, notificationsEnabled, currentProfileId, queryClient]);

  // Clear injected events only when a new API refetch includes them (not blindly on any data change)
  const prevDataForClearRef = useRef(data);
  useEffect(() => {
    if (data !== prevDataForClearRef.current) {
      prevDataForClearRef.current = data;
      if (liveInjectedEvents.length > 0 && data?.events) {
        const apiIds = new Set(data.events.map((e) => e.Event.Id));
        const remaining = liveInjectedEvents.filter((e) => !apiIds.has(e.id));
        if (remaining.length !== liveInjectedEvents.length) {
          setLiveInjectedEvents(remaining);
        }
      }
    }
  }, [data, liveInjectedEvents]);

  // In live mode, scroll to NOW after data arrives (not before, to avoid blank canvas)
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (liveMode && data !== prevDataRef.current) {
      prevDataRef.current = data;
      setFollowNowKey((k) => k + 1);
    }
  }, [liveMode, data]);

  // Transform API events to TimelineEvent[], merging any live-injected synthetics
  const allTimelineEvents: TimelineEvent[] = useMemo(() => {
    // Prune expired arrival timestamps (older than 5s)
    const now = Date.now();
    for (const [id, ts] of liveArrivalTimesRef.current) {
      if (now - ts > 5000) liveArrivalTimesRef.current.delete(id);
    }

    const apiEvents: TimelineEvent[] = data?.events
      ? data.events.map(({ Event }) => ({
          id: Event.Id,
          monitorId: Event.MonitorId,
          startMs: new Date(Event.StartDateTime.replace(' ', 'T')).getTime(),
          endMs: Event.EndDateTime
            ? new Date(Event.EndDateTime.replace(' ', 'T')).getTime()
            : new Date(Event.StartDateTime.replace(' ', 'T')).getTime() + parseFloat(Event.Length) * 1000,
          cause: Event.Cause,
          alarmRatio: parseInt(Event.AlarmFrames) / Math.max(parseInt(Event.Frames), 1),
          notes: Event.Notes ?? '',
          arrivedAt: liveArrivalTimesRef.current.get(Event.Id),
        }))
      : [];
    if (liveInjectedEvents.length === 0) return apiEvents;
    // Merge: API data wins over synthetics with the same id
    const apiIds = new Set(apiEvents.map((e) => e.id));
    const unique = liveInjectedEvents.filter((e) => !apiIds.has(e.id));
    return [...apiEvents, ...unique];
  }, [data, liveInjectedEvents]);

  // Compute detection category counts
  const detectionCounts = useMemo(() => {
    const counts: Record<DetectionCategory, number> = {
      all: allTimelineEvents.length,
      person: 0,
      vehicle: 0,
      animal: 0,
      other: 0,
    };
    for (const ev of allTimelineEvents) {
      const cat = categorizeEvent(ev.notes);
      counts[cat]++;
    }
    return counts;
  }, [allTimelineEvents]);

  // Filter by detection category
  const filteredEvents = useMemo(() => {
    if (detectionCategory === 'all') return allTimelineEvents;
    return allTimelineEvents.filter((ev) => categorizeEvent(ev.notes) === detectionCategory);
  }, [allTimelineEvents, detectionCategory]);

  // Build MonitorRow[] for canvas — only monitors that have events in the filtered set
  const monitorRows: MonitorRow[] = useMemo(() => {
    const activeIds = new Set(filteredEvents.map((ev) => ev.monitorId));
    const rows: MonitorRow[] = [];
    // Deduplicate and maintain stable order
    const seen = new Set<string>();
    for (const { Monitor } of enabledMonitors) {
      if (activeIds.has(Monitor.Id) && !seen.has(Monitor.Id)) {
        seen.add(Monitor.Id);
        rows.push({ id: Monitor.Id, name: Monitor.Name });
      }
    }
    return rows;
  }, [enabledMonitors, filteredEvents]);

  // Canvas time range — fit to actual event extent + "now" (with padding), fall back to filter range
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

  // Fetch tags for loaded events
  const eventIds = useMemo(
    () => data?.events?.map((e) => e.Event.Id) ?? [],
    [data],
  );
  const { getTagsForEvent } = useEventTagMapping({ eventIds });

  // Build a lookup from raw API events for the preview popover
  const rawEventMap = useMemo(() => {
    const map = new Map<string, EventData>();
    if (!data?.events) return map;
    for (const e of data.events) {
      map.set(e.Event.Id, e);
    }
    return map;
  }, [data]);

  const handleEventClick = useCallback((ev: TimelineEvent) => {
    // Find the raw API event data for the popover
    const raw = rawEventMap.get(ev.id);
    if (!raw) return;
    // Position the popover near the center of the screen
    setSelectedEvent({
      event: ev,
      position: { x: window.innerWidth / 2 - 144, y: 200 },
    });
  }, [rawEventMap]);

  const handleEventHover = useCallback((_event: TimelineEvent | null, _x: number, _y: number) => {
    // Hover is handled by the canvas renderer (highlight effect)
  }, []);

  const handleOpenEvent = useCallback((eventId: string) => {
    setSelectedEvent(null);
    navigateToEvent(eventId);
  }, [navigateToEvent]);

  const handleClosePopover = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // Stats
  const totalAlarmFrames = useMemo(
    () => data?.events?.reduce((sum, e) => sum + parseInt(e.Event.AlarmFrames || '0'), 0) ?? 0,
    [data]
  );
  const totalDurationMins = useMemo(
    () => Math.round((data?.events?.reduce((sum, e) => sum + parseFloat(e.Event.Length || '0'), 0) ?? 0) / 60),
    [data]
  );
  const activeMonitorCount = useMemo(
    () => data?.events ? new Set(data.events.map((e) => e.Event.MonitorId)).size : 0,
    [data]
  );

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-bold mb-6">{t('timeline.title')}</h1>
        <div className="p-4 bg-destructive/10 text-destructive rounded-md">
          {t('timeline.load_error')}: {(error as Error).message}
        </div>
      </div>
    );
  }

  // Build popover event data from selected event
  const popoverEvent = selectedEvent ? (() => {
    const raw = rawEventMap.get(selectedEvent.event.id);
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
      tags: getTagsForEvent(raw.Event.Id).map((tag) => tag.Name),
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
          <Button onClick={() => { clearFilters(); setActiveQuickRange(null); defaultDates.current = { start: formatLocalDateTime(subDays(new Date(), 1)), end: formatLocalDateTime(new Date()) }; }} variant="outline" size="sm" className="h-8 sm:h-9" data-testid="timeline-reset-button">
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.reset')}</span>
          </Button>
        </div>
      </div>

      {/* Filters — collapsible */}
      <Card>
        <button
          type="button"
          className="w-full flex items-center justify-between px-6 pt-4 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setFiltersCollapsed((c) => !c)}
          aria-expanded={!filtersCollapsed}
          data-testid="timeline-filters-toggle"
        >
          <span className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5" />
            {t('events.filters')}
            {activeFilterCount > 0 && (
              <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5">{activeFilterCount}</span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${filtersCollapsed ? '-rotate-90' : ''}`} />
        </button>
        {!filtersCollapsed && <CardContent className="pt-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="startDate" className="text-xs">{t('timeline.start_date')}</Label>
              <Input
                id="startDate"
                type="datetime-local"
                value={startDate}
                onChange={(e) => { setStartDateInput(e.target.value); setActiveQuickRange(null); }}
                data-testid="timeline-start-date"
              />
            </div>
            <div>
              <Label htmlFor="endDate" className="text-xs">{t('timeline.end_date')}</Label>
              <Input
                id="endDate"
                type="datetime-local"
                value={endDate}
                onChange={(e) => { setEndDateInput(e.target.value); setActiveQuickRange(null); }}
                data-testid="timeline-end-date"
              />
            </div>
            <div>
              <Label className="text-xs">{t('timeline.monitors')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between" data-testid="timeline-monitor-filter">
                    {selectedMonitorIds.length === 0
                      ? t('timeline.all_monitors')
                      : t('timeline.monitors_selected', { count: selectedMonitorIds.length })}
                    <Filter className="h-4 w-4 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm">
                  <MonitorFilterPopoverContent
                    monitors={enabledMonitors}
                    selectedMonitorIds={selectedMonitorIds}
                    onSelectionChange={setSelectedMonitorIds}
                    idPrefix="timeline"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {/* Cause Filter */}
          <div className="flex items-center justify-between p-3 rounded-md border bg-card">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="timeline-cause-filter" className="cursor-pointer">
                {t('timeline.cause_filter')}
              </Label>
            </div>
            <Select
              value={causeFilter || CAUSE_ALL}
              onValueChange={(value) => setCauseFilter(value === CAUSE_ALL ? '' : value)}
            >
              <SelectTrigger id="timeline-cause-filter" className="h-8 w-[170px]" data-testid="timeline-cause-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMELINE_CAUSE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`timeline-cause-${opt.value}`}>
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Object Detection Filter */}
          <div className="flex items-center justify-between p-3 rounded-md border bg-card">
            <div className="flex items-center gap-2">
              <ScanSearch className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="timeline-only-detected" className="cursor-pointer">
                {t('events.filter.onlyDetectedObjects')}
              </Label>
            </div>
            <Switch
              id="timeline-only-detected"
              checked={onlyDetectedObjects}
              onCheckedChange={setOnlyDetectedObjects}
              data-testid="timeline-detected-objects-toggle"
            />
          </div>

          {/* Quick Date Ranges + Clear */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">{t('events.quick_ranges')}</Label>
              <QuickDateRangeButtons
                activeHours={activeQuickRange}
                onRangeSelect={({ start, end, hours }) => {
                  setStartDateInput(formatLocalDateTime(start));
                  setEndDateInput(formatLocalDateTime(end));
                  setActiveQuickRange(hours);
                }}
              />
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="icon" onClick={() => { clearFilters(); setActiveQuickRange(null); }} className="text-muted-foreground h-7 w-7" title={t('common.clear')} data-testid="timeline-clear-filters">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>}
      </Card>

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
                title={detectionCategory !== 'all' ? t('timeline.no_events_in_range') : t('timeline.no_events_found')}
                description={t('timeline.adjust_filters')}
              />
            </div>
          ) : (
            <div className="p-4" data-testid="timeline-content">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setZoomInKey((k) => k + 1)}
                    title="Zoom in"
                    data-testid="timeline-zoom-in-button"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setZoomOutKey((k) => k + 1)}
                    title="Zoom out"
                    data-testid="timeline-zoom-out-button"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant={brushMode ? 'default' : 'ghost'}
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setBrushMode((b) => !b)}
                    title={t('timeline.select_to_zoom')}
                    data-testid="timeline-brush-zoom-button"
                  >
                    <RectangleHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant={liveMode ? 'default' : 'ghost'}
                    size="icon"
                    className={`h-6 w-6 ${liveMode ? 'text-red-50 bg-red-600 hover:bg-red-700' : 'text-muted-foreground'}`}
                    onClick={() => setLiveMode((v) => !v)}
                    title={t('timeline.live')}
                    data-testid="timeline-live-toggle"
                  >
                    <Radio className={`h-3.5 w-3.5 ${liveMode ? 'animate-pulse' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setResetKey((k) => k + 1)}
                    title={t('timeline.center_view')}
                    data-testid="timeline-center-button"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setGoToNowKey((k) => k + 1)}
                    title={t('timeline.go_to_now')}
                    data-testid="timeline-go-to-now-button"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
                        data-testid="timeline-help-button"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto text-xs space-y-1.5 p-3" side="bottom" align="end">
                      {(() => {
                        const hasPointer = window.matchMedia('(pointer: fine)').matches;
                        const HelpRow = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
                          <div className="flex items-center gap-2 text-muted-foreground">{icon}{text}</div>
                        );
                        return (
                          <>
                            <p className="font-medium text-foreground mb-2">{t('timeline.help.title')}</p>
                            <HelpRow icon={<Move className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.navigate')} />
                            <HelpRow icon={<RectangleHorizontal className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.brush')} />
                            {hasPointer && <HelpRow icon={<HandMetal className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.shift_drag')} />}
                            <HelpRow icon={<span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: '#00a8ff' }} />} text={t('timeline.help.scrubber')} />
                            <HelpRow icon={<Crosshair className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.center')} />
                            <HelpRow icon={<SkipForward className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.go_now')} />
                            <HelpRow icon={<Radio className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.live')} />
                          </>
                        );
                      })()}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <TimelineCanvas
                monitors={monitorRows}
                events={filteredEvents}
                startMs={startMs}
                endMs={endMs}
                resetKey={resetKey}
                zoomInKey={zoomInKey}
                zoomOutKey={zoomOutKey}
                goToNowKey={goToNowKey}
                panLeftKey={panLeftKey}
                panRightKey={panRightKey}
                onEventClick={handleEventClick}
                onEventHover={handleEventHover}
                onScrubberEventTap={navigateToEvent}
                onScrubberStateChange={handleScrubberStateChange}
                initialScrubberState={initialScrubberState}
                brushMode={brushMode}
                followNowKey={followNowKey}
                liveMode={liveMode}
              />
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

      {/* Event Statistics — compact inline */}
      {data?.events && data.events.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="timeline-statistics">
          <span><span className="font-semibold text-blue-500">{data.events.length}</span> {t('timeline.total_events')}</span>
          <span className="text-border">|</span>
          <span><span className="font-semibold text-green-500">{activeMonitorCount}</span> {t('timeline.active_monitors')}</span>
          <span className="text-border">|</span>
          <span><span className="font-semibold text-amber-500">{totalAlarmFrames.toLocaleString()}</span> {t('timeline.alarm_frames')}</span>
          <span className="text-border">|</span>
          <span><span className="font-semibold text-purple-500">{totalDurationMins}m</span> {t('timeline.total_duration')}</span>
        </div>
      )}
    </PageContainer>
  );
}
