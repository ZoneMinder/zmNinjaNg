/**
 * View-layer pure helpers for the "around this event" panel (refs #494).
 *
 * Pure and React-free so the list and the ribbon share one implementation;
 * component files may not export non-components (react-refresh lint), so
 * these live here beside `event-context.ts` instead.
 */

import { buildThumbnailChainForEvent, eventHasAlarmFrame } from './thumbnail-chain';
import { calculateThumbnailDimensions, getMonitorDimensions, EVENT_GRID_CONSTANTS } from './event-utils';
import type { EventAroundRow } from '../../hooks/useEventsAround';
import type { ThumbnailFallbackEntry } from './thumbnail-chain';
import type { Event, ProfileId } from '../../api/types';

/**
 * "+38s" / "+22m 01s" / "+22m" / "+1h 05m" / "−4m 12s": digits and units, no
 * translation needed (formatElapsedShort's own reasoning). Not built on
 * formatElapsedShort: that's a fixed "m:ss"/"h:mm:ss" stopwatch reading,
 * always shows seconds, and never grows a unit suffix, whereas this needs
 * unit letters and drops seconds once whole minutes are enough - a
 * `m:ss`-style badge misreads once the window reaches an hour, since
 * "22m 01s" and "22h 01m" both look like "22:01".
 */
export function offsetLabel(offsetMs: number): string {
  const totalSeconds = Math.floor(Math.abs(offsetMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let value: string;
  if (hours > 0) {
    value = `${hours}h ${String(minutes).padStart(2, '0')}m`;
  } else if (minutes > 0) {
    value = seconds === 0 ? `${minutes}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  } else {
    value = `${seconds}s`;
  }

  if (offsetMs < 0) return `−${value}`;
  if (offsetMs > 0) return `+${value}`;
  return value;
}

export interface RowThumbnailOptions {
  portalUrl: string;
  thumbnailChain: ThumbnailFallbackEntry[];
  token: string | undefined;
  minStreamingPort: number | undefined;
  profileId: ProfileId | undefined;
}

/** Thumbnail chain and aspect ratio for one row, falling back through
 *  fallback URLs the same way MonitorRecentEvents.tsx's buildRow does
 *  (refs #494). */
export function buildRowThumbnail(event: Event, opts: RowThumbnailOptions) {
  const { width, height } = getMonitorDimensions(undefined, event.Width, event.Height);
  const { width: tw, height: th } = calculateThumbnailDimensions(
    width,
    height,
    event.Orientation,
    EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
  );
  const urls = buildThumbnailChainForEvent(event.MonitorId, [], opts.portalUrl, event.Id, opts.thumbnailChain, {
    token: opts.token,
    width: tw,
    height: th,
    minStreamingPort: opts.minStreamingPort,
    monitorId: event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(event),
    profileId: opts.profileId,
  });
  return { urls, aspectRatio: tw / th };
}

/** Up to `max` rows around the anchor, in time order (refs #534). Rows at
 *  offset zero (the anchor and anything in its second) come first; the rest
 *  alternate between the nearest remaining row before and the nearest after,
 *  so both sides get an equal share. When one side runs out, the other fills
 *  the remaining slots. */
export function balancedAroundAnchor<T extends { offsetMs: number }>(rows: T[], max: number): T[] {
  const sorted = [...rows].sort((a, b) => a.offsetMs - b.offsetMs);
  const before = sorted.filter((r) => r.offsetMs < 0).reverse();
  const after = sorted.filter((r) => r.offsetMs > 0);
  const kept = sorted.filter((r) => r.offsetMs === 0).slice(0, max);
  let takeBefore = true;
  while (kept.length < max && (before.length || after.length)) {
    const side = (takeBefore && before.length) || !after.length ? before : after;
    kept.push(side.shift()!);
    takeBefore = !takeBefore;
  }
  return kept.sort((a, b) => a.offsetMs - b.offsetMs);
}

export interface ReplaySlot {
  eventId: string;
  /** Milliseconds after the replay starts. */
  playAtMs: number;
  /** Null for an event with no length yet, which plays until the replay closes. */
  stopAtMs: number | null;
}

/**
 * When each Sequence play tile starts and stops in the synced replay (refs #534).
 * Events keep their real spacing, so overlapping events play together, but
 * a stretch where nothing is recording is cut out: the next event starts the
 * moment the last one playing ends. `ratePercent` is ZMS's `rate` (200 = 2x),
 * the same rate the tiles stream at. Rows must be in time order.
 */
export function buildReplaySchedule(rows: EventAroundRow[], ratePercent: number): ReplaySlot[] {
  const scale = 100 / ratePercent;
  let frontier: number | null = null;
  let skipped = 0;
  const first = rows[0]?.offsetMs ?? 0;
  return rows.map(({ event, offsetMs }) => {
    if (frontier !== null && offsetMs > frontier) skipped += offsetMs - frontier;
    const lengthMs = (Number(event.Length) || 0) * 1000;
    frontier = Math.max(frontier ?? offsetMs, offsetMs + lengthMs);
    const start = offsetMs - first - skipped;
    return {
      eventId: event.Id,
      playAtMs: start * scale,
      stopAtMs: lengthMs > 0 ? (start + lengthMs) * scale : null,
    };
  });
}

/**
 * Together mode (refs #534): every tile starts at once, up to
 * `maxConcurrent` streams, and each waiting tile takes the first stream slot
 * to free up. The cap exists because a browser opens six connections per host
 * and each playing tile holds one; on a single port the seventh stream, and
 * every thumbnail and API call behind it, would sit queued.
 */
export function buildTogetherSchedule(rows: EventAroundRow[], ratePercent: number, maxConcurrent: number): ReplaySlot[] {
  const scale = 100 / ratePercent;
  const slots: number[] = [];
  return rows.map(({ event }) => {
    const slot = slots.length < maxConcurrent ? slots.push(0) - 1 : slots.indexOf(Math.min(...slots));
    const playAtMs = slots[slot];
    const lengthMs = (Number(event.Length) || 0) * 1000 * scale;
    const stopAtMs = lengthMs > 0 ? playAtMs + lengthMs : null;
    slots[slot] = stopAtMs ?? Infinity;
    return { eventId: event.Id, playAtMs, stopAtMs };
  });
}

export interface RibbonDot {
  eventId: string;
  offsetMs: number;
  leftPercent: number;
  isAnchor: boolean;
}

export interface RibbonLane {
  monitorId: string;
  monitorName: string;
  dots: RibbonDot[];
}

/** Lanes in first-seen order, each dot positioned 0-100% across the window. */
export function buildRibbonLanes(
  rows: EventAroundRow[],
  monitorNames: Map<string, string>,
  windowMs: number
): RibbonLane[] {
  const lanes = new Map<string, RibbonLane>();
  for (const { event, offsetMs, isAnchor } of rows) {
    const monitorId = event.MonitorId;
    let lane = lanes.get(monitorId);
    if (!lane) {
      lane = { monitorId, monitorName: monitorNames.get(monitorId) ?? monitorId, dots: [] };
      lanes.set(monitorId, lane);
    }
    const leftPercent = Math.min(100, Math.max(0, ((offsetMs + windowMs / 2) / windowMs) * 100));
    lane.dots.push({ eventId: event.Id, offsetMs, leftPercent, isAnchor });
  }
  return [...lanes.values()];
}
