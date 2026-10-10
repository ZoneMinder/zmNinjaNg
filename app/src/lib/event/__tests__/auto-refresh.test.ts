import { describe, expect, it } from 'vitest';
import { clampAutoRefreshSeconds } from '../auto-refresh';
import { EVENTS_AUTO_REFRESH } from '../../zmninja-ng-constants';

describe('clampAutoRefreshSeconds', () => {
  it('keeps 0 as off and in-range values as they are', () => {
    expect(clampAutoRefreshSeconds(0)).toBe(0);
    expect(clampAutoRefreshSeconds(60)).toBe(60);
  });

  it('raises a too-short interval to the floor and caps a long one', () => {
    expect(clampAutoRefreshSeconds(1)).toBe(EVENTS_AUTO_REFRESH.minSeconds);
    expect(clampAutoRefreshSeconds(999999)).toBe(EVENTS_AUTO_REFRESH.maxSeconds);
  });

  it('turns junk from storage into off', () => {
    expect(clampAutoRefreshSeconds(-5)).toBe(0);
    expect(clampAutoRefreshSeconds(Number.NaN)).toBe(0);
    expect(clampAutoRefreshSeconds('30' as unknown as number)).toBe(0);
  });
});
