import { describe, it, expect } from 'vitest';
import { balancedAroundAnchor, buildReplaySchedule, buildTogetherSchedule } from '../event-context-view';
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

describe('buildReplaySchedule', () => {
  it('plays overlapping events together and skips the idle gap between bursts', () => {
    // 0-10s and 5-15s overlap; the next burst starts 40 minutes later and
    // should begin as soon as the first burst ends at 15s.
    const rows = [row('a', 0, 10), row('b', 5_000, 10), row('c', 40 * MIN, 20)];
    expect(buildReplaySchedule(rows, 100)).toEqual([
      { eventId: 'a', playAtMs: 0, stopAtMs: 10_000 },
      { eventId: 'b', playAtMs: 5_000, stopAtMs: 15_000 },
      { eventId: 'c', playAtMs: 15_000, stopAtMs: 35_000 },
    ]);
  });

  it('runs the clock at the playback rate', () => {
    const rows = [row('a', -MIN, 10), row('b', -MIN + 4_000, 10)];
    expect(buildReplaySchedule(rows, 200)).toEqual([
      { eventId: 'a', playAtMs: 0, stopAtMs: 5_000 },
      { eventId: 'b', playAtMs: 2_000, stopAtMs: 7_000 },
    ]);
  });

  it('leaves an event with no length playing until the replay is closed', () => {
    expect(buildReplaySchedule([row('live', 0, 0)], 100)).toEqual([{ eventId: 'live', playAtMs: 0, stopAtMs: null }]);
  });
});

describe('buildTogetherSchedule', () => {
  it('starts every tile at once when the stream budget allows', () => {
    const rows = [row('a', -MIN, 10), row('b', 0, 20), row('c', 30 * MIN, 0)];
    expect(buildTogetherSchedule(rows, 200, Infinity)).toEqual([
      { eventId: 'a', playAtMs: 0, stopAtMs: 5_000 },
      { eventId: 'b', playAtMs: 0, stopAtMs: 10_000 },
      { eventId: 'c', playAtMs: 0, stopAtMs: null },
    ]);
  });

  it('starts a waiting tile in the first stream slot to free up', () => {
    // Two slots: a and b start at once, c takes a's slot when a ends at 10s,
    // d takes b's when b ends at 20s.
    const rows = [row('a', 0, 10), row('b', 1_000, 20), row('c', 2_000, 30), row('d', 3_000, 5)];
    expect(buildTogetherSchedule(rows, 100, 2)).toEqual([
      { eventId: 'a', playAtMs: 0, stopAtMs: 10_000 },
      { eventId: 'b', playAtMs: 0, stopAtMs: 20_000 },
      { eventId: 'c', playAtMs: 10_000, stopAtMs: 40_000 },
      { eventId: 'd', playAtMs: 20_000, stopAtMs: 25_000 },
    ]);
  });
});
