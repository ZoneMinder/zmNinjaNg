/**
 * "Around this event": which window, and which cameras.
 *
 * Pure and React-free so the panel, the hook and their tests all agree on the
 * same arithmetic. Every function here treats its input as untrusted: the
 * window comes from persisted settings and the monitor lists come from
 * ZoneMinder columns users hand-edit (I1).
 */

import { fromZonedTime } from 'date-fns-tz';
import { EVENT_CONTEXT, EVENT_CONTEXT_SCOPES, type EventContextScope } from '../zmninja-ng-constants';
import { formatForServerInTz } from '../time';
import { eventInstant } from './event-instant';
import type { EventData, GroupsResponse } from '../../api/types';

// Re-exported for existing consumers; the scope type and its values live in
// zmninja-ng-constants.ts, which imports nothing, so a value import of them
// never pulls in this module's own dependency chain (lib/time -> stores/profile).
export type { EventContextScope } from '../zmninja-ng-constants';
export { EVENT_CONTEXT_SCOPES };

export interface EventContextWindow {
  /** ZoneMinder wall-clock bounds, in the owning profile's timezone. */
  startDateTime: string;
  endDateTime: string;
  /** The anchor's own instant, for offsets the list and ribbon render. */
  anchorMs: number;
}

export function eventContextWindow(
  event: EventData,
  windowMinutes: number,
  timezone: string
): EventContextWindow {
  const anchorMs = eventInstant(event, timezone);
  const endRaw = event.Event.EndDateTime;
  const endMs = endRaw
    ? fromZonedTime(endRaw.replace(' ', 'T'), timezone).getTime()
    : anchorMs + (Number(event.Event.Length) || 0) * 1000;
  const padMs = windowMinutes * 60 * 1000;
  return {
    startDateTime: formatForServerInTz(new Date(anchorMs - padMs), timezone),
    endDateTime: formatForServerInTz(new Date(endMs + padMs), timezone),
    anchorMs,
  };
}

/** Ids out of ZoneMinder's free-text `LinkedMonitors` column, in order, once
 *  each. Anything that is not a run of digits is dropped rather than guessed. */
export function parseLinkedMonitorIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(',').map((part) => part.match(/\d+/)?.[0]).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** Every monitor sharing a group with `monitorId`, the monitor included. */
export function groupMonitorIds(
  groups: GroupsResponse['groups'] | undefined,
  monitorId: string
): string[] {
  if (!groups) return [];
  const ids = new Set<string>();
  for (const entry of groups) {
    const members = entry.Monitor?.map((m) => String(m.Id)) ?? [];
    if (!members.includes(monitorId)) continue;
    for (const id of members) ids.add(id);
  }
  return [...ids];
}

/**
 * The `monitorId` filter for a scope, or undefined to ask for every camera.
 *
 * Undefined is also the answer when a scope resolves to nothing (a server with
 * no links configured) or to more ids than one filter URL can carry: a window
 * over every camera is a worse answer than an error, but it is still an answer.
 */
export function resolveScopeMonitorIds(
  scope: EventContextScope,
  ids: { linked: string[]; group: string[] }
): string[] | undefined {
  if (scope === 'all') return undefined;
  const selected = scope === 'linked' ? ids.linked : ids.group;
  if (selected.length === 0 || selected.length > EVENT_CONTEXT.maxMonitorIds) return undefined;
  return selected;
}
