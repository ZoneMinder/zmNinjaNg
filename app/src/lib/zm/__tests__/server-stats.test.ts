import { describe, expect, it } from 'vitest';
import { zmHumanFilesize, zmUsageLevel } from '../server-stats';

describe('zmHumanFilesize', () => {
  it('matches the sizes the ZoneMinder console shows', () => {
    // Read off a ZoneMinder 1.39 console: "69.35GB of 97.87GB".
    expect(zmHumanFilesize(74462892032)).toBe('69.35 GB');
    expect(zmHumanFilesize(105089261568)).toBe('97.87 GB');
    expect(zmHumanFilesize(8589930496)).toBe('8.00 GB');
    expect(zmHumanFilesize(0)).toBe('0.00 B');
  });

  it('moves up a unit once the value passes 0.9 of the next one', () => {
    expect(zmHumanFilesize(1000)).toBe('0.98 kB');
    expect(zmHumanFilesize(900)).toBe('900.00 B');
  });
});

describe('zmUsageLevel', () => {
  it('warns above the warning line and alarms above the danger line', () => {
    expect(zmUsageLevel(95, 95, 98)).toBeUndefined();
    expect(zmUsageLevel(96, 95, 98)).toBe('warning');
    expect(zmUsageLevel(98, 95, 98)).toBe('warning');
    expect(zmUsageLevel(99, 95, 98)).toBe('danger');
  });
});
