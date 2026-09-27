/**
 * useScopedEvents Hook
 *
 * Aggregates events across the active profile scope (see useProfileScope):
 * one profile in single mode, every profile in All mode. Fans out via
 * useQueries with the SAME query key useEvents/Events.tsx uses
 * (queryKeys.eventsList(id, filters, limit, monitorId, isGroupFilterActive,
 * eventIds, tagIds)), so single mode shares its cache entry with the
 * existing single-profile Events page instead of double-fetching. v1
 * applies the CALLER-SUPPLIED filter params identically to every profile in
 * scope; per-profile monitor exclusions already ride the getEvents/api gate.
 *
 * `filters.startDateTime`/`endDateTime`, when present, are RAW local
 * datetime-local input strings (e.g. from a date picker), NOT pre-formatted
 * server strings - the per-profile queryFn below converts each one via
 * formatForServerInTz(date, profile.timezone) so a date-range filter means
 * the same real instant on every profile's server, regardless of that
 * profile's own timezone (refs #337). Events.tsx must pass the raw hook
 * filters here, not its own formatForServer-converted copy.
 *
 * Each result is wrapped with its owning profile's id/name (Scoped<T>) so
 * colliding event ids across two servers stay distinct entries. A profile's
 * query failing does not fail the others - it becomes one ProfileError
 * entry while the rest of the scope keeps rendering.
 *
 * Merged events are sorted descending by true absolute instant (eventInstant,
 * lib/event/event-instant.ts), not by the server-local StartDateTime string,
 * so events from profiles in different timezones interleave correctly.
 *
 * Polling is opt-in: `options.refetchInterval` is undefined unless the
 * caller passes one. The Events page's own query has no polling today, so
 * this hook must not invent it - a caller that wants live refresh sources
 * the interval itself via useBandwidthSettings (Polling contract stays at
 * the call site) and passes it through.
 */

import { useCallback } from 'react';
import { useQueries, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import type { EventFilters } from '../api/events';
import { getSession } from '../services/sessions';
import { useEventFavoritesStore } from '../stores/eventFavorites';
import { useProfileScope } from './useProfileScope';
import { queryKeys } from '../lib/query/query-keys';
import { staggeredRefetchInterval } from '../lib/query/stagger-interval';
import { eventInstant } from '../lib/event/event-instant';
import { formatForServerInTz, resolveProfileTimezone } from '../lib/time';
import type { Scoped, ProfileError } from '../api/scoped-types';
import type { EventData, ProfileId } from '../api/types';

/**
 * Resolves the comma-joined `monitorId` filter down to the ids one profile
 * actually owns. All-mode monitor-filter selections are composite
 * `${profileId}:${monitorId}` tokens (EventsFilterPopover, refs #337 I6) - a
 * bare numeric id is only unique within one server, so applying the SAME
 * shared string to every profile's query would filter profile B by a
 * monitor id that only means something on profile A. A token with no ':' is
 * a plain single-mode id and passes through unchanged (there is only ever
 * one profile in scope then).
 *
 * No tokens left for this profile -> undefined, which means "no monitor
 * filter" to ZoneMinder. That alone would answer with every event on that
 * server, so the caller pairs it with the impossible `eventIds: []` filter -
 * see `ownFilterIds` below.
 */
export function resolveOwnMonitorIds(monitorId: string | undefined, profileId: ProfileId): string | undefined {
  if (!monitorId) return undefined;
  const owned = monitorId.split(',').flatMap((token) => {
    const sep = token.indexOf(':');
    if (sep === -1) return [token];
    return token.slice(0, sep) === profileId ? [token.slice(sep + 1)] : [];
  });
  return owned.length > 0 ? owned.join(',') : undefined;
}

/**
 * One profile's share of the id-shaped filters.
 *
 * `monitorId` and `eventIds` interact: a profile that owns NONE of the
 * selected composite monitor tokens must contribute zero events, but
 * resolveOwnMonitorIds can only say "no monitor filter" there, which
 * ZoneMinder reads as "every monitor". The impossible `eventIds: []` filter
 * is what actually makes it match nothing - getEvents short-circuits an
 * empty id set to an empty response, the same shape favoritesOnly relies on
 * for a profile with no favorites of its own (refs #337).
 *
 * Exported so the Nearby panel's Filtered scope narrows the Events page query
 * to one server exactly the way this hook does (refs #534).
 */
export function ownFilterIds(
  profileId: ProfileId,
  monitorId: string | undefined,
  favoritesOnly: boolean | undefined,
  favorites: string[] | undefined
): { monitorId: string | undefined; eventIds: string[] | undefined } {
  const ownMonitorId = resolveOwnMonitorIds(monitorId, profileId);
  if (monitorId && ownMonitorId === undefined) return { monitorId: undefined, eventIds: [] };
  return { monitorId: ownMonitorId, eventIds: favoritesOnly ? (favorites ?? []) : undefined };
}

export interface UseScopedEventsOptions {
  /** Base filters, applied identically to every profile in scope - the same
   *  object the caller's single-profile query passes as `filters`. */
  filters: EventFilters;
  /** Shared page size fanned to every profile (v1, see paging note below). */
  limit: number;
  /** All mode: composite `${profileId}:${monitorId}` tokens, resolved to
   *  each profile's own ids before it hits that profile's query (see
   *  resolveOwnMonitorIds). Single mode: bare ids, unchanged. */
  monitorId?: string;
  isGroupFilterActive: boolean;
  /** Filter to only favorited events. Each profile's OWN favorites (per the
   *  Stores contract's getFavorites(profileId)) resolve inside the fan-out
   *  below, never a single profile's list reused for every profile - see
   *  resolveOwnMonitorIds' doc comment for the parallel bug this avoids
   *  (refs #337 I7). A profile with none of its own favorited contributes
   *  no events, matching single mode's existing empty-favorites behavior. */
  favoritesOnly?: boolean;
  /** Tag filter, already resolved to each profile's OWN tag ids; absent means
   *  no tag filter at all. Tags are per-server entities whose ids differ
   *  server to server, so All mode resolves the user's selection by NAME into
   *  every profile's own ids before it reaches that profile's query (see
   *  useScopedTags). A profile mapped to an EMPTY array has none of the
   *  selected tags and therefore matches nothing - the same
   *  impossible-filter shape favoritesOnly uses, and the reason getEvents
   *  treats an empty tagIds as "no results" rather than "no filter" (refs
   *  #337 D4). */
  tagIdsByProfile?: Partial<Record<ProfileId, string[]>>;
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
  /** Refetch interval in ms. Undefined (default) means no polling - the
   *  caller opts in explicitly, e.g. with a bandwidth-settings field. */
  refetchInterval?: number;
}

export interface UseScopedEventsReturn {
  /** Events across all profiles, sorted descending by true absolute instant */
  events: Scoped<EventData>[];
  /** One entry per profile whose query failed */
  errors: ProfileError[];
  /** True only while NO profile has data yet */
  isLoading: boolean;
  /** True while ANY profile's query is in flight (initial or background). */
  isFetching: boolean;
  /** Sum of every profile's own server-reported totalCount (undefined until
   *  at least one profile has data). In single mode this is exactly that
   *  one profile's totalCount, unchanged from the page's old direct query -
   *  drives "Load More" / "Showing X of Y" the same way it always did. */
  totalCount: number | undefined;
  /** Per-profile breakdown of the same totals, keyed by profile id. Lets a
   *  caller recompute "Showing X of Y" against a subset of profiles (e.g.
   *  Events.tsx's server filter) without an extra fetch (refs #337). */
  totalCountByProfile: Partial<Record<ProfileId, number>>;
  /** Refetch exactly one profile's query */
  refetchProfile: (id: ProfileId) => void;
  /** Refetch every profile in scope; resolves once all have settled. */
  refetchAll: () => Promise<void>;
}

export function useScopedEvents(options: UseScopedEventsOptions): UseScopedEventsReturn {
  const scope = useProfileScope();
  const queryClient = useQueryClient();
  const profiles = scope?.profiles ?? [];
  const { filters, limit, monitorId, isGroupFilterActive, favoritesOnly, tagIdsByProfile, enabled, refetchInterval } = options;

  // Reactive so toggling a favorite refetches the affected profile's query
  // (Stores contract: select every reactive field read - the whole record,
  // not a per-profile derived array, so an untouched profile's entry stays
  // reference-stable across renders).
  const profileFavorites = useEventFavoritesStore((s) => s.profileFavorites);

  // Shared by the fan-out and both refetch paths so the query key they
  // compute is byte-identical to the one that ran.
  const profileFilterIds = useCallback(
    (profileId: ProfileId) => ownFilterIds(profileId, monitorId, favoritesOnly, profileFavorites[profileId]),
    [monitorId, favoritesOnly, profileFavorites]
  );

  // combine is the only useQueries path that gets reference-stable output -
  // see useScopedMonitors.ts for the full rationale (QueriesObserver diffs
  // combine's OUTPUT with replaceEqualDeep and reuses old references for
  // unchanged sub-trees; without it every poll tick would produce brand-new
  // array identities even when the underlying data hasn't changed).
  const { events, errors, isLoading, isFetching, totalCount, totalCountByProfile } = useQueries({
    queries: profiles.map((p, i) => {
      const { monitorId: ownMonitorId, eventIds } = profileFilterIds(p.id);
      const tagIds = tagIdsByProfile?.[p.id];
      return {
        queryKey: queryKeys.eventsList(p.id, filters, limit, ownMonitorId, isGroupFilterActive, eventIds, tagIds),
        queryFn: () => {
          // Browser-zone fallback (not 'UTC') for a timezone-less profile,
          // matching formatForServer's historical fallback exactly - the
          // eventInstant sort below deliberately keeps its OWN 'UTC' fallback
          // (matches getSession's convention; a stable sort key, not a
          // user-facing query window) (refs #337 fix round 1).
          const tz = resolveProfileTimezone(p.timezone);
          return getEvents(getSession(p.id).client, p.id, {
            ...filters,
            monitorId: ownMonitorId,
            eventIds,
            tagIds,
            limit,
            // Convert per profile, not once up front: a shared Date bound must
            // mean the same real instant on every profile's own server.
            startDateTime: filters.startDateTime ? formatForServerInTz(new Date(filters.startDateTime), tz) : undefined,
            endDateTime: filters.endDateTime ? formatForServerInTz(new Date(filters.endDateTime), tz) : undefined,
          });
        },
        // A profile in scope always gets an enabled query, whether or not it
        // has ever bootstrapped/authenticated this session - see
        // useScopedMonitors.ts for why (the API client self-heals via its own
        // proactiveLogin path; a real auth failure still surfaces as this
        // profile's ProfileError). Refs #337. Its TLS trust-on-first-use rides
        // the same concurrent fan-out; cert pinning order across profiles is
        // best-effort, not guaranteed (refs #337, W8).
        enabled: enabled ?? true,
        // Keeps showing a profile's previous page while fetching the next one
        // (pagination "Load More") instead of flashing empty - matches the
        // Events page's old single-query behavior exactly.
        placeholderData: keepPreviousData,
        // Opt-in only - see the module doc comment: undefined means no polling,
        // and must stay undefined rather than accidentally turning into one via
        // staggering. When a caller does pass a base interval, stagger it the
        // same way useScopedMonitors does (see stagger-interval.ts) so a future
        // polling caller doesn't reintroduce the N-profile synchronized burst.
        refetchInterval: refetchInterval !== undefined
          ? staggeredRefetchInterval(i, profiles.length, refetchInterval)
          : undefined,
      };
    }),
    combine: (results) => {
      // Owning profile's timezone for eventInstant - falls back to 'UTC'
      // exactly like getSession does, so an untimezoned profile still sorts
      // deterministically instead of throwing.
      const timezoneById = new Map(profiles.map((p) => [p.id, p.timezone ?? 'UTC']));

      const events: Scoped<EventData>[] = [];
      const errors: ProfileError[] = [];
      let anyHasData = false;
      let totalCount: number | undefined;
      const totalCountByProfile: Partial<Record<ProfileId, number>> = {};

      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q) return;
        if (q.data) {
          anyHasData = true;
          for (const item of q.data.events) {
            events.push({ profileId: p.id, profileName: p.name, item });
          }
          const profileTotal = q.data.pagination?.totalCount;
          if (profileTotal !== undefined) {
            totalCount = (totalCount ?? 0) + profileTotal;
            totalCountByProfile[p.id] = profileTotal;
          }
        }
        if (q.error) {
          errors.push({ profileId: p.id, profileName: p.name, error: q.error });
        }
      });

      // ponytail: v1 paging is one shared page/limit fanned to every profile
      // and merged client-side (up to N-profiles * limit items in memory,
      // sorted by true instant). A per-profile cursor that advances only the
      // profiles whose slice is exhausted ("load more") is the natural
      // upgrade if that becomes visible with more than a couple of profiles
      // in scope.
      events.sort((a, b) => {
        const aInstant = eventInstant(a.item, timezoneById.get(a.profileId) ?? 'UTC');
        const bInstant = eventInstant(b.item, timezoneById.get(b.profileId) ?? 'UTC');
        return bInstant - aInstant;
      });

      return {
        events,
        errors,
        isLoading: !anyHasData,
        isFetching: results.some((r) => r?.isFetching),
        totalCount,
        totalCountByProfile,
      };
    },
  });

  // Keyed refetch instead of indexing into useQueries' per-render array -
  // exact query key match refetches precisely that profile, independent of
  // combine's shape.
  const refetchProfile = useCallback(
    (id: ProfileId): void => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.eventsList(id, filters, limit, profileFilterIds(id).monitorId, isGroupFilterActive, profileFilterIds(id).eventIds, tagIdsByProfile?.[id]),
        exact: true,
      });
    },
    [queryClient, filters, limit, isGroupFilterActive, profileFilterIds, tagIdsByProfile]
  );

  // Refetches every profile in scope and resolves once they've all settled -
  // pull-to-refresh awaits this so its spinner tracks real completion,
  // matching the single-profile page's old `await refetch()`.
  const refetchAll = useCallback(async (): Promise<void> => {
    await Promise.all(
      profiles.map((p) =>
        queryClient.refetchQueries({
          queryKey: queryKeys.eventsList(p.id, filters, limit, profileFilterIds(p.id).monitorId, isGroupFilterActive, profileFilterIds(p.id).eventIds, tagIdsByProfile?.[p.id]),
          exact: true,
        })
      )
    );
  }, [queryClient, profiles, filters, limit, isGroupFilterActive, profileFilterIds, tagIdsByProfile]);

  return { events, errors, isLoading, isFetching, totalCount, totalCountByProfile, refetchProfile, refetchAll };
}
