import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Platform } from '../../lib/platform';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let mockSettings: { autoRestartEnabled: boolean; autoRestartIntervalMinutes: number };
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ settings: mockSettings, currentProfile: { id: 'p1' } }),
}));

vi.mock('../../lib/logger', () => ({
  log: { app: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

import { useAutoRestart } from '../useAutoRestart';

const MIN_MS = 60 * 1000;

describe('useAutoRestart', () => {
  let isTauriSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    isTauriSpy = vi.spyOn(Platform, 'isTauri', 'get').mockReturnValue(true);
    mockSettings = { autoRestartEnabled: true, autoRestartIntervalMinutes: 120 };
  });

  afterEach(() => {
    vi.useRealTimers();
    isTauriSpy.mockRestore();
  });

  it('restarts the app after the configured interval (minutes) when enabled', async () => {
    renderHook(() => useAutoRestart());
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120 * MIN_MS);
    });

    expect(invokeMock).toHaveBeenCalledWith('restart_app');
  });

  it('does not restart before the interval elapses', async () => {
    renderHook(() => useAutoRestart());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120 * MIN_MS - 1000);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('clamps a sub-minimum interval to the 1-minute floor (no restart storm)', async () => {
    mockSettings = { autoRestartEnabled: true, autoRestartIntervalMinutes: 0.001 };
    renderHook(() => useAutoRestart());

    // 0.001 min would fire in ~60ms; clamped to 1 minute, so nothing yet at 59s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_MS - 1000);
    });
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(invokeMock).toHaveBeenCalledWith('restart_app');
  });

  it('does not restart when the toggle is off', async () => {
    mockSettings = { autoRestartEnabled: false, autoRestartIntervalMinutes: 120 };
    renderHook(() => useAutoRestart());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200 * MIN_MS);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not restart on non-Tauri platforms', async () => {
    isTauriSpy.mockReturnValue(false);
    renderHook(() => useAutoRestart());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200 * MIN_MS);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('cancels the pending restart on unmount', async () => {
    const { unmount } = renderHook(() => useAutoRestart());
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200 * MIN_MS);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
