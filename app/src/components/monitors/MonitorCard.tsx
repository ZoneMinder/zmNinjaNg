/**
 * Monitor Card Component
 *
 * Displays a single monitor with a live stream preview (or static image),
 * status information, and quick action buttons.
 * It handles stream connection regeneration and snapshot downloading.
 */

import { memo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { ProfileChip } from '../ui/profile-chip';
import { Button, HintButton } from '../ui/button';
import { Activity, Settings, Download, Clock, Volume2, VolumeX } from 'lucide-react';
import { cn, formatEventCount } from '../../lib/utils';
import { handleKeyClick } from '../../lib/tv/tv-a11y';
import { downloadSnapshotFromElement } from '../../services/download';
import { toast } from 'sonner';
import { LiveMonitorPlayer } from './LiveMonitorPlayer';
import { MonitorHoverPreview } from './MonitorHoverPreview';
import { useProfileById } from '../../hooks/useCurrentProfile';
import type { MonitorCardProps, ProfileId } from '../../api/types';
import { log, LogLevel } from '../../lib/logger';
import { useTranslation } from 'react-i18next';
import { getMonitorAspectRatio } from '../../lib/monitor/monitor-rotation';
import { getMonitorRunState, monitorDotColor } from '../../lib/monitor/monitor-status';
import { useAuthSlice } from '../../stores/auth';
import { useOpenMonitorEvents } from '../../hooks/useOpenMonitorEvents';
import { useMonitorMuted } from '../../hooks/useMonitorMuted';
import { MonitorInfoPopover } from './MonitorInfoPopover';

interface MonitorCardComponentProps extends MonitorCardProps {
  /** Callback to open the settings dialog for this monitor. `profileId` is
   *  the owning profile in All mode, so the caller can save against the
   *  right session (undefined in single mode: use the current profile). */
  onShowSettings: (monitor: MonitorCardProps['monitor'], profileId?: ProfileId | null) => void;
}

/**
 * MonitorCard component.
 * Renders a card with monitor details and a live stream/image.
 *
 * @param props - Component properties
 * @param props.monitor - The monitor data object
 * @param props.status - The current status of the monitor (Connected/Disconnected, FPS, etc.)
 * @param props.newEventCount - Events recorded since the user last looked at this monitor
 * @param props.onShowSettings - Callback when settings button is clicked
 */
function MonitorCardComponent({
  monitor,
  status,
  newEventCount,
  newestEventAt,
  onShowSettings,
  objectFit,
  compact,
  profileId,
  profileChip,
}: MonitorCardComponentProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // profileId is set only in All mode (see useScopedMonitors); resolving via
  // useProfileById rather than useCurrentProfile means the card's stream,
  // settings, and go2rtc URL all come from the monitor's OWN server instead
  // of the globally-selected profile.
  const { profile: ownerProfile, settings } = useProfileById(profileId);
  const zmVersion = useAuthSlice(ownerProfile?.id ?? null).version;
  const openMonitorEvents = useOpenMonitorEvents();
  const resolvedFit = (objectFit === 'flex' ? 'cover' : (objectFit ?? 'cover')) as 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  const [protocol, setProtocol] = useState('MJPEG');
  const [isMuted, setMuted] = useMonitorMuted(ownerProfile?.id, monitor.Id);
  const runState = getMonitorRunState(monitor, status, zmVersion);
  const isRTC = monitor.Go2RTCEnabled === true && !!ownerProfile?.go2rtcUrl;
  const aspectRatio = getMonitorAspectRatio(monitor.Width, monitor.Height, monitor.Orientation);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const showHover = compact ? settings.hoverPreview.monitorsGrid : settings.hoverPreview.monitorsList;

  const videoPlayer = (
    <LiveMonitorPlayer
      monitor={monitor}
      profile={ownerProfile}
      profileId={profileId}
      className="w-full h-full"
      objectFit={resolvedFit}
      externalMediaRef={mediaRef}
      muted={isMuted}
      onProtocolChange={setProtocol}
    />
  );
  const wrappedVideo = showHover ? (
    <MonitorHoverPreview monitor={monitor} profileId={profileId}>{videoPlayer}</MonitorHoverPreview>
  ) : videoPlayer;

  /**
   * Downloads a snapshot of the current stream frame.
   */
  const handleDownloadSnapshot = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mediaRef.current) {
      try {
        await downloadSnapshotFromElement(mediaRef.current, monitor.Name);
        toast.success(t('monitors.snapshot_downloaded'));
      } catch (error) {
        log.monitorCard('Failed to download snapshot', LogLevel.ERROR, error);
        toast.error(t('monitors.snapshot_failed'));
      }
    }
  };

  const handleShowSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowSettings(monitor, profileId);
  };

  // The Events page aggregates in All mode (refs #337, Task 4), so this
  // navigates directly with the owning profileId - no switch-then-navigate
  // needed (detail view already does the same via goToDetail's deep route).
  const openEvents = () => {
    openMonitorEvents({
      monitorId: monitor.Id,
      newEventCount,
      newestEventAt,
      from: '/monitors',
      profileId: profileId ?? undefined,
    });
  };

  const goToDetail = () => {
    navigate(
      profileId != null ? `/all/monitors/${profileId}/${monitor.Id}` : `/monitors/${monitor.Id}`,
      { state: { from: '/monitors' } }
    );
  };

  if (compact) {
    return (
      <Card
        className="group overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-card ring-1 ring-border/50 hover:ring-primary/50"
        data-testid="monitor-card"
        data-monitor-id={monitor.Id}
      >
        <div
          className="relative bg-card cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
          style={{ aspectRatio: aspectRatio ?? '16 / 9' }}
          onClick={goToDetail}
          onKeyDown={handleKeyClick}
          tabIndex={0}
          role="button"
          data-testid="monitor-player"
        >
          {wrappedVideo}
          <div className="absolute top-1.5 left-1.5 z-10">
            <span
              className={cn('block h-2 w-2 rounded-full shadow-sm', monitorDotColor(runState))}
            />
          </div>
          {settings.showProtocolLabel && (
            <span className="absolute bottom-1 right-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
              {protocol}
            </span>
          )}
        </div>
        <div className="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="text-xs font-semibold truncate flex-1 min-w-0" title={monitor.Name} data-testid="monitor-name">{monitor.Name}</div>
            {profileChip && (
              <ProfileChip name={profileChip} testId="monitor-profile-chip" />
            )}
            {isRTC && (
              <HintButton
                type="button"
                className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); setMuted(!isMuted); }}
                title={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
                aria-label={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
                data-testid="monitor-volume-btn"
              >
                {isMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
              </HintButton>
            )}
            <MonitorInfoPopover monitor={monitor} className="h-4 w-4" iconClassName="h-3 w-3" />
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
              {monitor.Id}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{status?.CaptureFPS || '0'} FPS</span>
            <span>&middot;</span>
            <span data-testid="monitor-resolution">{monitor.Width}x{monitor.Height}</span>
            {monitor.Controllable === '1' && (
              <>
                <span>&middot;</span>
                <span className="text-blue-600 dark:text-blue-400">PTZ</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 pt-0.5 min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-6 px-2 relative flex-1 min-w-0"
              onClick={openEvents}
              data-testid="monitor-events-button"
            >
              <Clock className="h-2.5 w-2.5 mr-0.5 shrink-0" />
              <span className="truncate">{t('sidebar.events')}</span>
              {newEventCount !== undefined && newEventCount > 0 && (
                <Badge
                  variant="info"
                  className="ml-0.5 px-0.5 py-0 text-[8px] h-3 min-w-3 shrink-0"
                  data-testid="monitor-new-events-badge"
                  aria-label={t('monitors.new_events_count', { count: newEventCount })}
                >
                  {formatEventCount(newEventCount)}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-6 px-2 flex-1 min-w-0"
              onClick={handleShowSettings}
              data-testid="monitor-settings-button"
            >
              <Settings className="h-2.5 w-2.5 mr-0.5 shrink-0" />
              <span className="truncate">{t('sidebar.settings')}</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={handleDownloadSnapshot}
              title={t('monitors.download_snapshot')}
              data-testid="monitor-download-button"
            >
              <Download className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="group overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-card ring-1 ring-border/50 hover:ring-primary/50"
      data-testid="monitor-card"
      data-monitor-id={monitor.Id}
    >
      <div className="flex flex-row gap-4 p-4">
        {/* Thumbnail Preview - Clickable */}
        <div
          className="relative bg-muted/30 rounded overflow-hidden cursor-pointer w-[40%] shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
          style={{ aspectRatio: aspectRatio ?? '16 / 9' }}
          onClick={goToDetail}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goToDetail();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`${t('monitors.view_live')}: ${monitor.Name}`}
          data-testid="monitor-player"
        >
          {wrappedVideo}
          {settings.showProtocolLabel && (
            <span className="absolute bottom-1 right-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
              {protocol}
            </span>
          )}
        </div>

        {/* Monitor Info & Controls */}
        <div className="flex-1 flex flex-col gap-3 sm:gap-4">
          {/* Name & Resolution */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={cn('block h-2 w-2 rounded-full shrink-0', monitorDotColor(runState))}
                data-testid="monitor-status"
              />
              <div className="font-semibold text-base truncate" data-testid="monitor-name">{monitor.Name}</div>
              <MonitorInfoPopover monitor={monitor} className="h-5 w-5" />
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
                ID: {monitor.Id}
              </Badge>
              {profileChip && (
                <span
                  className="text-[10px] px-1.5 py-0 h-5 rounded bg-muted text-muted-foreground truncate max-w-[120px] shrink-0"
                  title={profileChip}
                  data-testid="monitor-profile-chip"
                >
                  {profileChip}
                </span>
              )}
              {isRTC && (
                <HintButton
                  type="button"
                  className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); setMuted(!isMuted); }}
                  title={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
                  aria-label={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
                  data-testid="monitor-volume-btn"
                >
                  {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </HintButton>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                {status?.CaptureFPS || '0'} FPS
              </span>
              <span data-testid="monitor-resolution">
                {monitor.Width}x{monitor.Height}
              </span>
              {monitor.Controllable === '1' && (
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <Activity className="h-3 w-3" />
                  {t('monitors.ptz_capable')}
                </span>
              )}
            </div>
          </div>


          {/* Quick Actions */}
          <div className="flex items-center gap-2 pt-1 min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 relative min-w-0 max-w-[45%]"
              onClick={openEvents}
              data-testid="monitor-events-button"
            >
              <Clock className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{t('sidebar.events')}</span>
              {newEventCount !== undefined && newEventCount > 0 && (
                <Badge
                  variant="info"
                  className="ml-1 px-1 py-0 text-[10px] h-4 min-w-4 shrink-0"
                  data-testid="monitor-new-events-badge"
                  aria-label={t('monitors.new_events_count', { count: newEventCount })}
                >
                  {formatEventCount(newEventCount)}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 min-w-0 max-w-[45%]"
              onClick={handleShowSettings}
              data-testid="monitor-settings-button"
            >
              <Settings className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{t('sidebar.settings')}</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleDownloadSnapshot}
              title={t('monitors.download_snapshot')}
              aria-label={t('monitors.download_snapshot')}
              data-testid="monitor-download-button"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Memoize to prevent unnecessary re-renders when monitor data hasn't changed
export const MonitorCard = memo(MonitorCardComponent);
