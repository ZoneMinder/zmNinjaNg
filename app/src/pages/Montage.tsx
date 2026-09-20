/**
 * Montage Page
 *
 * Displays a customizable grid of live monitor streams.
 * Supports drag-and-drop layout, resizing, and fullscreen mode.
 */

import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { useMonitorNewEvents, useScopedMonitorNewEvents, scopedMonitorEventKey } from '../hooks/useMonitorNewEvents';
import { useAuthSlice } from '../stores/auth';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useTvMode } from '../hooks/useTvMode';
import { Button } from '../components/ui/button';
import { Video, Maximize, Pencil, ArrowLeftRight, Layers } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { EmptyState } from '../components/ui/empty-state';
import { filterMonitorsByGroup } from '../lib/monitor/filters';
import { allocateStreamBudget } from '../lib/monitor/stream-budget';
import { useMonitorPaging } from '../hooks/useMonitorPaging';
import { MonitorPageControls } from '../components/monitors/MonitorPageControls';
import { useHiddenPause } from '../hooks/useHiddenPause';
import { useIdleAfter } from '../hooks/useIdleAfter';
import { useViewportGating } from '../hooks/useViewportGating';
import { MONITOR_PAGING, MONTAGE_GRID } from '../lib/zmninja-ng-constants';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { useMontageGroupState } from '../hooks/useMontageGroupState';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { cn } from '../lib/utils';
import { groupByOwningProfile } from '../lib/profile/profile-sections';
import { useTranslation } from 'react-i18next';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { useInsomnia } from '../hooks/useInsomnia';
import { NotificationBadge } from '../components/NotificationBadge';
import type { Layout } from 'react-grid-layout';
import type { Profile, MonitorData, ProfileId } from '../api/types';

// Extracted hooks and components
import {
  GridLayoutControls,
  FullscreenControls,
  MontageKebabMenu,
  MontageErrorStrips,
  MontageGridSections,
  useMontageGrid,
  useContainerResize,
  useMontageVisibilityItems,
  type MontageTileItem,
  type MontageGroupedSections,
} from '../components/montage';
import { ScrollPad } from '../components/ui/scroll-pad';
import { NinjiiToolbarButton } from '../components/assistant/NinjiiToolbarButton';
import { useScrollPad } from '../hooks/useScrollPad';
import { useFullscreenMode } from '../hooks/useFullscreenMode';
import { tileIdFor } from '../components/montage/hooks/useMontageGrid';

export default function Montage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  const authSlice = useAuthSlice(currentProfile?.id ?? null);
  const accessToken = authSlice.accessToken;
  // Settings-update target: the real profile id in single mode, the active
  // aggregate's id while aggregating (currentProfile stays null there) - same
  // resolution Monitors.tsx uses for its server-grouping toggle.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);

  const scope = useProfileScope();
  // Owning-profile lookup for All-mode tiles: MontageMonitor needs the real
  // Profile object (zmVersion, settings, go2rtcUrl all key off its id), not
  // just the id useScopedMonitors tags each tile with.
  const profilesById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p])),
    [scope]
  );

  // Single code path for both modes, same as Monitors.tsx: one profile in
  // single mode, N in All mode, sharing useMonitors' queryKeys.monitors(id)
  // cache entry. Already filters to enabled monitors (refs #337).
  const {
    monitors: scopedMonitors,
    errors: profileErrors,
    isLoading: scopedLoading,
    refetchProfile,
  } = useScopedMonitors();

  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const { isFilterActive, filteredMonitorIds, isFilterReady } = useGroupFilter();
  // update() writes the active group's montage bucket against currentProfileId,
  // so every montage-layout write below goes through one path in both modes.
  const { groupKey, bucket, update: updateGroupLayout } = useMontageGroupState();

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Detect mobile viewport
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Hidden tiles, keyed exactly like the tiles themselves (tileIdFor): bare
  // monitor ids in single mode - so lists stored before All mode existed keep
  // working - and composite profileId:monitorId ids in the aggregate's own
  // bucket, where
  // two servers sharing a raw monitor id would otherwise hide each other's
  // tile (refs #337).
  const hiddenSet = useMemo(
    () => new Set(bucket.hiddenMonitorIds),
    [bucket.hiddenMonitorIds]
  );

  // Raw per-profile monitor counts, independent of any filter/cap below:
  // decides whether a profile's error strip shows (a profile filtered/capped
  // to zero tiles still "has data"), mirroring Monitors.tsx.
  const monitorCountByProfile = useMemo(() => {
    const counts = new Map<ProfileId, number>();
    for (const s of scopedMonitors) {
      counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1);
    }
    return counts;
  }, [scopedMonitors]);

  // The kebab's show-monitors list. Built from the FULL monitor list, never
  // the group-filtered `monitors` below - see the hook for why.
  const visibilityItems = useMontageVisibilityItems(scopedMonitors, isAllMode);

  const monitors = useMemo((): MontageTileItem[] => {
    if (isAllMode) {
      // Group filter is current-profile-scoped (Monitors.tsx precedent) - All
      // mode skips it until it is extended across servers.
      return scopedMonitors.map((s) => ({
        Monitor: s.item.Monitor,
        Monitor_Status: s.item.Monitor_Status,
        profileId: s.profileId,
        profileChip: s.profileName,
      }));
    }
    let list: MonitorData[] = scopedMonitors.map((s) => ({ Monitor: s.item.Monitor, Monitor_Status: s.item.Monitor_Status }));
    // When a group filter is active, show only its monitors. An empty id list
    // means the group resolved to nothing (or groups have not loaded yet), so
    // render none rather than falling back to streaming every monitor.
    if (isFilterActive) {
      list = filteredMonitorIds.length > 0
        ? filterMonitorsByGroup(list, filteredMonitorIds)
        : [];
    }
    return list;
  }, [isAllMode, scopedMonitors, isFilterActive, filteredMonitorIds]);

  // tileIdFor degrades to the bare monitor id when the tile has no profileId,
  // which is every tile in single mode - so one expression covers both modes.
  const visibleMonitors = useMemo(
    () => (hiddenSet.size > 0 ? monitors.filter((m) => !hiddenSet.has(tileIdFor(m))) : monitors),
    [monitors, hiddenSet]
  );

  // Edit mode state lifted to page level. Declared here because paging below
  // turns itself off for it.
  const [isEditMode, setIsEditMode] = useState(false);

  // Paging (refs #507): the slice happens BEFORE the stream budget below, not
  // after. A budget spent on the whole list and then paged would give page 1
  // the twelve tiles it allowed and page 2 the four that were left; paging
  // first hands each page its own budget, and in single mode - which has no
  // budget at all - this is the only bound on how many tiles mount.
  //
  // Editing shows the WHOLE montage, never a page. Every layout write - a drag,
  // a resize, apply-columns, fill-width, loading a saved layout - persists the
  // layout react-grid-layout reports, and rgl only knows the tiles it was
  // given. Paged, that array holds one page, so any reshape would write a
  // `workingLayout` missing every other page and silently discard positions the
  // user arranged (I2). Showing everything while editing keeps those six paths
  // seeing the whole list, which is what they have always assumed.
  //
  // Which page resets when the scope or the group filter changes, since page 4
  // of the previous list says nothing about this one.
  const paging = useMonitorPaging({
    items: visibleMonitors,
    pageSize: isEditMode ? MONITOR_PAGING.off : settings.monitorsPerPage,
    resetKey: `${currentProfileId ?? ''}:${groupKey}`,
  });

  // Stream cap (refs #337, Phase 4 Task 1): All mode only - single mode stays
  // unlimited (byte-identical). Without it, N profiles each contributing every
  // enabled monitor could open dozens of simultaneous streams across
  // independent servers at once.
  //
  // The limit comes from the active aggregate's bucket (its performance
  // section in Settings),
  // which `settings` already is while aggregating; it is only read inside the
  // isAllMode branch, so a single profile's own copy of the key never applies
  // to anything. mergeProfileSettings has already clamped it.
  //
  // allocateStreamBudget shares those slots across the servers in scope
  // instead of handing the first N to whichever server sorts first; the total
  // is the same, so the overflow count still describes the dropped tiles.
  const maxStreams = settings.allModeMaxStreams;
  const overflowCount = isAllMode && paging.items.length > maxStreams
    ? paging.items.length - maxStreams
    : 0;
  // Memoized so the query-input memos below keep their identity across a
  // render that changed nothing about which tiles are on screen.
  const cappedMonitors = useMemo(
    () =>
      overflowCount > 0
        ? allocateStreamBudget(paging.items, maxStreams, (m) => m.profileId ?? '')
        : paging.items,
    [overflowCount, paging.items, maxStreams]
  );

  // Reduced stream tuning (refs #337): another ALL-bucket knob, so it is read
  // inside the isAllMode branch for the same reason the cap is - a single
  // profile carries the same key and must never be throttled by it.
  const reduceStream = isAllMode && settings.allModeStreamTuning === 'reduced';

  // Pause while hidden (refs #337): one page-level visibility watch, not one
  // per tile. Leaving All mode or turning the knob off resumes, so tiles
  // cannot be stranded paused.
  const paused = useHiddenPause(
    isAllMode && settings.allModePauseHidden,
    MONTAGE_GRID.pauseHiddenGraceMs
  );

  // Idle downgrade (refs #337): after allModeIdleMinutes with no pointer, key
  // or touch activity, tiles fall back to periodic snapshots on the existing
  // Streaming Mode path - the same one the user's own setting drives - and any
  // activity puts them back. One page-level listener covers every tile.
  //
  // Independent of insomnia by design: a montage left running on a display
  // insomnia is keeping awake is exactly what this is for.
  const isIdle = useIdleAfter(
    isAllMode ? settings.allModeIdleMinutes : 0,
    MONTAGE_GRID.idleActivityThrottleMs
  );

  // useMonitorNewEvents stays current-profile-scoped for single mode; All mode
  // fans the equivalent query out per owning profile (Monitors.tsx precedent).
  const monitorIds = useMemo(
    () => (isAllMode ? [] : cappedMonitors.map(({ Monitor }) => Monitor.Id)),
    [isAllMode, cappedMonitors]
  );
  const { counts: newEventCounts, newest: newestEventAt } = useMonitorNewEvents(monitorIds);

  const scopedMonitorRefs = useMemo(
    () =>
      isAllMode
        ? cappedMonitors
            .filter((item): item is MontageTileItem & { profileId: ProfileId } => item.profileId !== undefined)
            .map(({ Monitor, profileId }) => ({ profileId, monitorId: Monitor.Id }))
        : [],
    [isAllMode, cappedMonitors]
  );
  const { counts: scopedNewEventCounts, newest: scopedNewestEventAt } =
    useScopedMonitorNewEvents(scopedMonitorRefs);

  // Edit mode shows the pad whatever the setting says: a drag there reorders
  // tiles rather than scrolling, which is a fact about the mode rather than a
  // preference. The kebab entry writes the remembered setting (refs #365).
  const [showScrollPad, toggleScrollPad] = useScrollPad(isEditMode);

  // Active saved layout name (persisted in settings)
  const activeLayoutName = bucket.activeLayoutName;

  // Monitor label overlay toggle for fullscreen mode
  const [showMonitorLabels, setShowMonitorLabels] = useState(false);

  // Toolbar visibility (controlled from app header eye button)
  const showToolbar = settings.montageShowToolbar;

  // Fullscreen mode. currentProfileId (not currentProfile.id): the real
  // profile id in single mode, the active aggregate's id otherwise, where
  // currentProfile itself is null (refs #337).
  const { isFullscreen, handleToggleFullscreen } =
    useFullscreenMode({
      profileId: currentProfileId,
      settings,
      settingKey: 'montageIsFullscreen',
    });


  // Grid layout management
  const {
    layout,
    gridCols,
    currentWidthRef,
    handleApplyGridLayout,
    handleLoadSavedLayout,
    handleLayoutChange,
    handleDragStop,
    handleFillWidth,
    handleResizeStop,
    handleWidthChange,
    togglePinMonitor,
    isMonitorPinned,
  } = useMontageGrid({
    monitors: cappedMonitors,
    profileId: currentProfileId,
    settings,
    isEditMode,
    groupKey,
    // In fullscreen the tile header is an absolute overlay and takes no flow
    // space; in normal mode it is in flow at the height the display mode
    // actually renders (refs #359).
    tileHeaderPx: isFullscreen
      ? 0
      : settings.displayMode === 'compact'
        ? MONTAGE_GRID.cardHeaderHeightCompactPx
        : MONTAGE_GRID.cardHeaderHeightPx,
  });

  // Tile render resolvers passed to MontageGridSections: the owning profile
  // and event-badge counts differ by mode (All mode reads its own server /
  // scoped counts, single mode reads currentProfile / the page's own
  // counts), so the extracted component stays agnostic of that branching.
  const resolveOwnerProfile = useCallback(
    (profileId: ProfileId | undefined): Profile | null =>
      profileId ? profilesById.get(profileId) ?? null : currentProfile,
    [profilesById, currentProfile]
  );
  const resolveNewEventCount = useCallback(
    (item: MontageTileItem): number | undefined =>
      item.profileId
        ? scopedNewEventCounts[scopedMonitorEventKey(item.profileId, item.Monitor.Id)]
        : newEventCounts[item.Monitor.Id],
    [scopedNewEventCounts, newEventCounts]
  );
  const resolveNewestEventAt = useCallback(
    (item: MontageTileItem): string | null | undefined =>
      item.profileId
        ? scopedNewestEventAt[scopedMonitorEventKey(item.profileId, item.Monitor.Id)]
        : newestEventAt[item.Monitor.Id],
    [scopedNewestEventAt, newestEventAt]
  );

  // Container resize observation
  const { containerRef } = useContainerResize({
    onWidthChange: handleWidthChange,
    currentWidthRef,
  });

  // The same element also scrolls, and the scroll pad needs to reach it.
  // Composed in a stable callback so the resize observer is not torn down and
  // re-attached on every render.
  //
  // Also kept in state, not only in the ref: the viewport gating below roots
  // its observer on this element and has to build one the moment it exists,
  // which a ref alone cannot announce.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollContainer, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const setScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollContainerRef.current = element;
      setScrollContainerEl(element);
      containerRef(element);
    },
    [containerRef]
  );

  // Viewport gating (refs #337): All mode only. A tile scrolled out of the
  // container (plus a container's worth of margin) holds no connection at
  // all, and comes back as it returns.
  //
  // This runs AFTER the stream budget above, and the ordering is the point:
  // the budget decides which tiles exist, gating decides which of those hold
  // a connection. A tile the budget dropped never reaches here, and a tile
  // gated here still counts against the budget - so scrolling cannot promote
  // an overflow monitor into the grid.
  const { isTileGated, registerTile } = useViewportGating({
    enabled: isAllMode && settings.allModeViewportGating,
    root: scrollContainer,
    rootMargin: MONTAGE_GRID.viewportGatingRootMargin,
    lingerMs: MONTAGE_GRID.viewportGatingLingerMs,
  });

  // TV mode D-pad grid navigation
  const { isTvMode } = useTvMode();
  const [focusedMonitorIndex, setFocusedMonitorIndex] = useState(0);

  // Estimate columns from gridCols (display columns)
  const estimatedCols = gridCols;

  const handleDpadNav = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      setFocusedMonitorIndex((prev) => {
        const total = cappedMonitors.length;
        if (total === 0) return 0;
        let next = prev;
        switch (direction) {
          case 'left':
            next = prev - 1;
            break;
          case 'right':
            next = prev + 1;
            break;
          case 'up':
            next = prev - estimatedCols;
            break;
          case 'down':
            next = prev + estimatedCols;
            break;
        }
        return Math.max(0, Math.min(total - 1, next));
      });
    },
    [cappedMonitors.length, estimatedCols]
  );

  const handleDpadEnter = useCallback(() => {
    const mon = cappedMonitors[focusedMonitorIndex];
    if (mon) {
      navigate(
        mon.profileId ? `/all/monitors/${mon.profileId}/${mon.Monitor.Id}` : `/monitors/${mon.Monitor.Id}`,
        { state: { from: '/montage' } }
      );
    }
  }, [cappedMonitors, focusedMonitorIndex, navigate]);

  useTvKeyHandler({
    ArrowLeft: () => handleDpadNav('left'),
    ArrowRight: () => handleDpadNav('right'),
    ArrowUp: () => handleDpadNav('up'),
    ArrowDown: () => handleDpadNav('down'),
    Enter: handleDpadEnter,
  });

  // Focus the monitor element when index changes in TV mode
  useEffect(() => {
    if (!isTvMode || cappedMonitors.length === 0) return;
    const focused = cappedMonitors[focusedMonitorIndex];
    if (!focused) return;
    const el = document.querySelector(
      `[data-testid="montage-monitor-${tileIdFor(focused)}"]`
    ) as HTMLElement | null;
    el?.focus();
  }, [isTvMode, focusedMonitorIndex, cappedMonitors]);

  // Pinch-to-zoom (disabled in fullscreen to avoid gesture conflicts)
  const pinchZoom = usePinchZoom({
    minScale: 0.5,
    maxScale: 3,
    initialScale: 1,
    enabled: !isFullscreen,
  });

  const handleApplyGridLayoutWithClear = (cols: number) => {
    handleApplyGridLayout(cols);
    updateGroupLayout({ activeLayoutName: null });
  };

  const handleFeedFitChange = (value: string) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, {
      montageFeedFit: value as typeof settings.montageFeedFit,
    });
  };

  // Saved layout handlers
  const handleSaveLayout = (name: string) => {
    const entry = { name, layout: [...layout], displayCols: gridCols };
    updateGroupLayout({
      savedLayouts: [...bucket.savedLayouts, entry],
      activeLayoutName: name,
    });
  };

  const handleLoadLayout = (saved: { name: string; layout: Layout[]; displayCols: number }) => {
    handleLoadSavedLayout(saved.layout, saved.displayCols);
    updateGroupLayout({ activeLayoutName: saved.name });
  };

  const handleDeleteLayout = (index: number) => {
    const saved = [...bucket.savedLayouts];
    saved.splice(index, 1);
    updateGroupLayout({ savedLayouts: saved });
  };

  // Hiding a tile needs no per-server persistence: the ids are composite
  // while aggregating, so the whole list lives in the active aggregate's own
  // bucket, and bare ids keep going to the real profile in single mode
  // (refs #337).
  const handleToggleMonitorVisibility = useCallback(
    (id: string) => {
      const current = bucket.hiddenMonitorIds;
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateGroupLayout({ hiddenMonitorIds: next });
    },
    [bucket.hiddenMonitorIds, updateGroupLayout]
  );

  const handleEditModeToggle = () => {
    setIsEditMode((prev) => !prev);
  };

  // Loading state. Also wait until the group filter has resolved (isFilterReady)
  // so we never mount monitor tiles against an unresolved group membership.
  // Mounting a tile starts its stream, so rendering all monitors for even one
  // frame before the group narrows would open every stream. isLoading never
  // clears on its own once any profile has errored (see useScopedMonitors),
  // so a profile that errored still falls through to the states below instead
  // of spinning forever (refs #337, Monitors.tsx Task 4 finding).
  const stillWaiting = scopedLoading && profileErrors.length === 0;
  if (stillWaiting || (!isAllMode && !isFilterReady)) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-video bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Single mode only: byte-identical to the pre-existing cold-start error
  // wall. scopedLoading only stays true until the (one, in single mode)
  // profile's monitors query has ever produced data - the same condition the
  // old `!data` check captured. All mode gets per-profile strips below
  // instead, added underneath the grid rather than replacing it, since one
  // failed server should not hide every other server's healthy tiles.
  if (!isAllMode && profileErrors.length > 0 && scopedLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
        </div>
        <ErrorBanner message={resolveQueryError(profileErrors[0].error, t)} />
      </div>
    );
  }

  // Empty state, keyed off the PRE-hide list. Keying it off the visible tiles
  // made hiding every monitor a one-way door: this branch renders no toolbar,
  // so the kebab that would un-hide them was gone and nothing else in the app
  // edits that list. With monitors present but all hidden the page renders
  // normally and says so under the toolbar instead (refs #337).
  if (monitors.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
          <RefreshButton size="sm" />
        </div>
        <EmptyState icon={Video} title={t('montage.no_monitors')} />
      </div>
    );
  }

  // Per-profile errors, All mode only (single mode keeps the byte-identical
  // cold-start wall above and otherwise stays silent, same as before this
  // task - refs #337, Phase 4 Task 1). One strip per profile whose query
  // failed AND produced zero monitors; a profile with cached data and a
  // background refetch error renders that data with no strip, same
  // zero-data-suppression semantics as Monitors.tsx.
  const visibleErrors = isAllMode
    ? profileErrors.filter((err) => (monitorCountByProfile.get(err.profileId) ?? 0) === 0)
    : [];

  // Section cappedMonitors by owning server when the toggle is on. All mode
  // only - single mode never has more than one profile to group by. The
  // actual grid/tile rendering lives in MontageGridSections (extracted,
  // refs #337 Phase 4 Task 1 fix round 1); this stays here since it depends
  // on isAllMode/settings the same way visibleErrors above does.
  const groupedSections: MontageGroupedSections | null = isAllMode && settings.monitorsGroupByServer
    ? groupByOwningProfile(cappedMonitors)
    : null;

  return (
    <div
      className={cn(
        isFullscreen
          ? 'fixed inset-0 z-40 bg-black flex flex-col'
          : 'flex flex-col bg-background relative'
      )}
    >
      {/* Header - Hidden in fullscreen mode */}
      {!isFullscreen && (
        <>
          {/* Toolbar row - toggleable via eye button in app header */}
          {showToolbar && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm shrink-0 z-10">
              {isAllMode ? (
                <Button
                  variant={settings.monitorsGroupByServer ? 'default' : 'outline'}
                  size="icon"
                  className="h-8 sm:h-9 w-8 sm:w-9"
                  aria-pressed={settings.monitorsGroupByServer}
                  title={t('monitors.group_by_server')}
                  aria-label={t('monitors.group_by_server')}
                  onClick={() => {
                    if (!currentProfileId) return;
                    // Aggregate-bucket setting (currentProfile is null while
                    // aggregating) -
                    // reuses Monitors.tsx's server-grouping toggle rather than
                    // a new montage-only field (refs #337, Phase 4 Task 1).
                    updateSettings(currentProfileId, {
                      monitorsGroupByServer: !settings.monitorsGroupByServer,
                    });
                  }}
                  data-testid="montage-group-by-server"
                >
                  <Layers className="h-4 w-4" />
                </Button>
              ) : (
                <GroupFilterSelect />
              )}
              <GridLayoutControls
                isMobile={isMobile}
                gridCols={gridCols}
                activeLayoutName={activeLayoutName}
                onApplyGridLayout={handleApplyGridLayoutWithClear}
                savedLayouts={bucket.savedLayouts}
                onSaveLayout={handleSaveLayout}
                onLoadLayout={handleLoadLayout}
                onDeleteLayout={handleDeleteLayout}
              />
              <Button
                onClick={handleEditModeToggle}
                variant={isEditMode ? 'default' : 'outline'}
                aria-pressed={isEditMode}
                size="sm"
                className="h-8 sm:h-9"
                title={isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                data-testid="montage-edit-toggle"
              >
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                </span>
              </Button>
              {isEditMode && (
                <Button
                  onClick={handleFillWidth}
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 sm:h-9 sm:w-9"
                  title={t('montage.fill_width', 'Fill Width')}
                  aria-label={t('montage.fill_width', 'Fill Width')}
                  data-testid="montage-fill-width"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              )}
              <Button
                onClick={() => handleToggleFullscreen(true)}
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                title={t('montage.fullscreen')}
                aria-label={t('montage.fullscreen')}
                data-testid="montage-fullscreen-button"
              >
                <Maximize className="h-4 w-4" />
              </Button>
              <NinjiiToolbarButton />
              {/* Only once there is a second page, so a montage that fits looks
                  exactly as it did before paging existed (refs #507). */}
              {paging.isPaged && (
                <MonitorPageControls
                  page={paging.page}
                  pages={paging.pages}
                  onGoToPage={paging.goToPage}
                  testIdPrefix="montage"
                />
              )}
              <RefreshButton size="sm" className="h-8 sm:h-9" data-testid="montage-refresh-button" />
              <MontageKebabMenu
                items={visibilityItems}
                hiddenMonitorIds={bucket.hiddenMonitorIds}
                onToggleVisibility={handleToggleMonitorVisibility}
                scrollPadOn={showScrollPad}
                onToggleScrollPad={toggleScrollPad}
                feedFit={settings.montageFeedFit}
                onFeedFitChange={handleFeedFitChange}
              />
              <NotificationBadge />
            </div>
          )}
        </>
      )}

      {/* Fullscreen toolbar: always visible, thin, translucent */}
      {isFullscreen && (
        <FullscreenControls
          onExitFullscreen={() => handleToggleFullscreen(false)}
          showLabels={showMonitorLabels}
          onToggleLabels={() => setShowMonitorLabels((prev) => !prev)}
        />
      )}

      {/* Per-profile errors: All mode only, see visibleErrors above. */}
      {!isFullscreen && <MontageErrorStrips errors={visibleErrors} onRetry={refetchProfile} />}

      {/* Grid Content */}
      <div
        ref={setScrollContainer}
        {...pinchZoom.bind()}
        className={cn(
          'flex-1 overflow-auto bg-muted/10',
          isFullscreen
            ? 'pt-[calc(var(--fullscreen-toolbar-h)+var(--sai-top,env(safe-area-inset-top)))] overscroll-contain'
            : 'touch-pan-y'
        )}
      >
        <div
          style={{
            transform: `scale(${pinchZoom.scale})`,
            transformOrigin: 'top left',
            transition: pinchZoom.isPinching ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          {/* Not in fullscreen: the notice tells the user to reach for the
              kebab's show-monitors list, and fullscreen's own thin toolbar
              carries no kebab. Pointing at a control that is not on screen is
              worse than an empty grid the user put there deliberately. */}
          {cappedMonitors.length === 0 && !isFullscreen && (
            <div data-testid="montage-all-hidden">
              <EmptyState
                icon={Video}
                title={t('montage.all_hidden', { label: t('montage.menu_show_monitors') })}
              />
            </div>
          )}
          <MontageGridSections
            cappedMonitors={cappedMonitors}
            groupedSections={groupedSections}
            scopeId={currentProfileId}
            layout={layout}
            gridCols={gridCols}
            isEditMode={isEditMode}
            overflowCount={overflowCount}
            onLayoutChange={handleLayoutChange}
            onDragStop={handleDragStop}
            onResizeStop={handleResizeStop}
            navigate={navigate}
            isFullscreen={isFullscreen}
            isTvMode={isTvMode}
            focusedMonitorIndex={focusedMonitorIndex}
            showMonitorLabels={showMonitorLabels}
            objectFit={settings.montageFeedFit}
            accessToken={accessToken}
            isMonitorPinned={isMonitorPinned}
            onPinToggle={togglePinMonitor}
            resolveOwnerProfile={resolveOwnerProfile}
            resolveNewEventCount={resolveNewEventCount}
            resolveNewestEventAt={resolveNewestEventAt}
            reduceStream={reduceStream}
            paused={paused}
            isTileGated={isTileGated}
            registerTile={registerTile}
            forceViewMode={isIdle ? 'snapshot' : undefined}
          />
        </div>
      </div>

      {showScrollPad && !isFullscreen && <ScrollPad targetRef={scrollContainerRef} />}
    </div>
  );
}
