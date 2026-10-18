import { describe, it, expect } from 'vitest';
import { formatAppWeekday, formatCompactDuration, formatElapsedShort } from '../format-date-time';

describe('formatAppWeekday', () => {
  it('returns the short weekday name for a known date', () => {
    // 2024-01-01 (noon local, so timezone cannot shift the day) is a Monday.
    expect(formatAppWeekday(new Date(2024, 0, 1, 12, 0, 0))).toBe('Mon');
    // 2024-01-06 is a Saturday.
    expect(formatAppWeekday(new Date(2024, 0, 6, 12, 0, 0))).toBe('Sat');
  });
});

describe('formatElapsedShort', () => {
  it('reads as a stopwatch below an hour', () => {
    expect(formatElapsedShort(0)).toBe('0:00');
    expect(formatElapsedShort(7_400)).toBe('0:07');
    expect(formatElapsedShort(247_000)).toBe('4:07');
    expect(formatElapsedShort(3_599_000)).toBe('59:59');
  });

  it('adds an hours field only once there are hours to show', () => {
    expect(formatElapsedShort(3_600_000)).toBe('1:00:00');
    expect(formatElapsedShort(3_753_000)).toBe('1:02:33');
  });

  it('clamps a negative interval to zero', () => {
    // The caller compares a tile's episode start against a clock that ticks
    // once a second, so a monitor that enters between two ticks is briefly
    // "in the future". That must read 0:00, not a minus sign.
    expect(formatElapsedShort(-500)).toBe('0:00');
  });
});

describe('formatCompactDuration', () => {
  it('uses the largest unit that fits, with at most one decimal', () => {
    expect(formatCompactDuration(30.4)).toBe('30s');
    expect(formatCompactDuration(59.6)).toBe('60s');
    expect(formatCompactDuration(60)).toBe('1m');
    expect(formatCompactDuration(90)).toBe('1.5m');
    expect(formatCompactDuration(5400)).toBe('1.5hr');
    expect(formatCompactDuration(7200)).toBe('2hr');
  });

  it('reads zero for a missing or negative length', () => {
    expect(formatCompactDuration(NaN)).toBe('0s');
    expect(formatCompactDuration(-3)).toBe('0s');
  });
});
