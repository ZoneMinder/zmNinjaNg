/**
 * Tree view of the "around this event" window (refs #494): the same rows the
 * list shows, laid out by event-tree.ts as a three-column tree - the anchor
 * as root, one branch per camera with an event in the window, that camera's
 * events as leaf thumbnails. A tree's positions carry meaning, so there is
 * no per-node dragging; dragging anywhere pans the whole canvas instead, and
 * wheel zooms it.
 *
 * The list stays the accessible source of truth; every root or leaf node is
 * still a real, focusable button in chronological tab order, carrying the
 * same camera+offset label the ribbon's dots use. Pointer capture lives on
 * the canvas (touch-action: none keeps a drag from scrolling the sheet); a
 * tap that did not drag opens that node's event exactly as a list row does.
 *
 * Each node also carries a small caption (camera, monitor id, event id) so
 * two similar thumbnails can be told apart; it is `aria-hidden`, since the
 * button's own aria-label already is the accessible name. Each leaf edge is
 * labelled with the unsigned time gap between it and the anchor
 * (event-context-view.ts owns that arithmetic); root-to-branch edges carry
 * no time of their own and stay unlabelled. The layout is static: nothing
 * here animates, so prefers-reduced-motion has nothing to disable.
 */
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useEventThumbnailOptions } from '../../../hooks/useEventThumbnailOptions';
import { buildEventTree, selectGraphRows, type TreeNode } from '../../../lib/event/event-tree';
import { buildRowThumbnail, offsetLabel } from '../../../lib/event/event-context-view';
import { EventThumbnail } from '../EventThumbnail';
import { EVENT_CONTEXT, UI_INTERACTIONS } from '../../../lib/zmninja-ng-constants';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { ProfileId } from '../../../api/types';

export interface EventContextGraphProps {
  rows: EventAroundRow[];
  monitorNames: Map<string, string>;
  profileId: ProfileId | undefined;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

interface DragState {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  moved: boolean;
  nodeEventId: string | undefined;
}

/** Elbowed bezier from one node centre to another, the usual dendrogram
 *  "link horizontal" shape: flat out of each end, curving through the
 *  middle. */
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

export function EventContextGraph({ rows, monitorNames, profileId }: EventContextGraphProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const thumbnailOptions = useEventThumbnailOptions(profileId);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const { rows: shownRows, omitted } = useMemo(
    () => selectGraphRows(rows, EVENT_CONTEXT.maxGraphNodes),
    [rows]
  );
  const eventsById = useMemo(() => new Map(shownRows.map((r) => [r.event.Id, r.event])), [shownRows]);
  const layout = useMemo(() => buildEventTree(shownRows, monitorNames), [shownRows, monitorNames]);
  // Rendered (and so tabbed) in chronological order regardless of the
  // branch-then-leaf order the layout's own array holds them in.
  const eventNodes = useMemo(
    () => layout.nodes.filter((n) => n.kind !== 'monitor').sort((a, b) => a.offsetMs - b.offsetMs),
    [layout]
  );
  const branchNodes = useMemo(() => layout.nodes.filter((n) => n.kind === 'monitor'), [layout]);

  const openEvent = useCallback(
    (eventId: string, monitorId: string) => {
      markViewed(eventId);
      const path = profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`;
      navigate(path, { state: { from: `/monitors/${monitorId}` } });
    },
    [markViewed, navigate, profileId]
  );

  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Read the pressed node BEFORE pointer capture below redirects every
      // later event's target to the container.
      const nodeEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-event-id]') : null;
      // jsdom has no pointer-capture implementation; real browsers do.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // Suppresses the compatibility click a pointer-driven tap would
      // otherwise fire, so the open-on-tap logic in onPointerUp is the
      // single source of truth for a pointer gesture; onClick is left for
      // keyboard.
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        moved: false,
        nodeEventId: nodeEl?.dataset.eventId,
      };
    },
    [pan]
  );

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > UI_INTERACTIONS.moveCancelPx) drag.moved = true;
    setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved || !drag.nodeEventId) return;
    const node = eventNodes.find((n) => n.eventId === drag.nodeEventId);
    if (node) openEvent(node.eventId!, node.monitorId);
  }, [eventNodes, openEvent]);

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.001)));
  }, []);

  const nodeLabel = (node: TreeNode) =>
    t('events.around.dot_label', {
      camera: node.monitorName,
      offset: node.kind === 'root' ? t('events.around.this_event') : offsetLabel(node.offsetMs),
    });

  const size = EVENT_CONTEXT.graphNodeSize;
  const half = size / 2;

  return (
    <div
      className="relative flex-1 touch-none overflow-hidden"
      data-testid="event-context-graph"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {omitted > 0 && (
        <div className="px-4 py-2 text-xs text-muted-foreground" data-testid="event-context-graph-truncated">
          {t('events.around.graph_truncated', { count: omitted })}
        </div>
      )}
      <div
        data-testid="event-context-graph-canvas"
        className="absolute left-0 top-0"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const fontSize = 9;
            const plateW = (edge.label?.length ?? 0) * fontSize * 0.62 + 6;
            const plateH = fontSize + 4;
            const midX = (edge.x1 + edge.x2) / 2;
            const midY = (edge.y1 + edge.y2) / 2;
            return (
              <g key={edge.id} data-testid={`event-context-edge-${edge.id}`}>
                <path d={elbowPath(edge.x1, edge.y1, edge.x2, edge.y2)} className="fill-none stroke-border" strokeWidth={1} />
                {edge.label && (
                  <>
                    <rect x={midX - plateW / 2} y={midY - plateH / 2} width={plateW} height={plateH} rx={3} fill="rgba(0, 0, 0, 0.72)" />
                    <text x={midX} y={midY} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={fontSize}>
                      {edge.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {branchNodes.map((node) => (
          <div
            key={node.id}
            data-testid={`event-context-branch-${node.monitorId}`}
            title={node.monitorName}
            className="absolute max-w-[80px] -translate-x-1/2 -translate-y-1/2 truncate text-center text-xs text-muted-foreground"
            style={{ left: node.x, top: node.y }}
          >
            {node.monitorName}
          </div>
        ))}
        {eventNodes.map((node) => {
          const event = eventsById.get(node.eventId!);
          if (!event) return null;
          const { urls, aspectRatio } = buildRowThumbnail(event, thumbnailOptions);
          const isRoot = node.kind === 'root';
          const caption = `${node.monitorName} · ${node.monitorId} · ${node.eventId}`;
          return (
            <div
              key={node.id}
              className={cn('absolute', isRoot && 'z-10')}
              style={{ left: node.x - half, top: node.y - half, width: size }}
            >
              <button
                type="button"
                data-testid={`event-context-node-${node.eventId}`}
                data-event-id={node.eventId}
                aria-label={nodeLabel(node)}
                onClick={() => openEvent(node.eventId!, node.monitorId)}
                className={cn(
                  'touch-none cursor-pointer overflow-hidden rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isRoot ? 'border-blue-500 ring-2 ring-blue-500/40' : 'border-border'
                )}
                style={{ width: size, height: size }}
              >
                <EventThumbnail
                  urls={urls}
                  cacheKey={node.eventId!}
                  alt=""
                  className="h-full w-full"
                  objectFit="cover"
                  style={{ aspectRatio: aspectRatio.toString() }}
                />
              </button>
              {/* aria-hidden: the button's aria-label is already the full
                  accessible name (camera + offset); this caption adds the
                  ids for sighted disambiguation only, so it must never
                  become a second, disagreeing accessible name or a
                  redundant stop. */}
              <div
                aria-hidden="true"
                title={caption}
                data-testid={`event-context-node-caption-${node.eventId}`}
                className="w-full truncate text-center text-[8px] leading-tight text-muted-foreground"
              >
                {caption}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
