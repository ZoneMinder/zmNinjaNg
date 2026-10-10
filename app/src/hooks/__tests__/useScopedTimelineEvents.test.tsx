import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useScopedTimelineEvents } from '../useScopedTimelineEvents';
import { getEvents } from '../../api/events';
import { getMonitors } from '../../api/monitors';
import { asProfileId, type Profile, type EventData } from '../../api/types';
import type { ApiClient } from '../../api/client';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
vi.mock('../../api/events', () => ({ getEvents: vi.fn() }));
vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));

const profile: Profile = {
  id: asProfileId('profile-a'),
  name: 'Home',
  apiUrl: 'http://a/api',
  portalUrl: 'http://a',
  cgiUrl: 'http://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
  timezone: 'UTC',
};

const event = {
  Event: { Id: '42', MonitorId: '1', StartDateTime: '2026-06-10 10:00:00', Length: '60', AlarmFrames: '1', Frames: '10' },
} as EventData;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useScopedTimelineEvents', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('keeps the current events while a moved date window fetches (refs #556)', async () => {
    seedProfiles([profile], { current: profile.id });
    installApiClient(profile.id, {} as ApiClient);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getEvents)
      .mockResolvedValueOnce({ events: [event] } as never)
      .mockImplementationOnce(() => new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ end }) => useScopedTimelineEvents({
        startDate: '2026-06-09T10:00', endDate: end, selectedMonitorIds: [], onlyDetectedObjects: false, causeFilter: '',
      }),
      { wrapper, initialProps: { end: '2026-06-10T10:00' } },
    );
    await waitFor(() => expect(result.current.eventIds).toEqual(['42']));

    rerender({ end: '2026-06-10T10:01' });
    await waitFor(() => expect(vi.mocked(getEvents)).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.eventIds).toEqual(['42']);
  });
});
