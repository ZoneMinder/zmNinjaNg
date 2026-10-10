/**
 * useScopedTimelineEvents Hook
 *
 * All-mode aggregation for the Timeline page. Fans out one events query per
 * profile in scope, using the SAME query key useTimelineData/Timeline.tsx
 * uses (queryKeys.timelineEventsList), tagged with the owning profile
 * (Scoped<EventData>) so colliding event/monitor ids across servers stay
 * distinct - the same pattern useScopedEvents uses for the Events page.
 *
 * v1 scope, intentionally smaller than single-profile useTimelineData:
 * ponytail: no live-mode notification injection and no per-monitor cause-filter
 * fan-out here - both are single-profile-session features (notification store
 * events aren't profile-tagged yet, and the per-monitor concurrency fan-out is
 * a single-server perf optimization). Cause filtering still narrows results,
 * just via one getEvents call per profile instead of one per monitor. Upgrade
 * path: extend the notification store to carry profileId (Task 5/6 territory)
 * before wiring live mode in here.
 *
 * Event instants (startMs/endMs) are derived via eventInstant (true absolute
 * instant from the OWNING profile's timezone), NOT a naive browser-local
 * parse of the wall-clock string - required so two profiles in different
 * real timezones plot correctly relative to each other on one shared axis
 * (refs #337).
 */

import { useCallback, useMemo, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getSession } from '../services/sessions';
import { useProfileScope } from './useProfileScope';
import { queryKeys } from '../lib/query/query-keys';
import { eventInstant } from '../lib/event/event-instant';
import { formatForServerInTz, resolveProfileTimezone } from '../lib/time';
import { causeToEventFilter } from '../lib/event/timeline-cause-filter';
import { filterEnabledMonitors } from '../lib/monitor/filters';
import { getMonitors } from '../api/monitors';
import { TIMELINE } from '../lib/zmninja-ng-constants';
import type { Scoped, ProfileError } from '../api/scoped-types';
import type { EventData, EventsResponse, MonitorData, ProfileId } from '../api/types';
import type { TimelineEvent } from '../components/timeline/timeline-layout';

export interface UseScopedTimelineEventsOptions {
  startDate: string;
  endDate: string;
  selectedMonitorIds: string[];
  onlyDetectedObjects: boolean;
  causeFilter: string;
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
}

export interface ScopedTimelineEvent extends TimelineEvent {
  profileId: ProfileId;
  profileChip: string;
}

export interface UseScopedTimelineEventsReturn {
  isLoading: boolean;
  errors: ProfileError[];
  /** Monitor rows across every profile, tagged so All-mode labels can chip them. */
  enabledMonitors: Scoped<MonitorData>[];
  /** Flattened events for the canvas, tagged with their owning profile. */
  events: ScopedTimelineEvent[];
  /** Raw events (for TimelineStats, which only counts them). */
  rawEvents: EventData[];
  eventIds: string[];
  /** Refetch exactly one profile's events query */
  refetchProfile: (id: ProfileId) => void;
}

export function useScopedTimelineEvents({
  startDate,
  endDate,
  selectedMonitorIds,
  onlyDetectedObjects,
  causeFilter,
  enabled,
}: UseScopedTimelineEventsOptions): UseScopedTimelineEventsReturn {
  const scope = useProfileScope();
  const queryClient = useQueryClient();
  const profiles = scope?.profiles ?? [];
  const monitorFilter = selectedMonitorIds.length > 0 ? selectedMonitorIds.join(',') : undefined;
  const causeFields = causeToEventFilter(causeFilter, onlyDetectedObjects);
  const queriesEnabled = enabled ?? true;
  // Each profile's last real page, shown while a moved window fetches -
  // useQueries starts a fresh observer per key, so keepPreviousData alone
  // would blank the canvas (refs #556, same as useScopedEvents).
  const lastPage = useRef(new Map<ProfileId, EventsResponse>());

  const monitorsResult = useQueries({
    queries: profiles.map((p) => ({
      queryKey: queryKeys.monitors(p.id),
      queryFn: () => getMonitors(getSession(p.id).client, p.id),
      enabled: queriesEnabled,
    })),
    combine: (results) => {
      const monitors: Scoped<MonitorData>[] = [];
      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q?.data) return;
        for (const item of filterEnabledMonitors(q.data.monitors)) {
          monitors.push({ profileId: p.id, profileName: p.name, item });
        }
      });
      return monitors;
    },
  });

  const { events, errors, isLoading, rawEvents } = useQueries({
    queries: profiles.map((p) => ({
      queryKey: queryKeys.timelineEventsList(p.id, startDate, endDate, monitorFilter, onlyDetectedObjects, causeFilter),
      queryFn: () => {
        // Browser-zone fallback (not 'UTC') for a timezone-less profile,
        // matching formatForServer's historical fallback - the eventInstant
        // sort below deliberately keeps its own 'UTC' fallback (matches
        // getSession's convention) (refs #337 fix round 1).
        const tz = resolveProfileTimezone(p.timezone);
        return getEvents(getSession(p.id).client, p.id, {
          startDateTime: formatForServerInTz(new Date(startDate), tz),
          endDateTime: formatForServerInTz(new Date(endDate), tz),
          monitorId: monitorFilter,
          ...causeFields,
          sort: 'StartDateTime',
          direction: 'desc',
          limit: TIMELINE.eventsLimit,
        });
      },
      enabled: queriesEnabled,
      placeholderData: (prev: EventsResponse | undefined) => prev ?? lastPage.current.get(p.id),
    })),
    combine: (results) => {
      const timezoneById = new Map(profiles.map((p) => [p.id, p.timezone ?? 'UTC']));
      const events: ScopedTimelineEvent[] = [];
      const rawEvents: EventData[] = [];
      const errors: ProfileError[] = [];
      let anyHasData = false;

      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q) return;
        if (q.data) {
          anyHasData = true;
          if (!q.isPlaceholderData) lastPage.current.set(p.id, q.data);
          const tz = timezoneById.get(p.id) ?? 'UTC';
          for (const item of q.data.events) {
            rawEvents.push(item);
            const startMs = eventInstant(item, tz);
            const lengthMs = parseFloat(item.Event.Length || '0') * 1000;
            const endMs = item.Event.EndDateTime
              ? eventInstant({ Event: { ...item.Event, StartDateTime: item.Event.EndDateTime } } as EventData, tz)
              : startMs + lengthMs;
            events.push({
              id: item.Event.Id,
              monitorId: item.Event.MonitorId,
              startMs,
              endMs,
              cause: item.Event.Cause,
              alarmRatio: parseInt(item.Event.AlarmFrames) / Math.max(parseInt(item.Event.Frames), 1),
              notes: item.Event.Notes ?? '',
              profileId: p.id,
              profileChip: p.name,
            });
          }
        }
        if (q.error) {
          errors.push({ profileId: p.id, profileName: p.name, error: q.error });
        }
      });

      events.sort((a, b) => b.startMs - a.startMs);
      return { events, rawEvents, errors, isLoading: !anyHasData };
    },
  });

  const eventIds = useMemo(() => rawEvents.map((e) => e.Event.Id), [rawEvents]);

  const refetchProfile = useCallback(
    (id: ProfileId): void => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.timelineEventsList(id, startDate, endDate, monitorFilter, onlyDetectedObjects, causeFilter),
        exact: true,
      });
    },
    [queryClient, startDate, endDate, monitorFilter, onlyDetectedObjects, causeFilter]
  );

  return { isLoading, errors, enabledMonitors: monitorsResult, events, rawEvents, eventIds, refetchProfile };
}
