/**
 * Live Activity.
 *
 * Only the monitors ZoneMinder currently reports as alarming, as montage
 * tiles. A monitor appears on alarm and leaves once the dwell window from its
 * last alarm closes. See lib/monitor/live-activity.ts for why the dwell
 * window exists (it protects nph-zms, not just the eye).
 *
 * All mode aggregates every scope profile's alarm fanout instead of gating
 * All mode out (refs #337, #341): single mode keeps its original
 * useAlarmStates path unchanged below (bare monitor-id keys); All mode's
 * data (useScopedAlarmStates fanout, watched-set cap, live-hint causes) is
 * assembled by useLiveActivityAllMode, keyed by monitorCacheKey(profileId,
 * monitorId) so two servers sharing a raw monitor id never collide. Both
 * feed the SAME dwell/damping engine below (reduceActiveMonitors etc., which
 * is generic over its state keys), so a single set of page state/effects
 * serves both modes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { getMonitors } from '../api/monitors';
import { getCurrentSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { useAuthSlice } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAlarmStates } from '../hooks/useAlarmStates';
import { useLiveActivityAllMode, type LiveActivityMonitorEntry } from '../hooks/useLiveActivityAllMode';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { resolvePollIntervalMs, useNotificationStore } from '../stores/notifications';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  applyLiveAlarmHints,
  releaseDismissed,
  sameMonitorOrder,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { runViewTransition } from '../lib/view-transition';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';
import type { Profile, ProfileId } from '../api/types';
import { useFullscreenMode } from '../hooks/useFullscreenMode';
import { LiveActivitySettingsDialog } from '../components/live-activity/LiveActivitySettingsDialog';
import { LiveActivityGridBody } from '../components/live-activity/LiveActivityGridBody';
import {
  LiveActivityHeader,
  LiveActivityFullscreenBar,
} from '../components/live-activity/LiveActivityChrome';
import { PageContainer } from '../components/common/PageContainer';

export default function LiveActivity() {
  const navigate = useNavigate();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  // The raw store value: the real profile id in single mode, the active
  // aggregate's id otherwise (where currentProfile above is null). View-level
  // writes that must still work while aggregating - the grid column count, fullscreen, the
  // settings dialog's own bucket - target this id rather than
  // currentProfile?.id, same pattern Montage.tsx uses (refs #337).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const authSlice = useAuthSlice(currentProfile?.id ?? null);
  const isAuthenticated = authSlice.isAuthenticated;
  const accessToken = authSlice.accessToken;
  const updateSettings = useSettingsStore((s) => s.updateProfileSettings);
  const bandwidth = useBandwidthSettings();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ---- Single mode: unchanged from before All mode existed ----

  const { data, isLoading: monitorsLoading, error: monitorsError } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(getCurrentSession().client, getCurrentSession().profileId),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.monitorStatusInterval,
  });

  // Monitors this page is allowed to watch. The profile-wide exclusion is
  // already applied inside getMonitors, so all that is left is the
  // page-specific ignore list.
  //
  // Recording mode is deliberately not consulted. A continuous recorder is
  // always inside an event, but an event is not an alarm: ZoneMinder derives
  // the alarm state from the motion score alone, so such a monitor reports
  // IDLE at rest (verified against 1.39.18, #313) and ALARM on motion like any
  // other. Servers before the 1.37 removal of TAPE report TAPE while
  // recording, which isAlarmingState already rejects. Skipping these monitors
  // only hid real alarms.
  const watchedIds = useMemo(() => {
    const ignored = new Set(settings.liveActivityIgnoredMonitorIds);
    return (data?.monitors ?? [])
      .filter(({ Monitor }) => !ignored.has(Monitor.Id))
      .map(({ Monitor }) => Monitor.Id);
  }, [data?.monitors, settings.liveActivityIgnoredMonitorIds]);

  const pollIntervalMs = resolvePollIntervalMs(
    settings.bandwidthMode,
    settings.liveActivityPollSeconds,
    'alarmStatusInterval'
  );

  // enabled stays a constant true for the page's whole lifetime (never toggled
  // off while mounted): useAlarmStates reports an empty `states` map while
  // disabled, and feeding that into reduceActiveMonitors below would drop
  // every resident monitor instantly with no dwell window, the exact tile
  // churn the dwell window exists to prevent (refs #313). watchedIds is
  // already empty in All mode (the query above is disabled there), so this
  // is a no-op fanout rather than a second gate.
  const { states, isLoading: alarmsLoading, error: alarmError } = useAlarmStates(watchedIds, {
    enabled: true,
    pollIntervalMs,
  });

  const dwellMs = settings.liveActivityDwellSeconds * 1000;

  // ---- Damped display list: fed by whichever mode is active ----
  // Held in state rather than derived during render because it depends on
  // the previous list and on the current time. Declared before
  // useLiveActivityAllMode below: that hook reads `active` to exempt
  // currently-resident monitors from its watched-set cap.
  const [active, setActive] = useState<ActiveMonitorEntry[]>([]);
  // Mirrors `active` so the updater below can read the previous list without
  // listing it as an effect dependency. `active` in the cooling effect's deps
  // would rearm the interval on every list change, and since an alarming
  // monitor's entry restamps Date.now() on each pass, that never settles.
  const activeRef = useRef<ActiveMonitorEntry[]>(active);

  // ---- All mode: scoped monitors, per-profile ignore lists, capped fanout,
  // and live-hint causes, all assembled in one hook (see its own doc
  // comment for why this stays a separate fetch path from useAlarmStates
  // above rather than one unified call).
  const allMode = useLiveActivityAllMode(isAllMode, dwellMs, pollIntervalMs, active);

  // Clock for the per-tile elapsed labels. A plain number rather than a Date
  // so an unchanged tick cannot produce a new reference, and advanced by the
  // cooling interval below rather than by a second timer of its own.
  const [now, setNow] = useState(() => Date.now());
  // Monitors the user cleared by hand. A ref rather than state, and page-local
  // rather than a profile setting: it is not a preference, nothing renders it
  // directly, and every read of it happens inside applyStates, which publishes
  // the list a dismissal actually changes. Held for the page's lifetime only,
  // so a dismissal does not outlive the visit that made it.
  const dismissedRef = useRef<ReadonlySet<string>>(new Set());

  // Websocket/push accelerant: a notification received in the last dwell
  // window promotes its monitor into the current poll snapshot immediately,
  // rather than waiting up to one poll interval for ZoneMinder to confirm it.
  // applyLiveAlarmHints only ever promotes a monitor already present in
  // `states`, so a hint for a page-ignored or profile-excluded monitor id is
  // dropped, not resurrected.
  //
  // The same pass also collects what ZoneMinder said triggered each of those
  // events, which is the only place a cause is available: the alarm poll
  // reports a state and nothing more. Values stay plain strings so useShallow
  // can compare the map entry by entry; an object per monitor would compare
  // by identity and defeat it.
  //
  // ponytail: this selector rebuilds the Map on every evaluation, so useShallow
  // still re-runs the filter/map on unrelated notification-store writes (it
  // just avoids a re-render when the resulting Map is contents-equal). If that
  // shows up as a real cost, memoize the profile's event list with a
  // reference-stable selector and build the Map in a separate useMemo keyed
  // off that list.
  const recentCauses = useNotificationStore(
    useShallow((state) => {
      const causes = new Map<string, string>();
      if (isAllMode) return causes;
      const events = currentProfile ? state.profileEvents[currentProfile.id] : undefined;
      if (!events?.length) return causes;
      const cutoff = Date.now() - dwellMs;
      // Newest first, so the first entry seen for a monitor is its latest.
      for (const event of events) {
        if (event.receivedAt < cutoff) continue;
        const monitorId = String(event.MonitorId);
        if (!causes.has(monitorId)) causes.set(monitorId, event.Cause ?? '');
      }
      return causes;
    })
  );

  // Whichever mode is active feeds the same dwell engine below.
  const effectiveStates = isAllMode ? allMode.states : states;
  const effectiveCauses = isAllMode ? allMode.recentCauses : recentCauses;

  const hintedMonitorIds = useMemo(() => new Set(effectiveCauses.keys()), [effectiveCauses]);

  const hintedStates = useMemo(
    () => applyLiveAlarmHints(effectiveStates, hintedMonitorIds),
    [effectiveStates, hintedMonitorIds]
  );

  // Runs the dwell policy and publishes the result. Identity-stable (no deps):
  // both effects below list it, and an identity that changed per render would
  // tear the one-second interval down before its 1000ms ever elapsed.
  const applyStates = useCallback(
    (
      statesNow: Record<string, MonitorAlarmState>,
      dwell: number,
      causes: ReadonlyMap<string, string>
    ) => {
      const prev = activeRef.current;
      const next = reduceActiveMonitors(prev, statesNow, Date.now(), dwell, {
        causes,
        dismissed: dismissedRef.current,
      });
      // Released after the reduce, never before it: a tile dismissed while it
      // was already cooling is not alarming, so releasing first would clear
      // the dismissal in the same pass that was supposed to honour it and the
      // tile would survive its own dismissal.
      dismissedRef.current = releaseDismissed(dismissedRef.current, statesNow);
      // reduceActiveMonitors hands back the same array when nothing moved, so
      // a poll tick that changed nothing costs no render at all.
      if (next === prev) return;
      activeRef.current = next;

      // Only tiles arriving, leaving, or swapping rows is worth a transition;
      // a state or count change happens in place and animates via CSS.
      if (sameMonitorOrder(prev, next)) {
        setActive(next);
        return;
      }
      runViewTransition(() => setActive(next));
    },
    []
  );

  useEffect(() => {
    applyStates(hintedStates, dwellMs, effectiveCauses);
  }, [hintedStates, dwellMs, effectiveCauses, applyStates]);

  // Removal goes back through the reducer rather than being filtered out at
  // render time, so a dismissed tile unmounts for real and its stream is quit
  // instead of being left running behind a hidden element.
  const handleDismiss = useCallback(
    (monitorId: string) => {
      dismissedRef.current = new Set(dismissedRef.current).add(monitorId);
      applyStates(hintedStates, dwellMs, effectiveCauses);
    },
    [hintedStates, dwellMs, effectiveCauses, applyStates]
  );

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  // The same tick advances the clock the elapsed labels read: a second
  // interval for those would run alongside this one for the same reason and
  // at the same rate, and this one is already scoped to exactly when tiles
  // exist.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      applyStates(hintedStates, dwellMs, effectiveCauses);
    }, 1000);
    return () => clearInterval(timer);
  }, [active.length, hintedStates, dwellMs, effectiveCauses, applyStates]);

  const { visible, overflowCount } = capActiveMonitors(active, settings.liveActivityMaxTiles);

  // Tile lookup: single mode keyed by the bare monitor id (this page's own
  // monitors query above); All mode keyed by monitorCacheKey, built by
  // useLiveActivityAllMode so two profiles' monitor "3" never collide (refs
  // #337, #341). Only one side is ever non-empty for a given render.
  const monitorsById = useMemo(() => {
    if (isAllMode) return allMode.monitorsById;
    const map = new Map<string, LiveActivityMonitorEntry>();
    for (const m of data?.monitors ?? []) {
      map.set(m.Monitor.Id, { Monitor: m.Monitor, Monitor_Status: m.Monitor_Status });
    }
    return map;
  }, [isAllMode, allMode.monitorsById, data?.monitors]);

  // The tile's owning profile: its own server in All mode, the page's
  // current profile in single mode - same resolver shape as Montage.tsx.
  const resolveOwnerProfile = useCallback(
    (profileId: ProfileId | undefined): Profile | null =>
      profileId ? allMode.profilesById.get(profileId) ?? null : currentProfile,
    [allMode.profilesById, currentProfile]
  );

  // Shares monitorGridCols with the Monitors page rather than a dedicated
  // liveActivityGridCols setting: one grid-density preference per user is
  // simpler than two, and there is nothing page-specific about column count
  // the way there is for poll/dwell/tiles/ignore list.
  const handleGridChange = useCallback((cols: number) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, { monitorGridCols: cols });
  }, [currentProfileId, updateSettings]);

  const {
    gridCols,
    isCustomGridDialogOpen,
    setIsCustomGridDialogOpen,
    customCols,
    setCustomCols,
    handleApplyGridLayout,
    handleCustomGridSubmit,
  } = useEventMontageGrid({
    initialCols: settings.monitorGridCols,
    containerRef: gridContainerRef,
    onGridChange: handleGridChange,
  });

  // Tile heights are computed in pixels (see lib/monitor/live-activity-layout
  // .ts), so the grid has to be measured. useEventMontageGrid reads the same
  // element, but only to decide whether a column count fits, and never reports
  // the width, so this measures it and keeps that hook's ref pointed at the
  // same element.
  const { width: gridWidth, setElement: setGridElement } = useMeasuredWidth(gridContainerRef);

  // Its own settings key, not montageIsFullscreen: a shared flag would make
  // going fullscreen here put the Montage page in fullscreen too.
  const { isFullscreen, handleToggleFullscreen } = useFullscreenMode({
    profileId: currentProfileId,
    settings,
    settingKey: 'liveActivityIsFullscreen',
  });

  // Aggregating only: every scope profile plus its own full monitor list,
  // for the settings dialog's ignore-list section (which edits a PICKED
  // profile's own bucket via ProfilePicker, never the aggregate's - refs
  // #337). Undefined in single mode, where the dialog keeps reading/writing
  // `monitors`/`profileId` directly as it always has.
  const scopeProfiles = useMemo(() => {
    if (!isAllMode) return undefined;
    return Array.from(allMode.profilesById.values()).map((profile) => ({
      profile,
      monitors: allMode.monitorsByProfile.get(profile.id) ?? [],
    }));
  }, [isAllMode, allMode.profilesById, allMode.monitorsByProfile]);

  const watchedCount = isAllMode ? allMode.watchedCount : watchedIds.length;
  const error = isAllMode
    ? (allMode.profileErrors[0]?.error ?? allMode.alarmError)
    : (monitorsError ?? alarmError);
  const isLoadingFanout = isAllMode
    ? (allMode.isMonitorsLoading || allMode.isAlarmsLoading)
    : (monitorsLoading || alarmsLoading);

  // "All quiet" is a claim about the server, so it is only honest once the
  // page has heard from it. An unreachable server leaves visible empty and
  // isLoadingFanout false, and a failing alarm fanout dwells every tile out,
  // so without this gate an outage reads as a confident "nothing is
  // alarming" next to the error banner: the worst possible false negative
  // for a page whose whole job is answering that question.
  const isEmpty = visible.length === 0;
  const showSkeleton = isEmpty && isLoadingFanout;
  const showEmptyState = isEmpty && !showSkeleton && !error;

  // The grid and everything that stands in for it, shared by both chrome
  // treatments below so fullscreen cannot drift from the normal page.
  const body = (
    <LiveActivityGridBody
        hoverPreview={settings.hoverPreview.liveActivity}
      error={error}
      showSkeleton={showSkeleton}
      showEmptyState={showEmptyState}
      isEmpty={isEmpty}
      watchedCount={watchedCount}
      gridCols={gridCols}
      gridWidth={gridWidth}
      setGridElement={setGridElement}
      visible={visible}
      monitorsById={monitorsById}
      resolveOwnerProfile={resolveOwnerProfile}
      accessToken={accessToken}
      navigate={navigate}
      now={now}
      onDismiss={handleDismiss}
      overflowCount={overflowCount}
      watchOverflowCount={isAllMode ? allMode.watchOverflowCount : 0}
      groupByScopeId={isAllMode && settings.monitorsGroupByServer ? currentProfileId ?? undefined : undefined}
    />
  );

  // Fullscreen drops the page chrome the way Montage does: the app frame is
  // covered edge to edge and the only control left is the thin translucent
  // bar, so a wall display shows tiles and nothing else.
  if (isFullscreen) {
    return (
      <div
        className="fixed inset-0 z-40 bg-black flex flex-col"
        data-testid="live-activity-fullscreen"
      >
        <LiveActivityFullscreenBar onExit={() => handleToggleFullscreen(false)} />
        <div className="flex-1 overflow-auto p-2">
          {body}
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <LiveActivityHeader
        gridCols={gridCols}
        customCols={customCols}
        isCustomGridDialogOpen={isCustomGridDialogOpen}
        onApplyGridLayout={handleApplyGridLayout}
        onCustomColsChange={setCustomCols}
        onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
        onCustomGridSubmit={handleCustomGridSubmit}
        onEnterFullscreen={() => handleToggleFullscreen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {currentProfileId && (
        <LiveActivitySettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          profileId={currentProfileId}
          monitors={data?.monitors ?? []}
          scopeProfiles={scopeProfiles}
        />
      )}

      {body}
    </PageContainer>
  );
}
