/**
 * useTimelineData Hook Tests
 *
 * Covers the API event transform, live-mode synthetic injection (including
 * dedup against API data), and the debounced refetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTimelineData, type UseTimelineDataOptions } from '../useTimelineData';
import { getEvents } from '../../api/events';
import { getMonitors } from '../../api/monitors';
import { TIMELINE } from '../../lib/zmninja-ng-constants';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useNotificationStore } from '../../stores/notifications';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

const apiEvent = {
  Event: {
    Id: '42',
    MonitorId: '1',
    Name: 'Event-42',
    StartDateTime: '2026-06-10 10:00:00',
    EndDateTime: '2026-06-10 10:01:00',
    Length: '60.0',
    Cause: 'Motion',
    AlarmFrames: '10',
    Frames: '100',
    Notes: 'person detected',
  },
} as never;

const defaultOptions: UseTimelineDataOptions = {
  startDate: '2026-06-09T10:00',
  endDate: '2026-06-10T10:00',
  liveMode: false,
  selectedMonitorIds: [],
  onlyDetectedObjects: false,
  causeFilter: '',
};

function createWrapper(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function emitLiveEvent(eventId: number, receivedAt: number) {
  act(() => {
    useNotificationStore.setState((state) => ({
      profileEvents: {
        ...state.profileEvents,
        'profile-1': [
          { EventId: eventId, MonitorId: 5, MonitorName: 'Door', Cause: 'Motion', Notes: 'person', receivedAt } as never,
          ...(state.profileEvents['profile-1'] ?? []),
        ],
      },
    }));
  });
}

describe('useTimelineData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationStore.setState({ profileEvents: {}, profileSettings: {}, connections: {} });
    seedProfiles(['profile-1'], { current: 'profile-1' });
    // The live-injection effect gates on the profile's own notifications
    // being enabled (DEFAULT_SETTINGS.enabled is false) - flip it on through
    // the real action, the way a user's settings would.
    useNotificationStore.getState().updateProfileSettings('profile-1', { enabled: true });
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetProfileFixture();
    resetFakeStoreGates();
    useNotificationStore.setState({ profileEvents: {}, profileSettings: {}, connections: {} });
  });

  it('transforms API events into timeline events', async () => {
    vi.mocked(getEvents).mockResolvedValue({ events: [apiEvent] } as never);

    const { result } = renderHook(() => useTimelineData(defaultOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allTimelineEvents).toHaveLength(1);
    const ev = result.current.allTimelineEvents[0];
    expect(ev.id).toBe('42');
    expect(ev.monitorId).toBe('1');
    expect(ev.endMs - ev.startMs).toBe(60_000);
    expect(ev.alarmRatio).toBeCloseTo(0.1);
    expect(result.current.eventIds).toEqual(['42']);
    expect(result.current.rawEventMap.get('42')).toBe(apiEvent);
  });

  it('keeps the current events while a moved date window fetches (refs #556)', async () => {
    vi.mocked(getEvents)
      .mockResolvedValueOnce({ events: [apiEvent] } as never)
      .mockImplementationOnce(() => new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ end }) => useTimelineData({ ...defaultOptions, endDate: end }),
      { wrapper: createWrapper(), initialProps: { end: '2026-06-10T10:00' } },
    );
    await waitFor(() => expect(result.current.allTimelineEvents).toHaveLength(1));

    rerender({ end: '2026-06-10T10:01' });
    await waitFor(() => expect(vi.mocked(getEvents)).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.eventIds).toEqual(['42']);
  });

  it('injects a synthetic event on a live notification and dedups repeats', async () => {
    const { result } = renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    emitLiveEvent(123, 1000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    expect(result.current.allTimelineEvents[0].id).toBe('123');

    // Same event arriving again must not produce a duplicate
    emitLiveEvent(123, 2000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    expect(result.current.allTimelineEvents[0].id).toBe('123');
  });

  it('prefers API data over a synthetic event with the same id', async () => {
    vi.mocked(getEvents).mockResolvedValue({ events: [apiEvent] } as never);

    const { result } = renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Live notification for the event the API already returned (id 42)
    emitLiveEvent(42, 1000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    const ev = result.current.allTimelineEvents[0];
    expect(ev.id).toBe('42');
    // API shape wins: real duration, not the 1s synthetic placeholder
    expect(ev.endMs - ev.startMs).toBe(60_000);
  });

  it('does not react to notifications when live mode is off', async () => {
    const { result } = renderHook(() => useTimelineData(defaultOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    emitLiveEvent(99, 1000);

    expect(result.current.allTimelineEvents).toHaveLength(0);
  });

  it('debounces the refetch when several live events arrive in quick succession', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper(client) },
    );

    emitLiveEvent(201, 1000);
    act(() => {
      vi.advanceTimersByTime(TIMELINE.liveRefetchDebounceMs / 2);
    });
    emitLiveEvent(202, 2000);

    // First timer was cancelled by the second arrival
    act(() => {
      vi.advanceTimersByTime(TIMELINE.liveRefetchDebounceMs - 1);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timeline-events', 'profile-1'] });
  });
});
