/**
 * Monitor Detail Page
 *
 * Displays a continuous live stream for a single monitor (always streaming
 * mode: the global Snapshot setting does not apply here). Includes PTZ
 * controls (if applicable) and quick actions.
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { getMonitor, getControl, updateMonitor } from '../api/monitors';
import { getZones } from '../api/zones';
import { getSession, tryGetCurrentSession } from '../services/sessions';
import type { ApiClient } from '../api/client';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useProfileById } from '../hooks/useCurrentProfile';
import { useMonitorMuted } from '../hooks/useMonitorMuted';
import { useMonitorFlag } from '../hooks/useMonitorFlag';
import { MonitorInfoPopover } from '../components/monitors/MonitorInfoPopover';
import { FullscreenExitButton } from '../components/ui/fullscreen-exit-button';
import { useAutoFullscreen } from '../hooks/useAutoFullscreen';
import { useAuthSlice } from '../stores/auth';
import type { ProfileId } from '../api/types';
import { useSettingsStore } from '../stores/settings';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ArrowLeft, Settings, Maximize2, AlertTriangle, Download, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Layers } from 'lucide-react';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { downloadSnapshotFromElement } from '../services/download';
import { useTranslation } from 'react-i18next';
import { useInsomnia } from '../hooks/useInsomnia';
import { PTZControls } from '../components/monitors/PTZControls';
import { LiveMonitorPlayer } from '../components/monitors/LiveMonitorPlayer';
import { ViewOptionsMenu, FeedFitItems, AnalysisFramesItem, ViewOptionsSeparator } from '../components/common/view-options';
import { ZoneOverlay } from '../components/monitors/ZoneOverlay';
import { ZoneLegend } from '../components/monitors/ZoneLegend';
import { log, LogLevel } from '../lib/logger';
import { getOrientedResolution, parseMonitorRotation } from '../lib/monitor/monitor-rotation';
import { getMonitorRunState, monitorDotColor } from '../lib/monitor/monitor-status';
import { useZoomPan } from '../hooks/useZoomPan';
import { useScrollPad } from '../hooks/useScrollPad';
import { ScrollPad } from '../components/ui/scroll-pad';
import { useServerUrls } from '../hooks/useServerUrls';

// Extracted hooks and components
import { usePTZControl, useAlarmControl, useModeControl, useMonitorNavigation } from './hooks';

import { MonitorSettingsDialog } from '../components/monitor-detail/MonitorSettingsDialog';
import { usePermissions } from '../hooks/usePermissions';
import { canEditMonitorSettings } from '../lib/permissions/zm-permissions';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import { markPermissionDenied, useIsPermissionDenied } from '../stores/permissions';
import { MonitorControlsCard } from '../components/monitor-detail/MonitorControlsCard';
import { ZoomControls } from '../components/ui/zoom-controls';
import { ErrorBanner, DetailPageSkeleton } from '../components/ui/query-state';
import { MonitorRecentEvents } from '../components/monitors/MonitorRecentEvents';
import { useMainScrollRestoration } from '../hooks/useMainScrollRestoration';

/**
 * Resolves the API client for this page's owning profile: the /all/ route's
 * profileId when present, else the current profile via tryGetCurrentSession
 * (never throws - this page can render while All mode has no single current
 * profile). Callers only invoke this once `enabled`/render guards confirm an
 * owning profile actually exists, so the null branch is defensive, not
 * expected in practice.
 */
function resolveClient(routeProfileId: ProfileId | undefined): ApiClient {
  const session = routeProfileId ? getSession(routeProfileId) : tryGetCurrentSession();
  if (!session) {
    throw new Error('MonitorDetail: no session available for the owning profile');
  }
  return session.client;
}

export default function MonitorDetail() {
  const params = useParams<{ id?: string; profileId?: string; monitorId?: string }>();
  // Two route shapes render this page: single-mode `/monitors/:id` and the
  // All-mode deep route `/all/monitors/:profileId/:monitorId` (refs #337).
  // Only one half of each pair is ever defined, depending on which matched.
  const id = params.id ?? params.monitorId;
  const routeProfileId = params.profileId as ProfileId | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // This page scrolls the shared app-shell <main> (it has no overflow container
  // of its own). Restore that scroll position when returning from an event
  // opened in the recent-events list, instead of snapping to the top (refs #213).
  useMainScrollRestoration(location.key);

  // Local UI state
  const [showPTZ, setShowPTZ] = useState(true);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [protocol, setProtocol] = useState('MJPEG');
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  // Navigation state
  const referrer = location.state?.from as string | undefined;
  const canGoBack = referrer || window.history.length > 1;
  const goBack = () => referrer ? navigate(referrer) : canGoBack ? navigate(-1) : navigate('/monitors');

  // Profile and settings: routeProfileId when present (All-mode deep route),
  // else the current profile - useProfileById already implements that
  // fallback. ownerProfile stays null (same as today's !currentProfile) both
  // when no profile is selected at all AND when routeProfileId names an
  // unknown profile, so the existing error state below covers both cases
  // without new branching (refs #337).
  const { profile: ownerProfile, settings } = useProfileById(routeProfileId);
  const [isMuted, setMuted] = useMonitorMuted(ownerProfile?.id, id ?? '');
  const [openFullscreen] = useMonitorFlag(ownerProfile?.id, id ?? '', 'fullscreenMonitorIds');
  const [isFullscreen, setFullscreen] = useAutoFullscreen({
    startFullscreen: settings.monitorDetailFullscreen || openFullscreen,
    resetKey: id,
  });
  // One value for the picture and the zone overlay on top of it: the overlay
  // has to be letterboxed or cropped exactly as the feed is, or the zones sit
  // at a different scale than what they outline.
  const feedFit = isFullscreen ? 'contain' : settings.monitorDetailFeedFit;
  const accessToken = useAuthSlice(ownerProfile?.id ?? null).accessToken;
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const dataEnabled = !!id && !!ownerProfile;

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Fetch monitor data
  const { data: monitor, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.monitor(ownerProfile?.id, id),
    queryFn: () => getMonitor(resolveClient(routeProfileId), id!),
    enabled: dataEnabled,
  });

  // Fetch control capabilities if monitor is controllable
  const { data: controlData } = useQuery({
    queryKey: queryKeys.control(ownerProfile?.id, monitor?.Monitor.ControlId),
    queryFn: () => getControl(resolveClient(routeProfileId), monitor!.Monitor.ControlId!),
    enabled: dataEnabled && !!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1',
  });

  // Fetch zones when showZones is enabled
  const { data: zones = [], isLoading: isZonesLoading } = useQuery({
    queryKey: queryKeys.zones(ownerProfile?.id, id),
    queryFn: () => getZones(resolveClient(routeProfileId), id!),
    enabled: dataEnabled && showZones,
  });

  // Custom hooks for extracted logic
  const { isSliding, enabledMonitors, hasPrev, hasNext, onSwipeLeft, onSwipeRight } = useMonitorNavigation({
    currentMonitorId: id,
    cycleSeconds: settings.monitorDetailCycleSeconds,
    profileId: routeProfileId,
  });

  // Pinch-to-zoom and pan (zooms around focal point, pan when zoomed, swipe when not)
  const zoomPan = useZoomPan({
    maxScale: 4,
    swipeEnabled: !!enabledMonitors && enabledMonitors.length > 1,
    onSwipeLeft,
    onSwipeRight,
  });

  // Zoom belongs to the picture the user zoomed into, not to the page. Stepping
  // to another monitor keeps this component mounted (the route element is not
  // keyed on the id), so without this the next monitor arrived still magnified
  // and panned to the previous one's framing (refs #382). Covers every path
  // that changes the id in place: keyboard jump, prev/next, swipe, auto-cycle.
  const resetZoom = zoomPan.reset;
  useEffect(() => {
    resetZoom();
  }, [id, resetZoom]);

  // Remembered per profile: the video owns every drag that lands on it, so a
  // tablet wants the pad for good rather than once per visit.
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [showScrollPad, toggleScrollPad] = useScrollPad();

  const { portalPath, apiBaseUrl } = useServerUrls(monitor?.Monitor.ServerId, routeProfileId);
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : ownerProfile?.portalUrl || '';

  const { handlePTZCommand } = usePTZControl({
    portalUrl: resolvedPortalUrl,
    monitorId: monitor?.Monitor.Id || '',
    accessToken,
    minStreamingPort: resolveMinStreamingPort(ownerProfile?.minStreamingPort, settings.forceDisableMultiPort),
    profileId: routeProfileId,
  });

  const {
    hasAlarmStatus,
    displayAlarmArmed,
    alarmStatusLabel,
    isAlarmLoading,
    isAlarmUpdating,
    alarmBorderClass,
    handleAlarmToggle,
  } = useAlarmControl({
    monitorId: monitor?.Monitor.Id,
    apiBaseUrl,
    profileId: routeProfileId,
  });

  const { isModeUpdating, handleModeChange } = useModeControl({
    monitorId: monitor?.Monitor.Id,
    currentFunction: monitor?.Monitor.Function,
    onSuccess: refetch,
    profileId: routeProfileId,
  });

  // ZM version for feature detection
  const zmVersion = useAuthSlice(ownerProfile?.id ?? null).version;

  // Whether the settings dialog offers an editor at all. Unknown permissions
  // stay optimistic: System='None' with Monitors='Edit' is a legal account, so
  // only a real denial takes the editor away (refs #344).
  const { permissions } = usePermissions(ownerProfile?.id);
  const monitorEditRefused = useIsPermissionDenied(ownerProfile?.id, 'monitor-settings', id);
  const canEditSettings =
    canEditMonitorSettings(permissions) !== 'denied' && !monitorEditRefused;

  // Settings dialog save handler: batches all changes into one or more API calls
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleSaveSettings = useCallback(async (changes: Record<string, string | undefined>) => {
    if (!monitor?.Monitor.Id) return;
    setIsSavingSettings(true);
    try {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) params[`Monitor[${key}]`] = value;
      }
      if (Object.keys(params).length > 0) {
        await updateMonitor(resolveClient(routeProfileId), monitor.Monitor.Id, params);
      }
      await refetch();
      toast.success(t('monitor_detail.capture_updated'));
    } catch (error) {
      log.monitorDetail('Settings save failed', LogLevel.ERROR, { error });
      // ZoneMinder can refuse one monitor even when the account columns say
      // Edit, through per-monitor permission rows the API never exposes. Latch
      // it so the dialog stops offering an editor that cannot save (refs #344).
      if (isPermissionDenied(error) && ownerProfile) {
        markPermissionDenied(ownerProfile.id, 'monitor-settings', monitor.Monitor.Id);
        toast.error(t('common.permission_denied'));
      } else {
        toast.error(t('monitor_detail.capture_failed'));
      }
    } finally {
      setIsSavingSettings(false);
    }
  }, [monitor?.Monitor.Id, routeProfileId, refetch, t, ownerProfile]);

  // Computed values
  const orientedResolution = useMemo(
    () => getOrientedResolution(monitor?.Monitor.Width, monitor?.Monitor.Height, monitor?.Monitor.Orientation),
    [monitor?.Monitor.Height, monitor?.Monitor.Orientation, monitor?.Monitor.Width]
  );

  // Maximizing changes this session only. It used to write
  // `fullscreenMonitorIds`, which made every monitor ever maximized open
  // fullscreen forever, with the settings dialog as the only way out (#476).
  // The dialog's "Open in fullscreen" and the global live-view setting are
  // the persistent form; the button beside them does not need to be one.
  const handleToggleFullscreen = useCallback(() => {
    setFullscreen(!isFullscreen);
    zoomPan.reset();
  }, [zoomPan, isFullscreen, setFullscreen]);

  // Settings handlers - write to the OWNING profile's settings bucket, not
  // whichever profile is globally current (refs #337).
  const handleFeedFitChange = (value: string) => {
    if (!ownerProfile) return;
    updateSettings(ownerProfile.id, {
      monitorDetailFeedFit: value as typeof settings.monitorDetailFeedFit,
    });
  };

  const handleCycleSecondsChange = (value: string) => {
    if (!ownerProfile) return;
    const parsedValue = Number(value);
    updateSettings(ownerProfile.id, {
      monitorDetailCycleSeconds: Number.isFinite(parsedValue) ? parsedValue : 0,
    });
  };

  // Log monitor status for debugging
  if (monitor?.Monitor) {
    log.monitorDetail('Monitor loaded in Single View', LogLevel.INFO, {
      id: monitor.Monitor.Id,
      name: monitor.Monitor.Name,
      controllable: monitor.Monitor.Controllable,
    });
  }

  // Loading state
  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  // Error state. !ownerProfile covers both "no profile selected" (today's
  // behavior) and an unknown /all/ route profileId (refs #337) - never crash,
  // render the same banner either way.
  if (error || !monitor || !ownerProfile) {
    return (
      <div className="p-8">
        <ErrorBanner icon={AlertTriangle} message={t('monitor_detail.load_error')} />
        <Button onClick={goBack} className="mt-4">
          {t('common.go_back')}
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className={cn(
        'flex flex-col h-full',
        isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'bg-background'
      )}>
      {/* Header - Hidden in fullscreen */}
      {!isFullscreen && (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 md:top-[var(--sai-top,env(safe-area-inset-top))] z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            title={t('common.go_back')}
            aria-label={t('common.go_back')}
            className="h-8 w-8"
            data-testid="monitor-detail-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSwipeRight}
            disabled={!hasPrev}
            title={t('common.previous')}
            aria-label={t('common.previous')}
            className="h-7 w-7"
            data-testid="monitor-detail-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  monitorDotColor(getMonitorRunState(monitor.Monitor, monitor.Monitor_Status, zmVersion))
                )}
              />
              <h1 className="text-sm sm:text-base font-semibold" data-testid="monitor-detail-name">{monitor.Monitor.Name}</h1>
              <MonitorInfoPopover monitor={monitor.Monitor} className="h-6 w-6 flex items-center justify-center" iconClassName="h-4 w-4" />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSwipeLeft}
            disabled={!hasNext}
            title={t('common.next')}
            aria-label={t('common.next')}
            className="h-7 w-7"
            data-testid="monitor-detail-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <Button
            variant={showScrollPad ? 'default' : 'outline'}
            size="icon"
            title={t('common.scroll_buttons')}
            aria-label={t('common.scroll_buttons')}
            aria-pressed={showScrollPad}
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={toggleScrollPad}
            data-testid="scroll-pad-toggle"
          >
            <ChevronsUpDown className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('monitor_detail.settings')}
            aria-label={t('monitor_detail.settings')}
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={() => setShowSettingsDialog(true)}
            data-testid="monitor-detail-settings"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <ViewOptionsMenu testId="monitor-detail">
            <FeedFitItems
              value={settings.monitorDetailFeedFit}
              onChange={handleFeedFitChange}
              testIdPrefix="monitor-detail"
            />
            <ViewOptionsSeparator />
            {/* This page streams whatever the profile's Streaming Mode says,
                so the control stays usable under snapshot. */}
            <AnalysisFramesItem alwaysStreaming />
          </ViewOptionsMenu>
        </div>
      </div>
      )}

      {/* Fullscreen exit control, floating over the feed */}
      {isFullscreen && (
        <FullscreenExitButton title={monitor.Monitor.Name} onExit={handleToggleFullscreen} testIdPrefix="monitor-detail" />
      )}

      {/* Main Content */}
      <div className={cn(
        // min-h-0: a flex item's default min-height is its content, and the
        // feed's percentage height resolves to the image's natural aspect at
        // full width while that is measured. In landscape that is taller than
        // the screen, so the item grew past it and the frame lost its bottom.
        // With the floor removed the card is the screen and contain applies.
        'flex-1 flex flex-col items-center justify-center',
        isFullscreen
          ? 'min-h-0 overflow-hidden pt-[var(--sai-top,env(safe-area-inset-top))] pb-[var(--sai-bottom,env(safe-area-inset-bottom))] pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
          : 'p-2 sm:p-3 md:p-4 bg-muted/10'
      )}>
        <Card
          ref={zoomPan.ref}
          className={cn(
            'relative bg-black overflow-hidden border-0 touch-none transition-shadow',
            isFullscreen
              ? 'w-full h-full rounded-none shadow-none'
              : 'w-full max-w-5xl aspect-video shadow-2xl landscape:max-w-[calc((100svh-7rem)*16/9)]',
            isSliding && 'monitor-slide-in',
            alarmBorderClass
          )}
          data-testid="monitor-player"
        >
          <div ref={zoomPan.innerRef} data-testid="monitor-zoom-content">
            <LiveMonitorPlayer
              // Remount on monitor change so the stream gets a fresh connkey and
              // the old monitor's nph-zms connection is torn down immediately.
              // Without this the prev/next buttons change the name but the feed
              // keeps showing the previous monitor until the next token cycle
              // (~60s) rebuilds the stream URL (refs #201).
              key={monitor.Monitor.Id}
              monitor={monitor.Monitor}
              profile={ownerProfile}
              profileId={routeProfileId ?? undefined}
              externalMediaRef={mediaRef}
              objectFit={feedFit}
              showControls={true}
              onProtocolChange={setProtocol}
              forceViewMode="streaming"
              bypassGo2rtcFailureCache
              muted={isMuted}
              onMutedChange={setMuted}
            />
            <ZoneOverlay
              zones={zones}
              monitorWidth={Number(monitor.Monitor.Width) || 1920}
              monitorHeight={Number(monitor.Monitor.Height) || 1080}
              rotation={parseMonitorRotation(monitor.Monitor.Orientation)}
              monitorId={monitor.Monitor.Id}
              visible={showZones && !isZonesLoading}
              objectFit={feedFit}
            />
          </div>
          <ZoneLegend
            zones={zones}
            monitorId={monitor.Monitor.Id}
            visible={showZones && !isZonesLoading}
            positionClassName={cn(
              'left-2',
              isFullscreen
                ? 'top-[calc(0.5rem+var(--sai-top,env(safe-area-inset-top)))]'
                : 'top-2'
            )}
          />
          {settings.showProtocolLabel && (
            <span className="absolute bottom-2 right-2 z-10 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
              {protocol}
            </span>
          )}
          <ZoomControls
            zoomPan={zoomPan}
            className={cn(
              'bottom-2 left-2',
              isFullscreen && 'bottom-[calc(0.5rem+var(--sai-bottom,env(safe-area-inset-bottom)))]'
            )}
          />
        </Card>

        {/* Video Controls Bar - Hidden in fullscreen */}
        {!isFullscreen && (
        <div className="w-full max-w-5xl mt-2 px-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (mediaRef.current) {
                  downloadSnapshotFromElement(mediaRef.current, monitor.Monitor.Name)
                    .then(() =>
                      toast.success(t('monitor_detail.snapshot_saved', { name: monitor.Monitor.Name }))
                    )
                    .catch(() => toast.error(t('monitor_detail.snapshot_failed')));
                }
              }}
              title={t('monitor_detail.save_snapshot')}
              aria-label={t('monitor_detail.save_snapshot')}
              data-testid="snapshot-button"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant={showZones ? 'default' : 'outline'}
              aria-pressed={showZones}
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowZones(!showZones)}
              title={showZones ? t('monitor_detail.hide_zones') : t('monitor_detail.show_zones')}
              aria-label={showZones ? t('monitor_detail.hide_zones') : t('monitor_detail.show_zones')}
              data-testid="zone-toggle-button"
            >
              <Layers className={cn('h-4 w-4', isZonesLoading && 'animate-pulse')} />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleToggleFullscreen}
              title={t('monitor_detail.maximize')}
              aria-label={t('monitor_detail.maximize')}
              data-testid="monitor-detail-maximize"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        )}

        {/* PTZ Controls - Hidden in fullscreen */}
        {!isFullscreen && monitor.Monitor.Controllable === '1' && (
          <div className="mt-8 w-full max-w-md flex flex-col items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPTZ(!showPTZ)}
              className="mb-4 text-muted-foreground hover:text-foreground"
              data-testid="ptz-toggle"
            >
              {showPTZ ? t('ptz.hide_controls') : t('ptz.show_controls')}
              {showPTZ ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>

            {showPTZ && (
              <div className="w-full flex flex-col items-center gap-4">
                <PTZControls
                  onCommand={handlePTZCommand}
                  profileId={ownerProfile?.id}
                  className="w-full"
                  control={controlData?.control.Control}
                />
              </div>
            )}
          </div>
        )}

        {/* Recent events - Hidden in fullscreen. Sits below PTZ so the
            controls stay reachable without scrolling past the event list. */}
        {!isFullscreen && (
          <MonitorRecentEvents monitor={monitor.Monitor} profileId={routeProfileId} />
        )}

        {/* Monitor Controls Card - Hidden in fullscreen */}
        {!isFullscreen && (
        <div className="w-full max-w-5xl mt-8">
          <MonitorControlsCard
            zmVersion={zmVersion}
            hasAlarmStatus={hasAlarmStatus}
            displayAlarmArmed={displayAlarmArmed}
            alarmStatusLabel={alarmStatusLabel}
            isAlarmLoading={isAlarmLoading}
            isAlarmUpdating={isAlarmUpdating}
            onAlarmToggle={handleAlarmToggle}
            currentFunction={monitor.Monitor.Function}
            isModeUpdating={isModeUpdating}
            onModeChange={handleModeChange}
          />
        </div>
        )}
      </div>

      {/* Settings Dialog */}
      <MonitorSettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
        monitor={monitor.Monitor}
        zmVersion={zmVersion}
        onSave={canEditSettings ? handleSaveSettings : undefined}
        restrictedReason={monitorEditRefused ? 'monitor' : 'account'}
        isSaving={isSavingSettings}
        cycleSeconds={settings.monitorDetailCycleSeconds}
        onCycleSecondsChange={handleCycleSecondsChange}
        orientedResolution={orientedResolution}
        profileId={ownerProfile.id}
      />

      {showScrollPad && !isFullscreen && <ScrollPad targetRef={pageRef} />}
    </div>
  );
}
