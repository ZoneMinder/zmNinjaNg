/**
 * The badge naming why ZoneMinder recorded an event ("Motion", "Continuous",
 * "Linked", ...), with the icon that goes with that cause.
 *
 * A component rather than an inline IIFE in each caller: `getEventCauseIcon`
 * returns a component, and calling it during render creates a new component
 * type on every pass, which remounts its subtree and trips
 * react-hooks/static-components. The event card and the montage tile both
 * rendered the same six lines that way (refs #494).
 */
import { createElement } from 'react';
import { Badge } from '../ui/badge';
import { getEventCauseIcon } from '../../lib/event/event-icons';
import { cn } from '../../lib/utils';

export interface EventCauseBadgeProps {
  cause: string;
  className?: string;
}

export function EventCauseBadge({ cause, className }: EventCauseBadgeProps) {
  return (
    <Badge variant="outline" className={cn('gap-1', className)} data-testid="event-cause-badge">
      {/* createElement, not <CauseIcon/>: binding the looked-up component to a
          local and rendering it reads to react-hooks/static-components as a
          component built during render. The lookup returns one of a fixed set
          of icons, so the element is what we actually want here. */}
      {createElement(getEventCauseIcon(cause), { className: 'h-3 w-3' })}
      {cause}
    </Badge>
  );
}
