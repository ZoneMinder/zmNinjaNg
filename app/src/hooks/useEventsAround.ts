/**
 * Events within a window either side of one anchor event (refs #494).
 *
 * Everything here is keyed by the ANCHOR's profile, never the current one:
 * the panel opens from All-mode rows whose server is not the current profile,
 * and in All mode there is no current profile at all. Monitors and groups are
 * fetched under the same keys the parented hooks use, so an open Events page
 * has usually paid for them already.
 *
 * Two requests per window, filling outward from the anchor. The scopes
 * resolve to a MonitorId list that ZoneMinder ORs together; a list too long
 * for one filter URL degrades to the unfiltered window rather than failing.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getGroups } from '../api/groups';
import { getSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { EVENT_CONTEXT } from '../lib/zmninja-ng-constants';
import {
  eventContextWindow,
  groupMonitorIds,
  parseLinkedMonitorIds,
  resolveScopeMonitorIds,
  type EventContextScope,
} from '../lib/event/event-context';
import { eventInstant } from '../lib/event/event-instant';
import { balancedAroundAnchor } from '../lib/event/event-context-view';
import { resolveProfileTimezone } from '../lib/time';
import { useProfileById } from './useCurrentProfile';
import { ownFilterIds } from './useScopedEvents';
import { useEventFavoritesStore } from '../stores/eventFavorites';
import type { EventsPageQuery } from '../stores/eventContext';
import type { Event, EventData, EventFilters, ProfileId } from '../api/types';

export interface EventAroundRow {
  event: Event;
  offsetMs: number;
  isAnchor: boolean;
}

export interface UseEventsAroundResult {
  rows: EventAroundRow[];
  anchorMs: number;
  isLoading: boolean;
  error: unknown;
  /** The server had more rows than `EVENT_CONTEXT.maxResults`. */
  truncated: boolean;
  /** Which scope segments this server can actually offer. Filtered needs an
   *  Events page with a filter set behind the panel. */
  available: { linked: boolean; group: boolean; filtered: boolean };
  /** The scope the query actually ran with. Equals the requested scope unless
   *  this anchor cannot offer it, in which case it is `'all'` - the panel
   *  renders this, not the request, so the pressed chip never disagrees with
   *  the rows underneath it. */
  effectiveScope: EventContextScope;
  /** Monitor id -> name, for the list rows and replay tiles. */
  monitorNames: Map<string, string>;
}

export function useEventsAround(
  anchor: EventData | null,
  profileId: ProfileId | undefined,
  options: {
    windowMinutes: number;
    scope: EventContextScope;
    enabled: boolean;
    /** The Events page's query, for the Filtered scope; null when the panel
     *  was not opened over the Events page. */
    pageQuery?: EventsPageQuery | null;
  }
): UseEventsAroundResult {
  // Parented to the anchor's own profile: useProfileById never falls back to
  // the current profile when an id is given, which is what makes this safe
  // to call for an All-mode row whose server isn't current (Aggregation contract).
  const { profile } = useProfileById(profileId);
  const timezone = resolveProfileTimezone(profile?.timezone);
  const active = options.enabled && !!anchor && !!profileId;

  const monitorsQuery = useQuery({
    queryKey: queryKeys.monitors(profileId),
    queryFn: () => getMonitors(getSession(profileId!).client, profileId!),
    enabled: active,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups(profileId),
    queryFn: () => getGroups(getSession(profileId!).client),
    enabled: active,
  });

  const anchorMonitorId = anchor?.Event.MonitorId ?? '';
  const linked = useMemo(() => {
    const row = monitorsQuery.data?.monitors.find((m) => m.Monitor.Id === anchorMonitorId);
    const ids = parseLinkedMonitorIds(row?.Monitor.LinkedMonitors);
    return ids.length ? [anchorMonitorId, ...ids.filter((id) => id !== anchorMonitorId)] : [];
  }, [monitorsQuery.data, anchorMonitorId]);

  const group = useMemo(
    () => groupMonitorIds(groupsQuery.data?.groups, anchorMonitorId),
    [groupsQuery.data, anchorMonitorId]
  );

  const window = useMemo(
    () =>
      anchor
        ? eventContextWindow(anchor, options.windowMinutes, timezone)
        : { startDateTime: '', endDateTime: '', anchorMs: 0 },
    [anchor, options.windowMinutes, timezone]
  );

  const pageQuery = options.pageQuery ?? null;
  const available = useMemo(
    () => ({ linked: linked.length > 0, group: group.length > 1, filtered: !!pageQuery?.active }),
    [linked, group, pageQuery]
  );

  // Filtered: the Events page query narrowed to the anchor's server the way
  // the page's own useScopedEvents narrows it (ownFilterIds), with this
  // panel's window standing in for the page's date range, limit and sort.
  // ponytail: with Favorites and tags both on, the page applies the tags in a
  // client pass over each event's tags (ZM cannot combine them server-side);
  // Filtered applies only the favorites then. Port that pass if it matters.
  const favorites = useEventFavoritesStore((s) => (profileId ? s.profileFavorites[profileId] : undefined));
  const filtered = useMemo((): EventFilters | undefined => {
    if (!pageQuery || !profileId) return undefined;
    const { notesRegexp, archived, cause, causeExclude, minAlarmFrames } = pageQuery.filters;
    const { monitorId, eventIds } = ownFilterIds(profileId, pageQuery.monitorId, pageQuery.favoritesOnly, favorites);
    return {
      notesRegexp,
      archived,
      cause,
      causeExclude,
      minAlarmFrames,
      monitorId,
      eventIds,
      tagIds: pageQuery.tagIdsByProfile?.[profileId],
    };
  }, [pageQuery, profileId, favorites]);

  // A scope this anchor cannot offer (no LinkedMonitors, no shared group)
  // resolves to no MonitorId filter at all, which asks for every camera. Left
  // as the requested scope, the panel would press the Linked chip over an
  // all-cameras result. Fall back to `all` once monitors and groups have
  // answered - the same gate the events query waits on, so the key settles
  // before the first fetch rather than changing under it (refs #494).
  const scopesKnown = !monitorsQuery.isPending && !groupsQuery.isPending;
  const effectiveScope: EventContextScope =
    scopesKnown && options.scope !== 'all' && !available[options.scope] ? 'all' : options.scope;

  const monitorIds = resolveScopeMonitorIds(effectiveScope, { linked, group });
  const scopeFilters: EventFilters =
    effectiveScope === 'filtered' && filtered ? filtered : { monitorId: monitorIds?.join(',') };

  const eventsQuery = useQuery({
    queryKey: queryKeys.eventsAround(
      profileId,
      anchor?.Event.Id ?? '',
      options.windowMinutes,
      effectiveScope,
      effectiveScope === 'filtered' ? scopeFilters : undefined
    ),
    // Two requests that fill outward from the anchor (refs #534): one sorted
    // oldest-first from the window start would spend the whole limit on the
    // far edge of a busy window and drop the events right after the anchor.
    // Both include the anchor's own second; the merge drops the duplicate.
    queryFn: async () => {
      const client = getSession(profileId!).client;
      const base = { ...scopeFilters, sort: 'StartDateTime', limit: EVENT_CONTEXT.maxResults };
      const anchorStart = anchor!.Event.StartDateTime;
      const [before, after] = await Promise.all([
        getEvents(client, profileId!, {
          ...base,
          startDateTime: window.startDateTime,
          startDateTimeMax: anchorStart,
          endDateTime: window.endDateTime,
          direction: 'desc',
        }),
        getEvents(client, profileId!, {
          ...base,
          startDateTime: anchorStart,
          endDateTime: window.endDateTime,
          direction: 'asc',
        }),
      ]);
      const events = [...new Map([...before.events, ...after.events].map((e) => [e.Event.Id, e])).values()];
      const truncated = [before, after].some((r) => (r.pagination.totalCount ?? r.events.length) > EVENT_CONTEXT.maxResults);
      return { events, truncated };
    },
    // isPending, not isLoading: a disabled query reports isLoading: false in
    // React Query v5 (agents/project/domain-context.md), so gating on
    // isLoading here would flip this query on before monitors/groups data
    // (and therefore the scope's monitor ids) had actually arrived.
    enabled: active && !monitorsQuery.isPending && !groupsQuery.isPending,
  });

  const rows = useMemo<EventAroundRow[]>(() => {
    const events = (eventsQuery.data?.events ?? []).map((item) => ({
      event: item.Event,
      offsetMs: eventInstant(item, timezone) - window.anchorMs,
      isAnchor: item.Event.Id === anchor?.Event.Id,
    }));
    return balancedAroundAnchor(events, EVENT_CONTEXT.maxResults);
  }, [eventsQuery.data, timezone, window.anchorMs, anchor]);

  const monitorNames = useMemo(
    () => new Map((monitorsQuery.data?.monitors ?? []).map((m) => [m.Monitor.Id, m.Monitor.Name])),
    [monitorsQuery.data]
  );

  return {
    rows,
    monitorNames,
    anchorMs: window.anchorMs,
    // isPending, not isLoading: the answer isn't knowable until monitors,
    // groups AND events have all produced data, and a still-disabled events
    // query (waiting on the other two) reports isLoading: false regardless
    // (same v5 trap as the enabled gate above).
    isLoading: active && (monitorsQuery.isPending || groupsQuery.isPending || eventsQuery.isPending),
    error: monitorsQuery.error ?? groupsQuery.error ?? eventsQuery.error,
    // Either side having more than it returned, or the two sides together
    // outrunning the cap balancedAroundAnchor applies, means rows were dropped.
    truncated:
      !!eventsQuery.data &&
      (eventsQuery.data.truncated || eventsQuery.data.events.length > EVENT_CONTEXT.maxResults),
    available,
    effectiveScope,
  };
}
