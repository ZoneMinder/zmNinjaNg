/**
 * Montage Monitor Component
 *
 * Individual monitor tile for the montage grid view.
 * Features:
 * - Live streaming or snapshot mode (MJPEG or WebRTC)
 * - WebRTC monitors start muted to avoid cacophony
 * - Auto-reconnection on stream failure
 * - Header bar with action buttons (download, events, timeline, maximize)
 * - Drag handle for grid repositioning (in edit mode)
 * - Click to navigate to monitor detail view
 * - Fullscreen mode: header slides in on hover from top edge
 */

import { useState, useRef, memo, useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import type { Monitor, MonitorStatus, Profile } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { getMonitorRunState, monitorDotColor } from '../../lib/monitor-status';
import { MONITOR_UI } from '../../lib/zmninja-ng-constants';
import { useSettingsStore } from '../../stores/settings';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { LiveMonitorPlayer } from './LiveMonitorPlayer';
import { Clock, ChartGantt, Download, Volume2, VolumeX, Pin, MoreVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { downloadSnapshotFromElement } from '../../lib/download';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { handleKeyClick } from '../../lib/tv-a11y';
import { useNotificationStore } from '../../stores/notifications';

interface MontageMonitorProps {
  monitor: Monitor;
  status: MonitorStatus | undefined;
  currentProfile: Profile | null;
  accessToken: string | null;
  navigate: NavigateFunction;
  isFullscreen?: boolean;
  isEditing?: boolean;
  isPinned?: boolean;
  onPinToggle?: () => void;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  showOverlay?: boolean;
  /** Grid index, used to stagger Go2RTC connection starts across tiles. */
  staggerIndex?: number;
}

function MontageMonitorComponent({
  monitor,
  status,
  currentProfile,
  accessToken: _accessToken,
  navigate,
  isFullscreen = false,
  isEditing = false,
  isPinned = false,
  onPinToggle,
  objectFit,
  showOverlay = false,
  staggerIndex = 0,
}: MontageMonitorProps) {
  const { t } = useTranslation();
  const zmVersion = useAuthStore((s) => s.version);
  const runState = getMonitorRunState(monitor, status, zmVersion);
  const settings = useSettingsStore(
    useShallow((state) => state.getProfileSettings(currentProfile?.id || ''))
  );
  const [protocol, setProtocol] = useState('MJPEG');
  const [isMuted, setIsMuted] = useState(true);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const resolvedFit = objectFit ?? 'cover';
  const isRTC = monitor.Go2RTCEnabled === true && !!currentProfile?.go2rtcUrl;

  // Alarm pulse — subscribe to notification store for new events on this monitor
  const [isAlarming, setIsAlarming] = useState(false);
  const [monitorEventCount, setMonitorEventCount] = useState(0);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenRef = useRef(0);

  useEffect(() => {
    if (!currentProfile) return;
    const profileId = currentProfile.id;
    const monitorId = monitor.Id;

    const updateFromState = (state: { profileEvents: Record<string, Array<{ MonitorId: number; receivedAt: number }>> }) => {
      const events = state.profileEvents[profileId];
      if (!events?.length) return;
      const monitorEvents = events.filter((e) => String(e.MonitorId) === monitorId);
      setMonitorEventCount(monitorEvents.length);
      const latest = monitorEvents[0];
      if (!latest || latest.receivedAt === lastSeenRef.current) return;
      lastSeenRef.current = latest.receivedAt;
      if (Date.now() - latest.receivedAt < MONITOR_UI.alarmPulseMs) {
        if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
        setIsAlarming(true);
        alarmTimerRef.current = setTimeout(() => setIsAlarming(false), MONITOR_UI.alarmPulseMs);
      }
    };

    // Seed initial count and lastSeen
    const initialState = useNotificationStore.getState();
    const initialEvents = initialState.profileEvents[profileId];
    if (initialEvents?.length) {
      const count = initialEvents.filter((e) => String(e.MonitorId) === monitorId).length;
      setMonitorEventCount(count);
      const match = initialEvents.find((e) => String(e.MonitorId) === monitorId);
      if (match) lastSeenRef.current = match.receivedAt;
    }

    const unsub = useNotificationStore.subscribe(updateFromState);

    return () => {
      unsub();
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    };
  }, [currentProfile?.id, monitor.Id]);

  // Handle snapshot download
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mediaRef.current) {
      downloadSnapshotFromElement(mediaRef.current, monitor.Name)
        .then(() => toast.success(t('montage.snapshot_saved', { name: monitor.Name })))
        .catch(() => toast.error(t('montage.snapshot_failed')));
    }
  };

  return (
    <Card
      className={cn(
        "h-full overflow-hidden flex flex-col rounded-none relative",
        isFullscreen
          ? "border-none shadow-none bg-black m-0 p-0"
          : "border-0 shadow-none bg-card",
      )}
    >
      {/* Edit mode border — rendered as overlay to avoid compact CSS !important overrides */}
      {isEditing && !isFullscreen && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            border: isPinned ? '2px solid rgba(96, 165, 250, 0.7)' : '2px solid rgba(250, 204, 21, 0.7)',
          }}
        />
      )}
      {/* Header / Drag Handle - Toggled via toolbar button in fullscreen mode */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 h-8 shrink-0 select-none z-10",
          isFullscreen
            ? cn(
                "absolute top-0 left-0 right-0 bg-black/80 text-white transition-all duration-200",
                showOverlay ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
              )
            : "bg-card border-b",
          isEditing && !isFullscreen ? "hover:bg-accent/50" : "cursor-default",
          isAlarming && "montage-alarm-pulse"
        )}
      >
        {/* Monitor status and name */}
        <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
          <Badge
            variant="default"
            className={cn(
              "h-1.5 w-1.5 p-0 rounded-full shrink-0",
              monitorDotColor(runState)
            )}
          />
          <span className={cn(
            "text-xs font-medium truncate",
            isFullscreen && "text-white"
          )} title={monitor.Name}>
            {monitor.Name}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 relative",
              isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/events?monitorId=${monitor.Id}`);
            }}
            title={t('common.events')}
            aria-label={t('monitors.view_events')}
            data-testid="montage-events-btn"
          >
            <Clock className="h-3 w-3" />
            {monitorEventCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-destructive text-destructive-foreground opacity-50 text-[8px] font-medium flex items-center justify-center px-0.5 leading-none">
                {monitorEventCount > 99 ? '99+' : monitorEventCount}
              </span>
            )}
          </Button>
          {isRTC && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6",
                isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => {
                e.stopPropagation();
                setIsMuted((m) => !m);
              }}
              title={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
              aria-label={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
              data-testid="montage-volume-btn"
            >
              {isMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            </Button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6",
                  isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={(e) => e.stopPropagation()}
                data-testid="montage-more-btn"
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-[140px]">
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); handleDownload(e as unknown as React.MouseEvent); }}
                data-testid="montage-download-btn"
              >
                <Download className="h-3.5 w-3.5 mr-2" />
                {t('montage.save_snapshot')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); navigate(`/timeline?monitorId=${monitor.Id}`); }}
                data-testid="montage-timeline-btn"
              >
                <ChartGantt className="h-3.5 w-3.5 mr-2" />
                {t('sidebar.timeline')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Video Content */}
      <div
        className={cn(
          "flex-1 relative overflow-hidden",
          isFullscreen ? "bg-black" : "bg-black/90",
          !isFullscreen && "cursor-pointer"
        )}
        onClick={() => !isEditing && navigate(`/monitors/${monitor.Id}`)}
        onKeyDown={handleKeyClick}
        tabIndex={isEditing ? -1 : 0}
        role="button"
      >
        <LiveMonitorPlayer
          monitor={monitor}
          profile={currentProfile}
          externalMediaRef={mediaRef}
          objectFit={resolvedFit}
          muted={isMuted}
          className="w-full h-full"
          onProtocolChange={setProtocol}
          staggerIndex={staggerIndex}
        />
        {settings.montageShowToolbar && settings.showProtocolLabel && (
          <span className="absolute bottom-1.5 right-1.5 z-30 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
            {protocol}
          </span>
        )}
      </div>

      {/* Pin button — bottom-left corner, outside drag handle, edit mode only */}
      {isEditing && !isFullscreen && onPinToggle && (
        <button
          type="button"
          className={cn(
            "absolute bottom-1 left-1 z-30 rounded-full p-1.5 touch-manipulation transition-all no-drag",
            isPinned
              ? "bg-blue-500 text-white shadow-md"
              : "bg-black/50 text-white/70 hover:bg-black/70 hover:text-white"
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPinToggle(); }}
          title={isPinned ? t('montage.unpin_monitor') : t('montage.pin_monitor')}
          data-testid={`montage-pin-${monitor.Id}`}
        >
          <Pin className={cn("h-4 w-4", isPinned && "fill-current")} />
        </button>
      )}
    </Card>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders
// This is important because grid layout changes can trigger parent re-renders
// and we don't want to tear down and re-establish video streams unnecessarily
export const MontageMonitor = memo(MontageMonitorComponent);
