import { describe, it, expect } from 'vitest';
import { nearestFirst, buildReplaySchedule, buildTogetherSchedule } from '../event-context-view';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { Event } from '../../../api/types';

const MIN = 60_000;

function row(id: string, offsetMs: number, lengthSeconds = 10): EventAroundRow {
  return { event: { Id: id, Length: String(lengthSeconds) } as Event, offsetMs, isAnchor: offsetMs === 0 };
}

describe('nearestFirst', () => {
  it('keeps the events closest to the anchor, not the ones from the window edge', () => {
    // ±60m window, cap of 4: three events a minute after the anchor beat the
    // two near the -60m edge even though those come first in time.
    const rows = [row('a', -58 * MIN), row('b', -30 * MIN), row('anchor', 0), row('c', MIN), row('d', MIN + 5_000), row('e', MIN + 9_000)];
    expect(nearestFirst(rows, 4).map((r) => r.event.Id)).toEqual(['anchor', 'c', 'd', 'e']);
  });

  it('returns what it keeps in time order', () => {
    const rows = [row('late', 2 * MIN), row('anchor', 0), row('early', -MIN), row('far', -50 * MIN)];
    expect(nearestFirst(rows, 3).map((r) => r.event.Id)).toEqual(['early', 'anchor', 'late']);
  });

  it('returns every row when there are fewer than the cap', () => {
    const rows = [row('anchor', 0), row('x', MIN)];
    expect(nearestFirst(rows, 12)).toHaveLength(2);
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
