/**
 * The camera ribbon in the "around this event" panel (refs #494): one lane
 * per camera in the window, one dot per event, a vertical rule behind the
 * anchor's own dot. Pure layout maths over Task 3's rows, no canvas.
 *
 * The list below the ribbon stays the accessible source of truth; each dot
 * is a real button with a camera+offset label so a screen reader user gets
 * the same information sighted users get from position.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import { offsetLabel } from './EventContextList';
import type { EventAroundRow } from '../../../hooks/useEventsAround';

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

export interface EventContextRibbonProps {
  lanes: RibbonLane[];
  onSelect: (eventId: string) => void;
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

export function EventContextRibbon({ lanes, onSelect }: EventContextRibbonProps) {
  const { t } = useTranslation();
  // A single lane says nothing the list below it does not.
  if (lanes.length < 2) return null;

  return (
    <div
      className="border-b py-1.5 overflow-y-auto"
      style={{ maxHeight: EVENT_CONTEXT.ribbonMaxLanes * EVENT_CONTEXT.ribbonLaneHeight }}
      data-testid="event-context-ribbon"
    >
      {lanes.map((lane) => (
        <div key={lane.monitorId} className="flex items-center gap-2 px-4" style={{ height: EVENT_CONTEXT.ribbonLaneHeight }}>
          <span className="w-16 shrink-0 truncate text-[10px] text-muted-foreground" title={lane.monitorName}>
            {lane.monitorName}
          </span>
          <div className="relative h-full flex-1">
            {lane.dots.map((dot) => (
              <span key={dot.eventId}>
                {dot.isAnchor && (
                  <span
                    className="pointer-events-none absolute inset-y-0 w-px bg-primary/60"
                    style={{ left: `${dot.leftPercent}%` }}
                  />
                )}
                <button
                  type="button"
                  data-testid={`event-context-dot-${dot.eventId}`}
                  aria-label={t('events.around.dot_label', { camera: lane.monitorName, offset: offsetLabel(dot.offsetMs) })}
                  onClick={() => onSelect(dot.eventId)}
                  className={cn(
                    'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    dot.isAnchor ? 'h-3 w-3 ring-2 ring-offset-1 ring-primary/40' : 'h-2 w-2'
                  )}
                  style={{ left: `${dot.leftPercent}%` }}
                />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
