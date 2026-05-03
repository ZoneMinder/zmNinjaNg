import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';
import type { LogFileStore } from '../log-file';

function makeFakeStore(): LogFileStore & { appended: unknown[] } {
  const appended: unknown[] = [];
  return {
    appended,
    capabilities: { share: false, reveal: false, available: true },
    initialize: vi.fn().mockResolvedValue(undefined),
    append: vi.fn((entry) => { appended.push(entry); }),
    flush: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    truncate: vi.fn().mockResolvedValue(undefined),
    getDisplayPath: vi.fn().mockResolvedValue('/mock/file.log'),
    getFileUri: vi.fn().mockResolvedValue(null),
    revealLocation: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
});

describe('logger -> log file persistence', () => {
  it('passes filtered entries to LogFileStore.append', () => {
    const fake = makeFakeStore();
    __resetLogFileForTests(fake);
    log.app('hello', LogLevel.INFO);
    expect(fake.appended.length).toBe(1);
    expect(fake.appended[0]).toMatchObject({
      level: 'INFO',
      message: 'hello',
      context: expect.objectContaining({ component: 'App' }),
    });
  });

  it('does NOT pass below-level entries to LogFileStore', () => {
    const fake = makeFakeStore();
    __resetLogFileForTests(fake);
    logger.setLevel(LogLevel.WARN);
    log.app('debug noise', LogLevel.DEBUG);
    expect(fake.appended.length).toBe(0);
  });
});
