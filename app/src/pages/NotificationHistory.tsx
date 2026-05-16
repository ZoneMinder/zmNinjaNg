/**
 * Notification History Page
 *
 * Displays a list of past notifications.
 * Allows users to view event details, mark as read, or clear history.
 */

import { useState, useMemo, useCallback } from 'react';
import { useNotificationStore } from '../stores/notifications';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { buildThumbnailChain } from '../lib/thumbnail-chain';
import { EventThumbnail } from '../components/events/EventThumbnail';
import { HoverPreview } from '../components/ui/hover-preview';
import { EventZmsHoverPlayer } from '../components/events/EventThumbnailHoverPreview';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Bell, Trash2, CheckCheck, ExternalLink, AlertCircle, Wifi, Smartphone, RefreshCw } from 'lucide-react';
import { getEventCauseIcon } from '../lib/event-icons';
import { formatDistanceToNow, isToday, isYesterday, startOfWeek, startOfMonth } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';
import { PageContainer } from '../components/common/PageContainer';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';

export default function NotificationHistory() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const { getEvents, getUnreadCount, markEventRead, markAllRead, clearEvents } = useNotificationStore();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const { fmtDateTimeShort } = useDateTimeFormat();
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  // Get events and unread count for current profile
  const events = currentProfile ? getEvents(currentProfile.id) : [];
  const unreadCount = currentProfile ? getUnreadCount(currentProfile.id) : 0;

  const handleViewEvent = (eventId: number) => {
    if (currentProfile) {
      markEventRead(currentProfile.id, eventId);
    }
    navigate(`/events/${eventId}`);
  };

  const handleMarkAllRead = () => {
    if (currentProfile) {
      markAllRead(currentProfile.id);
    }
  };

  const handleClearEvents = () => {
    if (currentProfile) {
      clearEvents(currentProfile.id);
    }
  };

  /** Build the thumbnail fallback chain URLs for a notification event. */
  const buildChainForEvent = useCallback(
    (eventId: number) => {
      if (!currentProfile) return [];
      return buildThumbnailChain(
        currentProfile.portalUrl,
        String(eventId),
        settings.thumbnailFallbackChain,
        {
          token: isAccessTokenFresh ? accessToken ?? undefined : undefined,
          minStreamingPort: currentProfile.minStreamingPort,
        }
      );
    },
    [currentProfile, accessToken, isAccessTokenFresh, settings.thumbnailFallbackChain]
  );

  type DateSection = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'older';

  const getDateSection = useCallback((timestamp: number): DateSection => {
    const date = new Date(timestamp);
    if (isToday(date)) return 'today';
    if (isYesterday(date)) return 'yesterday';
    const now = new Date();
    if (date >= startOfWeek(now, { weekStartsOn: 1 })) return 'this_week';
    if (date >= startOfMonth(now)) return 'this_month';
    return 'older';
  }, []);

  const groupedEvents = useMemo(() => {
    const sections: { key: DateSection; label: string; events: typeof events }[] = [
      { key: 'today', label: t('notification_history.today'), events: [] },
      { key: 'yesterday', label: t('notification_history.yesterday'), events: [] },
      { key: 'this_week', label: t('notification_history.this_week'), events: [] },
      { key: 'this_month', label: t('notification_history.this_month'), events: [] },
      { key: 'older', label: t('notification_history.older'), events: [] },
    ];
    for (const event of events) {
      const section = getDateSection(event.receivedAt);
      sections.find((s) => s.key === section)!.events.push(event);
    }
    return sections.filter((s) => s.events.length > 0);
  }, [events, getDateSection, t]);

  // Source icon component
  const SourceIcon = ({ source }: { source: string }) => {
    if (source === 'push') return <Smartphone className="h-3 w-3" />;
    if (source === 'poll') return <RefreshCw className="h-3 w-3" />;
    return <Wifi className="h-3 w-3" />;
  };

  // Early return if no profile
  if (!currentProfile) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center space-y-2">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="text-base font-semibold">{t('notification_history.no_profile')}</h2>
            <p className="text-sm text-muted-foreground">{t('notification_history.select_profile_first')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageContainer
      spacing="none"
      className="space-y-3 sm:space-y-4"
      data-testid="notification-history"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-tight">
            {t('notification_history.title')}
          </h1>
          <NotificationBadge />
        </div>
        <div className="flex gap-1.5">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead} size="sm" className="h-8">
              <CheckCheck className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t('notification_history.mark_all_read')}</span>
            </Button>
          )}
          {events.length > 0 && (
            <Button variant="destructive" onClick={() => setIsClearDialogOpen(true)} size="sm" className="h-8" data-testid="clear-history-button">
              <Trash2 className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t('notification_history.clear_all')}</span>
            </Button>
          )}
        </div>
      </div>

      {events.length === 0 ? (
        <Card data-testid="notification-history-empty">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="text-sm font-semibold mb-1">{t('notification_history.no_notifications')}</h3>
            <p className="text-xs text-muted-foreground text-center max-w-md">
              {t('notification_history.no_notifications_desc')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0" data-testid="notification-history-list">
          {groupedEvents.map((section) => (
            <div key={section.key}>
              {/* Section header: bubble + line */}
              <div className="flex items-center gap-3 my-3" data-testid={`section-${section.key}`}>
                <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full shrink-0">
                  {section.label}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {/* Events in section */}
              <div className="border rounded-md divide-y overflow-hidden">
                {section.events.map((event) => {
                  const causeDisplay = event.Cause.split('|')[0].trim();
                  const CauseIcon = getEventCauseIcon(causeDisplay);
                  return (
                    <div
                      key={`${event.EventId}-${event.receivedAt}`}
                      className={`flex items-center gap-3 p-2 sm:p-3 hover:bg-muted/50 cursor-pointer transition-colors ${event.read ? 'opacity-50' : ''}`}
                      onClick={() => handleViewEvent(event.EventId)}
                      data-testid="notification-history-item"
                    >
                      {/* Thumbnail */}
                      {event.EventId ? (
                        <div className="h-14 w-20 rounded border overflow-hidden bg-muted/30 flex-shrink-0">
                          {settings.hoverPreview.notifications ? (
                            <HoverPreview
                              aspectRatio={16 / 9}
                              testId="event-thumbnail-hover-preview"
                              renderPreview={() => (
                                <EventZmsHoverPlayer
                                  descriptor={{
                                    eventId: String(event.EventId),
                                    monitorId: String(event.MonitorId),
                                    name: event.MonitorName,
                                  }}
                                />
                              )}
                            >
                              <EventThumbnail
                                urls={buildChainForEvent(event.EventId)}
                                cacheKey={`notif-${event.EventId}`}
                                alt={`Event ${event.EventId}`}
                                className="h-full w-full"
                                objectFit="cover"
                              />
                            </HoverPreview>
                          ) : (
                            <EventThumbnail
                              urls={buildChainForEvent(event.EventId)}
                              cacheKey={`notif-${event.EventId}`}
                              alt={`Event ${event.EventId}`}
                              className="h-full w-full"
                              objectFit="cover"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="h-14 w-20 rounded border bg-muted/30 flex items-center justify-center flex-shrink-0">
                          <Bell className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate">{event.MonitorName}</span>
                          {!event.read && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">
                              {t('notification_history.new')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <CauseIcon className="h-3 w-3 shrink-0" />
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
                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50 mt-0.5">
                          <span>{t('notification_history.event_id', { id: event.EventId })}</span>
                          <span>·</span>
                          <span>{t('notification_history.monitor_id', { id: event.MonitorId })}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {!event.read && currentProfile && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => markEventRead(currentProfile.id, event.EventId)}
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
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="text-center text-xs text-muted-foreground">
          {t('notification_history.showing_count', { count: events.length })}
        </div>
      )}

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent data-testid="clear-history-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notification_history.clear_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('notification_history.clear_confirm_desc', { count: events.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="clear-history-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearEvents}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="clear-history-confirm"
            >
              {t('notification_history.clear_all')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
