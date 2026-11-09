/**
 * Live alarm state for several monitors at once.
 *
 * One query per monitor. The alternative, a single combined request, is not
 * available: ZoneMinder's alarm endpoint is addressed by a single monitor id.
 * This matches the fanout useMonitorNewEvents already uses for the same
 * reason, and React Query dedupes and caches each monitor independently.
 *
 * The caller passes `enabled` so the fanout only runs while the Live Activity
 * page is actually on screen. There is no background polling cost anywhere
 * else in the app.
 */

import { useQueries } from '@tanstack/react-query';
import { getAlarmStatus } from '../api/monitors';
import { getCurrentSession, getSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { staggeredRefetchInterval } from '../lib/query/stagger-interval';
import { monitorCacheKey } from '../stores/monitors';
import { getApiUrlForMonitor } from '../lib/zm/server-resolver';
import { parseAlarmState, type MonitorAlarmState } from '../lib/monitor/alarm-state';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthSlice } from '../stores/auth';
import type { ProfileId } from '../api/types';

interface UseAlarmStatesOptions {
  /** Poll only while the page is visible. */
  enabled: boolean;
  /** Already reconciled against the bandwidth floor by the caller. */
  pollIntervalMs: number;
}

/** A monitor to poll, with the ServerId that decides which host answers. */
export interface AlarmMonitorRef {
  monitorId: string;
  serverId: string | null | undefined;
}

interface UseAlarmStatesReturn {
  /**
   * Total over `monitors`: every id passed in gets an entry, even before
   * its query has ever resolved. The downstream dwell reducer reads a
   * missing key as "the caller stopped watching this monitor" and drops it
   * without waiting out the dwell window, so a transiently-loading or
   * transiently-failed query must still report a value rather than being
   * left out of the map.
   *
   * Identity-stable: the same object comes back across renders while
   * nothing has changed. Consumers derive from it in effects, so a fresh
   * object per render is a render loop, not a wasted comparison.
   */
  states: Record<string, MonitorAlarmState>;
  isLoading: boolean;
  error: Error | null;
}

export function useAlarmStates(
  monitors: AlarmMonitorRef[],
  { enabled, pollIntervalMs }: UseAlarmStatesOptions
): UseAlarmStatesReturn {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
  const profileId = currentProfile?.id;

  return useQueries({
    queries: monitors.map(({ monitorId, serverId }) => ({
      queryKey: queryKeys.monitorAlarmStatus(profileId, monitorId),
      queryFn: () => getAlarmStatus(getCurrentSession().client, monitorId, getApiUrlForMonitor(serverId, profileId)),
      enabled: enabled && !!profileId && isAuthenticated,
      refetchInterval: pollIntervalMs,
      // The page is only mounted while visible, so background refetching would
      // poll a screen nobody is looking at.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
    // Reducing here rather than in a downstream useMemo is what keeps the
    // return value identity-stable. Without `combine`, useQueries re-maps its
    // results array on every render, so a useMemo listing it never hits and
    // every consumer sees a new `states` object each render. On the Live
    // Activity page that fed an effect which stamps Date.now() into the dwell
    // list, so the wall clock alone kept producing a new list: render, effect,
    // setState, render, forever (measured at 471 renders in 300ms with one
    // alarming monitor). TanStack runs replaceEqualDeep over whatever
    // `combine` returns, so an unchanged poll yields the very same object and
    // the loop never starts.
    combine: (results) => {
      const states: Record<string, MonitorAlarmState> = {};
      let isLoading = false;
      let error: Error | null = null;

      // Disabled means the caller is not watching any of these monitors right
      // now (page off screen), so the map is genuinely empty rather than
      // total. Once enabled, every requested id must get an entry: TanStack
      // still returns one result per query even for a per-query-disabled
      // fetch (e.g. no profile yet), so leaving that case out here would read
      // downstream as "no longer watched" and drop the monitor without its
      // dwell window.
      if (enabled) {
        results.forEach((result, i) => {
          if (result.isLoading) isLoading = true;
          // A failed poll reports the monitor's last known state, not
          // `unknown`. `unknown` is not alarming, so one dropped request on
          // flaky wifi would end the alarm, start the dwell countdown, and let
          // the next success count a *fresh* alarm: a single continuous alarm
          // displayed as "x7". React Query keeps the previous payload in
          // `data` across a failed refetch, so this holds steady instead. A
          // monitor that has never succeeded has no `data` and parses to
          // `unknown`, which keeps the map total.
          states[monitors[i].monitorId] = parseAlarmState(result.data);
          if (result.error && !error) error = result.error as Error;
        });
      }

      return { states, isLoading, error };
    },
  });
}

/**
 * A (profile, monitor) pair whose alarm status is fetched under that
 * profile's own session, regardless of which profile is globally selected.
 * Mirrors ScopedMonitorRef in useMonitorNewEvents.ts.
 */
export interface ScopedAlarmRef extends AlarmMonitorRef {
  profileId: ProfileId;
}

interface UseScopedAlarmStatesReturn {
  /**
   * Keyed by monitorCacheKey(profileId, monitorId), so two profiles sharing
   * a raw monitor id never collide. Same total-map semantics as
   * useAlarmStates above: every requested pair gets an entry, a failed poll
   * holds the pair's last known state, and disabled means an empty map.
   * Identity-stable for the same reason useAlarmStates' map is (see its
   * combine comment).
   */
  states: Record<string, MonitorAlarmState>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * All-mode counterpart to useAlarmStates: fans the same per-monitor alarm
 * poll out across every (profile, monitor) pair the caller supplies, using
 * each pair's OWNING profile - never the globally-selected current profile -
 * for the session client and the query key (refs #337, #341).
 *
 * Single mode keeps using useAlarmStates unchanged rather than this hook
 * with a single-profile pair list: useAlarmStates' query key carries the
 * real current-profile id and so shares its cache entry with every other
 * single-profile alarm consumer, and its combine map is keyed by the bare
 * monitor id the rest of the single-mode page (recentCauses, dismissedRef,
 * tile testids) already assumes. Reusing this hook for single mode would
 * mean choosing between dropping that shared cache entry (an undefined
 * profileId in the query key) or keying the single-mode map by
 * monitorCacheKey too, which is a composite key none of that existing,
 * tested code expects. Two hooks sharing the same combine shape stays
 * simpler and lower-risk than forcing one.
 */
export function useScopedAlarmStates(
  pairs: ScopedAlarmRef[],
  { enabled, pollIntervalMs }: UseAlarmStatesOptions
): UseScopedAlarmStatesReturn {
  return useQueries({
    queries: pairs.map(({ profileId, monitorId, serverId }, i) => ({
      queryKey: queryKeys.monitorAlarmStatus(profileId, monitorId),
      queryFn: () => getAlarmStatus(getSession(profileId).client, monitorId, getApiUrlForMonitor(serverId, profileId)),
      enabled,
      // Desynchronizes the per-(profile, monitor) refetch bursts, same
      // rationale as useScopedMonitors/useScopedMonitorNewEvents.
      refetchInterval: staggeredRefetchInterval(i, pairs.length, pollIntervalMs),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
    // See useAlarmStates' combine comment above: this is what keeps `states`
    // identity-stable across an unchanged poll, which the Live Activity
    // page's dwell effect depends on to avoid a render loop.
    combine: (results) => {
      const states: Record<string, MonitorAlarmState> = {};
      let isLoading = false;
      let error: Error | null = null;

      if (enabled) {
        results.forEach((result, i) => {
          if (result.isLoading) isLoading = true;
          // Defensive: `results` and `pairs` are built from the same
          // `queries` map in this same render pass, so they are the same
          // length in practice, but a mismatch degrades to "skip this
          // result" rather than throwing on `pairs[i].profileId`.
          const pair = pairs[i];
          if (!pair) return;
          const key = monitorCacheKey(pair.profileId, pair.monitorId);
          states[key] = parseAlarmState(result.data);
          if (result.error && !error) error = result.error as Error;
        });
      }

      return { states, isLoading, error };
    },
  });
}
