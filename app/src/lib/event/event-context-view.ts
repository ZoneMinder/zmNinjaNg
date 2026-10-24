/**
 * View-layer pure helpers for the "around this event" panel (refs #494).
 *
 * Pure and React-free so the list and the replay share one implementation;
 * component files may not export non-components (react-refresh lint), so
 * these live here beside `event-context.ts` instead.
 */

import { buildThumbnailChainForEvent, eventHasAlarmFrame } from './thumbnail-chain';
import { calculateThumbnailDimensions, getMonitorDimensions, EVENT_GRID_CONSTANTS } from './event-utils';
import { EVENT_CONTEXT } from '../zmninja-ng-constants';
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

/** One tile's start inside its run, in milliseconds after the run starts. */
export interface ReplayCue {
  eventId: string;
  startMs: number;
}

/**
 * The in-order replay as runs of overlapping events (refs #534). Inside a run
 * the tiles keep their real spacing, scaled by `ratePercent` (ZMS's `rate`,
 * 200 = 2x), so cameras that recorded the same moment play it together. The
 * idle stretch between runs is cut: the next run starts when every tile in
 * the current one reports done, never on a timer, because a ZMS stream does
 * not keep to the event's nominal length. Rows must be in time order.
 */
export function buildReplayRuns(rows: EventAroundRow[], ratePercent: number): ReplayCue[][] {
  const scale = 100 / ratePercent;
  const runs: ReplayCue[][] = [];
  let frontier = -Infinity;
  let runStart = 0;
  for (const { event, offsetMs } of rows) {
    if (offsetMs > frontier) {
      runs.push([]);
      runStart = offsetMs;
    }
    runs[runs.length - 1].push({ eventId: event.Id, startMs: (offsetMs - runStart) * scale });
    frontier = Math.max(frontier, offsetMs + (Number(event.Length) || 0) * 1000);
  }
  return runs;
}

/** The first run with a tile still to finish, or -1 once all are done. */
export function currentRunIndex(runs: ReplayCue[][], done: ReadonlySet<string>): number {
  return runs.findIndex((run) => run.some(({ eventId }) => !done.has(eventId)));
}

/**
 * Grid track weights (`fr` units) after dragging track `index` to `sizePx` of
 * a `totalPx` grid (refs #534). Only the dragged track's weight changes, so
 * the others keep their proportions and the grid keeps its size.
 */
export function resizeTrack(weights: number[], index: number, sizePx: number, totalPx: number): number[] {
  if (weights.length < 2 || totalPx <= 0) return weights;
  const min = EVENT_CONTEXT.sequenceMinTrackShare;
  const others = weights.reduce((sum, w, i) => (i === index ? sum : sum + w), 0);
  const smallest = Math.min(...weights.filter((_, i) => i !== index));
  // Growing shrinks the others in proportion, so the cap keeps the smallest
  // of them at `min` or above.
  const share = Math.min(1 - (min * others) / smallest, Math.max(min, sizePx / totalPx));
  return weights.map((w, i) => (i === index ? (share * others) / (1 - share) : w));
}
