/**
 * Event List View
 *
 * List view of events with thumbnails and metadata.
 */

import { memo, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { EventCard } from './EventCard';
import { type EventFilters } from '../../api/events';
import { getPortalUrlForMonitor, getServerMapVersion, subscribeServerMap } from '../../lib/zm/server-resolver';
import { buildThumbnailChain, eventHasAlarmFrame } from '../../lib/event/thumbnail-chain';
import { buildMonitorMap, calculateThumbnailDimensions, EVENT_GRID_CONSTANTS, getMonitorDimensions } from '../../lib/event/event-utils';
import { groupByOwningProfile } from '../../lib/profile/profile-sections';
import { ProfileSectionList } from '../profiles/ProfileSectionList';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import type { EventData, Monitor, ProfileId, Tag } from '../../api/types';
import type { ThumbnailFallbackEntry } from '../../stores/settings';
import { scopedEventKey } from '../../lib/event/scoped-event-key';

/** An event tagged with its owning profile - set only in All mode
 *  (see useScopedEvents); undefined in single mode. */
export type ScopedEventItem = EventData & { profileId?: ProfileId; profileChip?: string };

interface EventListViewProps {
  events: ScopedEventItem[];
  /** All mode only: monitors carry their owning profileId so a colliding
   *  numeric id across two servers doesn't collapse into one map entry. */
  monitors: Array<{ Monitor: Monitor; profileId?: ProfileId }>;
  /** Off hides the text drawn over each thumbnail (refs #525). */
  showThumbnailLabels: boolean;
  /** Default portal URL/token, used in single mode or for an item with no profileId. */
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
  /** Aggregate only: the aggregate's own id sections the list by owning
   *  server instead of one time-ordered stream; undefined leaves it flat
   *  (refs #501). The id also scopes each section's collapse state. */
  groupByScopeId?: ProfileId;
}

// Helper to render a single event item
// Memoized: with a stable monitorMap and stable callback/array props from the
// parent, this skips re-rendering rows unaffected by a given state change.
const EventItem = memo(function EventItem({
  event,
  monitorMap,
  showThumbnailLabels,
  portalUrl,
  accessToken,
  eventTagMap,
  eventFilters,
  minStreamingPort,
  thumbnailChain,
}: {
  event: ScopedEventItem;
  monitorMap: Map<string, Monitor>;
  showThumbnailLabels: boolean;
  portalUrl: string;
  accessToken?: string;
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
  thumbnailChain: ThumbnailFallbackEntry[];
}) {
  const { Event, profileId, profileChip } = event;

  // Re-render THIS row when the server map changes (e.g. multi-server
  // bootstrap populating it after first render). Subscribing here, not in
  // the parent, means the parent's monitorMap useMemo doesn't need a
  // serverMapVersion dependency it never actually reads just to bust this
  // memo()-wrapped row's props (refs #337 fix round 1) - this row re-renders
  // on its own regardless of memo, and getPortalUrlForMonitor below reads
  // the (now up to date) server map fresh on every call.
  useSyncExternalStore(subscribeServerMap, getServerMapVersion);

  // All mode: resolve this row's OWN owning-profile client details instead
  // of the page-level defaults (which reflect no/whatever profile is
  // current - there isn't one in All mode). Cheap per-row hook calls are
  // the established pattern here (MonitorCard does the same per tile).
  // Single mode: profileId is undefined, both hooks fall back to the
  // current profile, matching prior behavior exactly.
  const { profile: ownerProfile, settings: ownerSettings } = useProfileById(profileId);
  const { token: ownerToken, isFresh: ownerTokenFresh } = useFreshAccessToken(profileId);
  const effectivePortalUrl = profileId ? (ownerProfile?.portalUrl || portalUrl) : portalUrl;
  const effectiveAccessToken = profileId ? (ownerTokenFresh ? ownerToken ?? undefined : undefined) : accessToken;
  const effectiveMinStreamingPort = profileId
    ? resolveMinStreamingPort(ownerProfile?.minStreamingPort, ownerSettings.forceDisableMultiPort)
    : minStreamingPort;

  // O(1) lookup via the id -> Monitor map built once per monitors change,
  // instead of an O(monitors) `.find()` per row per render. All mode keys
  // by `${profileId}:${monitorId}` so a colliding numeric id across two
  // servers resolves to THIS row's own server's monitor.
  const monitorData = monitorMap.get(profileId ? `${profileId}:${Event.MonitorId}` : Event.MonitorId);

  const { width: monitorWidth, height: monitorHeight } = getMonitorDimensions(monitorData, Event.Width, Event.Height);

  const { width: thumbnailWidth, height: thumbnailHeight } = calculateThumbnailDimensions(
    monitorWidth,
    monitorHeight,
    monitorData?.Orientation ?? Event.Orientation,
    EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
  );

  // Resolve the portal URL directly from the already-looked-up monitor
  // instead of getPortalUrlForEvent(), which would re-run its own
  // O(monitors) find() over the full monitors array.
  const eventPortalUrl = getPortalUrlForMonitor(monitorData?.ServerId, effectivePortalUrl, profileId);
  const thumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: effectiveAccessToken,
    width: thumbnailWidth,
    height: thumbnailHeight,
    minStreamingPort: effectiveMinStreamingPort,
    monitorId: Event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(Event),
  });

  // Full-size image chain used by the desktop hover preview. No width/height
  // is passed so ZM returns the original image, which the view scales down.
  const largeThumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: effectiveAccessToken,
    minStreamingPort: effectiveMinStreamingPort,
    monitorId: Event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(Event),
  });

  const monitorName = monitorData?.Name || `Camera ${Event.MonitorId}`;

  return (
    <div className="pb-3">
      <EventCard
        event={Event}
        monitorName={monitorName}
        profileId={profileId}
        profileChip={profileChip}
        monitorServerId={monitorData?.ServerId}
        thumbnailUrls={thumbnailUrls}
        largeThumbnailUrls={largeThumbnailUrls}
        showThumbnailLabels={showThumbnailLabels}
        thumbnailWidth={thumbnailWidth}
        thumbnailHeight={thumbnailHeight}
        tags={eventTagMap?.get(scopedEventKey(profileId, Event.Id))}
        eventFilters={eventFilters}
      />
    </div>
  );
});

export const EventListView = ({
  events,
  monitors,
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
}: EventListViewProps) => {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const thumbnailChain = settings.thumbnailFallbackChain;

  // id -> Monitor lookup, rebuilt only when the monitors array reference
  // changes. Replaces a monitors.find() per event per render (O(events x
  // monitors)) with an O(1) map.get() per event. EventItem below refreshes
  // its own per-server URL when the server map changes (it subscribes to it
  // directly), so this memo doesn't need to bust on that too.
  const monitorMap = useMemo(() => buildMonitorMap(monitors), [monitors]);

  const isLoadingData = isFetching;
  const hasMore = totalCount !== undefined ? events.length < totalCount : false;
  const remaining = totalCount !== undefined ? Math.min(batchSize, totalCount - events.length) : batchSize;

  // Status header - shows "Showing X of Y events" at the top
  const header = (
    <div className="text-xs text-muted-foreground pb-3 flex items-center gap-2">
      {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      {totalCount !== undefined
        ? t('events.showing_of_total', { showing: events.length, total: totalCount })
        : t('events.showing_events', { count: events.length })}
    </div>
  );

  // Footer with Load More button
  const footer = hasMore ? (
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
  ) : null;

  const renderEvent = (event: ScopedEventItem) => (
    <EventItem
      key={scopedEventKey(event.profileId, event.Event.Id)}
      event={event}
      monitorMap={monitorMap}
      showThumbnailLabels={showThumbnailLabels}
      portalUrl={portalUrl}
      accessToken={accessToken}
      eventTagMap={eventTagMap}
      eventFilters={eventFilters}
      minStreamingPort={minStreamingPort}
      thumbnailChain={thumbnailChain}
    />
  );

  // One section per owning server, in first-seen order; the count header and
  // Load More stay one per view so paging is unchanged (refs #501).
  const sections = groupByScopeId ? groupByOwningProfile(events) : null;

  return (
    <div className="min-h-0" data-testid="event-list">
      {header}
      {sections && groupByScopeId ? (
        <ProfileSectionList
          sections={sections}
          surface="events-group"
          scopeId={groupByScopeId}
          className="space-y-2"
          renderItems={(items) => <>{items.map(renderEvent)}</>}
        />
      ) : (
        events.map(renderEvent)
      )}
      {footer}
    </div>
  );
};
