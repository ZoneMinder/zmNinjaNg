/**
 * Tree layout for the "around this event" window (refs #494), replacing the
 * force-directed graph: every node gets a parent, so every node is
 * connected, unlike the graph where same-camera edges left most nodes
 * isolated in a typical window.
 *
 * Pure and React-free: `buildEventTree` lays the window out once and always
 * produces the same coordinates for the same input. Three fixed columns,
 * left to right - root (the anchor), one branch per camera with an event in
 * the window (ordered by that camera's nearest event), then that camera's
 * events as leaves in chronological order. Height grows with the leaf count;
 * width never does.
 */

import { EVENT_CONTEXT } from '../zmninja-ng-constants';
import { edgeGapLabel } from './event-context-view';
import type { EventAroundRow } from '../../hooks/useEventsAround';

export type TreeNodeKind = 'root' | 'monitor' | 'leaf';

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  /** Set for 'root' and 'leaf': the event the node opens. */
  eventId?: string;
  monitorId: string;
  monitorName: string;
  /** Signed ms from the anchor; 0 for 'root' and 'monitor' nodes. */
  offsetMs: number;
  x: number;
  y: number;
}

export interface TreeEdge {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Only set for a branch-to-leaf edge: that leaf's unsigned gap from the
   *  anchor. Root-to-branch edges carry no time of their own. */
  label?: string;
}

export interface EventTreeLayout {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
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

function monitorLabel(monitorId: string, monitorNames: Map<string, string>): string {
  return monitorNames.get(monitorId) ?? monitorId;
}

export function buildEventTree(rows: EventAroundRow[], monitorNames: Map<string, string>): EventTreeLayout {
  const { graphNodeSize, treeRowHeight, treeColumnGap, treePadding } = EVENT_CONTEXT;
  const anchorRow = rows.find((r) => r.isAnchor) ?? rows[0];
  const leafRows = rows.filter((r) => r !== anchorRow);

  const groups = new Map<string, EventAroundRow[]>();
  for (const leaf of leafRows) {
    const list = groups.get(leaf.event.MonitorId);
    if (list) list.push(leaf);
    else groups.set(leaf.event.MonitorId, [leaf]);
  }
  for (const group of groups.values()) group.sort((a, b) => a.offsetMs - b.offsetMs);

  const orderedMonitorIds = [...groups.keys()].sort((a, b) => {
    const nearestA = Math.min(...groups.get(a)!.map((r) => Math.abs(r.offsetMs)));
    const nearestB = Math.min(...groups.get(b)!.map((r) => Math.abs(r.offsetMs)));
    return nearestA - nearestB;
  });

  const half = graphNodeSize / 2;
  const rootX = treePadding + half;
  const monitorX = rootX + treeColumnGap;
  const leafX = monitorX + treeColumnGap;
  const width = leafX + half + treePadding;

  const totalLeaves = leafRows.length;
  const height = treePadding * 2 + Math.max(graphNodeSize, totalLeaves * treeRowHeight);
  const rootY = height / 2;

  const nodes: TreeNode[] = [
    {
      id: anchorRow.event.Id,
      kind: 'root',
      eventId: anchorRow.event.Id,
      monitorId: anchorRow.event.MonitorId,
      monitorName: monitorLabel(anchorRow.event.MonitorId, monitorNames),
      offsetMs: 0,
      x: rootX,
      y: rootY,
    },
  ];
  const edges: TreeEdge[] = [];

  let index = 0;
  for (const monitorId of orderedMonitorIds) {
    const groupRows = groups.get(monitorId)!;
    const firstY = treePadding + index * treeRowHeight + treeRowHeight / 2;
    for (const leaf of groupRows) {
      const y = treePadding + index * treeRowHeight + treeRowHeight / 2;
      nodes.push({
        id: leaf.event.Id,
        kind: 'leaf',
        eventId: leaf.event.Id,
        monitorId,
        monitorName: monitorLabel(monitorId, monitorNames),
        offsetMs: leaf.offsetMs,
        x: leafX,
        y,
      });
      index++;
    }
    const lastY = treePadding + (index - 1) * treeRowHeight + treeRowHeight / 2;
    const monitorNodeId = `monitor:${monitorId}`;
    const monitorY = (firstY + lastY) / 2;
    nodes.push({
      id: monitorNodeId,
      kind: 'monitor',
      monitorId,
      monitorName: monitorLabel(monitorId, monitorNames),
      offsetMs: 0,
      x: monitorX,
      y: monitorY,
    });
    edges.push({
      id: `${anchorRow.event.Id}-${monitorNodeId}`,
      from: anchorRow.event.Id,
      to: monitorNodeId,
      x1: rootX,
      y1: rootY,
      x2: monitorX,
      y2: monitorY,
    });
    for (const leaf of groupRows) {
      const leafNode = nodes.find((n) => n.id === leaf.event.Id)!;
      edges.push({
        id: `${monitorNodeId}-${leaf.event.Id}`,
        from: monitorNodeId,
        to: leaf.event.Id,
        x1: monitorX,
        y1: monitorY,
        x2: leafX,
        y2: leafNode.y,
        label: edgeGapLabel(Math.abs(leaf.offsetMs)),
      });
    }
  }

  return { nodes, edges, width, height };
}
