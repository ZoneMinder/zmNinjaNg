/**
 * Builds `DisplayEntity` result cards for the read-only assistant tools
 * (refs #246). Split out of tools-readonly.ts to keep that file under the
 * ~400 LOC guideline (rule 12) and because both list_events/get_event and
 * list_monitors/get_monitor share one builder each.
 *
 * Event thumbnail URLs are built exactly like MonitorRecentEvents.tsx builds
 * them for CompactEventRow: `getPortalUrlForEvent` resolves the event's
 * monitor to its (possibly multi-server) portal URL, then
 * `buildThumbnailChain` maps the profile's configured fallback chain
 * (alarm/snapshot/objdetect/custom) to authenticated image URLs via
 * `getEventImageUrl` (api/events.ts). These URLs are UI-only: they land on
 * `DisplayEntity.imageUrls`, never on the JSON `output` string a tool hands
 * back to the model (the vision non-goal stands).
 */
import type { Event, MonitorData } from '../../api/types';
import { getPortalUrlForEvent } from '../zm/server-resolver';
import { buildThumbnailChain, eventHasAlarmFrame } from '../event/thumbnail-chain';
import { parseDetectedObjects } from '../event/event-detection';
import { formatAppDateTimeShort } from '../format-date-time';
import type { DisplayEntity, ToolContext } from './types';

type EventLike = Pick<Event, 'Id' | 'MonitorId' | 'StartDateTime' | 'Notes' | 'Cause' | 'AlarmFrames'>;

/** Builds one event result card. `monitorName` is already resolved by the
 *  caller (list_events/get_event both build a monitor id -> name map for the
 *  text output; this reuses it instead of looking it up again). */
export function buildEventDisplayEntity(
  e: EventLike,
  monitorName: string,
  monitors: MonitorData[],
  ctx: ToolContext,
): DisplayEntity {
  const objects = parseDetectedObjects(e.Notes);
  const startTime = new Date(e.StartDateTime.replace(' ', 'T'));
  const startLabel = ctx.dateTimeFormat
    ? formatAppDateTimeShort(startTime, ctx.dateTimeFormat)
    : e.StartDateTime;

  let imageUrls: string[] = [];
  if (ctx.portalUrl) {
    const eventPortalUrl = getPortalUrlForEvent(e.MonitorId, monitors, ctx.portalUrl, ctx.profileId);
    imageUrls = buildThumbnailChain(eventPortalUrl, e.Id, ctx.thumbnailFallbackChain, {
      token: ctx.accessToken ?? undefined,
      minStreamingPort: ctx.minStreamingPort,
      monitorId: e.MonitorId,
      hasAlarmFrame: eventHasAlarmFrame(e),
    });
  }

  return {
    kind: 'event',
    id: e.Id,
    title: `${monitorName} · ${startLabel}`,
    subtitle: objects.length > 0 ? objects.join(', ') : e.Cause,
    navigatePath: `/events/${e.Id}`,
    imageUrls,
    cacheKey: e.Id,
    monitorId: e.MonitorId,
  };
}

/** Builds one monitor result card. No snapshot image (rule: do not wire a
 *  live stream or build one here); AskPanel renders the card text-only. */
export function buildMonitorDisplayEntity(m: MonitorData): DisplayEntity {
  const status = m.Monitor_Status?.Status;
  return {
    kind: 'monitor',
    id: m.Monitor.Id,
    title: m.Monitor.Name,
    subtitle: status ? `${m.Monitor.Function} · ${status}` : m.Monitor.Function,
    navigatePath: `/monitors/${m.Monitor.Id}`,
  };
}

/**
 * The SHOW directive: how the model says which cards its answer is about
 * (refs #264).
 *
 * The model may end its answer with one final line
 * `SHOW: events=<id,id> monitors=<id,id>`. The line is stripped before the
 * text renders (so the no-raw-ids rule for answer TEXT stands) and the ids
 * select among the cards this turn's tools actually produced; an id the
 * results never contained selects nothing, so the model cannot conjure a
 * card. No directive, or a directive matching nothing, shows every card,
 * which is also what every model produced before the directive existed.
 */
export interface ShowDirective {
  events: string[];
  monitors: string[];
}

/** Splits a SHOW directive off the end of an answer. Only a FINAL line is
 *  honored: a mid-text mention is prose about the mechanism, not a directive. */
export function extractShowDirective(text: string): { text: string; show?: ShowDirective } {
  const lines = text.trimEnd().split('\n');
  const last = lines[lines.length - 1]?.trim() ?? '';
  const match = /^SHOW:\s*(.*)$/i.exec(last);
  if (!match) return { text };
  const ids = (name: string): string[] => {
    // No whitespace tolerated around '=': a lax match swallowed the NEXT
    // list's name as this list's value on "events= monitors=".
    const part = new RegExp(`\\b${name}=([^\\s]*)`, 'i').exec(match[1]);
    // Models wrap the list in brackets ("events=[1,2]", observed live,
    // refs #436); the ids are the same either way.
    return (part?.[1] ?? '')
      .split(',')
      .map((id) => id.trim().replace(/^\[|\]$/g, ''))
      .filter((id) => id.length > 0);
  };
  return {
    text: lines.slice(0, -1).join('\n').trimEnd(),
    show: { events: ids('events'), monitors: ids('monitors') },
  };
}

/** The cards a SHOW directive selects, or every card when it selects none:
 *  a directive full of ids the results never contained is a model mistake,
 *  and hiding all evidence over it would be worse than over-showing. */
export function filterDisplayByShow(entities: DisplayEntity[], show: ShowDirective): DisplayEntity[] {
  const wanted = new Set([...show.events.map((id) => `event:${id}`), ...show.monitors.map((id) => `monitor:${id}`)]);
  const selected = entities.filter((e) => wanted.has(`${e.kind}:${e.id}`));
  return selected.length > 0 ? selected : entities;
}
