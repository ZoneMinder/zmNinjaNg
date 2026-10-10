/**
 * Timeline Data Hook
 *
 * Owns the timeline events query (including the per-monitor fan-out when a
 * cause filter is active), the live-mode notification subscription that
 * injects synthetic events, and the debounced refetch that follows.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getCurrentSession } from '../services/sessions';
import type { EventData } from '../api/types';
import { filterEnabledMonitors } from '../lib/monitor/filters';
import { formatForServer } from '../lib/time';
import { TIMELINE } from '../lib/zmninja-ng-constants';
import { mapWithConcurrency } from '../lib/async-pool';
import {
  causeToEventFilter,
  isCauseActive,
  mergeMonitorEvents,
} from '../lib/event/timeline-cause-filter';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { queryKeys } from '../lib/query/query-keys';
import { log, LogLevel } from '../lib/logger';
import type { TimelineEvent } from '../components/timeline/timeline-layout';

export interface UseTimelineDataOptions {
  /** Effective start date (datetime-local string). */
  startDate: string;
  /** Effective end date (datetime-local string). */
  endDate: string;
  /** When true, the end of the queried range is "now" and live updates apply. */
  liveMode: boolean;
  selectedMonitorIds: string[];
  onlyDetectedObjects: boolean;
  causeFilter: string;
  /** Whether the queries are enabled (default: true). All mode disables this
   *  hook and reads useScopedTimelineEvents instead (refs #337). */
  enabled?: boolean;
}

export function useTimelineData({
  startDate,
  endDate,
  liveMode,
  selectedMonitorIds,
  onlyDetectedObjects,
  causeFilter,
  enabled = true,
}: UseTimelineDataOptions) {
  const queryClient = useQueryClient();
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
  const notificationsEnabled = useNotificationStore(
    (s) => currentProfileId ? s.getProfileSettings(currentProfileId).enabled : false,
  );
  const bandwidth = useBandwidthSettings();

  // Fetch monitors
  const { data: monitorsData } = useQuery({
    queryKey: queryKeys.monitors(currentProfileId),
    queryFn: () => getMonitors(getCurrentSession().client, getCurrentSession().profileId),
    enabled,
  });

  // Get enabled monitors
  const enabledMonitors = useMemo(
    () => monitorsData?.monitors ? filterEnabledMonitors(monitorsData.monitors) : [],
    [monitorsData]
  );

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
    queryKey: queryKeys.timelineEventsList(currentProfileId, startDate, endDate, monitorFilter, onlyDetectedObjects, causeFilter),
    queryFn: async () => {
      const startDateTime = formatForServer(new Date(startDate));
      const endDateTime = formatForServer(liveMode ? new Date() : new Date(endDate));
      const causeFields = causeToEventFilter(causeFilter, onlyDetectedObjects);

      if (isCauseActive(causeFilter) && monitorsToQuery.length > 0) {
        const perMonitorResults = await mapWithConcurrency(
          monitorsToQuery,
          TIMELINE.fanoutConcurrency,
          (id) =>
            getEvents(getCurrentSession().client, getCurrentSession().profileId, {
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

      return getEvents(getCurrentSession().client, getCurrentSession().profileId, {
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
    enabled,
    // A moved window (auto-refresh, quick range) keeps the old events up
    // until the new ones land instead of blanking the canvas (refs #556).
    placeholderData: keepPreviousData,
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

  // Live-injected events: synthetic events from notifications, shown immediately
  // before the API refetch returns the real data
  const [liveInjectedEvents, setLiveInjectedEvents] = useState<TimelineEvent[]>([]);

  // Track arrival timestamps for live events. The map survives the synthetic-to-API
  // event swap so the pulse halo keeps animating after API data replaces the synthetic.
  const liveArrivalTimesRef = useRef<Map<string, number>>(new Map());

  // In live mode with notifications enabled, subscribe to store: inject event + schedule refetch.
  // Track by latest receivedAt, not count (store is capped at 100, count stays flat once full).
  // Delay refetch slightly so ZM has time to index the new event.
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
          // Drop arrival stamps past their pulse TTL. Pruning here, where the
          // map is written, keeps the transform below a pure computation.
          for (const [id, ts] of liveArrivalTimesRef.current) {
            if (now - ts > TIMELINE.liveArrivalTtlMs) liveArrivalTimesRef.current.delete(id);
          }
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
          queryClient.invalidateQueries({ queryKey: queryKeys.timelineEvents(currentProfileId) });
        }, TIMELINE.liveRefetchDebounceMs);
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

  // Transform API events to TimelineEvent[], merging any live-injected synthetics
  const allTimelineEvents: TimelineEvent[] = useMemo(() => {
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

  // Ids of loaded API events (for tag fetching)
  const eventIds = useMemo(
    () => data?.events?.map((e) => e.Event.Id) ?? [],
    [data],
  );

  // Build a lookup from raw API events for the preview popover
  const rawEventMap = useMemo(() => {
    const map = new Map<string, EventData>();
    if (!data?.events) return map;
    for (const e of data.events) {
      map.set(e.Event.Id, e);
    }
    return map;
  }, [data]);

  return { data, isLoading, error, enabledMonitors, allTimelineEvents, eventIds, rawEventMap };
}
