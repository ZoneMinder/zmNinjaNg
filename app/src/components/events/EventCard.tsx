/**
 * Event Card Component
 *
 * Displays a summary of a single event, including a thumbnail,
 * event details (name, cause, time), and statistics (frames, score).
 * It is used in event lists and grids.
 */

import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { EventThumbnail } from './EventThumbnail';
import { EventThumbnailHoverPreview } from './EventThumbnailHoverPreview';
import { EventCauseBadge } from './EventCauseBadge';
import { EventDeleteButton } from './EventDeleteButton';
import { EventFavoriteButton } from './EventFavoriteButton';
import { EventArchiveButton } from './EventArchiveButton';
import { EventDownloadButton } from './EventDownloadButton';
import { EventContextButton } from './context/EventContextButton';
import { Video, Calendar, Clock, Hourglass } from 'lucide-react';
import { getObjectClassIconFromList } from '../../lib/event/object-class-icons';
import type { EventCardProps } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { resolveOwnMonitorIds } from '../../hooks/useScopedEvents';
import { TagChipList } from './TagChip';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
import { useDeleteSelectionStore, eventSelectionKey } from '../../stores/deleteSelection';

/**
 * EventCard component.
 * Renders a clickable card representing a ZoneMinder event.
 *
 * @param props - Component properties
 * @param props.event - The event data object
 * @param props.monitorName - Name of the monitor that recorded the event
 * @param props.thumbnailUrl - URL for the event thumbnail image
 */
function EventCardComponent({ event, monitorName, profileId, profileChip, monitorServerId, thumbnailUrls, largeThumbnailUrls, objectFit = 'contain', thumbnailWidth, thumbnailHeight, tags, eventFilters }: EventCardProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtDate, fmtTime } = useDateTimeFormat();
  const { currentProfile, settings } = useCurrentProfile();
  const showHover = settings.hoverPreview.eventsList;
  // Owning profile for this card's actions: the row's own profileId in All
  // mode, the current profile in single mode (refs #337).
  const ownerProfileId = profileId ?? currentProfile?.id;

  const isArchived = event.Archived === '1';

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
          <div className="mt-1.5 flex items-center gap-1">
            <EventFavoriteButton eventId={event.Id} profileId={ownerProfileId} />
            <EventContextButton event={event} profileId={ownerProfileId} />
          </div>
        </div>

        {/* Event Details */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold text-sm sm:text-base truncate" title={event.Name}>
                {event.Name}
              </h3>
              <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                <EventArchiveButton eventId={event.Id} isArchived={isArchived} profileId={ownerProfileId} />
                <EventDownloadButton event={event} profileId={ownerProfileId} monitorServerId={monitorServerId} className="h-7 w-7 sm:h-8 sm:w-8" />
                {/* Destructive action set apart from the rest: at these sizes
                    an 8px gap is the difference between archiving and deleting. */}
                <span className="ml-1 sm:ml-1.5">
                  <EventDeleteButton eventId={event.Id} profileId={ownerProfileId} />
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px] sm:text-xs text-muted-foreground">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <Video className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="truncate max-w-[100px] sm:max-w-[150px]" title={monitorName} data-testid="event-monitor-name">
                  {monitorName}
                </span>
              </div>
              {/* The cause sits with the metadata rather than in the title row:
                  there it competed with the name and the actions for the same
                  width, which is what squeezed the buttons together. */}
              <EventCauseBadge cause={event.Cause} className="text-[10px] sm:text-xs" />
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
            <span data-testid="event-frames">{event.Frames} {t('events.frames')}</span>
            <span className="hidden sm:inline">•</span>
            <span data-testid="event-alarm-frames">{event.AlarmFrames} {t('events.alarm')}</span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden md:inline" data-testid="event-score">
              {t('events.score')}: {event.AvgScore}/{event.MaxScore}
            </span>
            {isArchived && (
              <>
                <span className="hidden sm:inline">•</span>
                <Badge variant="secondary" className="text-[10px] sm:text-xs h-4 sm:h-5" data-testid="event-archived-badge">
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
