/**
 * React Query key factory.
 *
 * Every server-data query is scoped to the active ZoneMinder profile by putting
 * the profile id immediately after the domain name: `[domain, profileId, ...rest]`.
 * React Query invalidates by array prefix, so a domain-level key (just
 * `[domain, profileId]`) prefix-matches every leaf key in that domain. Keep the
 * profileId in the same position across a domain and never insert an optional
 * parameter before it, or prefix invalidation stops matching.
 *
 * The query cache survives a profile switch (stores/profile.ts) so other
 * profiles' data stays warm for All mode; these profile-scoped keys are the
 * isolation primitive that keeps a stale key from another profile from ever
 * matching. `removeProfileQueries` (stores/query-cache.ts) evicts a
 * profile's keys when it is deleted.
 *
 * A handful of keys are genuinely app-level (not tied to a profile/server) and
 * carry no profile id. They are grouped at the bottom.
 */

import type { ProfileId } from '../../api/types';

export type { ProfileId };

/**
 * Profile id as supplied by the various call sites (hook, store, or prop).
 * Nullable because a query can run before a profile is selected; the branded
 * `ProfileId` still guarantees that when a value IS present, it came from a
 * real profile (see api/types.ts) rather than an arbitrary string.
 */
type MaybeProfileId = ProfileId | null | undefined;

export const queryKeys = {
  // --- Monitors -----------------------------------------------------------
  /** All monitor-derived queries. Domain prefix for broad invalidation. */
  monitors: (profileId: MaybeProfileId) => ['monitors', profileId] as const,
  /** Full monitor list including excluded monitors (settings screen). */
  monitorsAllIncludingExcluded: (profileId: MaybeProfileId) =>
    ['monitors', profileId, 'all-including-excluded'] as const,
  /** A single monitor by id. */
  monitor: (profileId: MaybeProfileId, monitorId: string | undefined) =>
    ['monitor', profileId, monitorId] as const,
  /** Live alarm status for a monitor. */
  monitorAlarmStatus: (profileId: MaybeProfileId, monitorId: string | undefined) =>
    ['monitor-alarm-status', profileId, monitorId] as const,
  /** PTZ control capabilities for a monitor's control id. */
  control: (profileId: MaybeProfileId, controlId: string | null | undefined) =>
    ['control', profileId, controlId] as const,
  /** Zones for a monitor. */
  zones: (profileId: MaybeProfileId, monitorId: string | undefined) =>
    ['zones', profileId, monitorId] as const,

  // --- Groups / tags ------------------------------------------------------
  groups: (profileId: MaybeProfileId) => ['groups', profileId] as const,
  tags: (profileId: MaybeProfileId) => ['tags', profileId] as const,
  eventTags: (profileId: MaybeProfileId, sortedEventIds: string[]) =>
    ['eventTags', profileId, sortedEventIds] as const,

  // --- Events -------------------------------------------------------------
  /** All `events`-domain queries. Domain prefix for broad invalidation. */
  events: (profileId: MaybeProfileId) => ['events', profileId] as const,
  /** The main events list on the Events page. */
  eventsList: (
    profileId: MaybeProfileId,
    filters: unknown,
    limit: number,
    monitorId: string | undefined,
    isGroupFilterActive: boolean,
    eventIds: string[] | undefined,
    tagIds: string[] | undefined,
  ) =>
    [
      'events',
      profileId,
      filters,
      limit,
      monitorId,
      isGroupFilterActive,
      eventIds,
      tagIds,
    ] as const,
  /** Events list shown inside a dashboard events widget. */
  eventsWidget: (
    profileId: MaybeProfileId,
    monitorIdFilter: string | undefined,
    limit: number,
    onlyDetectedObjects: boolean,
  ) => ['events', profileId, monitorIdFilter, limit, onlyDetectedObjects] as const,
  /** Events feeding the dashboard timeline widget. */
  eventsTimelineWidget: (profileId: MaybeProfileId, startMs: number) =>
    ['events', profileId, 'timeline-widget', startMs] as const,
  /** A single event by id. */
  event: (profileId: MaybeProfileId, eventId: string | undefined) =>
    ['event', profileId, eventId] as const,
  /** Events within a window either side of one anchor event. */
  eventsAround: (
    profileId: MaybeProfileId,
    anchorId: string,
    windowMinutes: number,
    scope: string,
  ) => ['events', profileId, 'around', anchorId, windowMinutes, scope] as const,
  /** Recent events for a single monitor (monitor detail list). */
  monitorRecentEvents: (
    profileId: MaybeProfileId,
    monitorId: string,
    count: number,
  ) => ['monitorRecentEvents', profileId, monitorId, count] as const,
  /** Events aggregated for the dashboard heatmap widget. */
  eventsHeatmap: (profileId: MaybeProfileId, timeRange: string) =>
    ['events-heatmap', profileId, timeRange] as const,
  /** All `event-montage`-domain queries. Domain prefix for invalidation. */
  eventMontage: (profileId: MaybeProfileId) => ['event-montage', profileId] as const,
  /** Events for the event montage page. */
  eventMontageList: (profileId: MaybeProfileId, filterParams: unknown) =>
    ['event-montage', profileId, filterParams] as const,
  /** Count of a monitor's events newer than a watermark. Keyed by the
   *  watermark so clearing the badge invalidates exactly one monitor. */
  monitorEventsSince: (
    profileId: MaybeProfileId,
    monitorId: string,
    since: string | null
  ) => ['monitor-events-since', profileId, monitorId, since] as const,
  /** All monitor-events-since queries. Domain prefix for invalidation. */
  monitorEventsSinceAll: (profileId: MaybeProfileId) =>
    ['monitor-events-since', profileId] as const,
  /** One monitor's events-since query, across any watermark. Prefix for
   *  invalidating a single monitor's count when a notification arrives. */
  monitorEventsSinceMonitor: (profileId: MaybeProfileId, monitorId: string) =>
    ['monitor-events-since', profileId, monitorId] as const,
  /** All `timeline-events`-domain queries. Domain prefix for invalidation. */
  timelineEvents: (profileId: MaybeProfileId) => ['timeline-events', profileId] as const,
  /** Events for the timeline page (optionally fanned out per monitor). */
  timelineEventsList: (
    profileId: MaybeProfileId,
    startDate: string,
    endDate: string,
    monitorFilter: string | undefined,
    onlyDetectedObjects: boolean,
    causeFilter: string,
  ) =>
    [
      'timeline-events',
      profileId,
      startDate,
      endDate,
      monitorFilter,
      onlyDetectedObjects,
      causeFilter,
    ] as const,

  // --- Server / system ----------------------------------------------------
  servers: (profileId: MaybeProfileId) => ['servers', profileId] as const,
  daemonCheck: (profileId: MaybeProfileId) => ['daemon-check', profileId] as const,
  serverLoad: (profileId: MaybeProfileId) => ['server-load', profileId] as const,
  diskUsage: (profileId: MaybeProfileId) => ['disk-usage', profileId] as const,
  states: (profileId: MaybeProfileId) => ['states', profileId] as const,
  timezone: (profileId: MaybeProfileId) => ['timezone', profileId] as const,
  storages: (profileId: MaybeProfileId) => ['storages', profileId] as const,
  /** What the profile's ZoneMinder account is allowed to do (refs #344). */
  accountPermissions: (profileId: MaybeProfileId) => ['account-permissions', profileId] as const,

  // --- Assistant ----------------------------------------------------------
  /** Ollama backend reachability probe, keyed by base URL so a URL change
   *  refetches instead of showing another server's status. */
  assistantOllamaHealth: (profileId: MaybeProfileId, baseUrl: string) =>
    ['assistant-ollama-health', profileId, baseUrl] as const,

  // --- App-level (not profile-scoped) -------------------------------------
  /** In-app developer notices. App-level, identical across profiles. */
  developerNotices: () => ['developer-notices'] as const,
} as const;
