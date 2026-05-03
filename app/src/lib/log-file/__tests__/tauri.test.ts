import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from '@tauri-apps/plugin-fs';
import * as opener from '@tauri-apps/plugin-opener';
import { appLogDir } from '@tauri-apps/api/path';
import { TauriLogFileStore } from '../tauri';
import type { LogEntry } from '../../../stores/logs';
import { LOG_FILE_NAME, LOG_FILE_MAX_ENTRIES, LOG_FILE_TRUNCATE_RETAIN } from '../types';

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
  (appLogDir as ReturnType<typeof vi.fn>).mockResolvedValue('/mock/applogdir');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TauriLogFileStore', () => {
  it('declares reveal capability and availability', () => {
    const store = new TauriLogFileStore();
    expect(store.capabilities).toEqual({ share: false, reveal: true, available: true });
  });

  it('initialize creates AppLog directory', async () => {
    const store = new TauriLogFileStore();
    await store.initialize();
    expect(fs.mkdir).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ baseDir: 'AppLog', recursive: true }),
    );
  });

  it('append + flush writes NDJSON via writeTextFile with append flag', async () => {
    const store = new TauriLogFileStore();
    await store.initialize();
    store.append(entry('1', 'a'));
    store.append(entry('2', 'b'));
    await store.flush();

    expect(fs.writeTextFile).toHaveBeenCalledTimes(1);
    const [path, data, opts] = (fs.writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe(LOG_FILE_NAME);
    expect(opts).toMatchObject({ append: true, baseDir: 'AppLog' });
    const lines = (data as string).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
    ]);
  });

  it('readAll parses NDJSON and skips malformed lines', async () => {
    (fs.readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [JSON.stringify(entry('1')), '{ broken', JSON.stringify(entry('2'))].join('\n'),
    );
    const store = new TauriLogFileStore();
    const got = await store.readAll();
    expect(got.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('truncate writes empty file (no append)', async () => {
    const store = new TauriLogFileStore();
    await store.truncate();
    const calls = (fs.writeTextFile as ReturnType<typeof vi.fn>).mock.calls;
    const truncating = calls.find((c) => c[1] === '' && (c[2] as { append?: boolean })?.append !== true);
    expect(truncating).toBeDefined();
  });

  it('getDisplayPath returns appLogDir + filename', async () => {
    const store = new TauriLogFileStore();
    const p = await store.getDisplayPath();
    expect(p).toBe(`/mock/applogdir/${LOG_FILE_NAME}`);
  });

  it('revealLocation calls revealItemInDir with the file path', async () => {
    const store = new TauriLogFileStore();
    await store.revealLocation();
    expect(opener.revealItemInDir).toHaveBeenCalledWith(`/mock/applogdir/${LOG_FILE_NAME}`);
  });

  it('rotates when entry count exceeds cap', async () => {
    // Stateful mock: the "file" lives in this string.
    let fileContent = Array.from(
      { length: LOG_FILE_MAX_ENTRIES },
      (_, i) => JSON.stringify(entry(String(i))),
    ).join('\n') + '\n';
    (fs.readTextFile as ReturnType<typeof vi.fn>).mockImplementation(async () => fileContent);
    (fs.writeTextFile as ReturnType<typeof vi.fn>).mockImplementation(async (_path: string, data: string, opts?: { append?: boolean }) => {
      if (opts?.append) {
        fileContent += data;
      } else {
        fileContent = data;
      }
    });

    const store = new TauriLogFileStore();
    await store.initialize();

    store.append(entry('overflow'));
    await store.flush();

    await vi.runAllTimersAsync();

    const lines = fileContent.split('\n').filter(Boolean);
    expect(lines.length).toBe(LOG_FILE_TRUNCATE_RETAIN);
  });
});
