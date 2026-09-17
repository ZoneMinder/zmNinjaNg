/**
 * Force-directed graph view of the "around this event" window (refs #494):
 * the same rows the list shows, laid out by useGraphSimulation and rendered
 * as draggable thumbnail nodes with same-camera edges behind them.
 *
 * The list stays the accessible source of truth; every node here is still a
 * real, focusable button in chronological tab order, carrying the same
 * camera+offset label the ribbon's dots use. Dragging a node moves it via
 * pointer events (touch-action: none keeps a drag from scrolling the sheet);
 * a tap that did not drag opens the event exactly as a list row does.
 */
import { useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useEventThumbnailOptions } from '../../../hooks/useEventThumbnailOptions';
import { useMeasuredWidth } from '../../../hooks/useMeasuredWidth';
import { useGraphSimulation } from '../../../hooks/useGraphSimulation';
import { prefersReducedMotion } from '../../../lib/view-transition';
import { selectGraphRows, type GraphNode } from '../../../lib/event/event-graph';
import { buildRowThumbnail, offsetLabel } from '../../../lib/event/event-context-view';
import { EventThumbnail } from '../EventThumbnail';
import { EVENT_CONTEXT, UI_INTERACTIONS } from '../../../lib/zmninja-ng-constants';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { ProfileId } from '../../../api/types';

export interface EventContextGraphProps {
  rows: EventAroundRow[];
  monitorNames: Map<string, string>;
  windowMinutes: number;
  profileId: ProfileId | undefined;
}

interface DragState {
  startX: number;
  startY: number;
  moved: boolean;
}

export function EventContextGraph({ rows, monitorNames, windowMinutes, profileId }: EventContextGraphProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const thumbnailOptions = useEventThumbnailOptions(profileId);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, setElement } = useMeasuredWidth(containerRef);
  // A static read at mount, same as runViewTransition's own use of this
  // check: this panel remounts fresh on every open (EventContextPanel keys
  // EventContextBody per anchor), so a later OS-level toggle is covered by
  // the next open rather than needing a live subscription here.
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const { rows: shownRows, omitted } = useMemo(
    () => selectGraphRows(rows, EVENT_CONTEXT.maxGraphNodes),
    [rows]
  );
  const eventsById = useMemo(() => new Map(shownRows.map((r) => [r.event.Id, r.event])), [shownRows]);

  const { nodes, edges, beginDrag, dragTo, endDrag } = useGraphSimulation({
    rows: shownRows,
    windowMs: windowMinutes * 60_000,
    containerWidth: width,
    reducedMotion,
  });
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.eventId, n])), [nodes]);
  // Rendered (and so tabbed) in chronological order regardless of the order
  // the simulation's own array happens to hold them in.
  const orderedNodes = useMemo(() => [...nodes].sort((a, b) => a.offsetMs - b.offsetMs), [nodes]);

  const openEvent = useCallback(
    (node: GraphNode) => {
      markViewed(node.eventId);
      const path = profileId ? `/all/events/${profileId}/${node.eventId}` : `/events/${node.eventId}`;
      navigate(path, { state: { from: `/monitors/${node.monitorId}` } });
    },
    [markViewed, navigate, profileId]
  );

  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, node: GraphNode) => {
      // Suppresses the compatibility click a pointer-driven tap would
      // otherwise fire, so the open-on-tap logic below is the single source
      // of truth for a pointer gesture; onClick is left for keyboard.
      e.preventDefault();
      // jsdom has no pointer-capture implementation; real browsers do.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
      beginDrag(node.eventId);
    },
    [beginDrag]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > UI_INTERACTIONS.moveCancelPx) drag.moved = true;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragTo(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
    },
    [dragTo]
  );

  const handlePointerUp = useCallback(
    (node: GraphNode) => {
      const drag = dragRef.current;
      dragRef.current = null;
      endDrag();
      if (drag && !drag.moved) openEvent(node);
    },
    [endDrag, openEvent]
  );

  const nodeLabel = (node: GraphNode) =>
    t('events.around.dot_label', {
      camera: monitorNames.get(node.monitorId) ?? node.monitorId,
      offset: node.isAnchor ? t('events.around.this_event') : offsetLabel(node.offsetMs),
    });

  return (
    <div ref={setElement} className="relative flex-1 touch-none overflow-hidden" data-testid="event-context-graph">
      {omitted > 0 && (
        <div className="px-4 py-2 text-xs text-muted-foreground" data-testid="event-context-graph-truncated">
          {t('events.around.graph_truncated', { count: omitted })}
        </div>
      )}
      <svg className="pointer-events-none absolute left-1/2 top-1/2 overflow-visible" width={0} height={0} aria-hidden="true">
        {edges.map((edge) => {
          const a = nodesById.get(edge.a);
          const b = nodesById.get(edge.b);
          if (!a || !b) return null;
          return (
            <line key={`${edge.a}-${edge.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-border" strokeWidth={1} />
          );
        })}
      </svg>
      {orderedNodes.map((node) => {
        const event = eventsById.get(node.eventId);
        if (!event) return null;
        const { urls, aspectRatio } = buildRowThumbnail(event, thumbnailOptions);
        const size = EVENT_CONTEXT.graphNodeSize;
        return (
          <button
            key={node.eventId}
            type="button"
            data-testid={`event-context-node-${node.eventId}`}
            data-node-x={Math.round(node.x)}
            data-node-y={Math.round(node.y)}
            aria-label={nodeLabel(node)}
            onClick={() => openEvent(node)}
            onPointerDown={node.isAnchor ? undefined : (e) => handlePointerDown(e, node)}
            onPointerMove={node.isAnchor ? undefined : handlePointerMove}
            onPointerUp={node.isAnchor ? undefined : () => handlePointerUp(node)}
            className={cn(
              'absolute left-1/2 top-1/2 touch-none overflow-hidden rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              node.isAnchor ? 'z-10 border-primary ring-2 ring-primary/40' : 'cursor-grab border-border'
            )}
            style={{ width: size, height: size, transform: `translate(${node.x - size / 2}px, ${node.y - size / 2}px)` }}
          >
            <EventThumbnail
              urls={urls}
              cacheKey={node.eventId}
              alt=""
              className="h-full w-full"
              objectFit="cover"
              style={{ aspectRatio: aspectRatio.toString() }}
            />
          </button>
        );
      })}
    </div>
  );
}
