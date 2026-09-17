/**
 * useEventsAround queries the ANCHOR's own profile (never the current one),
 * so an All-mode row whose server isn't current still resolves. Runs against
 * the real stores; only the HTTP client is fake (tests/profile-fixture).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import {
  seedProfiles,
  resetProfileFixture,
  fakeApiClient,
  asProfileId,
} from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useEventsAround } from '../useEventsAround';

const P = asProfileId('p1');

const anchorEvent = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
  Frames: '40',
  AlarmFrames: '4',
  Cause: 'Motion',
};
const anchor = { Event: anchorEvent } as never;

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('useEventsAround', () => {
  it('asks the anchor profile for the window and marks the anchor row', async () => {
    seedProfiles([P]);
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '4' } }] },
      '/groups.json': { groups: [] },
      '/events/index': {
        events: [
          { Event: { ...anchorEvent } },
          { Event: { ...anchorEvent, Id: '407', MonitorId: '4', StartDateTime: '2026-09-17 21:10:03' } },
        ],
        pagination: { count: 2 },
      },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 15, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((r) => r.event.Id)).toEqual(['407', '406']);
    expect(result.current.rows[1].isAnchor).toBe(true);
    expect(result.current.rows[0].offsetMs).toBe(-240_000);
    expect(result.current.monitorNames.get('3')).toBe('Door');
  });

  it('filters to the linked cameras when the scope asks for them', async () => {
    seedProfiles([P]);
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '4,7' } }] },
      '/groups.json': { groups: [] },
      '/events/index': { events: [], pagination: { count: 0 } },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'linked', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const requested = client.calls.map((c) => c.url).join(' ');
    expect(requested).toContain('MonitorId%3A3');
    expect(requested).toContain('MonitorId%3A4');
    expect(requested).toContain('MonitorId%3A7');
  });

  it('reports which scopes the server can offer', async () => {
    seedProfiles([P]);
    installApiClient(
      P,
      fakeApiClient({
        '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '' } }] },
        '/groups.json': { groups: [{ Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '3' }, { Id: '9' }] }] },
        '/events/index': { events: [], pagination: { count: 0 } },
      })
    );

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.available).toEqual({ linked: false, group: true }));
  });

  it('asks for nothing while the panel is closed', async () => {
    seedProfiles([P]);
    const client = fakeApiClient({});
    installApiClient(P, client);

    renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'all', enabled: false }),
      { wrapper }
    );

    await waitFor(() => expect(client.calls).toHaveLength(0));
  });
});
