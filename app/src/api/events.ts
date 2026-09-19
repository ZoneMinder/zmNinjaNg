/**
 * Events API
 * 
 * Handles fetching event lists, details, and generating URLs for event media (images, video).
 * Supports filtering, pagination, and archiving.
 */

import type { ApiClient } from './client';
import type { EventsResponse, EventData, EventFilters, ProfileId } from './types';
import { EventsResponseSchema, EventResponseSchema } from './types';
import { log, LogLevel } from '../lib/logger';
import { validateApiResponse } from '../lib/zm/api-validator';
import {
  getEventImageUrl as buildEventImageUrl,
  getEventVideoUrl as buildEventVideoUrl,
  getEventZmsUrl as buildEventZmsUrl,
} from '../lib/zm/url-builder';
import { wrapWithImageProxy } from '../lib/zm/proxy-utils';
import { getExcludedMonitorIdSet } from '../lib/profile/profile-settings';
import { API_PAGINATION } from '../lib/zmninja-ng-constants';

// EventFilters is declared in ./types alongside the other request and response
// shapes, because types.ts references it too and importing it back from here
// closed a cycle (refs #281). Re-exported for the callers that expect it here.
export type { EventFilters };

/** Drop events belonging to profileId's excluded monitors. */
function dropExcludedMonitorEvents(events: EventData[], profileId: ProfileId): EventData[] {
  const excludedIds = getExcludedMonitorIdSet(profileId);
  if (excludedIds.size === 0) return events;
  return events.filter(event => !excludedIds.has(event.Event.MonitorId));
}

/** Build the EventsResponse for a fully-resolved, ordered event list. */
function buildEventsResponse(
  orderedEvents: EventData[],
  desiredLimit: number,
  totalCount: number
): EventsResponse {
  const finalEvents = orderedEvents.slice(0, desiredLimit);
  return {
    events: finalEvents,
    pagination: {
      page: 1,
      pageCount: Math.ceil(totalCount / desiredLimit),
      current: 1,
      count: finalEvents.length,
      prevPage: false,
      nextPage: finalEvents.length < totalCount,
      limit: desiredLimit,
      totalCount,
    },
  };
}

/**
 * Fetch events for each of several filter variants, then merge them into one
 * paginated result. A "variant" is one extra ZM filter segment that the server
 * cannot express in a single query alongside the others: an "Id IN:<chunk>"
 * (favorites, chunked for URL length) or a "Tags.Id:<id>" (one per selected
 * tag, since ZM rejects "Tags.Id IN:"). Each variant is fetched in full, then
 * the variants are merged, de-duplicated, ordered by StartDateTime, and sliced
 * to the caller's limit. totalCount reflects the merged match set, so the result
 * composes with pagination instead of being filtered client-side after a server
 * page (refs #205).
 */
async function fetchEventsByVariants(
  client: ApiClient,
  profileId: ProfileId,
  baseSegments: string[],
  variantSegments: string[],
  filters: EventFilters
): Promise<EventsResponse> {
  const desiredLimit = filters.limit || API_PAGINATION.eventsPerPage;

  const collected: EventData[] = [];
  for (const variant of variantSegments) {
    const segments = [...baseSegments, `/${encodeURIComponent(variant)}`];
    const url = `/events/index${segments.join('')}.json`;

    let currentPage = 1;
    let hasMore = true;
    while (hasMore && currentPage <= API_PAGINATION.maxEventPages) {
      const params: Record<string, string | number> = {
        page: currentPage,
        limit: API_PAGINATION.eventsPerPage,
      };
      if (filters.sort) params.sort = filters.sort;
      if (filters.direction) params.direction = filters.direction;

      const response = await client.get<EventsResponse>(url, {
        params,
        intent: `Fetch events by membership (${variant}, page ${currentPage})`,
      });
      const validated = validateApiResponse(EventsResponseSchema, response.data, {
        endpoint: url,
        method: 'GET',
      });
      collected.push(...validated.events);
      if (validated.pagination?.nextPage) {
        currentPage++;
      } else {
        hasMore = false;
      }
    }
  }

  // De-duplicate across variants and pages, drop excluded monitors.
  const uniqueEvents = Array.from(
    new Map(collected.map(event => [event.Event.Id, event])).values()
  );
  const visibleEvents = dropExcludedMonitorEvents(uniqueEvents, profileId);

  // Order by StartDateTime (lexicographic on 'YYYY-MM-DD HH:MM:SS' is chronological).
  const sortDir = filters.direction === 'asc' ? 1 : -1;
  visibleEvents.sort((a, b) => {
    const aTime = a.Event.StartDateTime ?? '';
    const bTime = b.Event.StartDateTime ?? '';
    if (aTime === bTime) return 0;
    return (aTime < bTime ? -1 : 1) * sortDir;
  });

  return buildEventsResponse(visibleEvents, desiredLimit, visibleEvents.length);
}

/**
 * Get events with optional filtering.
 *
 * Automatically fetches multiple pages if needed to reach the desired limit.
 * Handles ZM API pagination logic internally.
 *
 * @param client - API client for the target profile
 * @param profileId - The profile whose exclusion list filters the result
 * @param filters - Object containing filter criteria (monitor, date, etc.)
 * @returns Promise resolving to EventsResponse with list of events and pagination info
 */
export async function getEvents(client: ApiClient, profileId: ProfileId, filters: EventFilters = {}): Promise<EventsResponse> {
  // Build filter path for ZM API
  const filterSegments: string[] = [];
  const addFilterSegment = (segment: string) => {
    filterSegments.push(`/${encodeURIComponent(segment)}`);
  };

  if (filters.monitorId) {
    // Support multiple monitor IDs separated by commas
    const monitorIds = filters.monitorId.split(',');
    monitorIds.forEach(id => {
      addFilterSegment(`MonitorId:${id.trim()}`);
    });
  }
  if (filters.startDateTime) {
    // ZM API expects space instead of T
    const formattedStart = filters.startDateTime.replace('T', ' ');
    addFilterSegment(`StartDateTime >=:${formattedStart}`);
  }
  if (filters.endDateTime) {
    const formattedEnd = filters.endDateTime.replace('T', ' ');
    addFilterSegment(`EndDateTime <=:${formattedEnd}`);
  }
  if (filters.minAlarmFrames) {
    addFilterSegment(`AlarmFrames >=:${filters.minAlarmFrames}`);
  }
  if (filters.notesRegexp) {
    addFilterSegment(`Notes REGEXP:${filters.notesRegexp}`);
  }
  if (filters.cause) {
    addFilterSegment(`Cause REGEXP:${filters.cause}`);
  }
  if (filters.causeExclude) {
    addFilterSegment(`Cause NOT REGEXP:${filters.causeExclude}`);
  }
  if (filters.archived) {
    addFilterSegment('Archived:1');
  }

  // Favorites pass an explicit ID set; route through the server-side "Id IN:"
  // filter so pagination stays accurate (refs #205). An empty set matches
  // nothing and skips the request.
  // `!= null`, not `!== undefined`: a null here used to reach `.length` and
  // throw. The assistant strips omitted arguments now, but this is a trust
  // boundary and should not depend on its caller being careful.
  if (filters.eventIds != null) {
    const desiredLimit = filters.limit || API_PAGINATION.eventsPerPage;
    if (filters.eventIds.length === 0) {
      return buildEventsResponse([], desiredLimit, 0);
    }
    const variants: string[] = [];
    for (let i = 0; i < filters.eventIds.length; i += API_PAGINATION.eventIdFilterChunkSize) {
      const chunk = filters.eventIds.slice(i, i + API_PAGINATION.eventIdFilterChunkSize);
      variants.push(`Id IN:${chunk.join(',')}`);
    }
    return fetchEventsByVariants(client, profileId, filterSegments, variants, filters);
  }

  // Tags filter server-side via one "Tags.Id:" query per selected tag (ZM
  // rejects "Tags.Id IN:"), merged so it composes with pagination (refs #205).
  // An empty list means the caller HAS a tag filter that this server matches
  // nothing for - All mode resolves a selected tag name into each server's own
  // ids, and a server without that tag resolves to none (refs #337). Falling
  // through would answer an unfiltered query, i.e. every event on the one
  // server that lacks the tag. Same contract as eventIds above.
  if (filters.tagIds != null) {
    if (filters.tagIds.length === 0) {
      return buildEventsResponse([], filters.limit || API_PAGINATION.eventsPerPage, 0);
    }
    const variants = filters.tagIds.map(tagId => `Tags.Id:${tagId}`);
    return fetchEventsByVariants(client, profileId, filterSegments, variants, filters);
  }

  const filterPath = filterSegments.join('');

  // Use /events/index.json for both filtered and unfiltered requests
  const url = filterPath ? `/events/index${filterPath}.json` : '/events/index.json';

  const desiredLimit = filters.limit || 100;
  const allEvents: EventData[] = [];
  let currentPage = 1;
  let hasMore = true;
  let totalCount = 0; // Total events matching filters (from server)
  const maxPages = 10; // Limit to 10 pages (1000 events max) to prevent excessive API calls

  // Keep fetching pages until we have enough events, no more pages, or hit max pages
  while (hasMore && allEvents.length < desiredLimit && currentPage <= maxPages) {
    const params: Record<string, string | number> = {};
    params.page = currentPage;
    params.limit = 100; // ZM's max per page, we'll fetch multiple pages
    if (filters.sort) params.sort = filters.sort;
    if (filters.direction) params.direction = filters.direction;

    const response = await client.get<EventsResponse>(url, {
      params,
      intent: `Fetch events page ${currentPage}`,
    });
    const validated = validateApiResponse(EventsResponseSchema, response.data, {
      endpoint: url,
      method: 'GET',
    });

    // Capture total count from first page (ZM returns total matching events in count)
    if (currentPage === 1) {
      totalCount = validated.pagination?.count ?? 0;
    }

    // Add events from this page
    allEvents.push(...validated.events);

    // Check if there are more pages
    if (validated.pagination?.nextPage) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  // Deduplicate events based on ID to handle pagination shifts with live data
  // This prevents "duplicate key" errors in React when new events shift pagination boundaries
  const uniqueEvents = Array.from(
    new Map(allEvents.map(event => [event.Event.Id, event])).values()
  );

  // Drop events belonging to per-profile excluded monitors at the API boundary
  const visibleEvents = dropExcludedMonitorEvents(uniqueEvents, profileId);

  // Warn if we hit the max pages limit
  if (currentPage > maxPages && allEvents.length < desiredLimit) {
    log.api(
      `Hit max pages limit (${maxPages}) while fetching events. Consider refining filters.`,
      LogLevel.WARN,
      { fetched: allEvents.length, requested: desiredLimit }
    );
  }

  log.api(
    `Fetched events complete`,
    LogLevel.DEBUG,
    { total: allEvents.length, returning: Math.min(visibleEvents.length, desiredLimit), requested: desiredLimit }
  );

  // Return with pagination info set to indicate if there are more events available
  return buildEventsResponse(visibleEvents, desiredLimit, totalCount);
}

/**
 * Count a monitor's events recorded after `since`, and report the newest one.
 *
 * One request answers both questions: sorting descending and taking a single
 * row gives the newest event, while ZoneMinder reports the full match size in
 * `pagination.count`. That is what lets the monitor card stamp its watermark
 * from cache when the user opens the events, instead of issuing a second
 * request (refs #239).
 *
 * The operator is strict `>`, verified against ZM 1.39.1: `>=` matches the
 * watermark event itself, so the badge would show a permanent "1 new" for an
 * event the user had already seen.
 *
 * `since` of null means no watermark yet, so every event counts.
 */
export async function getMonitorEventsSince(
  client: ApiClient,
  monitorId: string,
  since: string | null
): Promise<{ count: number; newest: string | null }> {
  const segments = [`MonitorId:${monitorId}`];
  if (since !== null) {
    segments.push(`StartDateTime >:${since}`);
  }
  const url = `/events/index${segments.map((s) => `/${encodeURIComponent(s)}`).join('')}.json`;

  const response = await client.get<EventsResponse>(url, {
    params: { limit: 1, sort: 'StartDateTime', direction: 'desc' },
    intent: `Count events for monitor ${monitorId} since ${since ?? 'the beginning'}`,
  });

  // No validateApiResponse here: this reads two scalars and already degrades
  // to {count: 0, newest: null} when pagination or events is missing, so a
  // Zod schema would add a failure mode without adding a guarantee. getEvents
  // above validates because callers render its events.
  const count = response.data.pagination?.count ?? 0;
  const newest = response.data.events?.[0]?.Event?.StartDateTime ?? null;

  log.api('Counted new events for monitor', LogLevel.DEBUG, { monitorId, since, count });

  return { count, newest };
}

/**
 * Fetch the next or previous event relative to a given timestamp.
 * Uses the same filters as the events list to maintain consistency.
 *
 * Expects filters with already server-formatted dates (from Events page navigation state).
 * Builds the ZM API filter path directly to use StartDateTime comparisons for both directions.
 */
export async function getAdjacentEvent(
  client: ApiClient,
  profileId: ProfileId,
  direction: 'next' | 'prev',
  currentStartDateTime: string,
  filters: EventFilters = {}
): Promise<EventData | null> {
  // Build filter segments (same logic as getEvents, but with custom date handling)
  const filterSegments: string[] = [];
  const addSegment = (segment: string) => {
    filterSegments.push(`/${encodeURIComponent(segment)}`);
  };

  // Apply monitor filter from original filters
  if (filters.monitorId) {
    const monitorIds = filters.monitorId.split(',');
    monitorIds.forEach(id => addSegment(`MonitorId:${id.trim()}`));
  }

  // Apply alarm frames filter
  if (filters.minAlarmFrames) {
    addSegment(`AlarmFrames >=:${filters.minAlarmFrames}`);
  }

  // Apply notes filter
  if (filters.notesRegexp) {
    addSegment(`Notes REGEXP:${filters.notesRegexp}`);
  }

  // Use StartDateTime for adjacency (not the original date range filters)
  if (direction === 'next') {
    addSegment(`StartDateTime >:${currentStartDateTime}`);
  } else {
    addSegment(`StartDateTime <:${currentStartDateTime}`);
  }

  const filterPath = filterSegments.join('');
  const url = `/events/index${filterPath}.json`;

  // Fetch a small batch (not just 1) so we can skip over excluded monitors
  // and still land on the nearest visible adjacent event.
  const excludedIds = getExcludedMonitorIdSet(profileId);
  const params: Record<string, string | number> = {
    page: 1,
    limit: excludedIds.size === 0 ? 1 : 25,
    sort: 'StartDateTime',
    direction: direction === 'next' ? 'asc' : 'desc',
  };

  try {
    const response = await client.get<EventsResponse>(url, { params });
    const validated = validateApiResponse(EventsResponseSchema, response.data, {
      endpoint: url,
      method: 'GET',
    });
    const visible = excludedIds.size === 0
      ? validated.events
      : validated.events.filter(event => !excludedIds.has(event.Event.MonitorId));
    return visible[0] || null;
  } catch (err) {
    log.api('Failed to fetch adjacent event', LogLevel.ERROR, { direction, error: err });
    return null;
  }
}

/**
 * Get a single event by ID.
 *
 * @param eventId - The ID of the event to fetch
 * @returns Promise resolving to EventData
 */
export async function getEvent(client: ApiClient, eventId: string): Promise<EventData> {
  const response = await client.get(`/events/${eventId}.json`);

  // Validate response with Zod
  const validated = validateApiResponse(EventResponseSchema, response.data, {
    endpoint: `/events/${eventId}.json`,
    method: 'GET',
  });

  return validated.event;
}

export interface ConsoleEventCount {
  monitorId: string;
  count: number;
}

/**
 * Per-monitor event counts over an interval (e.g. "1 hour", "1 day"). Hidden
 * monitors are dropped by the caller against the monitor list.
 *
 * Previously unused endpoint (refs #246). The interval token format ("1
 * hour", "1 day", ...) needs verifying against a live ZM server at device
 * time; it is not exercised by any e2e test.
 */
export async function getConsoleEvents(client: ApiClient, interval: string): Promise<ConsoleEventCount[]> {
  const url = `/events/consoleEvents/${encodeURIComponent(interval)}.json`;
  const response = await client.get<{ results?: Record<string, number> }>(url, {
    intent: `Fetch console event counts (${interval})`,
  });
  const results = response.data.results ?? {};
  return Object.entries(results).map(([monitorId, count]) => ({ monitorId, count: Number(count) }));
}

/**
 * Delete an event.
 * 
 * @param eventId - The ID of the event to delete
 */
export async function deleteEvent(client: ApiClient, eventId: string): Promise<void> {
  await client.delete(`/events/${eventId}.json`);
}

/**
 * Archive or unarchive an event.
 *
 * ZM's CakePHP API expects form-encoded PUT bodies (`Event[Archived]=1`)
 * and responds with `{"message":"Saved"}` on success, not the updated event.
 * Callers should invalidate the event/events queries to refresh state.
 */
export async function setEventArchived(client: ApiClient, eventId: string, archived: boolean): Promise<void> {
  const body = new URLSearchParams();
  body.set('Event[Archived]', archived ? '1' : '0');
  await client.putForm(`/events/${eventId}.json`, body);
}

/**
 * Construct event image URL using ZoneMinder's index.php endpoint.
 *
 * Format: /index.php?view=image&eid=<eventId>&fid=<frame>&width=<width>&height=<height>&token=<token>
 * In dev mode, uses proxy to avoid CORS issues.
 *
 * @param portalUrl - Base portal URL
 * @param eventId - The ID of the event
 * @param frame - Frame number, 'snapshot', or 'objdetect'
 * @param options - Options for token, dimensions, and API URL override
 * @returns Full URL string for the image
 */
export function getEventImageUrl(
  portalUrl: string,
  eventId: string,
  frame: number | 'snapshot' | 'alarm' | 'objdetect' | string,
  options: {
    token?: string;
    width?: number;
    height?: number;
    apiUrl?: string;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const fullUrl = buildEventImageUrl(portalUrl, eventId, frame, options);

  // In dev mode, use proxy server to avoid CORS issues
  return wrapWithImageProxy(fullUrl);
}

/**
 * Construct event video URL.
 *
 * Supports both MP4 (mode=mp4) and HLS (mode=hls) depending on the
 * event's DefaultVideo field. HLS events use view_event_hls.
 *
 * @param portalUrl - Base portal URL
 * @param eventId - The ID of the event
 * @param token - Auth token
 * @param apiUrl - API URL override
 * @param hls - Use HLS mode when DefaultVideo is an m3u8 manifest
 * @returns Full URL string for the video
 */
export function getEventVideoUrl(
  portalUrl: string,
  eventId: string,
  token?: string,
  apiUrl?: string,
  hls?: boolean,
  minStreamingPort?: number,
  monitorId?: string,
): string {
  return buildEventVideoUrl(portalUrl, eventId, { token, apiUrl, hls, minStreamingPort, monitorId });
}

/**
 * Construct event ZMS stream URL (for MJPEG playback with controls).
 *
 * @param portalUrl - Base portal URL
 * @param eventId - The ID of the event
 * @param options - Playback control options
 * @returns Full URL string for the stream
 */
export function getEventZmsUrl(
  portalUrl: string,
  eventId: string,
  options: {
    token?: string;
    apiUrl?: string;
    frame?: number;        // Start frame (1-based)
    rate?: number;         // Playback speed (100 = 1x, 200 = 2x, 50 = 0.5x)
    maxfps?: number;       // Maximum frames per second
    replay?: 'single' | 'all' | 'gapless' | 'none';  // Replay mode
    scale?: number;        // Scale percentage (50 = 50%, 100 = 100%)
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  return buildEventZmsUrl(portalUrl, eventId, options);
}
