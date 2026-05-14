/**
 * Monitor Detail Page
 *
 * Displays a continuous live stream for a single monitor (always streaming
 * mode — the global Snapshot setting does not apply here). Includes PTZ
 * controls (if applicable) and quick actions.
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMonitor, getControl, updateMonitor } from '../api/monitors';
import { getZones } from '../api/zones';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ArrowLeft, Settings, Maximize2, Minimize2, Clock, AlertTriangle, Download, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Layers, Video, Eye, Disc } from 'lucide-react';
import { useState, useRef, useMemo, useCallback } from 'react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { downloadSnapshotFromElement } from '../lib/download';
import { useTranslation } from 'react-i18next';
import { useInsomnia } from '../hooks/useInsomnia';
import { PTZControls } from '../components/monitors/PTZControls';
import { VideoPlayer } from '../components/video/VideoPlayer';
import { ZoneOverlay } from '../components/video/ZoneOverlay';
import { log, LogLevel } from '../lib/logger';
import { getOrientedResolution, parseMonitorRotation } from '../lib/monitor-rotation';
import { isZmVersionAtLeast } from '../lib/zm-version';
import { getMonitorRunState, monitorDotColor } from '../lib/monitor-status';
import { useZoomPan } from '../hooks/useZoomPan';
import { useServerUrls } from '../hooks/useServerUrls';

// Extracted hooks and components
import { usePTZControl, useAlarmControl, useModeControl, useMonitorNavigation } from './hooks';

import { MonitorSettingsDialog } from '../components/monitor-detail/MonitorSettingsDialog';
import { MonitorControlsCard } from '../components/monitor-detail/MonitorControlsCard';
import { ZoomControls } from '../components/ui/ZoomControls';

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // Local UI state
  const [showPTZ, setShowPTZ] = useState(true);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [protocol, setProtocol] = useState('MJPEG');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  // Navigation state
  const referrer = location.state?.from as string | undefined;
  const canGoBack = referrer || window.history.length > 1;
  const goBack = () => referrer ? navigate(referrer) : canGoBack ? navigate(-1) : navigate('/monitors');

  // Profile and settings
  const { currentProfile, settings } = useCurrentProfile();
  const accessToken = useAuthStore((state) => state.accessToken);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Fetch monitor data
  const { data: monitor, isLoading, error, refetch } = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => getMonitor(id!),
    enabled: !!id,
  });

  // Fetch control capabilities if monitor is controllable
  const { data: controlData } = useQuery({
    queryKey: ['control', monitor?.Monitor.ControlId],
    queryFn: () => getControl(monitor!.Monitor.ControlId!),
    enabled: !!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1',
  });

  // Fetch zones when showZones is enabled
  const { data: zones = [], isLoading: isZonesLoading } = useQuery({
    queryKey: ['zones', id],
    queryFn: () => getZones(id!),
    enabled: !!id && showZones,
  });

  // Custom hooks for extracted logic
  const { isSliding, enabledMonitors, hasPrev, hasNext, onSwipeLeft, onSwipeRight } = useMonitorNavigation({
    currentMonitorId: id,
    cycleSeconds: settings.monitorDetailCycleSeconds,
  });

  // Pinch-to-zoom and pan (zooms around focal point, pan when zoomed, swipe when not)
  const zoomPan = useZoomPan({
    minScale: 0.5,
    maxScale: 4,
    swipeEnabled: !!enabledMonitors && enabledMonitors.length > 1,
    onSwipeLeft,
    onSwipeRight,
  });

  const { portalPath, apiBaseUrl } = useServerUrls(monitor?.Monitor.ServerId);
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : currentProfile?.portalUrl || '';

  const { handlePTZCommand } = usePTZControl({
    portalUrl: resolvedPortalUrl,
    monitorId: monitor?.Monitor.Id || '',
    accessToken,
    minStreamingPort: currentProfile?.minStreamingPort,
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
  });

  const { isModeUpdating, handleModeChange } = useModeControl({
    monitorId: monitor?.Monitor.Id,
    currentFunction: monitor?.Monitor.Function,
    onSuccess: refetch,
  });

  // ZM version for feature detection
  const zmVersion = useAuthStore((s) => s.version);
  const is138Plus = isZmVersionAtLeast(zmVersion, '1.38.0');

  // Settings dialog save handler — batches all changes into one or more API calls
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
        await updateMonitor(monitor.Monitor.Id, params);
      }
      await refetch();
      toast.success(t('monitor_detail.capture_updated'));
    } catch (error) {
      log.monitorDetail('Settings save failed', LogLevel.ERROR, { error });
      toast.error(t('monitor_detail.capture_failed'));
    } finally {
      setIsSavingSettings(false);
    }
  }, [monitor?.Monitor.Id, refetch, t]);

  // Computed values
  const orientedResolution = useMemo(
    () => getOrientedResolution(monitor?.Monitor.Width, monitor?.Monitor.Height, monitor?.Monitor.Orientation),
    [monitor?.Monitor.Height, monitor?.Monitor.Orientation, monitor?.Monitor.Width]
  );

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    zoomPan.reset();
  }, [zoomPan]);

  // Settings handlers
  const handleFeedFitChange = (value: string) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, {
      monitorDetailFeedFit: value as typeof settings.monitorDetailFeedFit,
    });
  };

  const handleCycleSecondsChange = (value: string) => {
    if (!currentProfile) return;
    const parsedValue = Number(value);
    updateSettings(currentProfile.id, {
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
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
        <div className="aspect-video w-full max-w-4xl bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  // Error state
  if (error || !monitor || !currentProfile) {
    return (
      <div className="p-8">
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          {t('monitor_detail.load_error')}
        </div>
        <Button onClick={goBack} className="mt-4">
          {t('common.go_back')}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col h-full',
      isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'bg-background'
    )}>
      {/* Header - Hidden in fullscreen */}
      {!isFullscreen && (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label={t('common.go_back')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSwipeRight}
            disabled={!hasPrev}
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
              <h1 className="text-sm sm:text-base font-semibold">{monitor.Monitor.Name}</h1>
            </div>
            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground ml-3">
              {is138Plus ? (
                <>
                  <span className="flex items-center gap-0.5" title={t('monitors.capturing')}><Video className="h-2.5 w-2.5" />Cap: {monitor.Monitor.Capturing}</span>
                  <span className="flex items-center gap-0.5" title={t('monitors.analysing')}><Eye className="h-2.5 w-2.5" />Anl: {monitor.Monitor.Analysing}</span>
                  <span className="flex items-center gap-0.5" title={t('monitors.recording')}><Disc className="h-2.5 w-2.5" />Rec: {monitor.Monitor.Recording}</span>
                </>
              ) : (
                <span className="flex items-center gap-0.5" title={t('monitors.function')}><Video className="h-2.5 w-2.5" />{monitor.Monitor.Function}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSwipeLeft}
            disabled={!hasNext}
            aria-label={t('common.next')}
            className="h-7 w-7"
            data-testid="monitor-detail-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/events?monitorId=${monitor.Monitor.Id}`)}
            className="h-8 sm:h-9"
            title={t('monitor_detail.events')}
          >
            <Clock className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('monitor_detail.events')}</span>
          </Button>
          <Select value={settings.monitorDetailFeedFit} onValueChange={handleFeedFitChange}>
            <SelectTrigger className="h-8 sm:h-9 w-[100px]" data-testid="monitor-detail-fit-select">
              <SelectValue placeholder={t('monitor_detail.feed_fit')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contain" data-testid="monitor-detail-fit-contain">
                {t('montage.fit_fit')}
              </SelectItem>
              <SelectItem value="cover" data-testid="monitor-detail-fit-cover">
                {t('montage.fit_crop')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('monitor_detail.settings')}
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={() => setShowSettingsDialog(true)}
            data-testid="monitor-detail-settings"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        </div>
      </div>
      )}

      {/* Fullscreen exit bar */}
      {isFullscreen && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-black/50 backdrop-blur-sm pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))] pt-[var(--sai-top,env(safe-area-inset-top))]"
          data-testid="monitor-detail-fullscreen-toolbar"
        >
          <div className="h-8 flex items-center justify-between px-3">
            <span className="text-white/70 font-medium text-xs truncate min-w-0" title={monitor.Monitor.Name}>
              {monitor.Monitor.Name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="bg-red-600/80 hover:bg-red-600 text-white h-7 px-2 text-xs"
              onClick={handleToggleFullscreen}
              aria-label={t('monitor_detail.exit_fullscreen')}
              data-testid="monitor-detail-exit-fullscreen"
            >
              <Minimize2 className="h-3.5 w-3.5 mr-1" />
              {t('monitor_detail.exit_fullscreen')}
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={cn(
        'flex-1 flex flex-col items-center justify-center',
        isFullscreen
          ? 'pt-[calc(2rem+var(--sai-top,env(safe-area-inset-top)))] pb-[var(--sai-bottom,env(safe-area-inset-bottom))] pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
          : 'p-2 sm:p-3 md:p-4 bg-muted/10'
      )}>
        <Card
          ref={zoomPan.ref}
          className={cn(
            'relative bg-black overflow-hidden border-0 touch-none transition-shadow',
            isFullscreen
              ? 'w-full h-full rounded-none shadow-none'
              : 'w-full max-w-5xl aspect-video shadow-2xl landscape:max-w-[calc((100vh-6rem)*16/9)]',
            isSliding && 'monitor-slide-in',
            alarmBorderClass
          )}
        >
          <div ref={zoomPan.innerRef}>
            <VideoPlayer
              monitor={monitor.Monitor}
              profile={currentProfile}
              externalMediaRef={mediaRef}
              objectFit={isFullscreen ? 'contain' : settings.monitorDetailFeedFit}
              showControls={true}
              className="data-[testid=monitor-player]"
              onProtocolChange={setProtocol}
              forceViewMode="streaming"
            />
            <ZoneOverlay
              zones={zones}
              monitorWidth={Number(monitor.Monitor.Width) || 1920}
              monitorHeight={Number(monitor.Monitor.Height) || 1080}
              rotation={parseMonitorRotation(monitor.Monitor.Orientation)}
              monitorId={monitor.Monitor.Id}
              visible={showZones && !isZonesLoading}
            />
          </div>
          {settings.showProtocolLabel && (
            <span className="absolute bottom-2 right-2 z-10 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
              {protocol}
            </span>
          )}
          <ZoomControls
            onZoomIn={zoomPan.zoomIn}
            onZoomOut={zoomPan.zoomOut}
            onReset={zoomPan.reset}
            onPanLeft={zoomPan.panLeft}
            onPanRight={zoomPan.panRight}
            onPanUp={zoomPan.panUp}
            onPanDown={zoomPan.panDown}
            isZoomed={zoomPan.isZoomed}
            scale={zoomPan.scale}
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
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate(`/events?monitorId=${monitor.Monitor.Id}`)}
              title={t('monitor_detail.view_events')}
              aria-label={t('monitor_detail.view_events')}
            >
              <Clock className="h-4 w-4" />
            </Button>
            <Button
              variant={showZones ? 'secondary' : 'ghost'}
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
            >
              {showPTZ ? t('ptz.hide_controls') : t('ptz.show_controls')}
              {showPTZ ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>

            {showPTZ && (
              <div className="w-full flex flex-col items-center gap-4">
                <PTZControls
                  onCommand={handlePTZCommand}
                  className="w-full"
                  control={controlData?.control.Control}
                />
              </div>
            )}
          </div>
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
        onSave={handleSaveSettings}
        isSaving={isSavingSettings}
        cycleSeconds={settings.monitorDetailCycleSeconds}
        onCycleSecondsChange={handleCycleSecondsChange}
        orientedResolution={orientedResolution}
      />
    </div>
  );
}
