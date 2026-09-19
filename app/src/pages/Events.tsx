/**
 * Events Page
 *
 * Displays a list of events with filtering and infinite scrolling.
 * Uses virtualization for performance with large lists.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import type { EventFilters } from '../api/events';
import type { ProfileId } from '../api/types';
import { getCurrentSession } from '../services/sessions';
import { getMonitors } from '../api/monitors';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedEvents } from '../hooks/useScopedEvents';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { useProfileStore } from '../stores/profile';
import { useAuthSlice } from '../stores/auth';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { useSettingsStore, ALL_GROUPS_KEY, DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT } from '../stores/settings';
import { useEventFilters, ALL_TAGS_FILTER_ID } from '../hooks/useEventFilters';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useEventPagination } from '../hooks/useEventPagination';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { useScopedTags, useScopedEventTagMapping, type ScopedEventRef } from '../hooks/useScopedEventTags';
import { scopedEventKey } from '../lib/event/scoped-event-key';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { PullToRefreshIndicator } from '../components/ui/pull-to-refresh-indicator';
import { Button } from '../components/ui/button';
import { Filter, ArrowLeft, LayoutGrid, List, Clock, X, Crop, Layers } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { filterMonitorsByGroup, includedMonitorIdParam } from '../lib/monitor/filters';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { Popover, PopoverTrigger } from '../components/ui/popover';
import { EventHeatmap } from '../components/events/EventHeatmap';
import { eventInstant } from '../lib/event/event-instant';
import { EventMontageView } from '../components/events/EventMontageView';
import { EventListView, type ScopedEventItem } from '../components/events/EventListView';
import { EventsAllModeBar } from '../components/events/EventsAllModeBar';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { NinjiiToolbarButton } from '../components/assistant/NinjiiToolbarButton';
import { EventsFilterPopover } from '../components/events/EventsFilterPopover';
import { QuickDateRangeButtons } from '../components/ui/quick-date-range-buttons';
import { useTranslation } from 'react-i18next';
import { formatForServer, formatLocalDateTimeSeconds } from '../lib/time';
import { EmptyState } from '../components/ui/empty-state';
import { NotificationBadge } from '../components/NotificationBadge';

export default function Events() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  // Settings-update target: the real profile id in single mode, or the
  // active aggregate's id while aggregating (currentProfile stays null there)
  // - same pattern Monitors.tsx uses so view-level toggles persist in both
  // modes.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const scope = useProfileScope();
  const totalScopeProfiles = scope?.profiles.length ?? 0;
  const normalizedThumbnailFit = settings.eventsThumbnailFit === 'fill'
    ? 'contain'
    : settings.eventsThumbnailFit;
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const updateEventMontageGroupLayout = useSettingsStore(
    (state) => state.updateEventMontageGroupLayout
  );
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
  const { selectedGroupId, isFilterActive: isGroupFilterActive, filteredMonitorIds: groupMonitorIds } = useGroupFilter();
  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const eventCols =
    settings.eventMontageByGroup[groupKey]?.gridCols ??
    DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols;

  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // Check if user came from another page (navigation state tracking)
  const referrer = location.state?.from as string | undefined;

  const {
    filters,
    selectedMonitorIds,
    selectedTagIds,
    startDateInput,
    endDateInput,
    favoritesOnly,
    archivedOnly,
    setSelectedMonitorIds,
    setSelectedTagIds,
    setStartDateInput,
    setEndDateInput,
    setFavoritesOnly,
    setArchivedOnly,
    onlyDetectedObjects,
    setOnlyDetectedObjects,
    activeQuickRange,
    setActiveQuickRange,
    applyFilters,
    clearFilters,
    clearDateRange,
    activeFilterCount,
  } = useEventFilters();

  // Available tags across the scope. In All mode the offered entries are one
  // per distinct tag NAME, with the name standing in for the id, because tag
  // ids are per-server and collide; resolveOwnTagIds maps a selection back to
  // each server's own ids (refs #337, audit D4).
  const {
    availableTags,
    tagsSupported,
    isLoadingTags,
    resolveOwnTagIds,
  } = useScopedTags();

  // Derived, not state. The `?view=montage` deep link and the persisted
  // preference between them always decide the view, and the only writer
  // (handleViewModeChange) updates both - so a copy in state could only ever
  // restate what these two already say. It used to be state kept in sync by
  // two effects that raced each other on mount, which is what broke the deep
  // link in the first place (refs #337 round 2).
  //
  // currentProfileId is never null here: AppLayout redirects to profile setup
  // when the scope does not resolve, so handleViewModeChange's persist always
  // runs and this expression always agrees with what the user just picked.
  const viewMode: 'list' | 'montage' =
    searchParams.get('view') === 'montage' ? 'montage' : settings.eventsViewMode;
  // Fetch monitors for display in filter UI (single mode; unchanged query).
  const { data: monitorsData } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(getCurrentSession().client, getCurrentSession().profileId),
    enabled: !!currentProfile && isAuthenticated,
  });

  // All mode: monitors across every profile in scope, for the server-grouped
  // filter picker and for EventListView's per-server thumbnail/name lookups.
  // Disabled in single mode (enabled ties to isAllMode), so this never
  // double-fetches what the query above already covers there.
  const { monitors: scopedMonitorsAll } = useScopedMonitors({ enabled: isAllMode });

  // All monitors (for filter popover display)
  const allMonitors = monitorsData?.monitors || [];

  // Monitors filtered by group (for filter popover when group is active).
  // Group filter is current-profile-scoped and skipped in All mode (see
  // useGroupFilter/Monitors.tsx - same Phase 3 boundary).
  const displayMonitors = useMemo(() => {
    if (!isGroupFilterActive) return allMonitors;
    return filterMonitorsByGroup(allMonitors, groupMonitorIds);
  }, [allMonitors, isGroupFilterActive, groupMonitorIds]);

  // Monitor list handed to EventListView: single mode passes the flat list
  // unchanged; All mode tags each monitor with its owning profileId so a
  // colliding numeric id across two servers resolves correctly per row.
  const eventListMonitors = useMemo(
    () => (isAllMode ? scopedMonitorsAll.map((s) => ({ ...s.item, profileId: s.profileId })) : displayMonitors),
    [isAllMode, scopedMonitorsAll, displayMonitors]
  );

  // Monitors grouped by owning server, for the All-mode filter popover.
  const monitorServerGroups = useMemo(() => {
    if (!isAllMode) return undefined;
    const byProfile = new Map<string, { profileId: string; profileName: string; monitors: typeof allMonitors }>();
    for (const s of scopedMonitorsAll) {
      const existing = byProfile.get(s.profileId);
      if (existing) {
        existing.monitors.push(s.item);
      } else {
        byProfile.set(s.profileId, { profileId: s.profileId, profileName: s.profileName, monitors: [s.item] });
      }
    }
    return Array.from(byProfile.values());
  }, [isAllMode, scopedMonitorsAll]);

  // Compute effective monitor IDs for API call:
  // 1. If user selected specific monitors in filter → use those
  // 2. Else if group filter is active → use group monitor IDs
  // 3. Else → undefined (fetch all)
  const effectiveMonitorId = useMemo(() => {
    // User's explicit filter takes priority
    if (filters.monitorId) {
      return filters.monitorId;
    }
    // Group filter - pass group monitor IDs to API
    if (isGroupFilterActive && groupMonitorIds.length > 0) {
      return groupMonitorIds.join(',');
    }
    // No explicit filter: if monitors are excluded, send the included set so the
    // server's totalCount and "Load More" exclude them too, instead of counting
    // events that get dropped after fetching (refs #205). Otherwise fetch all.
    return includedMonitorIdParam(allMonitors, settings.excludedMonitorIds);
  }, [filters.monitorId, isGroupFilterActive, groupMonitorIds, allMonitors, settings.excludedMonitorIds]);

  // Build filters with server-formatted dates for passing to EventDetail
  const serverFilters: EventFilters = useMemo(() => ({
    ...filters,
    startDateTime: filters.startDateTime ? formatForServer(new Date(filters.startDateTime)) : undefined,
    endDateTime: filters.endDateTime ? formatForServer(new Date(filters.endDateTime)) : undefined,
    monitorId: effectiveMonitorId,
  }), [filters, effectiveMonitorId]);

  // Tags filter server-side too, so tagged events past the first page stay
  // reachable and "Load More" is accurate (refs #205). ZM cannot combine its
  // "Tags.Id:" filter with the favorites "Id IN:" query, so when favorites is
  // also on we leave tags to the client-side pass below (the favorite set is
  // fetched in full there, so that pass stays accurate). "All tags" expands to
  // every available tag token, i.e. events carrying any tag.
  const tagIdFilter = useMemo(() => {
    if (favoritesOnly || selectedTagIds.length === 0) return undefined;
    if (selectedTagIds.includes(ALL_TAGS_FILTER_ID)) {
      const expanded = availableTags.map((tag) => tag.Id);
      // No tags loaded yet, the request failed, or the server has no tag
      // support: an empty expansion is a filter that matches nothing, which
      // would empty the list with no banner to explain it. "All tags" with
      // nothing to expand means no tag filter at all.
      return expanded.length > 0 ? expanded : undefined;
    }
    return selectedTagIds;
  }, [favoritesOnly, selectedTagIds, availableTags]);

  // The selection resolved to every profile's OWN tag ids. In single mode the
  // tokens already ARE that profile's ids, so this is a one-entry passthrough;
  // in All mode the tokens are tag names and a profile lacking the tag maps to
  // an empty list, which means "matches nothing here" rather than "no filter"
  // (see useScopedEvents.tagIdsByProfile).
  const tagIdsByProfile = useMemo(() => {
    if (!tagIdFilter) return undefined;
    const resolved: Partial<Record<ProfileId, string[]>> = {};
    for (const p of scope?.profiles ?? []) {
      resolved[p.id] = resolveOwnTagIds(tagIdFilter, p.id);
    }
    return resolved;
  }, [tagIdFilter, scope?.profiles, resolveOwnTagIds]);

  // Manual "Load More" pagination. persistKey identifies the current result set
  // (everything the query key encodes except the limit itself) so the expanded
  // count survives the round-trip into an event and back, and resets when a
  // filter changes (refs #197). Opening an event unmounts this page, so a
  // component-local count would collapse back to the first page on return.
  // favoritesOnly resolves to each profile's OWN favorites now (useScopedEvents,
  // refs #337 I7), so this key can no longer carry the resolved id list -
  // a sentinel that flips with the toggle is enough to reset pagination.
  const paginationKey = useMemo(
    () => JSON.stringify(
      queryKeys.eventsList(currentProfile?.id, filters, 0, effectiveMonitorId, isGroupFilterActive, favoritesOnly ? ['__favorites__'] : undefined, tagIdFilter)
    ),
    [currentProfile?.id, filters, effectiveMonitorId, isGroupFilterActive, favoritesOnly, tagIdFilter]
  );
  const { eventLimit, batchSize, loadNextPage } = useEventPagination({
    defaultLimit: settings.defaultEventLimit || 100,
    persistKey: paginationKey,
  });

  // Fetch events with configured limit, aggregated across the active scope
  // (one profile in single mode, every profile in All mode - see
  // useScopedEvents). Single mode shares the SAME cache slot the page used
  // before: same queryKeys.eventsList(...) shape, filters passed RAW (not
  // pre-formatted - the hook converts dates per profile's own timezone).
  const {
    events: scopedEvents,
    errors: profileErrors,
    isLoading,
    isFetching,
    totalCount,
    totalCountByProfile,
    refetchProfile,
    refetchAll,
  } = useScopedEvents({
    filters,
    limit: eventLimit,
    monitorId: effectiveMonitorId,
    isGroupFilterActive,
    favoritesOnly,
    tagIdsByProfile,
  });

  // A deep link from a monitor card / event detail / recent-events row in
  // All mode carries `?profileId=` alongside `monitorId` (refs #337): those
  // callers know which server the monitor id belongs to, so focus the
  // server filter down to just that profile instead of leaving the numeric
  // monitorId ambiguous across every server in scope. Transient: overlays
  // the persisted filter for this render only rather than writing it via
  // updateSettings, so one tap can't permanently narrow the user's saved
  // All-mode filter - navigating away (or clearing the param) reverts to
  // whatever was persisted before the link was opened (refs #337 I9).
  const deepLinkedProfileId = isAllMode ? searchParams.get('profileId') : null;
  // Reconciled here rather than in mergeProfileSettings (the Settings contract's
  // usual coercion spot): that merge is a pure function with no access to the
  // live profiles list - stores/settings.ts importing stores/profile.ts to get
  // one would cycle back through profile.ts's own useSettingsStore import.
  // Without this, a deleted profile's id lingers in the persisted filter
  // forever; if it was the ONLY id left, "no filter" silently became "hide
  // every real profile" the moment that profile was deleted (refs #337).
  const effectiveServerFilter = useMemo(() => {
    if (deepLinkedProfileId) return [deepLinkedProfileId as ProfileId];
    if (!settings.eventsServerFilter) return null;
    const liveIds = new Set((scope?.profiles ?? []).map((p) => p.id));
    const reconciled = settings.eventsServerFilter.filter((id) => liveIds.has(id));
    // Every persisted id named a since-deleted profile: fall back to "no
    // filter" instead of an effective list that hides every real profile.
    // An already-empty persisted list (user deselected every server) stays
    // empty - that is the deliberate hide-everything state.
    if (reconciled.length === 0 && settings.eventsServerFilter.length > 0) return null;
    return reconciled;
  }, [deepLinkedProfileId, settings.eventsServerFilter, scope?.profiles]);

  // Every profile in scope failed and none ever produced an event: distinct
  // from "no events match the filter" (same suppression semantics as
  // Monitors.tsx - refs #337, Task 4).
  const allFailed = profileErrors.length > 0 && profileErrors.length === totalScopeProfiles && scopedEvents.length === 0;
  // A strip only for a profile that produced zero events; one with cached
  // data and a background refetch error renders that data with no strip.
  const visibleErrors = profileErrors.filter(
    (err) => !scopedEvents.some((e) => e.profileId === err.profileId)
  );

  // ALL mode's server filter (settings.eventsServerFilter, null = every
  // profile) is applied client-side: useScopedEvents already fetched every
  // profile's slice, so narrowing the DISPLAYED list here is enough and
  // needs no extra query plumbing.
  const serverFilteredEvents = useMemo(() => {
    if (!isAllMode || !effectiveServerFilter) return scopedEvents;
    const included = new Set(effectiveServerFilter);
    return scopedEvents.filter((e) => included.has(e.profileId));
  }, [isAllMode, effectiveServerFilter, scopedEvents]);

  // "Showing X of Y": Y must match the server filter, not every profile in
  // scope - totalCount (from useScopedEvents) sums ALL of them regardless,
  // so a narrowed filter otherwise reported a Y the filtered list could never
  // reach (refs #337).
  const filteredTotalCount = useMemo(() => {
    if (!isAllMode || !effectiveServerFilter) return totalCount;
    return effectiveServerFilter.reduce((sum, id) => sum + (totalCountByProfile[id] ?? 0), 0);
  }, [isAllMode, effectiveServerFilter, totalCountByProfile, totalCount]);

  // Deselecting every server (an explicit empty filter, distinct from null's
  // "every profile") leaves zero events for a reason unrelated to the date/
  // monitor/tag filters below - the plain "no events" empty state (with its
  // "clear filters" action) doesn't explain it, so this gets its own hint.
  const serverFilterHidesEverything = isAllMode && effectiveServerFilter !== null && effectiveServerFilter.length === 0;

  // Pull-to-refresh gesture
  const pullToRefresh = usePullToRefresh({
    containerRef: parentRef,
    onRefresh: refetchAll,
    enabled: true,
  });

  // Displayed events with their owning profile, so each server is asked only
  // for its own event ids and the merged map stays collision-free.
  const tagRefs = useMemo<ScopedEventRef[]>(() =>
    serverFilteredEvents.map((e) => ({ profileId: e.profileId, eventId: e.item.Event.Id })),
    [serverFilteredEvents]
  );

  // Fetch tags for displayed events. Keyed to match what a ROW carries:
  // composite in All mode, bare event id in single mode (scopedEventKey).
  const { eventTagMap } = useScopedEventTagMapping({
    events: tagRefs,
    enabled: tagsSupported && tagRefs.length > 0,
  });

  // Memoize filtered events. The server applied monitor/group, date, favorites
  // (eventIds), and tags (tagIds). The one case left for the client is tags
  // while favorites is also on: ZM can't run both server-side, but the favorite
  // set is fetched in full above, so filtering it here by tag stays accurate.
  // Merges each item's Event with its owning profileId/profileChip
  // (undefined in single mode) for EventListView's per-row All-mode wiring.
  const allEvents: ScopedEventItem[] = useMemo(() => {
    let filtered = serverFilteredEvents;

    if (favoritesOnly && selectedTagIds.length > 0 && eventTagMap.size > 0) {
      const isAllTagsFilter = selectedTagIds.includes(ALL_TAGS_FILTER_ID);
      filtered = filtered.filter(({ profileId, item: { Event } }) => {
        // The map is keyed the way rows are: composite in All mode only.
        const eventTags = eventTagMap.get(scopedEventKey(isAllMode ? profileId : undefined, Event.Id)) || [];
        if (isAllTagsFilter) {
          // "All" = show events that have at least one tag
          return eventTags.length > 0;
        }
        // Otherwise event must have at least one of the selected tags. All
        // mode selects by tag NAME, since ids differ per server.
        return eventTags.some(tag => selectedTagIds.includes(isAllMode ? tag.Name : tag.Id));
      });
    }

    return filtered.map((e) => ({
      ...e.item,
      profileId: isAllMode ? e.profileId : undefined,
      profileChip: isAllMode ? e.profileName : undefined,
    }));
  }, [serverFilteredEvents, favoritesOnly, selectedTagIds, eventTagMap, isAllMode]);

  // allEvents tagged with the OWNING profile's timezone, for EventHeatmap's
  // real-instant bucketing (eventInstant) instead of a naive local Date
  // parse - required once All mode can merge events from more than one
  // profile/timezone (refs #337). Single mode: one profile, one timezone.
  const tzById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p.timezone ?? 'UTC'])),
    [scope]
  );
  const heatmapEvents = useMemo(
    () =>
      allEvents.map((item) => ({
        item,
        timezone: item.profileId ? (tzById.get(item.profileId) ?? 'UTC') : (currentProfile?.timezone ?? 'UTC'),
      })),
    [allEvents, tzById, currentProfile]
  );

  // Date range shown on the heatmap: explicit filters win, otherwise infer
  // the span from the loaded events. Derived from heatmapEvents' real
  // instants (eventInstant), not a naive local Date parse: the buckets
  // below already use real instants, so a naively-derived window can fall
  // short of them and silently drop events the buckets would otherwise show
  // (refs #337 - the other half of the timezone-bucket fix).
  const heatmapDateRange = useMemo(() => {
    if (heatmapEvents.length === 0) return null;

    if (filters.startDateTime && filters.endDateTime) {
      return { startDate: new Date(filters.startDateTime), endDate: new Date(filters.endDateTime) };
    }

    const eventDates = heatmapEvents.map(({ item, timezone }) => new Date(eventInstant(item, timezone)));
    return {
      startDate: new Date(Math.min(...eventDates.map((d) => d.getTime()))),
      endDate: new Date(Math.max(...eventDates.map((d) => d.getTime()))),
    };
  }, [heatmapEvents, filters.startDateTime, filters.endDateTime]);

  // Restore the list scroll position when returning from an event detail.
  // /events and /events/:id are sibling routes, so this component unmounts when
  // opening an event; without this the list snaps back to the top (refs #197).
  const restoreScrollRef = useScrollRestoration(location.key, !isLoading && allEvents.length > 0);

  // Use grid management hook (only active when in montage mode). Settings
  // writes below target currentProfileId (the active aggregate's id while
  // aggregating, the real profile id in single mode) so view-level toggles
  // persist in both modes, same as Monitors.tsx.
  const gridControls = useEventMontageGrid({
    initialCols: eventCols,
    containerRef: parentRef,
    onGridChange: (cols) => {
      if (currentProfileId) {
        updateEventMontageGroupLayout(currentProfileId, groupKey, { gridCols: cols });
      }
    },
  });

  // Grid columns are gridControls' own state, so they still need syncing from
  // the settings the active profile and group resolve to. The `?view=montage`
  // skip stays: a deep link renders montage without adopting the stored
  // column count, which is what it did before viewMode became derived.
  useEffect(() => {
    if (!currentProfileId) return;
    if (searchParams.get('view') === 'montage') return;
    gridControls.setGridCols(eventCols);
    gridControls.setCustomCols(eventCols.toString());
  }, [currentProfileId, groupKey, eventCols, searchParams]);

  const handleViewModeChange = (mode: 'list' | 'montage') => {
    if (currentProfileId) {
      updateSettings(currentProfileId, { eventsViewMode: mode });
    }
    const nextParams = new URLSearchParams(searchParams);
    if (mode === 'montage') {
      nextParams.set('view', 'montage');
    } else {
      nextParams.delete('view');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleThumbnailFitChange = (value: string) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, {
      eventsThumbnailFit: (value === 'fill' ? 'contain' : value) as typeof settings.eventsThumbnailFit,
    });
  };

  // isLoading never clears on a total outage (no profile ever gets data), so
  // the skeleton only shows while there's still a chance of that - once
  // every profile has errored, allFailed below takes over (refs #337, Task 4
  // finding - same as Monitors.tsx).
  const stillWaiting = isLoading && profileErrors.length === 0;
  if (stillWaiting) {
    return (
      <div className="flex flex-col h-full p-6 md:p-8 gap-6">
        <div className="flex justify-between flex-shrink-0">
          <div className="h-8 w-32 bg-muted rounded animate-pulse" />
          <div className="h-8 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-[140px] bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={(el) => {
          parentRef.current = el;
          restoreScrollRef(el);
        }}
        {...pullToRefresh.bind()}
        className="h-full overflow-auto p-3 sm:p-4 md:p-6 relative touch-pan-y"
        data-testid="events-scroll-container"
      >
        <PullToRefreshIndicator
          isPulling={pullToRefresh.isPulling}
          isRefreshing={pullToRefresh.isRefreshing}
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
        />
        <div className="flex flex-col gap-3 sm:gap-4 mb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {referrer && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(referrer)}
                  title={t('common.go_back')}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('events.title')}</h1>
                  <NotificationBadge />
                </div>
                <p className="text-xs text-muted-foreground hidden sm:block">{t('events.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isAllMode && (
                <Button
                  variant={settings.eventsGroupByServer ? 'default' : 'outline'}
                  size="icon"
                  aria-pressed={settings.eventsGroupByServer}
                  title={t('monitors.group_by_server')}
                  aria-label={t('monitors.group_by_server')}
                  onClick={() => {
                    if (!currentProfileId) return;
                    // Aggregate bucket: currentProfileId is the aggregate's own
                    // id while it is current (refs #501).
                    updateSettings(currentProfileId, {
                      eventsGroupByServer: !settings.eventsGroupByServer,
                    });
                  }}
                  data-testid="events-group-by-server"
                >
                  <Layers className="h-4 w-4" />
                </Button>
              )}
              <GroupFilterSelect />
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleViewModeChange(viewMode === 'list' ? 'montage' : 'list')}
                title={viewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
                aria-label={viewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
                data-testid="events-view-toggle"
              >
                {viewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              </Button>
              {viewMode === 'montage' && (
                <EventMontageGridControls
                  gridCols={gridControls.gridCols}
                  customCols={gridControls.customCols}
                  isCustomGridDialogOpen={gridControls.isCustomGridDialogOpen}
                  onApplyGridLayout={gridControls.handleApplyGridLayout}
                  onCustomColsChange={gridControls.setCustomCols}
                  onCustomGridDialogOpenChange={gridControls.setIsCustomGridDialogOpen}
                  onCustomGridSubmit={gridControls.handleCustomGridSubmit}
                />
              )}
              {/* Controlled: every filter setter writes the choice straight to
                  the settings store, which re-renders this page through
                  useCurrentProfile. An uncontrolled Popover lost its open
                  state on that re-render, so ticking one monitor or the
                  favourites switch slammed the panel shut and the user had to
                  reopen it for every single choice. Owning the state here
                  means only a deliberate dismissal closes it. */}
              <Popover open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={activeFilterCount > 0 ? 'default' : 'outline'}
                    size="icon"
                    className="relative"
                    title={t('events.filters')}
                    aria-label={t('events.filters')}
                    data-testid="events-filter-button"
                  >
                    <Filter className="h-4 w-4" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 border-2 border-background" />
                    )}
                  </Button>
                </PopoverTrigger>
                <EventsFilterPopover
                  monitors={displayMonitors}
                  serverGroups={monitorServerGroups}
                  selectedMonitorIds={selectedMonitorIds}
                  onMonitorSelectionChange={setSelectedMonitorIds}
                  favoritesOnly={favoritesOnly}
                  onFavoritesOnlyChange={setFavoritesOnly}
                  archivedOnly={archivedOnly}
                  onArchivedOnlyChange={setArchivedOnly}
                  startDateInput={startDateInput}
                  onStartDateChange={setStartDateInput}
                  endDateInput={endDateInput}
                  onEndDateChange={setEndDateInput}
                  onQuickRangeSelect={({ start, end }) => {
                    setStartDateInput(formatLocalDateTimeSeconds(start));
                    setEndDateInput(formatLocalDateTimeSeconds(end));
                  }}
                  onApplyFilters={applyFilters}
                  onClearFilters={clearFilters}
                  tagsSupported={tagsSupported}
                  availableTags={availableTags}
                  selectedTagIds={selectedTagIds}
                  onTagSelectionChange={setSelectedTagIds}
                  isLoadingTags={isLoadingTags}
                  onlyDetectedObjects={onlyDetectedObjects}
                  onOnlyDetectedObjectsChange={setOnlyDetectedObjects}
                />
              </Popover>

              <NinjiiToolbarButton />
              <RefreshButton
                aria-label={t('events.refresh')}
                data-testid="events-refresh-button"
              />
              {/* One preference, so a toggle rather than a menu holding it
                  alone. Pressed means cropped to fill, the state that differs
                  from the default. */}
              <Button
                variant={normalizedThumbnailFit === 'cover' ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                aria-pressed={normalizedThumbnailFit === 'cover'}
                title={t('common.crop_to_fill')}
                aria-label={t('common.crop_to_fill')}
                onClick={() =>
                  handleThumbnailFitChange(normalizedThumbnailFit === 'cover' ? 'contain' : 'cover')
                }
                data-testid="events-thumbnail-fit-toggle"
              >
                <Crop className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {viewMode === 'montage' && gridControls.isScreenTooSmall && (
            <p className="text-xs text-destructive">{t('eventMontage.screen_too_small')}</p>
          )}

          {/* Per-profile error strips + All-mode server filter chips */}
          <EventsAllModeBar
            profiles={scope?.profiles ?? []}
            visibleErrors={visibleErrors}
            onRetryProfile={refetchProfile}
            serverFilter={effectiveServerFilter ?? null}
            onServerFilterChange={(next) => {
              if (currentProfileId) updateSettings(currentProfileId, { eventsServerFilter: next });
            }}
          />

          {/* Quick Date Range Buttons */}
          <div className="flex items-center gap-3">
            <QuickDateRangeButtons
              activeHours={activeQuickRange}
              onRangeSelect={({ start, end, hours }) => {
                const startInput = formatLocalDateTimeSeconds(start);
                const endInput = formatLocalDateTimeSeconds(end);
                setStartDateInput(startInput);
                setEndDateInput(endInput);
                setActiveQuickRange(hours);
                // Pass the new range explicitly: applyFilters still closes over the
                // pre-click date state, and the URL-readback effect would otherwise
                // reapply the previous window (refs #193).
                applyFilters({ startDateTime: startInput, endDateTime: endInput });
              }}
            />
            {/* Shows for any active date range, not only a quick-range chip, so a date
                range that arrived via URL (e.g. a monitor card's Events link) can also
                be cleared without losing the rest of the filter set (refs #239). The
                testid stays events-clear-quick-range: existing e2e steps depend on it. */}
            {(activeQuickRange !== null || startDateInput || endDateInput) && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-7 w-7"
                onClick={clearDateRange}
                title={t('common.clear')}
                data-testid="events-clear-quick-range"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Event Heatmap */}
        {heatmapDateRange && (
          <EventHeatmap
            events={heatmapEvents}
            startDate={heatmapDateRange.startDate}
            endDate={heatmapDateRange.endDate}
            onTimeRangeClick={(startDateTime, endDateTime) => {
              setStartDateInput(formatLocalDateTimeSeconds(new Date(startDateTime)));
              setEndDateInput(formatLocalDateTimeSeconds(new Date(endDateTime)));
              applyFilters();
            }}
          />
        )}

        {/* Events List or Montage View */}
        {allEvents.length === 0 ? (
          serverFilterHidesEverything ? (
            <div data-testid="events-filter-empty-hint">
              <EmptyState
                icon={Clock}
                title={t('events.filter_hides_everything')}
                action={{
                  label: t('events.show_all_servers'),
                  onClick: () => {
                    if (currentProfileId) updateSettings(currentProfileId, { eventsServerFilter: null });
                  },
                  variant: 'link',
                }}
              />
            </div>
          ) : (
            <div data-testid={allFailed ? 'events-all-failed-state' : 'events-empty-state'}>
              <EmptyState
                icon={Clock}
                title={t(allFailed ? 'events.all_failed_title' : 'events.no_events')}
                action={
                  filters.monitorId || filters.startDateTime || filters.endDateTime
                    ? {
                        label: t('events.clear_filters'),
                        onClick: clearFilters,
                        variant: 'link',
                      }
                    : undefined
                }
              />
            </div>
          )
        ) : viewMode === 'montage' ? (
          <EventMontageView
            events={allEvents}
            monitors={eventListMonitors}
            gridCols={gridControls.gridCols}
            thumbnailFit={normalizedThumbnailFit}
            portalUrl={currentProfile?.portalUrl || ''}
            accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
            batchSize={batchSize}
            totalCount={filteredTotalCount}
            isFetching={isFetching}
            onLoadMore={loadNextPage}
            eventTagMap={eventTagMap}
            eventFilters={serverFilters}
            minStreamingPort={resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)}
            groupByScopeId={isAllMode && settings.eventsGroupByServer ? currentProfileId ?? undefined : undefined}
          />
        ) : (
          <EventListView
            events={allEvents}
            monitors={eventListMonitors}
            thumbnailFit={normalizedThumbnailFit}
            portalUrl={currentProfile?.portalUrl || ''}
            accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
            batchSize={batchSize}
            totalCount={filteredTotalCount}
            isFetching={isFetching}
            onLoadMore={loadNextPage}
            eventTagMap={eventTagMap}
            eventFilters={serverFilters}
            minStreamingPort={resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)}
            groupByScopeId={isAllMode && settings.eventsGroupByServer ? currentProfileId ?? undefined : undefined}
          />
        )}
      </div>
    </>
  );
}
