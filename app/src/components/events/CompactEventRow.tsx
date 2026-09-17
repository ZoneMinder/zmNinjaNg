/**
 * Compact event row for the monitor-detail recent-events list.
 * Thumbnail + detection (or cause) + event id + time + relative time + duration,
 * with a delete button. Clicking the row opens the event detail.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { EventThumbnail } from './EventThumbnail';
import { EventThumbnailHoverPreview } from './EventThumbnailHoverPreview';
import { EventDeleteButton } from './EventDeleteButton';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { parseDetectedObjects } from '../../lib/event/event-detection';
import { getObjectClassIconFromList } from '../../lib/event/object-class-icons';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import { cn } from '../../lib/utils';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
import { useDeleteSelectionStore, eventSelectionKey } from '../../stores/deleteSelection';
import type { Event, ProfileId } from '../../api/types';

interface CompactEventRowProps {
  event: Event;
  thumbnailUrls: string[];
  aspectRatio: number;
  objectFit?: CSSProperties['objectFit'];
  /** Owning profile for an /all/ deep route; defaults to the current profile. */
  profileId?: ProfileId;
  /**
   * Owning profile for this row's delete-selection key - the row's own
   * profileId in All mode, the current one otherwise, so one event selected
   * from either surface is one selection key (refs #337).
   *
   * Passed down rather than re-derived here: the parent already resolves the
   * owning profile, and a list of rows each subscribing to the profile store
   * to recompute the id its parent is holding costs three subscriptions per
   * row for nothing.
   */
  ownerProfileId?: ProfileId;
  /** Wrap the thumbnail in the hover/long-press preview (refs #494). Off by
   *  default so the existing MonitorRecentEvents caller is unchanged. */
  hoverPreview?: boolean;
}

export function CompactEventRow({ event, thumbnailUrls, aspectRatio, objectFit = 'cover', profileId, ownerProfileId, hoverPreview = false }: CompactEventRowProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtTime } = useDateTimeFormat();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);
  const selectedForDelete = useDeleteSelectionStore((s) =>
    s.selectedKeys.includes(eventSelectionKey(ownerProfileId, event.Id)));
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
  const detected = parseDetectedObjects(event.Notes);
  const DetIcon = detected.length ? getObjectClassIconFromList(detected.join(',')) : null;
  const primaryText = detected.length ? detected.join(', ') : event.Cause;
  const showRelative = isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS);
  const durationSecs = Math.max(0, Math.round(Number(event.Length) || 0));
  const durationLabel =
    durationSecs >= 60
      ? `${Math.floor(durationSecs / 60)}:${String(durationSecs % 60).padStart(2, '0')}`
      : `${durationSecs}s`;
  const open = () => {
    markViewed(event.Id);
    // All mode: deep route carries the owning profile (refs #337).
    const path = profileId ? `/all/events/${profileId}/${event.Id}` : `/events/${event.Id}`;
    navigate(path, { state: { from: `/monitors/${event.MonitorId}` } });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md p-1.5 cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary',
        flash && 'ring-2 ring-primary/60 bg-primary/5',
        selectedForDelete && 'bg-destructive/10 opacity-60'
      )}
      data-testid="compact-event-row"
      data-event-id={event.Id}
      aria-label={`${t('common.view')}: ${event.Name}`}
    >
      <div className="relative flex-shrink-0 w-16">
        {flash && <ReturnFlashArrow />}
        <div
          className="w-full rounded overflow-hidden bg-card border border-border/40"
          style={{ aspectRatio: aspectRatio.toString() }}
        >
          {hoverPreview ? (
            <EventThumbnailHoverPreview event={event} aspectRatio={aspectRatio} profileId={ownerProfileId}>
              <EventThumbnail
                urls={thumbnailUrls}
                cacheKey={event.Id}
                alt={event.Name}
                className="w-full h-full"
                objectFit={objectFit}
                loading="lazy"
                data-testid="compact-event-thumbnail"
              />
            </EventThumbnailHoverPreview>
          ) : (
            <EventThumbnail
              urls={thumbnailUrls}
              cacheKey={event.Id}
              alt={event.Name}
              className="w-full h-full"
              objectFit={objectFit}
              loading="lazy"
              data-testid="compact-event-thumbnail"
            />
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {DetIcon && <DetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm truncate" title={primaryText}>{primaryText}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">· #{event.Id}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {fmtTime(startTime)}
          {showRelative && ` · ${formatEventRelative(startTime, i18n.language, t)}`}
        </p>
      </div>
      <span
        className="flex-shrink-0 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        title={t('events.duration')}
      >
        {durationLabel}
      </span>
      <EventDeleteButton eventId={event.Id} profileId={ownerProfileId} size="sm" className="flex-shrink-0" />
    </div>
  );
}
