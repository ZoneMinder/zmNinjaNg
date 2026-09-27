/**
 * One row in the notification history list.
 *
 * Resolves its OWNING profile (portal URL, settings, access token) rather
 * than the page's current/global profile, so an All-mode union list renders
 * every row with the right server's thumbnail chain even though event ids
 * can collide across profiles - same per-row pattern as EventListView's
 * EventItem (refs #337).
 */

import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, ExternalLink, Wifi, Smartphone, RefreshCw } from 'lucide-react';
import type { NotificationEvent } from '../../stores/notifications';
import type { ProfileId } from '../../api/types';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { buildThumbnailChain } from '../../lib/event/thumbnail-chain';
import { EventThumbnail } from '../events/EventThumbnail';
import { HoverPreview } from '../ui/hover-preview';
import { EventZmsHoverPlayer } from '../events/EventThumbnailHoverPreview';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getEventCauseIcon } from '../../lib/event/event-icons';
import { formatDistanceToNow } from 'date-fns';
import { activateOnEnterOrSpace } from '../../lib/utils';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';

export interface HistoryEvent extends NotificationEvent {
  profileId: ProfileId;
  profileName: string;
}

interface NotificationHistoryItemProps {
  event: HistoryEvent;
  /** Show the owning-profile chip: All mode only. */
  showProfileChip: boolean;
  onView: (event: HistoryEvent) => void;
  onMarkRead: (event: HistoryEvent) => void;
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'push') return <Smartphone className="h-3 w-3" />;
  if (source === 'poll') return <RefreshCw className="h-3 w-3" />;
  return <Wifi className="h-3 w-3" />;
}

function NotificationHistoryItemComponent({ event, showProfileChip, onView, onMarkRead }: NotificationHistoryItemProps) {
  const { t } = useTranslation();
  const { profile, settings } = useProfileById(event.profileId);
  // Previews are selection-scoped: they follow the current selection, not
  // the owning server (refs #536).
  const { settings: selectionSettings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(event.profileId);
  const { fmtDateTimeShort } = useDateTimeFormat();

  const causeDisplay = event.Cause.split('|')[0].trim();
  // EventId 0 means the push had no ZM event (issue #242): nothing to open
  // and no image to fetch, so the row is not clickable.
  const canView = event.EventId > 0;

  const chainUrls = useMemo(() => {
    if (!profile || !canView) return [];
    return buildThumbnailChain(profile.portalUrl, String(event.EventId), settings.thumbnailFallbackChain, {
      token: isAccessTokenFresh ? accessToken ?? undefined : undefined,
      minStreamingPort: resolveMinStreamingPort(profile.minStreamingPort, settings.forceDisableMultiPort),
    });
  }, [profile, canView, event.EventId, settings.thumbnailFallbackChain, settings.forceDisableMultiPort, accessToken, isAccessTokenFresh]);

  const handleClick = useCallback(() => {
    if (canView) onView(event);
  }, [canView, onView, event]);

  return (
    <div
      className={`flex items-center gap-3 p-2 sm:p-3 transition-colors ${canView ? 'hover:bg-muted/50 cursor-pointer' : ''} ${event.read ? 'opacity-50' : ''}`}
      role={canView ? 'button' : undefined}
      tabIndex={canView ? 0 : undefined}
      onClick={canView ? handleClick : undefined}
      onKeyDown={canView ? activateOnEnterOrSpace(handleClick) : undefined}
      data-testid="notification-history-item"
    >
      {/* Thumbnail */}
      {canView ? (
        <div className="h-14 w-20 rounded border overflow-hidden bg-muted/30 flex-shrink-0">
          {selectionSettings.hoverPreview.notifications ? (
            <HoverPreview
              aspectRatio={16 / 9}
              testId="event-thumbnail-hover-preview"
              renderPreview={() => (
                <EventZmsHoverPlayer
                  descriptor={{
                    eventId: String(event.EventId),
                    monitorId: String(event.MonitorId),
                    name: event.MonitorName,
                    profileId: event.profileId,
                  }}
                />
              )}
            >
              <EventThumbnail
                urls={chainUrls}
                cacheKey={`notif-${event.profileId}-${event.EventId}`}
                alt={`Event ${event.EventId}`}
                className="h-full w-full"
                objectFit="cover"
              />
            </HoverPreview>
          ) : (
            <EventThumbnail
              urls={chainUrls}
              cacheKey={`notif-${event.profileId}-${event.EventId}`}
              alt={`Event ${event.EventId}`}
              className="h-full w-full"
              objectFit="cover"
            />
          )}
        </div>
      ) : (
        <div className="h-14 w-20 rounded border overflow-hidden bg-muted/30 flex-shrink-0">
          {/* No ZM event: show the shared no-image placeholder, never fetch (issue #242) */}
          <EventThumbnail
            urls={[]}
            cacheKey={`notif-noevent-${event.profileId}-${event.receivedAt}`}
            alt={event.MonitorName}
            className="h-full w-full"
            objectFit="cover"
          />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold truncate">{event.MonitorName}</span>
          {showProfileChip && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1 shrink-0 max-w-[8rem] truncate"
              title={event.profileName}
              data-testid="notification-profile-chip"
            >
              {event.profileName}
            </Badge>
          )}
          {!event.read && (
            <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">
              {t('notification_history.new')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
          {(() => {
            const CauseIcon = getEventCauseIcon(causeDisplay);
            return <CauseIcon className="h-3 w-3 shrink-0" />;
          })()}
          <span className="truncate">{causeDisplay}</span>
          {event.Notes && (
            <>
              <span className="shrink-0">·</span>
              <span className="truncate hidden sm:inline" title={event.Notes}>{event.Notes.split('|')[0].trim()}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 mt-0.5 flex-wrap">
          <span>{fmtDateTimeShort(new Date(event.receivedAt))}</span>
          <span>·</span>
          <SourceIcon source={event.source} />
          <span>{formatDistanceToNow(event.receivedAt, { addSuffix: true })}</span>
        </div>
        {canView && (
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50 mt-0.5">
            <span>{t('notification_history.event_id', { id: event.EventId })}</span>
            <span>·</span>
            <span>{t('notification_history.monitor_id', { id: event.MonitorId })}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0" role="presentation" onClick={(e) => e.stopPropagation()}>
        {!event.read && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onMarkRead(event)}
            data-testid="mark-read"
          >
            <CheckCheck className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">{t('notification_history.mark_read')}</span>
          </Button>
        )}
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

// memo()-wrapped (same pattern as EventCard/EventMontageTile): this
// list-item component re-renders once per row on every notification-store
// update, and skips rows whose own props haven't changed.
export const NotificationHistoryItem = memo(NotificationHistoryItemComponent);
