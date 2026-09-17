/**
 * Event Card Component
 *
 * Displays a summary of a single event, including a thumbnail,
 * event details (name, cause, time), and statistics (frames, score).
 * It is used in event lists and grids.
 */

import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { EventThumbnail } from './EventThumbnail';
import { EventThumbnailHoverPreview } from './EventThumbnailHoverPreview';
import { EventDeleteButton } from './EventDeleteButton';
import { EventContextButton } from './context/EventContextButton';
import { Video, Calendar, Clock, Star, Archive, ArchiveRestore, Hourglass } from 'lucide-react';
import { getEventCauseIcon } from '../../lib/event/event-icons';
import { getObjectClassIconFromList } from '../../lib/event/object-class-icons';
import type { EventCardProps } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { resolveOwnMonitorIds } from '../../hooks/useScopedEvents';
import { queryKeys } from '../../lib/query/query-keys';
import { setEventArchived } from '../../api/events';
import { usePermissions } from '../../hooks/usePermissions';
import { canEditEvents } from '../../lib/permissions/zm-permissions';
import { useDeniedControl } from '../../hooks/useDeniedControl';
import { isPermissionDenied } from '../../lib/permissions/permission-error';
import { isNotFound } from '../../lib/http/types';
import { markPermissionDenied, useIsPermissionDenied } from '../../stores/permissions';
import { getSession } from '../../services/sessions';
import { log, LogLevel } from '../../lib/logger';
import { TagChipList } from './TagChip';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
import { useDeleteSelectionStore, eventSelectionKey } from '../../stores/deleteSelection';
import { HintButton } from '../ui/button';

/**
 * EventCard component.
 * Renders a clickable card representing a ZoneMinder event.
 *
 * @param props - Component properties
 * @param props.event - The event data object
 * @param props.monitorName - Name of the monitor that recorded the event
 * @param props.thumbnailUrl - URL for the event thumbnail image
 */
function EventCardComponent({ event, monitorName, profileId, profileChip, thumbnailUrls, largeThumbnailUrls, objectFit = 'contain', thumbnailWidth, thumbnailHeight, tags, eventFilters }: EventCardProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtDate, fmtTime } = useDateTimeFormat();
  const { currentProfile, settings } = useCurrentProfile();
  const queryClient = useQueryClient();
  const showHover = settings.hoverPreview.eventsList;
  const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);
  // Owning profile for this card's actions: the row's own profileId in All
  // mode, the current profile in single mode (refs #337).
  const ownerProfileId = profileId ?? currentProfile?.id;

  // Subscribe to the specific favorite state for this event
  // This ensures re-renders when favorite status changes
  const isFav = useEventFavoritesStore((state) =>
    ownerProfileId ? state.isFavorited(ownerProfileId, event.Id) : false
  );

  const isArchived = event.Archived === '1';
  const [isArchiving, setIsArchiving] = useState(false);

  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);
  const selectedForDelete = useDeleteSelectionStore((s) =>
    s.selectedKeys.includes(eventSelectionKey(ownerProfileId, event.Id)));
  const openEvent = () => {
    markViewed(event.Id);
    // All mode: deep route carries the owning profile so EventDetail
    // resolves its session from it instead of the (absent) current
    // profile (refs #337).
    const path = profileId ? `/all/events/${profileId}/${event.Id}` : `/events/${event.Id}`;
    // The shared eventFilters object's monitorId can carry composite
    // `${profileId}:${monitorId}` tokens from the All-mode camera filter
    // (refs #337 I6) - riding that into nav state sends a bogus
    // `MonitorId:profile-b:3` segment to getAdjacentEvent, silently
    // breaking prev/next. Strip to this row's own bare ids before
    // navigating; a bare (single-mode) monitorId passes through unchanged
    // (round 2).
    const navEventFilters = eventFilters && ownerProfileId
      ? { ...eventFilters, monitorId: resolveOwnMonitorIds(eventFilters.monitorId, ownerProfileId) }
      : eventFilters;
    navigate(path, { state: { from: '/events', eventFilters: navEventFilters } });
  };

  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));

  // Calculate aspect ratio from thumbnail dimensions
  // (thumbnailWidth/Height are already swapped for rotated monitors)
  const aspectRatio = thumbnailWidth / thumbnailHeight;

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card navigation
    if (ownerProfileId) {
      toggleFavorite(ownerProfileId, event.Id);
    }
  };

  const { permissions } = usePermissions(ownerProfileId);
  const archiveRefused = useIsPermissionDenied(ownerProfileId, 'events-edit');

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving || !ownerProfileId) return;
    const next = !isArchived;
    setIsArchiving(true);
    try {
      await setEventArchived(getSession(ownerProfileId).client, event.Id, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events(ownerProfileId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.event(ownerProfileId, event.Id) }),
      ]);
      toast.success(next ? t('events.archived_success') : t('events.unarchived_success'));
    } catch (err) {
      log.eventCard('Archive toggle failed', LogLevel.ERROR, { eventId: event.Id, next, error: err });
      // An account too restricted to read its own permissions leaves this
      // control ungated, so the refusal is the only thing that can explain
      // itself. Spend it once: say what happened, and grey the control so the
      // next press is not the same discovery (refs #344).
      if (isNotFound(err) && ownerProfileId) {
        // A server that prunes deletes events under an open list, so the card
        // outlives the row. Refresh the list rather than leaving a ghost that
        // fails the same way on every press.
        void queryClient.invalidateQueries({ queryKey: queryKeys.events(ownerProfileId) });
        toast.error(t('events.event_gone'));
      } else if (isPermissionDenied(err) && ownerProfileId) {
        markPermissionDenied(ownerProfileId, 'events-edit');
        toast.error(t('events.archive_permission_denied'));
      } else {
        toast.error(t('events.archive_failed'));
      }
    } finally {
      setIsArchiving(false);
    }
  };

  // Archiving needs Events: Edit. The control stays live and greyed so it can
  // still say why it does nothing (refs #344).
  const archiveProps = useDeniedControl({
    denied: canEditEvents(permissions) === 'denied' || archiveRefused,
    message: t('events.archive_permission_denied'),
    onClick: handleArchiveClick,
    title: isArchived ? t('events.unarchive') : t('events.archive'),
    className: cn(
      'p-1 rounded-full hover:bg-accent transition-colors',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed'
    ),
  });

  return (
    <Card
      className={cn(
        'group relative overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 hover:ring-2 hover:ring-primary/50 focus:outline-none focus:ring-2 focus:ring-primary',
        flash && 'ring-2 ring-primary/60 bg-primary/5',
        selectedForDelete && 'bg-destructive/10 opacity-60'
      )}
      onClick={openEvent}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEvent();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${t('common.view')}: ${event.Name}`}
      data-testid="event-card"
      data-event-id={event.Id}
      data-monitor-id={event.MonitorId}
    >
      <div className="flex gap-2 sm:gap-3 p-2 sm:p-3">
        {/* Thumbnail - Fixed width container for consistent text alignment */}
        <div className="relative flex-shrink-0 w-24 sm:w-28 md:w-32 max-w-[40%]">
          {flash && <ReturnFlashArrow />}
          <div className="relative rounded overflow-hidden bg-card border border-border/40">
          <div
            className="w-full max-h-28"
            style={{ aspectRatio: aspectRatio.toString() }}
          >
            {showHover ? (
              <EventThumbnailHoverPreview
                urls={largeThumbnailUrls ?? thumbnailUrls}
                cacheKey={event.Id}
                alt={event.Name}
                aspectRatio={aspectRatio}
                event={event}
                profileId={ownerProfileId}
              >
                <EventThumbnail
                  urls={thumbnailUrls}
                  cacheKey={event.Id}
                  alt={event.Name}
                  className={cn(
                    "w-full h-full group-hover:scale-105 transition-transform duration-300"
                  )}
                  objectFit={objectFit}
                  loading="lazy"
                  data-testid="event-thumbnail"
                />
              </EventThumbnailHoverPreview>
            ) : (
              <EventThumbnail
                urls={thumbnailUrls}
                cacheKey={event.Id}
                alt={event.Name}
                className={cn(
                  "w-full h-full group-hover:scale-105 transition-transform duration-300"
                )}
                objectFit={objectFit}
                loading="lazy"
                data-testid="event-thumbnail"
              />
            )}
          </div>
          {isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS) && (
            <div
              className="absolute bottom-0.5 left-1/2 -translate-x-1/2 sm:bottom-1 max-w-[calc(100%-0.5rem)] truncate bg-black/50 text-white text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded font-medium"
              data-testid="event-relative-time"
            >
              {formatEventRelative(startTime, i18n.language, t)}
            </div>
          )}
          </div>
        </div>

        {/* Event Details */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold text-sm sm:text-base truncate" title={event.Name}>
                {event.Name}
              </h3>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <HintButton
                  onClick={handleFavoriteClick}
                  className={cn(
                    "p-1 rounded-full hover:bg-accent transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  )}
                  title={isFav ? t('events.unfavorite') : t('events.favorite')}
                  aria-label={isFav ? t('events.unfavorite') : t('events.favorite')}
                  data-testid="event-favorite-button"
                >
                  <Star
                    className={cn(
                      "h-4 w-4 sm:h-5 sm:w-5 transition-colors",
                      isFav
                        ? "fill-yellow-500 stroke-yellow-500"
                        : "stroke-muted-foreground hover:stroke-yellow-500"
                    )}
                  />
                </HintButton>
                <HintButton
                  {...archiveProps}
                  disabled={isArchiving}
                  aria-label={isArchived ? t('events.unarchive') : t('events.archive')}
                  data-testid="event-archive-button"
                >
                  {/* Shape carries the state, not fill: a solid archive box
                      loses its lid and reads as a blob at this size, and colour
                      alone says nothing to a colourblind reader. The restore
                      arrow doubles as a hint at what the tap does, which is
                      what the label already says. */}
                  {isArchived ? (
                    <ArchiveRestore
                      className="h-4 w-4 sm:h-5 sm:w-5 transition-colors stroke-primary"
                      data-testid="event-archive-icon-on"
                    />
                  ) : (
                    <Archive
                      className="h-4 w-4 sm:h-5 sm:w-5 transition-colors stroke-muted-foreground hover:stroke-primary"
                      data-testid="event-archive-icon-off"
                    />
                  )}
                </HintButton>
                <EventContextButton event={event} profileId={ownerProfileId} />
                <EventDeleteButton eventId={event.Id} profileId={ownerProfileId} />
                {(() => {
                  const CauseIcon = getEventCauseIcon(event.Cause);
                  return (
                    <Badge variant="outline" className="text-[10px] sm:text-xs gap-1">
                      <CauseIcon className="h-3 w-3" />
                      {event.Cause}
                    </Badge>
                  );
                })()}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px] sm:text-xs text-muted-foreground">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <Video className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="truncate max-w-[100px] sm:max-w-[150px]" title={monitorName} data-testid="event-monitor-name">
                  {monitorName}
                </span>
              </div>
              {profileChip && (
                <span
                  className="text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground truncate max-w-[100px]"
                  title={profileChip}
                  data-testid="event-profile-chip"
                >
                  {profileChip}
                </span>
              )}
              <div className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5">
                <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                {fmtDate(startTime)}
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                {fmtTime(startTime)}
              </div>
              <div
                className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5"
                title={t('events.duration')}
                data-testid="event-duration"
              >
                <Hourglass className="h-3 w-3 sm:h-4 sm:w-4" />
                {event.Length}s
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-[10px] sm:text-xs text-muted-foreground">
            <span>{event.Frames} {t('events.frames')}</span>
            <span className="hidden sm:inline">•</span>
            <span>{event.AlarmFrames} {t('events.alarm')}</span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden md:inline">
              {t('events.score')}: {event.AvgScore}/{event.MaxScore}
            </span>
            {event.Archived === '1' && (
              <>
                <span className="hidden sm:inline">•</span>
                <Badge variant="secondary" className="text-[10px] sm:text-xs h-4 sm:h-5">
                  {t('events.archived')}
                </Badge>
              </>
            )}
          </div>

          {/* Detection notes (strip everything after | which is redundant motion info) */}
          {event.Notes && (() => {
            const noteText = event.Notes.split('|')[0].trim();
            const isDetection = noteText.startsWith('detected:');
            const classList = isDetection ? noteText.slice('detected:'.length) : '';
            const NoteIcon = isDetection && classList ? getObjectClassIconFromList(classList) : null;
            return (
              <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground truncate mt-1" title={event.Notes}>
                {NoteIcon && <NoteIcon className="h-3 w-3 shrink-0" />}
                <span className="truncate">{noteText}</span>
              </div>
            );
          })()}

          {/* Tags */}
          {tags && tags.length > 0 && (
            <TagChipList
              tags={tags}
              maxVisible={4}
              size="sm"
              className="mt-1.5"
              overflowText={(count) => t('events.tags.moreCount', { count })}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// Memoize to prevent unnecessary re-renders in virtualized event lists
export const EventCard = memo(EventCardComponent);
