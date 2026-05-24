import { describe, it, expect } from 'vitest';
import type { EventData } from '../../api/types';
import {
  CAUSE_ALL,
  MOTION_CAUSE,
  TIMELINE_CAUSE_OPTIONS,
  causeToEventFilter,
  isCauseActive,
  mergeMonitorEvents,
} from '../timeline-cause-filter';

const event = (id: string, start: string, monitorId = '1'): EventData =>
  ({ Event: { Id: id, MonitorId: monitorId, StartDateTime: start } }) as unknown as EventData;

describe('isCauseActive', () => {
  it('is inactive for the empty and all-causes sentinels', () => {
    expect(isCauseActive('')).toBe(false);
    expect(isCauseActive(CAUSE_ALL)).toBe(false);
  });

  it('is active for a real cause or the motion pseudo-cause', () => {
    expect(isCauseActive('Continuous')).toBe(true);
    expect(isCauseActive(MOTION_CAUSE)).toBe(true);
  });
});

describe('causeToEventFilter', () => {
  it('maps motion to a Notes regexp, never the Cause field', () => {
    expect(causeToEventFilter(MOTION_CAUSE, false)).toEqual({ notesRegexp: 'Motion:', cause: undefined });
    // Motion ignores the detected-objects toggle (both are Notes regexps).
    expect(causeToEventFilter(MOTION_CAUSE, true)).toEqual({ notesRegexp: 'Motion:', cause: undefined });
  });

  it('maps a real cause to the Cause field', () => {
    expect(causeToEventFilter('Continuous', false)).toEqual({ notesRegexp: undefined, cause: 'Continuous' });
  });

  it('combines a real cause with the detected-objects toggle', () => {
    expect(causeToEventFilter('Signal', true)).toEqual({ notesRegexp: 'detected:', cause: 'Signal' });
  });

  it('applies no cause/notes filter when none is active', () => {
    expect(causeToEventFilter('', false)).toEqual({ notesRegexp: undefined, cause: undefined });
    expect(causeToEventFilter(CAUSE_ALL, false)).toEqual({ notesRegexp: undefined, cause: undefined });
  });

  it('keeps the detected-objects toggle when no cause is selected', () => {
    expect(causeToEventFilter('', true)).toEqual({ notesRegexp: 'detected:', cause: undefined });
  });
});

describe('TIMELINE_CAUSE_OPTIONS', () => {
  it('leads with the all-causes option and uses non-empty values (Radix-safe)', () => {
    expect(TIMELINE_CAUSE_OPTIONS[0].value).toBe(CAUSE_ALL);
    expect(TIMELINE_CAUSE_OPTIONS.every((o) => o.value !== '')).toBe(true);
  });
});

describe('mergeMonitorEvents', () => {
  it('flattens, dedupes by id, and sorts by StartDateTime descending', () => {
    const merged = mergeMonitorEvents([
      [event('1', '2024-01-01 08:00:00'), event('2', '2024-01-01 10:00:00')],
      [event('3', '2024-01-01 09:00:00', '2')],
    ]);
    expect(merged.map((e) => e.Event.Id)).toEqual(['2', '3', '1']);
  });

  it('drops duplicate event ids', () => {
    const merged = mergeMonitorEvents([
      [event('1', '2024-01-01 08:00:00')],
      [event('1', '2024-01-01 08:00:00')],
    ]);
    expect(merged).toHaveLength(1);
  });
});
