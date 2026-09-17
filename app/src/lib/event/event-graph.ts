/**
 * Force-directed layout for the "around this event" graph view (refs #494).
 *
 * Pure and React-free: `buildGraph` lays the window out once, `stepGraph`
 * advances the physics by one tick and mutates the nodes it is given in
 * place (its return value is only the leftover kinetic energy, so the
 * caller re-renders from the same array reference each frame). No
 * `Math.random()` anywhere - the initial angle comes from each row's index,
 * so the same rows always produce the same layout.
 */

import { EVENT_CONTEXT } from '../zmninja-ng-constants';
import type { EventAroundRow } from '../../hooks/useEventsAround';

export interface GraphNode {
  eventId: string;
  monitorId: string;
  /** Signed ms from the anchor; 0 for the anchor itself. */
  offsetMs: number;
  isAnchor: boolean;
  /** Orbit radius the radial spring pulls this node toward; 0 for the
   *  anchor. Precomputed from offsetMs so stepGraph never needs windowMs. */
  homeRadius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphEdge {
  a: string;
  b: string;
}

/** Where a node wants to sit: radius grows with |offsetMs| relative to the
 *  window, clamped to the window edge. */
export function targetRadius(offsetMs: number, windowMs: number): number {
  const { graphMinRadius, graphMaxRadius } = EVENT_CONTEXT;
  if (windowMs <= 0) return graphMinRadius;
  const t = Math.min(1, Math.abs(offsetMs) / windowMs);
  return graphMinRadius + t * (graphMaxRadius - graphMinRadius);
}

/** Deterministic initial angle for a node: evenly spaced by its index among
 *  the window's rows, so the same rows always start in the same place. */
function initialAngle(index: number, total: number): number {
  return total <= 1 ? 0 : (2 * Math.PI * index) / total;
}

/** Initial ring layout plus the same-camera edges. Deterministic: the same
 *  rows in produce the same layout out. */
export function buildGraph(
  rows: EventAroundRow[],
  windowMs: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = rows.map((row, index) => {
    const isAnchor = row.isAnchor;
    const homeRadius = isAnchor ? 0 : targetRadius(row.offsetMs, windowMs);
    const angle = initialAngle(index, rows.length);
    return {
      eventId: row.event.Id,
      monitorId: row.event.MonitorId,
      offsetMs: row.offsetMs,
      isAnchor,
      homeRadius,
      x: isAnchor ? 0 : homeRadius * Math.cos(angle),
      y: isAnchor ? 0 : homeRadius * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });

  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].monitorId === nodes[j].monitorId) {
        edges.push({ a: nodes[i].eventId, b: nodes[j].eventId });
      }
    }
  }

  return { nodes, edges };
}

/** Pulls a node toward its `homeRadius` from the origin. The anchor has no
 *  pull of its own; it is held fixed by `stepGraph` directly. */
export function radialSpringForce(node: GraphNode): { fx: number; fy: number } {
  if (node.isAnchor) return { fx: 0, fy: 0 };
  const dist = Math.hypot(node.x, node.y);
  const diff = node.homeRadius - dist;
  if (dist < 1e-6) {
    // No direction to push in from dead centre; nudge outward along +x.
    return { fx: EVENT_CONTEXT.graphRadialSpringStrength * node.homeRadius, fy: 0 };
  }
  return {
    fx: (node.x / dist) * diff * EVENT_CONTEXT.graphRadialSpringStrength,
    fy: (node.y / dist) * diff * EVENT_CONTEXT.graphRadialSpringStrength,
  };
}

/** Inverse-square repulsion so thumbnails do not overlap. Coincident nodes
 *  get a deterministic nudge along +x rather than a divide-by-zero. */
export function repulsionForce(a: GraphNode, b: GraphNode): { fx: number; fy: number } {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  let distSq = dx * dx + dy * dy;
  if (distSq < 1e-4) {
    dx = 1;
    dy = 0;
    distSq = 1;
  }
  const dist = Math.sqrt(distSq);
  const force = EVENT_CONTEXT.graphRepulsionStrength / distSq;
  return { fx: (dx / dist) * force, fy: (dy / dist) * force };
}

/** Attractive spring along a same-camera edge, toward `graphEdgeRestLength`. */
export function edgeSpringForce(a: GraphNode, b: GraphNode): { fx: number; fy: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const diff = dist - EVENT_CONTEXT.graphEdgeRestLength;
  return {
    fx: (dx / dist) * diff * EVENT_CONTEXT.graphEdgeSpringStrength,
    fy: (dy / dist) * diff * EVENT_CONTEXT.graphEdgeSpringStrength,
  };
}

/** Slices to at most `maxNodes` rows, keeping the ones nearest the anchor by
 *  absolute offset (the anchor itself, offsetMs 0, is always nearest and so
 *  always kept). Surviving rows keep their original order. */
export function selectGraphRows(
  rows: EventAroundRow[],
  maxNodes: number
): { rows: EventAroundRow[]; omitted: number } {
  if (rows.length <= maxNodes) return { rows, omitted: 0 };
  const nearest = new Set(
    [...rows]
      .sort((a, b) => Math.abs(a.offsetMs) - Math.abs(b.offsetMs))
      .slice(0, maxNodes)
      .map((row) => row.event.Id)
  );
  const kept = rows.filter((row) => nearest.has(row.event.Id));
  return { rows: kept, omitted: rows.length - kept.length };
}

/** One simulation step, mutating `nodes` in place. The anchor never moves;
 *  a node named by `opts.draggingId` is held at its current position while
 *  everything else still reacts to it. Returns the total kinetic energy so
 *  the caller can stop stepping once the layout settles. */
export function stepGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { draggingId?: string } = {}
): number {
  const fx = new Map<string, number>();
  const fy = new Map<string, number>();
  for (const node of nodes) {
    fx.set(node.eventId, 0);
    fy.set(node.eventId, 0);
  }

  const addForce = (id: string, fxAdd: number, fyAdd: number) => {
    fx.set(id, fx.get(id)! + fxAdd);
    fy.set(id, fy.get(id)! + fyAdd);
  };

  for (const node of nodes) {
    const f = radialSpringForce(node);
    addForce(node.eventId, f.fx, f.fy);
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const f = repulsionForce(a, b);
      addForce(a.eventId, f.fx, f.fy);
      addForce(b.eventId, -f.fx, -f.fy);
    }
  }

  const byId = new Map(nodes.map((node) => [node.eventId, node]));
  for (const edge of edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b) continue;
    const f = edgeSpringForce(a, b);
    addForce(a.eventId, f.fx, f.fy);
    addForce(b.eventId, -f.fx, -f.fy);
  }

  let energy = 0;
  for (const node of nodes) {
    if (node.isAnchor) {
      node.x = 0;
      node.y = 0;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    if (node.eventId === opts.draggingId) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx = (node.vx + fx.get(node.eventId)!) * EVENT_CONTEXT.graphDamping;
    node.vy = (node.vy + fy.get(node.eventId)!) * EVENT_CONTEXT.graphDamping;
    node.x += node.vx;
    node.y += node.vy;
    energy += 0.5 * (node.vx * node.vx + node.vy * node.vy);
  }

  return energy;
}
