import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLogStore } from '../../stores/logs';
import { hydrateLogStoreFromFile, __resetLogFileForTests } from '../log-file';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  __resetLogFileForTests();
});

describe('hydrateLogStoreFromFile', () => {
  it('replaces useLogStore.logs with file content', async () => {
    const fake = {
      capabilities: { share: false, reveal: false, available: true },
      initialize: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      readAll: vi.fn().mockResolvedValue([
        { id: '1', timestamp: 't1', level: 'INFO', message: 'a' },
        { id: '2', timestamp: 't2', level: 'WARN', message: 'b' },
      ]),
      truncate: vi.fn().mockResolvedValue(undefined),
      getDisplayPath: vi.fn().mockResolvedValue(null),
      getFileUri: vi.fn().mockResolvedValue(null),
      revealLocation: vi.fn().mockResolvedValue(undefined),
    };
    __resetLogFileForTests(fake as never);

    await hydrateLogStoreFromFile();
    const logs = useLogStore.getState().logs;
    expect(logs.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('leaves the store untouched when file is empty', async () => {
    const fake = {
      capabilities: { share: false, reveal: false, available: false },
      initialize: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      readAll: vi.fn().mockResolvedValue([]),
      truncate: vi.fn().mockResolvedValue(undefined),
      getDisplayPath: vi.fn().mockResolvedValue(null),
      getFileUri: vi.fn().mockResolvedValue(null),
      revealLocation: vi.fn().mockResolvedValue(undefined),
    };
    __resetLogFileForTests(fake as never);

    useLogStore.setState({
      logs: [{ id: 'x', timestamp: 't', level: 'INFO', message: 'pre-existing' }],
    });
    await hydrateLogStoreFromFile();
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useLogStore.getState().logs[0].id).toBe('x');
  });
});
