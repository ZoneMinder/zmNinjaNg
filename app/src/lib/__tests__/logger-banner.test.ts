import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';
import { viewNameForPath } from '../navigation';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log.banner', () => {
  it('emits a styled banner with bars around the message', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    log.banner('Entering Timeline View');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [first, second] = infoSpy.mock.calls[0];
    expect(first).toContain('Entering Timeline View');
    // %c directive at the head of the format string
    expect(String(first).startsWith('%c')).toBe(true);
    expect(typeof second).toBe('string');
    expect(String(second)).toContain('font-weight: bold');
  });

  it('records exactly one entry to the in-memory store', () => {
    log.banner('Entering Settings View');
    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain('Entering Settings View');
    expect(logs[0].context).toMatchObject({ component: 'View' });
  });

  it('respects the global log level', () => {
    logger.setLevel(LogLevel.WARN);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    log.banner('Should be filtered', LogLevel.INFO);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(useLogStore.getState().logs).toHaveLength(0);
  });
});

describe('viewNameForPath', () => {
  it('returns name for known exact paths', () => {
    expect(viewNameForPath('/timeline')).toBe('Timeline');
    expect(viewNameForPath('/dashboard')).toBe('Dashboard');
    expect(viewNameForPath('/montage')).toBe('Montage');
  });

  it('strips trailing slashes', () => {
    expect(viewNameForPath('/events/')).toBe('Events');
  });

  it('matches parameterized routes', () => {
    expect(viewNameForPath('/monitors/5')).toBe('Monitor Detail');
    expect(viewNameForPath('/events/12345')).toBe('Event Detail');
  });

  it('returns null for paths without a banner', () => {
    expect(viewNameForPath('/setup')).toBeNull();
    expect(viewNameForPath('/profiles/new')).toBeNull();
    expect(viewNameForPath('/some-unknown-path')).toBeNull();
  });
});
