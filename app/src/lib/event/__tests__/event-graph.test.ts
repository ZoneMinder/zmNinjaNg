import { describe, it, expect } from 'vitest';
import { buildGraph, stepGraph, targetRadius, selectGraphRows, type GraphNode, type GraphEdge } from '../event-graph';
import { EVENT_CONTEXT } from '../../zmninja-ng-constants';
import type { EventAroundRow } from '../../../hooks/useEventsAround';

const row = (eventId: string, monitorId: string, offsetMs: number, isAnchor = false): EventAroundRow =>
  ({
    event: { Id: eventId, MonitorId: monitorId },
    offsetMs,
    isAnchor,
  }) as unknown as EventAroundRow;

const dist = (a: GraphNode, b: GraphNode) => Math.hypot(a.x - b.x, a.y - b.y);
const byId = (nodes: GraphNode[], id: string) => nodes.find((n) => n.eventId === id)!;
const run = (nodes: GraphNode[], edges: GraphEdge[], steps: number, draggingId?: string) => {
  let energy = 0;
  for (let i = 0; i < steps; i++) energy = stepGraph(nodes, edges, { draggingId });
  return energy;
};

describe('buildGraph', () => {
  it('is deterministic: the same rows twice produce identical coordinates', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '3', -8000), row('c', '4', 12000)];
    const first = buildGraph(rows, 15000);
    const second = buildGraph(rows, 15000);
    expect(first.nodes).toEqual(second.nodes);
    expect(first.edges).toEqual(second.edges);
  });

  it('places the anchor at the origin', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { nodes } = buildGraph(rows, 15000);
    const anchor = byId(nodes, 'anchor');
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
  });

  it('draws edges only between same-camera rows', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 3000), row('b', '2', -3000), row('c', '3', 6000)];
    const { edges } = buildGraph(rows, 20000);
    expect(edges).toContainEqual({ a: 'a', b: 'b' });
    expect(edges.some((e) => e.a === 'c' || e.b === 'c')).toBe(false);
  });
});

describe('targetRadius', () => {
  it('grows with the absolute offset', () => {
    expect(targetRadius(5000, 60000)).toBeGreaterThan(targetRadius(1000, 60000));
  });

  it('is symmetric for equal offsets either side of the anchor', () => {
    expect(targetRadius(5000, 60000)).toBe(targetRadius(-5000, 60000));
  });

  it('clamps at the window edge', () => {
    const atEdge = targetRadius(60000, 60000);
    expect(targetRadius(600000, 60000)).toBe(atEdge);
  });
});

describe('stepGraph', () => {
  it('leaves the anchor pinned at the origin however hard the others pull', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '1', 5000), row('b', '1', -8000), row('c', '1', 8000)];
    const { nodes, edges } = buildGraph(rows, 15000);
    run(nodes, edges, 100);
    const anchor = byId(nodes, 'anchor');
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
  });

  it('pushes two coincident nodes apart via repulsion', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '3', 5000)];
    const { nodes, edges } = buildGraph(rows, 20000);
    const a = byId(nodes, 'a');
    const b = byId(nodes, 'b');
    // Force the coincidence the test needs: same offset does not guarantee
    // the same starting angle once more rows are in the window.
    b.x = a.x;
    b.y = a.y;
    run(nodes, edges, 100);
    expect(dist(a, b)).toBeGreaterThanOrEqual(EVENT_CONTEXT.graphNodeSize);
  });

  it('pulls same-camera nodes closer than they started', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 3000), row('b', '2', -9000)];
    const { nodes, edges } = buildGraph(rows, 20000);
    const a = byId(nodes, 'a');
    const b = byId(nodes, 'b');
    const startDist = dist(a, b);
    run(nodes, edges, 100);
    expect(dist(a, b)).toBeLessThan(startDist);
  });

  it('does not add an edge for cameras that share nothing, so they never get pulled together', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 3000), row('c', '3', -3000)];
    const { edges } = buildGraph(rows, 20000);
    expect(edges).toEqual([]);
  });

  it('settles within a bounded number of steps for a typical window', () => {
    const rows = [
      row('anchor', '1', 0, true),
      ...Array.from({ length: 11 }, (_, i) =>
        row(`e${i}`, String((i % 3) + 2), (i + 1) * 4000 * (i % 2 === 0 ? 1 : -1))
      ),
    ];
    const { nodes, edges } = buildGraph(rows, 60000);
    const maxSteps = 500;
    let energy = Number.POSITIVE_INFINITY;
    let steps = 0;
    while (energy >= EVENT_CONTEXT.graphSettleEnergy && steps < maxSteps) {
      energy = stepGraph(nodes, edges, {});
      steps++;
    }
    expect(steps).toBeLessThan(maxSteps);
  });

  it('holds the dragged node still while its neighbours react to it', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '2', -5000)];
    const { nodes, edges } = buildGraph(rows, 20000);
    const a = byId(nodes, 'a');
    const b = byId(nodes, 'b');
    a.x = 40;
    a.y = 0;
    const bBefore = { x: b.x, y: b.y };
    run(nodes, edges, 20, 'a');
    expect(a.x).toBe(40);
    expect(a.y).toBe(0);
    expect(b.x !== bBefore.x || b.y !== bBefore.y).toBe(true);
  });
});

describe('selectGraphRows', () => {
  it('keeps every row when there are no more than the cap', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const result = selectGraphRows(rows, 5);
    expect(result).toEqual({ rows, omitted: 0 });
  });

  it('keeps the rows nearest the anchor by absolute offset, dropping the rest', () => {
    const rows = [
      row('anchor', '1', 0, true),
      row('near', '2', 1000),
      row('far', '3', -50000),
      row('mid', '4', 8000),
    ];
    const result = selectGraphRows(rows, 3);
    expect(result.rows.map((r) => r.event.Id)).toEqual(['anchor', 'near', 'mid']);
    expect(result.omitted).toBe(1);
  });

  it('preserves the original chronological order among the rows it keeps', () => {
    const rows = [
      row('far-before', '1', -9000),
      row('anchor', '1', 0, true),
      row('near', '2', 1000),
      row('far-after', '3', 9000),
    ];
    const result = selectGraphRows(rows, 2);
    expect(result.rows.map((r) => r.event.Id)).toEqual(['anchor', 'near']);
  });
});
