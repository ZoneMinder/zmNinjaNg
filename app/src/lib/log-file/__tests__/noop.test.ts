import { describe, it, expect } from 'vitest';
import { NoopLogFileStore } from '../noop';
import type { LogEntry } from '../../../stores/logs';

const sampleEntry: LogEntry = {
  id: 'a',
  timestamp: '2026-05-03 07:00:00',
  rawTimestamp: 1714747200000,
  level: 'INFO',
  message: 'hi',
};

describe('NoopLogFileStore', () => {
  it('reports no capabilities', () => {
    const store = new NoopLogFileStore();
    expect(store.capabilities).toEqual({ share: false, reveal: false, available: false });
  });

  it('append/flush/truncate/readAll/reveal all resolve without throwing', async () => {
    const store = new NoopLogFileStore();
    await store.initialize();
    store.append(sampleEntry);
    await store.flush();
    await store.truncate();
    await store.revealLocation();
    expect(await store.readAll()).toEqual([]);
    expect(await store.getDisplayPath()).toBeNull();
    expect(await store.getFileUri()).toBeNull();
  });
});
