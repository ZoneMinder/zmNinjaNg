import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log.groupCollapsed', () => {
  it('emits a console group containing the body and ends it', () => {
    const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const endSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

    log.groupCollapsed('HTTP', 'headline', LogLevel.DEBUG, { request: { x: 1 } });

    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy.mock.calls[0][1]).toBe('headline');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toEqual({ request: { x: 1 } });
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('records exactly one entry to the in-memory store with body in args', () => {
    log.groupCollapsed('HTTP', 'one entry', LogLevel.INFO, { foo: 'bar' });
    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('one entry');
    expect(logs[0].context).toMatchObject({ component: 'HTTP' });
    expect(logs[0].args).toEqual([{ foo: 'bar' }]);
  });

  it('respects per-component level overrides', () => {
    logger.setComponentLevel('HTTP', LogLevel.WARN);
    const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    log.groupCollapsed('HTTP', 'too quiet', LogLevel.DEBUG, {});
    expect(groupSpy).not.toHaveBeenCalled();
    expect(useLogStore.getState().logs).toHaveLength(0);
    logger.clearComponentLevels();
  });

  it('falls back to a flat emit when console.groupCollapsed is unavailable', () => {
    const original = console.groupCollapsed;
    // @ts-expect-error simulating an environment without group support
    console.groupCollapsed = undefined;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      log.groupCollapsed('HTTP', 'flat fallback', LogLevel.DEBUG, { foo: 1 });
      expect(logSpy).toHaveBeenCalledTimes(1);
      // Flat emit takes prefix + message + body as 3 args
      expect(logSpy.mock.calls[0]).toHaveLength(3);
      expect(logSpy.mock.calls[0][1]).toBe('flat fallback');
      expect(logSpy.mock.calls[0][2]).toEqual({ foo: 1 });
    } finally {
      console.groupCollapsed = original;
    }
  });
});
