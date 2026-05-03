import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { CapacitorLogFileStore } from '../capacitor';
import type { LogEntry } from '../../../stores/logs';
import { LOG_FILE_FLUSH_INTERVAL_MS, LOG_FILE_MAX_ENTRIES, LOG_FILE_TRUNCATE_RETAIN } from '../types';

const entry = (id: string, message = 'hi'): LogEntry => ({
  id,
  timestamp: '2026-05-03 07:00:00',
  rawTimestamp: 1714747200000,
  level: 'INFO',
  message,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CapacitorLogFileStore', () => {
  it('declares share capability and availability', () => {
    const store = new CapacitorLogFileStore();
    expect(store.capabilities).toEqual({ share: true, reveal: false, available: true });
  });

  it('append + flush writes NDJSON via appendFile', async () => {
    const store = new CapacitorLogFileStore();
    await store.initialize();
    store.append(entry('1', 'first'));
    store.append(entry('2', 'second'));
    await store.flush();

    expect(Filesystem.appendFile).toHaveBeenCalledTimes(1);
    const call = (Filesystem.appendFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lines = call.data.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({ id: '1', message: 'first' }),
      expect.objectContaining({ id: '2', message: 'second' }),
    ]);
  });

  it('throttled flush fires after LOG_FILE_FLUSH_INTERVAL_MS', async () => {
    const store = new CapacitorLogFileStore();
    await store.initialize();
    store.append(entry('1'));
    expect(Filesystem.appendFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LOG_FILE_FLUSH_INTERVAL_MS);
    expect(Filesystem.appendFile).toHaveBeenCalledTimes(1);
  });

  it('readAll parses NDJSON and skips malformed lines', async () => {
    (Filesystem.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        JSON.stringify(entry('1', 'a')),
        '{ broken json',
        JSON.stringify(entry('2', 'b')),
        '',
      ].join('\n'),
    });
    const store = new CapacitorLogFileStore();
    const got = await store.readAll();
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ id: '1', message: 'a' });
    expect(got[1]).toMatchObject({ id: '2', message: 'b' });
  });

  it('truncate writes empty file', async () => {
    const store = new CapacitorLogFileStore();
    await store.truncate();
    expect(Filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: '' }),
    );
  });

  it('getFileUri returns the URI from Filesystem.getUri', async () => {
    const store = new CapacitorLogFileStore();
    const uri = await store.getFileUri();
    expect(uri).toBe('file:///mock/zmninja-ng.log');
  });

  it('rotates when entry count exceeds cap', async () => {
    // Seed file with MAX entries
    const seeded = Array.from({ length: LOG_FILE_MAX_ENTRIES }, (_, i) => JSON.stringify(entry(String(i)))).join('\n');
    (Filesystem.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: seeded });

    const store = new CapacitorLogFileStore();
    await store.initialize(); // counts existing entries

    // Trigger overflow
    store.append(entry('overflow'));
    await store.flush();

    // Allow the async rotation pass to settle (it's started via void this.rotate() inside flush)
    await vi.runAllTimersAsync();

    // Expect a rewrite — writeFile called with last LOG_FILE_TRUNCATE_RETAIN entries
    const writeFileCall = (Filesystem.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      typeof c[0].data === 'string' && c[0].data.split('\n').filter(Boolean).length === LOG_FILE_TRUNCATE_RETAIN,
    );
    expect(writeFileCall).toBeDefined();
  });
});
