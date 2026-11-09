import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../api/monitors', () => ({ getAlarmStatus: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useAlarmStates } from '../useAlarmStates';
import { getAlarmStatus } from '../../api/monitors';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { clearAllServerMaps, setServerMap } from '../../lib/zm/server-resolver';
import { asProfileId } from '../../api/types';

const mockStatus = vi.mocked(getAlarmStatus);

const refs = (...ids: string[]) => ids.map((monitorId) => ({ monitorId, serverId: null }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAlarmStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles(['p1']);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    clearAllServerMaps();
  });

  it('polls each monitor on the API host of its own server', async () => {
    setServerMap(
      new Map([['2', { recordingUrl: '', portalPath: '', apiBaseUrl: 'http://server2/zm/api' }]]),
      asProfileId('p1')
    );
    mockStatus.mockResolvedValue({ status: 0 });

    renderHook(
      () =>
        useAlarmStates(
          [
            { monitorId: '1', serverId: '2' }, // the mapped server
            { monitorId: '3', serverId: '9' }, // not in the map
            { monitorId: '4', serverId: null }, // no server assigned
          ],
          { enabled: true, pollIntervalMs: 5000 }
        ),
      { wrapper }
    );

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalledTimes(3);
    });
    expect(mockStatus.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['1', 'http://server2/zm/api'],
      ['3', undefined],
      ['4', undefined],
    ]);
  });

  it('returns a parsed state per monitor', async () => {
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      id === '1' ? { status: 2 } : { status: 0 }
    );

    const { result } = renderHook(
      () => useAlarmStates(refs('1', '2'), { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states).toEqual({ '1': 'alarm', '2': 'idle' });
    });
  });

  it('issues one request per monitor rather than one combined request', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    renderHook(
      () => useAlarmStates(refs('1', '2', '3'), { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalledTimes(3);
    });
    expect(mockStatus.mock.calls.map((c) => c[1])).toEqual(['1', '2', '3']);
  });

  it('fetches nothing while disabled', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    const { result } = renderHook(
      () => useAlarmStates(refs('1'), { enabled: false, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockStatus).not.toHaveBeenCalled();
    expect(result.current.states).toEqual({});
  });

  it('reports a monitor whose request failed as unknown and surfaces the error', async () => {
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id === '2') throw new Error('boom');
      return { status: 2 };
    });

    const { result } = renderHook(
      () => useAlarmStates(refs('1', '2'), { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['1']).toBe('alarm');
    });
    expect(result.current.states['2']).toBe('unknown');
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('emits a state for every requested monitor even before its query resolves', async () => {
    // A monitor missing from the map would be read downstream as "no longer
    // watched" and dropped without its dwell window, so the map must be total.
    let resolveSecond: ((value: { status: number }) => void) | undefined;
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id === '1') return { status: 2 };
      return new Promise((resolve) => {
        resolveSecond = resolve as (value: { status: number }) => void;
      });
    });

    const { result } = renderHook(
      () => useAlarmStates(refs('1', '2'), { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['1']).toBe('alarm');
    });
    // '2' has not resolved yet, but must still be present.
    expect(Object.keys(result.current.states).sort()).toEqual(['1', '2']);
    expect(result.current.states['2']).toBe('unknown');

    resolveSecond?.({ status: 0 });
    await waitFor(() => {
      expect(result.current.states['2']).toBe('idle');
    });
  });

  it('returns the same states object across renders while nothing changes', async () => {
    // Regression: useQueries without `combine` re-maps its results array every
    // render, so anything derived from it downstream gets a new identity per
    // render. The Live Activity page derives its dwell list in an effect that
    // stamps Date.now(), so a per-render identity meant render -> effect ->
    // setState -> render without end. Reference equality here is the property
    // that stops it, and it does not depend on how fast jsdom renders.
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      id === '1' ? { status: 2 } : { status: 0 }
    );

    const { result, rerender } = renderHook(
      () => useAlarmStates(refs('1', '2'), { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['2']).toBe('idle');
    });

    const settledStates = result.current.states;
    const settledReturn = result.current;
    rerender();
    rerender();

    expect(result.current.states).toBe(settledStates);
    expect(result.current).toBe(settledReturn);
    // Guards against the assertion passing on an empty map.
    expect(settledStates).toEqual({ '1': 'alarm', '2': 'idle' });
  });

  it('holds a monitor at its last known state when a poll fails', async () => {
    // A dropped request must not read as "the alarm ended": that starts the
    // dwell countdown, and the next success then counts a fresh alarm, so one
    // continuous alarm displays as a repeat count on flaky wifi.
    let shouldFail = false;
    mockStatus.mockImplementation(async () => {
      if (shouldFail) throw new Error('boom');
      return { status: 2 };
    });

    const { result } = renderHook(
      () => useAlarmStates(refs('1'), { enabled: true, pollIntervalMs: 20 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['1']).toBe('alarm');
    });

    shouldFail = true;
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.states['1']).toBe('alarm');
  });

  it('returns an empty map for an empty monitor list', async () => {
    const { result } = renderHook(
      () => useAlarmStates([], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.states).toEqual({});
    expect(mockStatus).not.toHaveBeenCalled();
  });
});
