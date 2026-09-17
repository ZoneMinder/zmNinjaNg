/**
 * View-layer pure helpers for the "around this event" panel (refs #494).
 *
 * Pure and React-free so the list and the ribbon share one implementation;
 * component files may not export non-components (react-refresh lint), so
 * these live here beside `event-context.ts` instead.
 */

import type { EventAroundRow } from '../../hooks/useEventsAround';

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
