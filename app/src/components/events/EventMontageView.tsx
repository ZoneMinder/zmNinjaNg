/**
 * Event Montage View
 *
 * Grid view of events with thumbnails and metadata.
 * Features:
 * - Responsive grid layout
 * - Haptic feedback on downloads (native platforms)
 * - Touch-optimized download buttons
 */

import { memo, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getObjectClassIconFromList } from '../../lib/event/object-class-icons';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { EventCauseBadge } from './EventCauseBadge';
import { EventThumbnail } from './EventThumbnail';
import { EventContextButton } from './context/EventContextButton';
import { EventFavoriteButton } from './EventFavoriteButton';
import { EventArchiveButton } from './EventArchiveButton';
import { EventDeleteButton } from './EventDeleteButton';
import { EventDownloadButton } from './EventDownloadButton';
import { type EventFilters } from '../../api/events';
import { getPortalUrlForMonitor, getServerMapVersion, subscribeServerMap } from '../../lib/zm/server-resolver';
import { buildThumbnailChain, eventHasAlarmFrame } from '../../lib/event/thumbnail-chain';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { EventThumbnailHoverPreview } from './EventThumbnailHoverPreview';
import { buildMonitorMap, calculateThumbnailDimensions, getMonitorDimensions } from '../../lib/event/event-utils';
import { groupByOwningProfile } from '../../lib/profile/profile-sections';
import { ProfileSectionList } from '../profiles/ProfileSectionList';
import { ZM_INTEGRATION, RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import type { Event, Monitor, ProfileId, Tag } from '../../api/types';
import type { ThumbnailFallbackEntry } from '../../stores/settings';
import { TagChipList } from './TagChip';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
import { useDeleteSelectionStore, eventSelectionKey } from '../../stores/deleteSelection';
import { cn } from '../../lib/utils';
import type { ScopedEventItem } from './EventListView';
import { scopedEventKey } from '../../lib/event/scoped-event-key';

interface EventMontageTileProps {
  event: Event;
  /** All mode only: this event's owning profile - resolves this tile's own
   *  portal URL/token instead of the page-level defaults, exactly like
   *  EventListView's EventItem (refs #337 Task 2). */
  profileId?: ProfileId;
  profileChip?: string;
  monitorMap: Map<string, Monitor>;
  /** Off hides the text drawn over the image (refs #525). */
  showThumbnailLabels: boolean;
  thumbnailChain: ThumbnailFallbackEntry[];
  showHover: boolean;
  portalUrl: string;
  accessToken?: string;
  tags?: Tag[];
  eventFilters?: EventFilters;
  minStreamingPort?: number;
}

/**
 * One grid tile. Extracted from the parent's `.map()` so it can call
 * `useReturnFlash` per event: hooks cannot run inside a map callback.
 */
const EventMontageTile = memo(function EventMontageTile({
  event,
  profileId,
  profileChip,
  monitorMap,
  showThumbnailLabels,
  thumbnailChain,
  showHover,
  portalUrl,
  accessToken,
  tags,
  eventFilters,
  minStreamingPort,
}: EventMontageTileProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtDateTimeShort } = useDateTimeFormat();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);

  // Re-render THIS tile when the server map changes (e.g. multi-server
  // bootstrap populating it after first render). Subscribing here, not in
  // the parent, means the parent's monitorMap useMemo doesn't need a
  // serverMapVersion dependency it never actually reads just to bust this
  // memo()-wrapped tile's props (refs #337 fix round 1) - this tile
  // re-renders on its own regardless of memo, and getPortalUrlForMonitor
  // below reads the (now up to date) server map fresh on every call.
  useSyncExternalStore(subscribeServerMap, getServerMapVersion);

  // All mode: resolve this tile's OWN owning-profile client details instead
  // of the page-level defaults (which reflect no/whatever profile is
  // current - there isn't one in All mode). Single mode: profileId is
  // undefined, both hooks fall back to the current profile, matching prior
  // behavior exactly (same pattern as EventListView's EventItem, refs #337).
  const { profile: ownerProfile, settings: ownerSettings } = useProfileById(profileId);
  // Owning profile for this tile's actions: the tile's own profileId in All
  // mode, the current profile in single mode (mirrors EventCard, refs #337).
  const ownerProfileId = ownerProfile?.id;
  const { token: ownerToken, isFresh: ownerTokenFresh } = useFreshAccessToken(profileId);
  const effectivePortalUrl = profileId ? (ownerProfile?.portalUrl || portalUrl) : portalUrl;
  const effectiveAccessToken = profileId ? (ownerTokenFresh ? ownerToken ?? undefined : undefined) : accessToken;
  const effectiveMinStreamingPort = profileId
    ? resolveMinStreamingPort(ownerProfile?.minStreamingPort, ownerSettings.forceDisableMultiPort)
    : minStreamingPort;

  const monitorData = monitorMap.get(profileId ? `${profileId}:${event.MonitorId}` : event.MonitorId);
  const monitorName = monitorData?.Name || `Camera ${event.MonitorId}`;
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
  const selectedForDelete = useDeleteSelectionStore((s) =>
    s.selectedKeys.includes(eventSelectionKey(ownerProfileId, event.Id)));

  const { width: monitorWidth, height: monitorHeight } = getMonitorDimensions(monitorData, event.Width, event.Height);

  const { width: thumbnailWidth, height: thumbnailHeight } = calculateThumbnailDimensions(
    monitorWidth,
    monitorHeight,
    monitorData?.Orientation ?? event.Orientation,
    ZM_INTEGRATION.eventMontageImageWidth
  );

  const eventPortalUrl = getPortalUrlForMonitor(monitorData?.ServerId, effectivePortalUrl, profileId);
  const thumbnailUrls = buildThumbnailChain(eventPortalUrl, event.Id, thumbnailChain, {
    token: effectiveAccessToken,
    width: thumbnailWidth,
    height: thumbnailHeight,
    minStreamingPort: effectiveMinStreamingPort,
    monitorId: event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(event),
  });

  const isArchived = event.Archived === '1';
  const aspectRatio = thumbnailWidth / thumbnailHeight;

  const openEvent = () => {
    markViewed(event.Id);
    navigate(`/events/${event.Id}`, { state: { from: '/events', eventFilters } });
  };

  return (
    // The arrow straddles the tile's top edge, as it does on a list row. It has
    // to sit outside the Card, which clips its overflow to keep the thumbnail
    // inside the rounded corners.
    <div className="relative">
      {flash && <ReturnFlashArrow />}
      <Card
        data-testid="event-montage-tile"
        data-event-id={event.Id}
        className={cn(
          'overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary',
          flash && 'ring-2 ring-primary/60',
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
      >
        <div className="relative bg-card" style={{ aspectRatio: aspectRatio.toString() }} data-testid="event-montage-thumbnail">
          {showHover ? (
          <EventThumbnailHoverPreview event={event} aspectRatio={aspectRatio} profileId={profileId}>
            <EventThumbnail
              urls={thumbnailUrls}
              cacheKey={event.Id}
              alt={event.Name}
              className="w-full h-full"
              objectFit="contain"
              loading="lazy"
            />
          </EventThumbnailHoverPreview>
        ) : (
          <EventThumbnail
            urls={thumbnailUrls}
            cacheKey={event.Id}
            alt={event.Name}
            className="w-full h-full"
            objectFit="contain"
            loading="lazy"
          />
        )}
        {showThumbnailLabels && isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS) && (
          <Badge variant="secondary" className="absolute top-2 right-2 text-xs" data-testid="event-montage-relative-time">
            {formatEventRelative(startTime, i18n.language, t)}
          </Badge>
        )}
      </div>
      <div className="p-3 space-y-1">
        {/* Below the image, as on a list row: on a small tile the buttons
            covered a third of the picture (refs #525). */}
        <div className="flex items-center gap-1">
          <EventFavoriteButton eventId={event.Id} profileId={ownerProfileId} />
          <EventContextButton event={event} profileId={profileId} />
        </div>
        <div className="font-medium text-sm truncate" title={event.Name}>
          {event.Name}
        </div>
        <div className="text-xs text-muted-foreground truncate" title={monitorName} data-testid="event-monitor-name">{monitorName}</div>
        {profileChip && (
          <span
            className="inline-block text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground truncate max-w-[100px]"
            title={profileChip}
            data-testid="event-profile-chip"
          >
            {profileChip}
          </span>
        )}
        <div className="text-xs text-muted-foreground truncate">
          {fmtDateTimeShort(startTime)}
          <span data-testid="event-montage-duration">{` · ${event.Length}s`}</span>
        </div>
        {/* Frames/alarm/score: same figures as EventCard, one compact line
            instead of the card's wider spread (refs #494). */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span data-testid="event-frames">{event.Frames} {t('events.frames')}</span>
          <span data-testid="event-alarm-frames">{event.AlarmFrames} {t('events.alarm')}</span>
          <span data-testid="event-score">{t('events.score')}: {event.AvgScore}/{event.MaxScore}</span>
          {isArchived && (
            <Badge variant="secondary" className="text-[10px] h-4" data-testid="event-archived-badge">
              {t('events.archived')}
            </Badge>
          )}
        </div>
        {event.Cause && <EventCauseBadge cause={event.Cause} className="text-xs" />}
        {event.Notes && (() => {
          const noteText = event.Notes.split('|')[0].trim();
          const isDetection = noteText.startsWith('detected:');
          const classList = isDetection ? noteText.slice('detected:'.length) : '';
          const NoteIcon = isDetection && classList ? getObjectClassIconFromList(classList) : null;
          return (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground truncate" title={event.Notes}>
              {NoteIcon && <NoteIcon className="h-3 w-3 shrink-0" />}
              <span className="truncate">{noteText}</span>
            </p>
          );
        })()}
        {/* Tags */}
        {tags && tags.length > 0 && (
          <TagChipList
            tags={tags}
            maxVisible={3}
            size="sm"
            overflowText={(count) => t('events.tags.moreCount', { count })}
          />
        )}
        {/* Actions that change or remove the event: archive and download sit
            together, delete set apart from them (mirrors EventCard). */}
        <div className="flex items-center gap-2 pt-1">
          <EventArchiveButton eventId={event.Id} isArchived={isArchived} profileId={ownerProfileId} />
          <EventDownloadButton event={event} profileId={ownerProfileId} monitorServerId={monitorData?.ServerId} />
          <span className="ml-1">
            <EventDeleteButton eventId={event.Id} profileId={ownerProfileId} />
          </span>
        </div>
        </div>
      </Card>
    </div>
  );
});

interface EventMontageViewProps {
  events: ScopedEventItem[];
  /** All mode only: monitors carry their owning profileId so a colliding
   *  numeric id across two servers doesn't collapse into one map entry
   *  (same contract as EventListView's monitors prop). */
  monitors: Array<{ Monitor: Monitor; profileId?: ProfileId }>;
  gridCols: number;
  showThumbnailLabels: boolean;
  portalUrl: string;
  accessToken?: string;
  batchSize: number;
  totalCount?: number;
  isFetching?: boolean;
  onLoadMore: () => void;
  /** Tags keyed by scopedEventKey: `${profileId}:${eventId}` for All-mode
   *  rows (event ids collide across servers), bare event id in single mode. */
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
  /** Aggregate only: the aggregate's own id sections the grid by owning
   *  server instead of one time-ordered grid; undefined leaves it flat
   *  (refs #501). The id also scopes each section's collapse state. */
  groupByScopeId?: ProfileId;
}

export const EventMontageView = ({
  events,
  monitors,
  gridCols,
  showThumbnailLabels,
  portalUrl,
  accessToken,
  batchSize,
  totalCount,
  isFetching = false,
  onLoadMore,
  eventTagMap,
  eventFilters,
  minStreamingPort,
  groupByScopeId,
}: EventMontageViewProps) => {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const thumbnailChain = settings.thumbnailFallbackChain;
  const showHover = settings.hoverPreview.eventsGrid;

  // id -> Monitor lookup, rebuilt only when the monitors array reference
  // changes - same shape/reasoning as EventListView's monitorMap.
  // EventMontageTile below refreshes its own per-server URL when the server
  // map changes (it subscribes to it directly), so this memo doesn't need
  // to bust on that too (refs #337 fix round 1).
  const monitorMap = useMemo(() => buildMonitorMap(monitors), [monitors]);

  const isLoadingData = isFetching;
  const hasMore = totalCount !== undefined ? events.length < totalCount : false;
  const remaining = totalCount !== undefined ? Math.min(batchSize, totalCount - events.length) : batchSize;

  const gridStyle = { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` };

  const renderTile = (eventData: ScopedEventItem) => (
    <EventMontageTile
      key={scopedEventKey(eventData.profileId, eventData.Event.Id)}
      event={eventData.Event}
      profileId={eventData.profileId}
      profileChip={eventData.profileChip}
      monitorMap={monitorMap}
      showThumbnailLabels={showThumbnailLabels}
      thumbnailChain={thumbnailChain}
      showHover={showHover}
      portalUrl={portalUrl}
      accessToken={accessToken}
      tags={eventTagMap?.get(scopedEventKey(eventData.profileId, eventData.Event.Id))}
      eventFilters={eventFilters}
      minStreamingPort={minStreamingPort}
    />
  );

  // One grid per owning server, in first-seen order; the count header and
  // Load More stay one per view so paging is unchanged (refs #501).
  const sections = groupByScopeId ? groupByOwningProfile(events) : null;

  return (
    <div className="min-h-0" data-testid="events-montage-grid">
      {/* Status header */}
      <div className="text-xs text-muted-foreground pb-3 flex items-center gap-2">
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        {totalCount !== undefined
          ? t('events.showing_of_total', { showing: events.length, total: totalCount })
          : t('events.showing_events', { count: events.length })}
      </div>

      {sections && groupByScopeId ? (
        <ProfileSectionList
          sections={sections}
          surface="events-group"
          scopeId={groupByScopeId}
          className="space-y-6"
          renderItems={(items) => (
            <div className="grid gap-4" style={gridStyle}>
              {items.map(renderTile)}
            </div>
          )}
        />
      ) : (
        <div className="grid gap-4" style={gridStyle}>
          {events.map(renderTile)}
        </div>
      )}

      {/* Load More button */}
      {hasMore && (
        <div className="text-center py-4">
          <Button
            onClick={onLoadMore}
            disabled={isLoadingData}
            variant="outline"
            size="sm"
            className="w-full"
            data-testid="events-load-more"
          >
            {isLoadingData ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('events.loading_more', { count: remaining })}
              </>
            ) : (
              t('events.load_more')
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
