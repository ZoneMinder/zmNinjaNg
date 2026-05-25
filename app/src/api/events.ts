/**
 * Events API
 * 
 * Handles fetching event lists, details, and generating URLs for event media (images, video).
 * Supports filtering, pagination, and archiving.
 */

import { getApiClient } from './client';
import type { EventsResponse, EventData } from './types';
import { EventsResponseSchema, EventResponseSchema, ConsoleEventsResponseSchema } from './types';
import { log, LogLevel } from '../lib/logger';
import { validateApiResponse } from '../lib/api-validator';
import {
  getEventImageUrl as buildEventImageUrl,
  getEventVideoUrl as buildEventVideoUrl,
  getEventZmsUrl as buildEventZmsUrl,
} from '../lib/url-builder';
import { wrapWithImageProxy } from '../lib/proxy-utils';
import { getExcludedMonitorIds } from '../lib/profile-settings';

export interface EventFilters {
  monitorId?: string;
  startDateTime?: string;
  endDateTime?: string;
  archived?: boolean;
  minAlarmFrames?: number;
  notesRegexp?: string; // REGEXP filter on Notes field (e.g., "detected:" for object detection)
  cause?: string; // Filter by event cause (e.g., "Motion", "Continuous", "Signal", "Forced")
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/**
 * Get events with optional filtering.
 * 
 * Automatically fetches multiple pages if needed to reach the desired limit.
 * Handles ZM API pagination logic internally.
 * 
 * @param filters - Object containing filter criteria (monitor, date, etc.)
 * @returns Promise resolving to EventsResponse with list of events and pagination info
 */
export async function getEvents(filters: EventFilters = {}): Promise<EventsResponse> {
  const client = getApiClient();

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
  const excludedIds = new Set(getExcludedMonitorIds());
  const visibleEvents = excludedIds.size === 0
    ? uniqueEvents
    : uniqueEvents.filter(event => !excludedIds.has(event.Event.MonitorId));

  // Return only the requested number of events
  const finalEvents = visibleEvents.slice(0, desiredLimit);

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
    { total: allEvents.length, returning: finalEvents.length, requested: desiredLimit }
  );

  // Return with pagination info set to indicate if there are more events available
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
      totalCount, // Total events matching filters (from server)
    },
  };
}

/**
 * Fetch the next or previous event relative to a given timestamp.
 * Uses the same filters as the events list to maintain consistency.
 *
 * Expects filters with already server-formatted dates (from Events page navigation state).
 * Builds the ZM API filter path directly to use StartDateTime comparisons for both directions.
 */
export async function getAdjacentEvent(
  direction: 'next' | 'prev',
  currentStartDateTime: string,
  filters: EventFilters = {}
): Promise<EventData | null> {
  const client = getApiClient();

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
  const excludedIds = new Set(getExcludedMonitorIds());
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
export async function getEvent(eventId: string): Promise<EventData> {
  const client = getApiClient();
  const response = await client.get(`/events/${eventId}.json`);

  // Validate response with Zod
  const validated = validateApiResponse(EventResponseSchema, response.data, {
    endpoint: `/events/${eventId}.json`,
    method: 'GET',
  });

  return validated.event;
}

/**
 * Delete an event.
 * 
 * @param eventId - The ID of the event to delete
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const client = getApiClient();
  await client.delete(`/events/${eventId}.json`);
}

/**
 * Archive or unarchive an event.
 *
 * @param eventId - The ID of the event
 * @param archived - True to archive, false to unarchive
 * @returns Promise resolving to updated EventData
 */
export async function setEventArchived(eventId: string, archived: boolean): Promise<EventData> {
  const client = getApiClient();
  const response = await client.put(`/events/${eventId}.json`, {
    'Event[Archived]': archived ? '1' : '0',
  });

  // Validate response with Zod
  const validated = validateApiResponse(EventResponseSchema, response.data, {
    endpoint: `/events/${eventId}.json`,
    method: 'PUT',
  });

  return validated.event;
}

/**
 * Get event count for console (recent events per monitor).
 *
 * Returns event counts per monitor within the specified interval.
 *
 * @param interval - Time interval string (e.g. '1 hour', '1 day')
 * @returns Promise resolving to object mapping monitor IDs to event counts
 */
export async function getConsoleEvents(interval: string = '1 hour'): Promise<Record<string, number>> {
  const client = getApiClient();
  const response = await client.get(`/events/consoleEvents/${encodeURIComponent(interval)}.json`);

  // Validate response with Zod
  const validated = validateApiResponse(ConsoleEventsResponseSchema, response.data, {
    endpoint: `/events/consoleEvents/${interval}.json`,
    method: 'GET',
  });

  // The response should be an object where keys are monitor IDs and values are event counts
  // Example: { results: { "1": 5, "2": 3, "3": 0 } }
  // According to ZoneMinder source, this should always be an object/record.
  // However, some ZM versions may return an empty array instead of empty object.
  if (Array.isArray(validated.results)) {
    log.api(
      'consoleEvents returned array instead of object (likely ZM version difference or no results)',
      LogLevel.WARN,
      { interval, resultsType: 'array', resultsLength: validated.results.length }
    );
    return {};
  }

  const results = validated.results || {};

  // Drop counts for per-profile excluded monitors
  const excludedIds = new Set(getExcludedMonitorIds());
  if (excludedIds.size === 0) {
    return results;
  }
  return Object.fromEntries(
    Object.entries(results).filter(([monitorId]) => !excludedIds.has(monitorId))
  );
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
