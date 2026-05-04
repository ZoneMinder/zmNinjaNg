import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('log.dedupe', () => {
  it('emits the first call immediately with no suffix', () => {
    const emit = vi.fn();
    log.dedupe('test-key-1', 1000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('');
  });

  it('suppresses repeats inside the window', () => {
    const emit = vi.fn();
    log.dedupe('test-key-2', 1000, emit);
    log.dedupe('test-key-2', 1000, emit);
    log.dedupe('test-key-2', 1000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits with suppressed count after window elapses', () => {
    const emit = vi.fn();
    log.dedupe('test-key-3', 1000, emit);
    log.dedupe('test-key-3', 1000, emit);
    log.dedupe('test-key-3', 1000, emit);
    vi.advanceTimersByTime(1500);
    log.dedupe('test-key-3', 1000, emit);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(' (+2 suppressed)');
  });

  it('different keys are independent', () => {
    const emitA = vi.fn();
    const emitB = vi.fn();
    log.dedupe('key-a', 1000, emitA);
    log.dedupe('key-b', 1000, emitB);
    log.dedupe('key-a', 1000, emitA);
    log.dedupe('key-b', 1000, emitB);
    expect(emitA).toHaveBeenCalledTimes(1);
    expect(emitB).toHaveBeenCalledTimes(1);
  });

  it('after a clean window with no suppressed calls, suffix is empty again', () => {
    const emit = vi.fn();
    log.dedupe('test-key-4', 1000, emit);
    vi.advanceTimersByTime(1500);
    log.dedupe('test-key-4', 1000, emit);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, '');
    expect(emit).toHaveBeenNthCalledWith(2, '');
  });
});
