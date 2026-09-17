import { describe, it, expect } from 'vitest';
import { buildEventTree, selectGraphRows } from '../event-tree';
import { EVENT_CONTEXT } from '../../zmninja-ng-constants';
import type { EventAroundRow } from '../../../hooks/useEventsAround';

const row = (eventId: string, monitorId: string, offsetMs: number, isAnchor = false): EventAroundRow =>
  ({
    event: { Id: eventId, MonitorId: monitorId },
    offsetMs,
    isAnchor,
  }) as unknown as EventAroundRow;

const names = new Map([
  ['1', 'Front Door'],
  ['2', 'Driveway'],
  ['3', 'Yard'],
]);

describe('buildEventTree', () => {
  it('is deterministic: the same rows twice produce identical layouts', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '3', -8000)];
    const first = buildEventTree(rows, names);
    const second = buildEventTree(rows, names);
    expect(first).toEqual(second);
  });

  it('roots the tree on the anchor row, vertically centred on the canvas', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { nodes, height } = buildEventTree(rows, names);
    const root = nodes.find((n) => n.kind === 'root')!;
    expect(root.eventId).toBe('anchor');
    expect(root.y).toBe(height / 2);
  });

  it('creates one branch per camera that has a non-anchor event, carrying its name', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '3', -8000)];
    const { nodes } = buildEventTree(rows, names);
    const branches = nodes.filter((n) => n.kind === 'monitor');
    expect(branches.map((b) => b.monitorId).sort()).toEqual(['2', '3']);
    expect(branches.find((b) => b.monitorId === '2')!.monitorName).toBe('Driveway');
  });

  it('gives the anchor camera a branch too when it has other events', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '1', 5000), row('b', '2', -8000)];
    const { nodes } = buildEventTree(rows, names);
    const branches = nodes.filter((n) => n.kind === 'monitor');
    expect(branches.map((b) => b.monitorId).sort()).toEqual(['1', '2']);
  });

  it('gives the anchor camera no branch when it has no other events', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { nodes } = buildEventTree(rows, names);
    const branches = nodes.filter((n) => n.kind === 'monitor');
    expect(branches.map((b) => b.monitorId)).toEqual(['2']);
  });

  it('orders branches by that camera\'s nearest event to the anchor', () => {
    const rows = [
      row('anchor', '1', 0, true),
      row('far', '2', 20000),
      row('near', '3', 1000),
    ];
    const { nodes } = buildEventTree(rows, names);
    const branches = nodes.filter((n) => n.kind === 'monitor');
    expect(branches.map((b) => b.monitorId)).toEqual(['3', '2']);
  });

  it('orders leaves within one camera chronologically', () => {
    const rows = [
      row('anchor', '1', 0, true),
      row('later', '2', 9000),
      row('earlier', '2', -3000),
    ];
    const { nodes } = buildEventTree(rows, names);
    const leaves = nodes.filter((n) => n.kind === 'leaf');
    expect(leaves.map((l) => l.eventId)).toEqual(['earlier', 'later']);
  });

  it('stacks leaves top to bottom with a fixed row height', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 1000), row('b', '3', 2000)];
    const { nodes } = buildEventTree(rows, names);
    const leaves = nodes.filter((n) => n.kind === 'leaf').sort((a, b) => a.y - b.y);
    expect(leaves[1].y - leaves[0].y).toBe(EVENT_CONTEXT.treeRowHeight);
  });

  it('positions the three columns left to right using the fixed column gap', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 1000)];
    const { nodes } = buildEventTree(rows, names);
    const root = nodes.find((n) => n.kind === 'root')!;
    const branch = nodes.find((n) => n.kind === 'monitor')!;
    const leaf = nodes.find((n) => n.kind === 'leaf')!;
    expect(branch.x - root.x).toBe(EVENT_CONTEXT.treeColumnGap);
    expect(leaf.x - branch.x).toBe(EVENT_CONTEXT.treeColumnGap);
  });

  it('grows canvas height with the number of leaves, not the number of branches', () => {
    const small = buildEventTree([row('anchor', '1', 0, true), row('a', '2', 1000)], names);
    const big = buildEventTree(
      [row('anchor', '1', 0, true), row('a', '2', 1000), row('b', '2', 2000), row('c', '2', 3000)],
      names
    );
    expect(big.height).toBeGreaterThan(small.height);
  });

  it('labels each leaf edge with the unsigned gap from the anchor', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', -38000)];
    const { edges } = buildEventTree(rows, names);
    const leafEdge = edges.find((e) => e.to === 'a')!;
    expect(leafEdge.label).toBe('38s');
  });

  it('leaves the root-to-branch edges unlabelled', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { edges } = buildEventTree(rows, names);
    const rootEdge = edges.find((e) => e.from === 'anchor')!;
    expect(rootEdge.label).toBeUndefined();
  });

  it('draws every edge as root-to-branch and branch-to-leaf, never root-to-leaf', () => {
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '2', -3000)];
    const { nodes, edges } = buildEventTree(rows, names);
    const root = nodes.find((n) => n.kind === 'root')!;
    const branch = nodes.find((n) => n.kind === 'monitor')!;
    expect(edges).toHaveLength(3);
    expect(edges.filter((e) => e.from === root.id)).toHaveLength(1);
    expect(edges.filter((e) => e.from === branch.id)).toHaveLength(2);
  });

  it('falls back to the monitor id when a name is missing', () => {
    const rows = [row('anchor', '9', 0, true), row('a', '9', 1000)];
    const { nodes } = buildEventTree(rows, new Map());
    expect(nodes.find((n) => n.kind === 'monitor')!.monitorName).toBe('9');
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
