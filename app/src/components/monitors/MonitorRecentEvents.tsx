/**
 * Recent-events list under the live view on the monitor detail page.
 * Always-visible header (title, refresh, collapse, "All events"). The body is
 * collapsible per monitor; while collapsed the query is disabled (refs #213).
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { CompactEventRow } from '../events/CompactEventRow';
import { useMonitorRecentEvents } from '../../hooks/useMonitorRecentEvents';
import { useProfileById } from '../../hooks/useCurrentProfile';
import { useMonitorSeenStore } from '../../stores/monitorSeen';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { buildThumbnailChainForEvent, eventHasAlarmFrame } from '../../lib/event/thumbnail-chain';
import {
  calculateThumbnailDimensions,
  getMonitorDimensions,
  EVENT_GRID_CONSTANTS,
} from '../../lib/event/event-utils';
import type { Event, Monitor, ProfileId } from '../../api/types';

interface MonitorRecentEventsProps {
  monitor: Monitor;
  /** Owning profile for an /all/ deep route; defaults to the current profile. */
  profileId?: ProfileId;
}

export function MonitorRecentEvents({ monitor, profileId }: MonitorRecentEventsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile: ownerProfile, settings } = useProfileById(profileId);
  const { token: accessToken, isFresh } = useFreshAccessToken(profileId);
  const monitorId = monitor.Id;
  const { events, isLoading, isError, isFetching, hidden, count, toggleHidden, refetch } =
    useMonitorRecentEvents(monitorId, profileId);
  const markSeen = useMonitorSeenStore((s) => s.markSeen);

  // The list is on screen, so its events have been seen. Collapsed (`hidden`)
  // means the user opened this page for the live stream and never saw them.
  useEffect(() => {
    if (hidden || isLoading || events.length === 0) return;
    if (!ownerProfile) return;
    markSeen(ownerProfile.id, monitorId, events[0].Event.StartDateTime);
  }, [hidden, isLoading, events, ownerProfile, monitorId, markSeen]);

  const portalUrl = ownerProfile?.portalUrl || '';
  const thumbnailChain = settings.thumbnailFallbackChain;
  const minStreamingPort = resolveMinStreamingPort(
    ownerProfile?.minStreamingPort,
    settings.forceDisableMultiPort
  );
  const monitorsForResolve = [{ Monitor: monitor }];

  const buildRow = (ev: Event) => {
    const { width, height } = getMonitorDimensions(monitor, ev.Width, ev.Height);
    const { width: tw, height: th } = calculateThumbnailDimensions(
      width,
      height,
      monitor.Orientation ?? ev.Orientation,
      EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
    );
    const urls = buildThumbnailChainForEvent(ev.MonitorId, monitorsForResolve, portalUrl, ev.Id, thumbnailChain, {
      token: isFresh ? accessToken ?? undefined : undefined,
      width: tw,
      height: th,
      minStreamingPort,
      monitorId: ev.MonitorId,
      hasAlarmFrame: eventHasAlarmFrame(ev),
      profileId,
    });
    return { urls, aspectRatio: tw / th };
  };

  return (
    <div className="w-full max-w-5xl mt-4 px-2" data-testid="monitor-recent-events">
      <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
        <button
          type="button"
          onClick={toggleHidden}
          className="flex items-center gap-1.5 text-sm font-medium min-w-0"
          aria-expanded={!hidden}
          data-testid="monitor-recent-events-toggle"
        >
          {hidden ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="truncate">
            {t('monitor_detail.recent_events')}
            <span className="ml-1 font-normal text-muted-foreground">
              ({t('monitor_detail.recent_events_last', { count })})
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1">
          {!hidden && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refetch}
              disabled={isFetching}
              title={t('monitor_detail.refresh_events')}
              aria-label={t('monitor_detail.refresh_events')}
              data-testid="monitor-recent-events-refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate(
              profileId ? `/events?monitorId=${monitorId}&profileId=${profileId}` : `/events?monitorId=${monitorId}`
            )}
            data-testid="monitor-recent-events-all"
          >
            {t('monitor_detail.all_events')}
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </div>

      {!hidden && (
        <div className="pt-2" data-testid="monitor-recent-events-body">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-xs text-destructive py-2">
              <AlertCircle className="h-4 w-4" />
              {t('common.error')}
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              {t('monitor_detail.no_recent_events')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {events.map(({ Event: ev }) => {
                const { urls, aspectRatio } = buildRow(ev);
                return (
                  <CompactEventRow
                    key={ev.Id}
                    event={ev}
                    thumbnailUrls={urls}
                    aspectRatio={aspectRatio}
                    objectFit="contain"
                    profileId={profileId}
                    ownerProfileId={profileId ?? ownerProfile?.id}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
