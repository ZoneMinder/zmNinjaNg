/**
 * All-mode data for the Live Activity page (refs #337, #341): every scope
 * profile's watched monitors, alarm fanout and live-hint causes, keyed by
 * monitorCacheKey(profileId, monitorId) so two servers sharing a raw
 * monitor id never collide.
 *
 * Extracted out of LiveActivity.tsx (C2 - the page file had grown past the
 * 400-line guideline once All mode was added). Single mode is entirely
 * unaffected: LiveActivity.tsx keeps its own useAlarmStates/useQuery path
 * unchanged and this hook simply produces empty/disabled results while
 * `isAllMode` is false, at the cost of the cheap selectors below still
 * running (useProfileScope, the settings map subscription) - no network
 * fanout happens until enabled.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileScope } from './useProfileScope';
import { useScopedMonitors } from './useScopedMonitors';
import { useScopedAlarmStates, type ScopedAlarmRef } from './useAlarmStates';
import { useSettingsStore, mergeProfileSettings, DEFAULT_SETTINGS } from '../stores/settings';
import { monitorCacheKey } from '../stores/monitors';
import { useNotificationStore } from '../stores/notifications';
import { capWatchedRoundRobin, type ActiveMonitorEntry } from '../lib/monitor/live-activity';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';
import type { Monitor, MonitorData, MonitorStatus, Profile, ProfileId } from '../api/types';
import type { ProfileError } from '../api/scoped-types';

/** One tile's render data, shared with LiveActivity.tsx's single-mode map so
 *  both feed the same tile lookup shape. */
export interface LiveActivityMonitorEntry {
  Monitor: Monitor;
  Monitor_Status: MonitorStatus | undefined;
  /** Set only in All mode. */
  profileId?: ProfileId;
  profileChip?: string;
}

interface UseLiveActivityAllModeReturn {
  /** Keyed by monitorCacheKey(profileId, monitorId). Empty in single mode. */
  monitorsById: Map<string, LiveActivityMonitorEntry>;
  /** Every scope profile's FULL monitor list (pre-ignore-filter, pre-cap):
   *  the settings dialog's ignore-list section needs to offer every monitor
   *  a picked profile has, not just the ones currently watched. Empty in
   *  single mode. */
  monitorsByProfile: Map<ProfileId, MonitorData[]>;
  profilesById: Map<ProfileId, Profile>;
  profileErrors: ProfileError[];
  isMonitorsLoading: boolean;
  /** Total (profile, monitor) pairs watched, after the round-robin cap. */
  watchedCount: number;
  /** How many watched pairs the cap dropped, for the overflow notice. */
  watchOverflowCount: number;
  /** Keyed by monitorCacheKey(profileId, monitorId). */
  states: Record<string, MonitorAlarmState>;
  isAlarmsLoading: boolean;
  alarmError: Error | null;
  /** Keyed by monitorCacheKey(profileId, monitorId). */
  recentCauses: ReadonlyMap<string, string>;
}

export function useLiveActivityAllMode(
  isAllMode: boolean,
  dwellMs: number,
  configuredPollIntervalMs: number,
  /** The page's damping-engine display list: every monitorId currently
   *  resident (on screen, mid-alarm-or-cooling) is exempt from the
   *  watched-set cap below. A reactive value (not a ref) so it is a normal,
   *  React-Compiler-safe useMemo dependency; react-hooks/refs forbids
   *  reading `ref.current` during render, which a memo callback counts as. */
  active: ActiveMonitorEntry[]
): UseLiveActivityAllModeReturn {
  const scope = useProfileScope();
  const {
    monitors: scopedMonitors,
    errors: profileErrors,
    isLoading: isMonitorsLoading,
  } = useScopedMonitors({ enabled: isAllMode });

  const profilesById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p])),
    [scope?.profiles]
  );

  // Both guardrails below are user settings living in the active aggregate's
  // bucket, which is exactly what `scope.settings` resolves to while
  // aggregating (its performance section in Settings). The fallback only
  // covers "no scope at all",
  // where nothing fans out anyway and the numbers are unused; it exists so the
  // arithmetic stays defined rather than to describe a real configuration.
  const allModeSettings = scope?.settings ?? DEFAULT_SETTINGS;

  // Both maps are one pass over the same scopedMonitors list - monitorsById
  // for the composite-keyed tile lookup, monitorsByProfile for the settings
  // dialog's per-picked-profile ignore list (full, uncapped, pre-ignore-
  // filter monitor lists).
  const { monitorsById, monitorsByProfile } = useMemo(() => {
    const byId = new Map<string, LiveActivityMonitorEntry>();
    const byProfile = new Map<ProfileId, MonitorData[]>();
    if (!isAllMode) return { monitorsById: byId, monitorsByProfile: byProfile };
    for (const { profileId, profileName, item } of scopedMonitors) {
      byId.set(monitorCacheKey(profileId, item.Monitor.Id), {
        Monitor: item.Monitor,
        Monitor_Status: item.Monitor_Status,
        profileId,
        profileChip: profileName,
      });
      const list = byProfile.get(profileId) ?? [];
      list.push(item);
      byProfile.set(profileId, list);
    }
    return { monitorsById: byId, monitorsByProfile: byProfile };
  }, [isAllMode, scopedMonitors]);

  // Raw record select (not a per-profile selector): every profile's OWN
  // liveActivityIgnoredMonitorIds is a per-server data preference, never the
  // shared ALL-bucket settings the page's poll/dwell/tiles controls use.
  const profileSettingsMap = useSettingsStore((s) => s.profileSettings);

  // Grouped by owning profile (not a flat list) so the round-robin cap below
  // can draw evenly from each profile instead of exhausting the first one.
  const watchedGroups = useMemo(() => {
    if (!isAllMode) return [];
    const byProfile = new Map<ProfileId, ScopedAlarmRef[]>();
    for (const { profileId, item } of scopedMonitors) {
      const ignored = mergeProfileSettings(profileSettingsMap[profileId]).liveActivityIgnoredMonitorIds;
      if (ignored.includes(item.Monitor.Id)) continue;
      const list = byProfile.get(profileId) ?? [];
      list.push({ profileId, monitorId: item.Monitor.Id, serverId: item.Monitor.ServerId });
      byProfile.set(profileId, list);
    }
    return Array.from(byProfile.values());
  }, [isAllMode, scopedMonitors, profileSettingsMap]);

  // GUARDRAIL: total watched cap, round-robin across profiles - the alarm
  // endpoint is per-monitor, so without this an All mode with many
  // profiles/monitors could fan out dozens of concurrent polls.
  //
  // Exempts currently-resident (mid-alarm, on screen) keys from the slice: a
  // re-slice triggered by `watchedGroups` changing (a monitor list refetch,
  // an ignore list edit) would otherwise silently drop a tile the dwell
  // window hasn't released yet - the #313 failure mode reached through the
  // cap instead of the poll. `active` in the dependency array is
  // technically wider than strictly necessary (a monitor can only become
  // resident by first being polled, i.e. by already being in
  // `watchedGroups`, so residency changing alone never NEEDS a fresh
  // recompute), but it is the React-Compiler-safe way to read it - reading
  // `activeRef.current` inside this memo instead is exactly what
  // react-hooks/refs forbids (accessing a ref's value during render).
  const activeKeys = useMemo(() => new Set(active.map((entry) => entry.monitorId)), [active]);
  const { watched: watchedPairs, overflowCount: watchOverflowCount } = useMemo(
    () =>
      capWatchedRoundRobin(watchedGroups, allModeSettings.allModeMaxWatched, {
        keyOf: (pair) => monitorCacheKey(pair.profileId, pair.monitorId),
        keys: activeKeys,
      }),
    [watchedGroups, activeKeys, allModeSettings.allModeMaxWatched]
  );

  // GUARDRAIL: poll floor. Live hints (below) carry the fast path when a
  // profile's connection is Live; polling only confirms, so All mode does
  // not need single mode's tighter floor while fanning its poll out across
  // every scope profile at once.
  const allModePollIntervalMs = Math.max(
    configuredPollIntervalMs,
    allModeSettings.allModePollFloorSeconds * 1000
  );

  const { states, isLoading: isAlarmsLoading, error: alarmError } = useScopedAlarmStates(watchedPairs, {
    enabled: isAllMode,
    pollIntervalMs: allModePollIntervalMs,
  });

  // Live-hint accelerant, generalized across every scope profile and keyed
  // by monitorCacheKey so an event for profile B's monitor "3" can never
  // promote profile A's own monitor "3". Mirrors LiveActivity.tsx's own
  // single-mode recentCauses selector below (same store, same shape), just
  // scanning every scope profile's event bucket instead of one profile id.
  //
  // ponytail: this selector rebuilds the Map on every evaluation, so
  // useShallow still re-runs the scan on unrelated notification-store
  // writes (it just avoids a re-render when the resulting Map is contents-
  // equal). Same cost, same fix if it matters, as the single-mode selector
  // this mirrors: memoize each profile's event list with a reference-stable
  // selector and build the Map in a separate useMemo keyed off that.
  const scopeProfileIds = useMemo(() => (scope?.profiles ?? []).map((p) => p.id), [scope?.profiles]);
  const recentCauses = useNotificationStore(
    useShallow((state) => {
      const causes = new Map<string, string>();
      if (!isAllMode) return causes;
      const cutoff = Date.now() - dwellMs;
      for (const profileId of scopeProfileIds) {
        const events = state.profileEvents[profileId];
        if (!events?.length) continue;
        for (const event of events) {
          if (event.receivedAt < cutoff) continue;
          const key = monitorCacheKey(profileId, String(event.MonitorId));
          if (!causes.has(key)) causes.set(key, event.Cause ?? '');
        }
      }
      return causes;
    })
  );

  return {
    monitorsById,
    monitorsByProfile,
    profilesById,
    profileErrors,
    isMonitorsLoading,
    watchedCount: watchedPairs.length,
    watchOverflowCount,
    states,
    isAlarmsLoading,
    alarmError,
    recentCauses,
  };
}
