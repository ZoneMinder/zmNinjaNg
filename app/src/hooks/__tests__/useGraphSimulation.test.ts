import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGraphSimulation } from '../useGraphSimulation';
import { buildGraph } from '../../lib/event/event-graph';
import type { EventAroundRow } from '../useEventsAround';

const row = (eventId: string, monitorId: string, offsetMs: number, isAnchor = false): EventAroundRow =>
  ({ event: { Id: eventId, MonitorId: monitorId }, offsetMs, isAnchor }) as unknown as EventAroundRow;

/** jsdom has no rAF timing: a manual queue the test drains one frame at a
 *  time, matching how the real browser calls back one scheduled frame. */
function stubRaf() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
    nextId += 1;
    callbacks.set(nextId, cb);
    return nextId;
  }) as typeof requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', ((handle: number) => {
    callbacks.delete(handle);
  }) as typeof cancelAnimationFrame);
  return {
    flush: () => {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of entries) cb(0);
    },
    pendingCount: () => callbacks.size,
  };
}

function runToSettle(raf: ReturnType<typeof stubRaf>, maxSteps = 500) {
  let steps = 0;
  while (raf.pendingCount() > 0 && steps < maxSteps) {
    act(() => raf.flush());
    steps++;
  }
  return steps;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGraphSimulation', () => {
  it('builds the initial layout from the rows on mount', () => {
    stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { result } = renderHook(() =>
      useGraphSimulation({ rows, windowMs: 15000, containerWidth: 400, reducedMotion: false })
    );
    expect(result.current.nodes.map((n) => n.eventId)).toEqual(['anchor', 'a']);
    expect(result.current.nodes.find((n) => n.eventId === 'anchor')).toMatchObject({ x: 0, y: 0 });
  });

  it('steps the simulation on animation frames and stops scheduling once it settles', () => {
    const raf = stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '2', -5000)];
    renderHook(() => useGraphSimulation({ rows, windowMs: 20000, containerWidth: 400, reducedMotion: false }));

    const steps = runToSettle(raf);
    expect(steps).toBeGreaterThan(0);
    expect(raf.pendingCount()).toBe(0);
  });

  it('restarts the layout when the rows change', () => {
    stubRaf();
    const rowsA = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const rowsB = [row('anchor', '1', 0, true), row('c', '3', -3000)];
    const { result, rerender } = renderHook(
      ({ rows }) => useGraphSimulation({ rows, windowMs: 15000, containerWidth: 400, reducedMotion: false }),
      { initialProps: { rows: rowsA } }
    );
    expect(result.current.nodes.map((n) => n.eventId)).toEqual(['anchor', 'a']);
    act(() => rerender({ rows: rowsB }));
    expect(result.current.nodes.map((n) => n.eventId)).toEqual(['anchor', 'c']);
  });

  it('restarts the layout when the container width changes', () => {
    stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { result, rerender } = renderHook(
      ({ containerWidth }) =>
        useGraphSimulation({ rows, windowMs: 15000, containerWidth, reducedMotion: false }),
      { initialProps: { containerWidth: 300 } }
    );
    const before = result.current.nodes.find((n) => n.eventId === 'a')!;
    before.x = 999;
    before.y = 999;
    act(() => rerender({ containerWidth: 500 }));
    const after = result.current.nodes.find((n) => n.eventId === 'a')!;
    expect(after.x).not.toBe(999);
  });

  it('holds a dragged node at the position dragTo sets, then lets it settle back on release', () => {
    const raf = stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '2', -5000)];
    const { result } = renderHook(() =>
      useGraphSimulation({ rows, windowMs: 20000, containerWidth: 400, reducedMotion: false })
    );
    runToSettle(raf);

    act(() => result.current.beginDrag('a'));
    act(() => result.current.dragTo(40, 0));
    let dragged = result.current.nodes.find((n) => n.eventId === 'a')!;
    expect(dragged.x).toBe(40);
    expect(dragged.y).toBe(0);

    // the loop keeps running while a node is held, and keeps it pinned there
    act(() => raf.flush());
    dragged = result.current.nodes.find((n) => n.eventId === 'a')!;
    expect(dragged.x).toBe(40);
    expect(dragged.y).toBe(0);

    act(() => result.current.endDrag());
    runToSettle(raf);
    const settled = result.current.nodes.find((n) => n.eventId === 'a')!;
    expect(settled.x !== 40 || settled.y !== 0).toBe(true);
  });

  it('never schedules a frame once the graph has settled', () => {
    const raf = stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    renderHook(() => useGraphSimulation({ rows, windowMs: 15000, containerWidth: 400, reducedMotion: false }));
    runToSettle(raf);
    expect(raf.pendingCount()).toBe(0);
    // Flushing again is a no-op: nothing left queued to advance.
    act(() => raf.flush());
    expect(raf.pendingCount()).toBe(0);
  });

  it('honours reduced motion: settles synchronously and schedules no frame', () => {
    const raf = stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000), row('b', '2', -5000)];
    const initial = buildGraph(rows, 20000);
    const initialA = initial.nodes.find((n) => n.eventId === 'a')!;

    const { result } = renderHook(() =>
      useGraphSimulation({ rows, windowMs: 20000, containerWidth: 400, reducedMotion: true })
    );

    expect(raf.pendingCount()).toBe(0);
    const settledA = result.current.nodes.find((n) => n.eventId === 'a')!;
    expect(settledA.x !== initialA.x || settledA.y !== initialA.y).toBe(true);
  });

  it('honours reduced motion while dragging too: no frame is ever scheduled', () => {
    const raf = stubRaf();
    const rows = [row('anchor', '1', 0, true), row('a', '2', 5000)];
    const { result } = renderHook(() =>
      useGraphSimulation({ rows, windowMs: 15000, containerWidth: 400, reducedMotion: true })
    );
    act(() => result.current.beginDrag('a'));
    act(() => result.current.dragTo(70, 10));
    expect(result.current.nodes.find((n) => n.eventId === 'a')).toMatchObject({ x: 70, y: 10 });
    expect(raf.pendingCount()).toBe(0);
    act(() => result.current.endDrag());
    expect(raf.pendingCount()).toBe(0);
  });
});
