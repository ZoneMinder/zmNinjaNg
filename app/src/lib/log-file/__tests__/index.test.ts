import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  // Default test env: no __TAURI_INTERNALS__, Capacitor mock returns isNativePlatform=false
});

describe('log-file selector', () => {
  it('returns NoopLogFileStore on web', async () => {
    const { getLogFile } = await import('../index');
    const { NoopLogFileStore } = await import('../noop');
    const store = getLogFile();
    expect(store).toBeInstanceOf(NoopLogFileStore);
  });

  it('returns the same singleton on repeat calls', async () => {
    const { getLogFile } = await import('../index');
    expect(getLogFile()).toBe(getLogFile());
  });
});
