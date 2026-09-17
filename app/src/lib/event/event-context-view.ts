/**
 * View-layer pure helpers for the "around this event" panel (refs #494).
 *
 * Pure and React-free so the list and the ribbon share one implementation;
 * component files may not export non-components (react-refresh lint), so
 * these live here beside `event-context.ts` instead.
 */

import { formatElapsedShort } from '../format-date-time';
import type { EventAroundRow } from '../../hooks/useEventsAround';

/** "−4:12" / "+0:38" / "0:00" — digits and a sign, no translation needed. */
export function offsetLabel(offsetMs: number): string {
  const elapsed = formatElapsedShort(Math.abs(offsetMs));
  if (offsetMs < 0) return `−${elapsed}`;
  if (offsetMs > 0) return `+${elapsed}`;
  return elapsed;
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
