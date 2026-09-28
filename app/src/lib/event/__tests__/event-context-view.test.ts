import { describe, it, expect } from 'vitest';
import { balancedAroundAnchor, buildReplayRuns, currentRunIndex, togetherPlaying } from '../event-context-view';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { Event } from '../../../api/types';

const MIN = 60_000;

function row(id: string, offsetMs: number, lengthSeconds = 10): EventAroundRow {
  return { event: { Id: id, Length: String(lengthSeconds) } as Event, offsetMs, isAnchor: offsetMs === 0 };
}

describe('balancedAroundAnchor', () => {
  it('splits the cap evenly before and after, even when one side is closer in time', () => {
    // Six events within seconds before the anchor, two far after it. A pick by
    // time distance would take only the before side.
    const before = [1, 2, 3, 4, 5, 6].map((s) => row(`b${s}`, -s * 1000));
    const rows = [...before, row('anchor', 0), row('a1', 30 * MIN), row('a2', 40 * MIN)];
    expect(balancedAroundAnchor(rows, 5).map((r) => r.event.Id)).toEqual(['b2', 'b1', 'anchor', 'a1', 'a2']);
  });

  it('fills from the other side when one side runs out', () => {
    const after = [1, 2, 3, 4, 5].map((m) => row(`a${m}`, m * MIN));
    const rows = [row('b1', -MIN), row('anchor', 0), ...after];
    expect(balancedAroundAnchor(rows, 5).map((r) => r.event.Id)).toEqual(['b1', 'anchor', 'a1', 'a2', 'a3']);
  });

  it('takes the nearest events on each side, in time order', () => {
    const rows = [row('late', 2 * MIN), row('anchor', 0), row('early', -MIN), row('far', -50 * MIN), row('later', 9 * MIN)];
    expect(balancedAroundAnchor(rows, 3).map((r) => r.event.Id)).toEqual(['early', 'anchor', 'late']);
  });

  it('returns every row when there are fewer than the cap', () => {
    const rows = [row('anchor', 0), row('x', MIN)];
    expect(balancedAroundAnchor(rows, 12)).toHaveLength(2);
  });

  // The maintainer's examples: a 5 minute window, 12 tiles, one of them the anchor.
  const sides = (before: number, after: number) => [
    ...Array.from({ length: before }, (_, i) => row(`b${i + 1}`, -(i + 1) * 5_000)),
    row('anchor', 0),
    ...Array.from({ length: after }, (_, i) => row(`a${i + 1}`, (i + 1) * 5_000)),
  ];
  const count = (kept: EventAroundRow[]) => ({
    before: kept.filter((r) => r.offsetMs < 0).length,
    after: kept.filter((r) => r.offsetMs > 0).length,
  });

  it('keeps 6 before and 5 after around the anchor when both sides have 20', () => {
    expect(count(balancedAroundAnchor(sides(20, 20), 12))).toEqual({ before: 6, after: 5 });
  });

  it('keeps 8 before and all 3 after when the after side has only 3', () => {
    expect(count(balancedAroundAnchor(sides(40, 3), 12))).toEqual({ before: 8, after: 3 });
  });
});

describe('buildReplayRuns', () => {
  it('groups overlapping events into one run and starts a new run after an idle gap', () => {
    // 0-10s and 5-15s overlap; the next burst starts 40 minutes later.
    const rows = [row('a', 0, 10), row('b', 5_000, 10), row('c', 40 * MIN, 20)];
    expect(buildReplayRuns(rows, 100)).toEqual([
      [{ eventId: 'a', startMs: 0 }, { eventId: 'b', startMs: 5_000 }],
      [{ eventId: 'c', startMs: 0 }],
    ]);
  });

  it('spaces the starts inside a run at the playback rate', () => {
    const rows = [row('a', -MIN, 10), row('b', -MIN + 4_000, 10)];
    expect(buildReplayRuns(rows, 200)).toEqual([[{ eventId: 'a', startMs: 0 }, { eventId: 'b', startMs: 2_000 }]]);
  });

  it('gives a sub-second event its own run instead of letting its length cut the next one short', () => {
    // The reported bug: 364970 is 0.83s long, 18s before the anchor.
    const rows = [row('short', -18_000, 0.83), row('anchor', 0, 31.71), row('after', 36_000, 30)];
    expect(buildReplayRuns(rows, 200).map((run) => run.map((c) => c.eventId))).toEqual([['short'], ['anchor'], ['after']]);
  });
});

describe('currentRunIndex', () => {
  const runs = [[{ eventId: 'a', startMs: 0 }, { eventId: 'b', startMs: 1_000 }], [{ eventId: 'c', startMs: 0 }]];

  it('stays on a run until every tile in it is done', () => {
    expect(currentRunIndex(runs, new Set())).toBe(0);
    expect(currentRunIndex(runs, new Set(['a']))).toBe(0);
    expect(currentRunIndex(runs, new Set(['a', 'b']))).toBe(1);
  });

  it('is -1 once the whole replay is done', () => {
    expect(currentRunIndex(runs, new Set(['a', 'b', 'c']))).toBe(-1);
  });
});

describe('togetherPlaying', () => {
  it('fills the stream budget in tile order and hands a done tile slot to the next one', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(togetherPlaying(ids, new Set(), 2)).toEqual(['a', 'b']);
    expect(togetherPlaying(ids, new Set(['b']), 2)).toEqual(['a', 'c']);
    expect(togetherPlaying(ids, new Set(['a', 'b', 'c']), 2)).toEqual(['d']);
  });
});
