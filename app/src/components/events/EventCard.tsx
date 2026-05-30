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
import { Video, Calendar, Clock, Star, Archive } from 'lucide-react';
import { getEventCauseIcon } from '../../lib/event-icons';
import { getObjectClassIconFromList } from '../../lib/object-class-icons';
import type { EventCardProps } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { setEventArchived } from '../../api/events';
import { log, LogLevel } from '../../lib/logger';
import { TagChipList } from './TagChip';

/**
 * EventCard component.
 * Renders a clickable card representing a ZoneMinder event.
 *
 * @param props - Component properties
 * @param props.event - The event data object
 * @param props.monitorName - Name of the monitor that recorded the event
 * @param props.thumbnailUrl - URL for the event thumbnail image
 */
function EventCardComponent({ event, monitorName, thumbnailUrls, largeThumbnailUrls, objectFit = 'contain', thumbnailWidth, thumbnailHeight, tags, eventFilters }: EventCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { fmtDate, fmtTime } = useDateTimeFormat();
  const { currentProfile, settings } = useCurrentProfile();
  const queryClient = useQueryClient();
  const showHover = settings.hoverPreview.eventsList;
  const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);

  // Subscribe to the specific favorite state for this event
  // This ensures re-renders when favorite status changes
  const isFav = useEventFavoritesStore((state) =>
    currentProfile ? state.isFavorited(currentProfile.id, event.Id) : false
  );

  const isArchived = event.Archived === '1';
  const [isArchiving, setIsArchiving] = useState(false);

  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));

  // Calculate aspect ratio from thumbnail dimensions
  // (thumbnailWidth/Height are already swapped for rotated monitors)
  const aspectRatio = thumbnailWidth / thumbnailHeight;

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card navigation
    if (currentProfile) {
      toggleFavorite(currentProfile.id, event.Id);
    }
  };

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving) return;
    const next = !isArchived;
    setIsArchiving(true);
    try {
      await setEventArchived(event.Id, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['event', event.Id] }),
      ]);
      toast.success(next ? t('events.archived_success') : t('events.unarchived_success'));
    } catch (err) {
      log.eventCard('Archive toggle failed', LogLevel.ERROR, { eventId: event.Id, next, error: err });
      toast.error(t('events.archive_failed'));
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <Card
      className="group overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 hover:ring-2 hover:ring-primary/50 focus:outline-none focus:ring-2 focus:ring-primary"
      onClick={() => navigate(`/events/${event.Id}`, { state: { from: '/events', eventFilters } })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/events/${event.Id}`, { state: { from: '/events', eventFilters } });
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${t('common.view')}: ${event.Name}`}
      data-testid="event-card"
    >
      <div className="flex gap-2 sm:gap-3 p-2 sm:p-3">
        {/* Thumbnail - Fixed width container for consistent text alignment */}
        <div className="relative flex-shrink-0 rounded overflow-hidden bg-card border border-border/40 w-24 sm:w-28 md:w-32 max-w-[40%]">
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
          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 sm:bottom-1 bg-black/50 text-white text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded font-medium">
            {event.Length}s
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
                <button
                  onClick={handleFavoriteClick}
                  className={cn(
                    "p-1 rounded-full hover:bg-accent transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  )}
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
                </button>
                <button
                  onClick={handleArchiveClick}
                  disabled={isArchiving}
                  className={cn(
                    "p-1 rounded-full hover:bg-accent transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  aria-label={isArchived ? t('events.unarchive') : t('events.archive')}
                  title={isArchived ? t('events.unarchive') : t('events.archive')}
                  data-testid="event-archive-button"
                >
                  <Archive
                    className={cn(
                      "h-4 w-4 sm:h-5 sm:w-5 transition-colors",
                      isArchived
                        ? "fill-primary stroke-primary"
                        : "stroke-muted-foreground hover:stroke-primary"
                    )}
                  />
                </button>
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

            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <Video className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="truncate max-w-[100px] sm:max-w-[150px]" title={monitorName} data-testid="event-monitor-name">
                  {monitorName}
                </span>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5">
                <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                {fmtDate(startTime)}
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 bg-primary/10 rounded px-1.5 py-0.5">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                {fmtTime(startTime)}
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
