/**
 * Monitors Page
 *
 * Displays a grid of all available monitors with their status and event counts.
 * Allows filtering and quick access to monitor details.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { updateMonitor } from '../api/monitors';
import { getSession } from '../services/sessions';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { useMonitorNewEvents, useScopedMonitorNewEvents, scopedMonitorEventKey } from '../hooks/useMonitorNewEvents';
import { useAuthSlice } from '../stores/auth';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';
import { Button } from '../components/ui/button';
import { LayoutGrid, List, Video, Layers } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { ErrorBanner } from '../components/ui/query-state';
import { EmptyState } from '../components/ui/empty-state';
import { resolveQueryError } from '../lib/query/query-error';
import { RefreshButton } from '../components/common/RefreshButton';
import { MonitorCard } from '../components/monitors/MonitorCard';
import { MonitorPageControls } from '../components/monitors/MonitorPageControls';
import { useMonitorPaging } from '../hooks/useMonitorPaging';
import { ViewOptionsMenu, FeedFitItems, AnalysisFramesItem, ViewOptionsSeparator } from '../components/common/view-options';
import { NinjiiToolbarButton } from '../components/assistant/NinjiiToolbarButton';
import { MonitorSettingsDialog } from '../components/monitor-detail/MonitorSettingsDialog';
import { usePermissions } from '../hooks/usePermissions';
import { canEditMonitorSettings, canViewMonitors } from '../lib/permissions/zm-permissions';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import { markPermissionDenied, useIsPermissionDenied } from '../stores/permissions';
import { filterMonitorsByGroup } from '../lib/monitor/filters';
import { groupByOwningProfile } from '../lib/profile/profile-sections';
import { ProfileSectionList } from '../components/profiles/ProfileSectionList';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import type { Monitor, MonitorStatus, ProfileId } from '../api/types';
import { NotificationBadge } from '../components/NotificationBadge';
import { toast } from 'sonner';
import { log, LogLevel } from '../lib/logger';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';

/** One monitor tile's worth of render data. profileId/profileChip are set
 * only in All mode (see useScopedMonitors); undefined in single mode. */
interface MonitorGridItem {
  Monitor: Monitor;
  Monitor_Status: MonitorStatus | undefined;
  profileId?: ProfileId;
  profileChip?: string;
}
export default function Monitors() {
  const { t } = useTranslation();
  const [selectedMonitor, setSelectedMonitor] = useState<Monitor | null>(null);
  const [selectedMonitorProfileId, setSelectedMonitorProfileId] = useState<ProfileId | null>(null);
  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);

  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  // Settings-update target: the real profile id in single mode, or the
  // active aggregate's id while aggregating (currentProfile stays null
  // there), whichever aggregate that is.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const scope = useProfileScope();
  const totalScopeProfiles = scope?.profiles.length ?? 0;
  // Group filter is current-profile-scoped (settings + groups query both key
  // off it); All mode skips it until Phase 3 extends it across servers.
  const { isFilterActive, filteredMonitorIds, isFilterReady } = useGroupFilter();
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const handleMonitorGridChange = useCallback((cols: number) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, { monitorGridCols: cols });
  }, [currentProfileId, updateSettings]);

  const {
    gridCols: monitorGridCols,
    isCustomGridDialogOpen,
    setIsCustomGridDialogOpen,
    customCols,
    setCustomCols,
    handleApplyGridLayout: handleMonitorApplyGridLayout,
    handleCustomGridSubmit: handleMonitorCustomGridSubmit,
  } = useEventMontageGrid({
    initialCols: settings.monitorGridCols,
    containerRef: gridContainerRef,
    onGridChange: handleMonitorGridChange,
  });

  // Single code path for both modes: one profile in single mode, N in All
  // mode, sharing the same queryKeys.monitors(id) cache entry useMonitors
  // uses. isLoading stays true forever on a total outage (no profile ever
  // gets data), so the render below branches on errors.length instead of
  // trusting isLoading alone (refs #337, Task 4 finding).
  const { monitors: scopedMonitors, errors: profileErrors, isLoading: scopedLoading, refetchProfile } = useScopedMonitors();

  const renderItems = useMemo((): MonitorGridItem[] => {
    if (isAllMode) {
      return scopedMonitors.map((s) => ({
        Monitor: s.item.Monitor,
        Monitor_Status: s.item.Monitor_Status,
        profileId: s.profileId,
        profileChip: s.profileName,
      }));
    }
    const unwrapped = scopedMonitors.map((s) => s.item);
    // Apply group filter if active. An empty id list means the group resolved
    // to nothing (or groups have not loaded yet), so show none rather than
    // falling back to every monitor.
    const filtered = !isFilterActive
      ? unwrapped
      : filteredMonitorIds.length === 0
        ? []
        : filterMonitorsByGroup(unwrapped, filteredMonitorIds);
    return filtered.map(({ Monitor, Monitor_Status }) => ({ Monitor, Monitor_Status }));
  }, [isAllMode, scopedMonitors, isFilterActive, filteredMonitorIds]);

  // Paging (refs #507, see lib/monitor/paging). `renderItems` stays the whole
  // scope, which the header count and the error strips describe; only what is
  // rendered is sliced.
  const paging = useMonitorPaging({
    items: renderItems,
    pageSize: settings.monitorsPerPage,
    resetKey: `${currentProfileId ?? ''}:${isFilterActive ? filteredMonitorIds.join(',') : ''}`,
  });

  // Raw per-profile monitor counts, independent of the group filter above:
  // used only to decide whether a profile's error strip shows (a profile
  // filtered down to zero by the group filter still "has data").
  const monitorCountByProfile = useMemo(() => {
    const counts = new Map<ProfileId, number>();
    for (const s of scopedMonitors) {
      counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1);
    }
    return counts;
  }, [scopedMonitors]);

  // useMonitorNewEvents stays current-profile-scoped for single mode, sharing
  // its watermarks keyed by one profile id. All mode fans the equivalent
  // query out per owning profile via useScopedMonitorNewEvents (refs #337).
  //
  // Over the PAGE, not the whole scope: this is one request per monitor, so a
  // 74-camera account fired 74 of them at mount and they compete for the same
  // six connections per host the feeds need (refs #507). A card that is not
  // rendered has no badge to fill, and its watermark is untouched until you
  // turn to its page - which is correct, since you have not looked at it.
  const monitorIds = useMemo(
    () => (isAllMode ? [] : paging.items.map(({ Monitor }) => Monitor.Id)),
    [isAllMode, paging.items]
  );
  const { counts: newEventCounts, newest: newestEventAt } = useMonitorNewEvents(monitorIds);

  const scopedMonitorRefs = useMemo(
    () =>
      isAllMode
        ? paging.items
            .filter((item): item is MonitorGridItem & { profileId: ProfileId } => item.profileId !== undefined)
            .map(({ Monitor, profileId }) => ({ profileId, monitorId: Monitor.Id }))
        : [],
    [isAllMode, paging.items]
  );
  const { counts: scopedNewEventCounts, newest: scopedNewestEventAt } =
    useScopedMonitorNewEvents(scopedMonitorRefs);

  // Stable identity: MonitorCard is memo()'d, and this is its only
  // reference-unstable prop. A fresh function per render would re-render every
  // card on every status poll.
  const handleShowSettings = useCallback((monitor: Monitor, profileId?: ProfileId | null) => {
    setSelectedMonitor(monitor);
    setSelectedMonitorProfileId(profileId ?? null);
    setShowPropertiesDialog(true);
  }, []);

  // Settings dialog save handler
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  // The profile that owns the selected monitor: the card's own profileId in
  // All mode, the current profile in single mode.
  const settingsProfileId = selectedMonitorProfileId ?? currentProfile?.id ?? null;
  const settingsZmVersion = useAuthSlice(settingsProfileId).version;

  const handleSaveSettings = useCallback(async (changes: Record<string, string | undefined>) => {
    if (!selectedMonitor || !settingsProfileId) return;
    setIsSavingSettings(true);
    try {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) params[`Monitor[${key}]`] = value;
      }
      if (Object.keys(params).length > 0) {
        await updateMonitor(getSession(settingsProfileId).client, selectedMonitor.Id, params);
      }
      refetchProfile(settingsProfileId);
      toast.success(t('monitor_detail.capture_updated'));
    } catch (error) {
      log.monitor('Settings save failed', LogLevel.ERROR, { error });
      // Per-monitor permission rows can refuse a save the account columns
      // allowed, and they are not in the API - so the refusal itself is the
      // only way to learn about them (refs #344).
      if (isPermissionDenied(error)) {
        markPermissionDenied(settingsProfileId, 'monitor-settings', selectedMonitor.Id);
        toast.error(t('common.permission_denied'));
      } else {
        toast.error(t('monitor_detail.capture_failed'));
      }
    } finally {
      setIsSavingSettings(false);
    }
  }, [selectedMonitor, settingsProfileId, refetchProfile, t]);

  // An account with Monitors='None' gets an empty list from ZoneMinder, not an
  // error - so without this the page would blame the server for having no
  // cameras (refs #344).
  const { permissions: currentPermissions } = usePermissions(currentProfile?.id);
  const monitorsDenied = canViewMonitors(currentPermissions) === 'denied';

  // Unknown permissions stay optimistic; only a denial removes the editor.
  const { permissions: settingsPermissions } = usePermissions(settingsProfileId);
  const settingsMonitorRefused = useIsPermissionDenied(
    settingsProfileId,
    'monitor-settings',
    selectedMonitor?.Id,
  );
  const canEditSettings =
    canEditMonitorSettings(settingsPermissions) !== 'denied' && !settingsMonitorRefused;

  const handleFeedFitChange = (value: string) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, {
      monitorsFeedFit: value as typeof settings.monitorsFeedFit,
    });
  };

  // Wait for monitors to load and (single mode only) for the group filter to
  // resolve before rendering tiles. A mounted tile starts its stream, so
  // rendering all monitors for a frame before the group narrows would open
  // every stream. Once any profile has errored, scopedLoading never clears
  // on its own (see useScopedMonitors), so an errored profile must fall
  // through to the normal view below instead of spinning forever.
  const stillWaiting = scopedLoading && profileErrors.length === 0;
  if (stillWaiting || (!isAllMode && !isFilterReady)) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Every profile in scope failed and none ever produced data: distinct from
  // "no cameras configured" so a retry affordance stays visible via the error
  // strips below (refs #337, Task 4 finding).
  const allFailed = profileErrors.length > 0 && profileErrors.length === totalScopeProfiles && renderItems.length === 0;

  // A background refetch error (e.g. offline) while cached monitors are
  // already rendering falls through to the normal view instead of a strip;
  // the OfflineBanner in AppLayout covers that case. A strip only appears for
  // a profile that produced zero monitors, the per-profile analogue of the
  // old single-mode "error and no data" wall.
  const visibleErrors = profileErrors.filter((err) => (monitorCountByProfile.get(err.profileId) ?? 0) === 0);

  const renderMonitorSection = (items: MonitorGridItem[], attachGridRef: boolean) => (
    settings.monitorsViewMode === 'grid' ? (
      <div
        ref={attachGridRef ? gridContainerRef : undefined}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${monitorGridCols}, minmax(0, 1fr))` }}
        data-testid="monitor-grid"
      >
        {items.map(({ Monitor, Monitor_Status, profileId, profileChip }) => (
          <MonitorCard
            key={`${profileId ?? ''}-${Monitor.Id}`}
            monitor={Monitor}
            status={Monitor_Status}
            newEventCount={
              profileId
                ? scopedNewEventCounts[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newEventCounts[Monitor.Id]
            }
            newestEventAt={
              profileId
                ? scopedNewestEventAt[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newestEventAt[Monitor.Id]
            }
            onShowSettings={handleShowSettings}
            objectFit={settings.monitorsFeedFit}
            profileId={profileId}
            profileChip={profileChip}
            compact
          />
        ))}
      </div>
    ) : (
      <div className="space-y-4" data-testid="monitor-grid">
        {items.map(({ Monitor, Monitor_Status, profileId, profileChip }) => (
          <MonitorCard
            key={`${profileId ?? ''}-${Monitor.Id}`}
            monitor={Monitor}
            status={Monitor_Status}
            newEventCount={
              profileId
                ? scopedNewEventCounts[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newEventCounts[Monitor.Id]
            }
            newestEventAt={
              profileId
                ? scopedNewestEventAt[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newestEventAt[Monitor.Id]
            }
            onShowSettings={handleShowSettings}
            objectFit={settings.monitorsFeedFit}
            profileId={profileId}
            profileChip={profileChip}
          />
        ))}
      </div>
    )
  );

  // Section renderItems by owning server when the toggle is on. All mode
  // only - single mode never has more than one profile to group by.
  const groupedSections = isAllMode && settings.monitorsGroupByServer
    ? groupByOwningProfile(paging.items)
    : null;

  return (
    <PageContainer className="space-y-4 sm:space-y-6" spacing="none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('monitors.title')}</h1>
            <NotificationBadge />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {t('monitors.count', { count: renderItems.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                updateSettings(currentProfileId, { monitorsGroupByServer: !settings.monitorsGroupByServer });
              }}
              data-testid="monitors-group-by-server"
            >
              <Layers className="h-4 w-4" />
            </Button>
          ) : (
            <GroupFilterSelect />
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 sm:h-9 w-8 sm:w-9"
            onClick={() => {
              if (!currentProfileId) return;
              const next = settings.monitorsViewMode === 'list' ? 'grid' : 'list';
              updateSettings(currentProfileId, { monitorsViewMode: next });
            }}
            title={settings.monitorsViewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
            aria-label={settings.monitorsViewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
            data-testid="monitors-view-toggle"
          >
            {settings.monitorsViewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </Button>
          {settings.monitorsViewMode === 'grid' && (
            <EventMontageGridControls
              gridCols={monitorGridCols}
              customCols={customCols}
              isCustomGridDialogOpen={isCustomGridDialogOpen}
              onApplyGridLayout={handleMonitorApplyGridLayout}
              onCustomColsChange={setCustomCols}
              onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
              onCustomGridSubmit={handleMonitorCustomGridSubmit}
            />
          )}
          <NinjiiToolbarButton />
          {paging.isPaged && (
            <MonitorPageControls
              page={paging.page}
              pages={paging.pages}
              onGoToPage={paging.goToPage}
              testIdPrefix="monitors"
            />
          )}
          <RefreshButton
            className="h-8 w-8 sm:h-9 sm:w-9"
            data-testid="monitors-refresh-button"
          />
          <ViewOptionsMenu testId="monitors">
            <FeedFitItems
              value={settings.monitorsFeedFit}
              onChange={handleFeedFitChange}
              testIdPrefix="monitors"
            />
            <ViewOptionsSeparator />
            <AnalysisFramesItem />
          </ViewOptionsMenu>
        </div>
      </div>

      {/* Per-profile errors: one strip per profile whose query failed AND
          produced zero monitors. A profile with cached data and a background
          refetch error (e.g. offline) renders that data with no strip; the
          OfflineBanner in AppLayout covers that case (refs #337, Task 4
          finding). */}
      {visibleErrors.length > 0 && (
        <div className="space-y-2">
          {visibleErrors.map((err) => (
            <div
              key={err.profileId}
              className="flex items-center gap-2"
              data-testid={`profile-error-strip-${err.profileId}`}
            >
              <ErrorBanner
                className="flex-1"
                message={
                  totalScopeProfiles === 1
                    ? resolveQueryError(err.error, t, { fallbackKey: 'monitors.failed_to_load' })
                    : `${err.profileName}: ${resolveQueryError(err.error, t, { fallbackKey: 'monitors.failed_to_load' })}`
                }
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchProfile(err.profileId)}
                data-testid={`profile-error-strip-retry-${err.profileId}`}
              >
                {t('common.retry')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* All Cameras */}
      <div className="space-y-3 sm:space-y-4">
        {renderItems.length === 0 ? (
          <div data-testid={allFailed ? 'monitors-all-failed-state' : 'monitors-empty-state'}>
            <EmptyState
              icon={Video}
              title={t(
                allFailed
                  ? 'monitors.all_failed_title'
                  : monitorsDenied
                    ? 'monitors.no_monitor_permission'
                    : 'monitors.no_cameras',
              )}
              className="p-8 text-center border rounded-lg bg-muted/20 text-muted-foreground"
            />
          </div>
        ) : groupedSections && currentProfileId ? (
          <ProfileSectionList
            sections={groupedSections}
            surface="monitors-group"
            scopeId={currentProfileId}
            className="space-y-6"
            renderItems={(items) => renderMonitorSection(items, false)}
          />
        ) : (
          renderMonitorSection(paging.items, true)
        )}
      </div>

      {/* Monitor Settings Dialog */}
      {selectedMonitor && (
        <MonitorSettingsDialog
          open={showPropertiesDialog}
          onOpenChange={setShowPropertiesDialog}
          monitor={selectedMonitor}
          zmVersion={settingsZmVersion}
          onSave={canEditSettings ? handleSaveSettings : undefined}
          restrictedReason={settingsMonitorRefused ? 'monitor' : 'account'}
          isSaving={isSavingSettings}
          profileId={settingsProfileId ?? undefined}
        />
      )}
    </PageContainer>
  );
}
