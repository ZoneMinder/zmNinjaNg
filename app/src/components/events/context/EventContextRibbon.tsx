/**
 * The camera ribbon in the "around this event" panel (refs #494): one lane
 * per camera in the window, one dot per event, a vertical rule behind the
 * anchor's own dot. Pure layout maths over Task 3's rows, no canvas.
 *
 * The list below the ribbon stays the accessible source of truth; each dot
 * is a real button with a camera+offset label so a screen reader user gets
 * the same information sighted users get from position.
 *
 * Collapsible (refs #494): many-camera windows can fill most of the panel, so
 * a header row lets the user hide the lanes, remembered per device the same
 * way AppearanceSection remembers the hover-preview section
 * (STORAGE_KEYS, a lazy useState initialiser, try/catch on both ends).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { EVENT_CONTEXT, STORAGE_KEYS } from '../../../lib/zmninja-ng-constants';
import { offsetLabel, type RibbonLane } from '../../../lib/event/event-context-view';

export interface EventContextRibbonProps {
  lanes: RibbonLane[];
  onSelect: (eventId: string) => void;
}

function readStoredExpanded(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.eventContextRibbonOpen);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function EventContextRibbon({ lanes, onSelect }: EventContextRibbonProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(readStoredExpanded);

  // Hidden only when there is nothing to compare: a single event is its own
  // answer. One camera with several events still earns the strip, because
  // where they sit in the window is what the list's offsets say least
  // directly.
  const dotCount = lanes.reduce((total, lane) => total + lane.dots.length, 0);
  if (dotCount < 2) return null;

  const handleExpandedChange = (next: boolean) => {
    setExpanded(next);
    try {
      localStorage.setItem(STORAGE_KEYS.eventContextRibbonOpen, String(next));
    } catch {
      /* per-device convenience only; a blocked write just resets next open */
    }
  };

  return (
    <div className="border-b" data-testid="event-context-ribbon">
      <button
        type="button"
        data-testid="event-context-ribbon-toggle"
        aria-expanded={expanded}
        onClick={() => handleExpandedChange(!expanded)}
        className="flex w-full items-center gap-1.5 px-4 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')} />
        {expanded ? t('events.around.scope') : t('events.around.ribbon_count', { count: lanes.length })}
      </button>
      {expanded && (
        <div
          className="overflow-y-auto"
          style={{ maxHeight: EVENT_CONTEXT.ribbonMaxLanes * EVENT_CONTEXT.ribbonLaneHeight }}
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
                        'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        // Colour and size both carry the anchor, never colour alone:
                        // the neighbours recede so the event you came from is the
                        // one the eye lands on.
                        dot.isAnchor
                          ? 'h-3 w-3 bg-primary ring-2 ring-offset-1 ring-primary/40'
                          : 'h-2 w-2 bg-muted-foreground/60 hover:bg-muted-foreground'
                      )}
                      style={{ left: `${dot.leftPercent}%` }}
                    />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
