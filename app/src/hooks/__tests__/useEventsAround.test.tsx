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
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import type { EventsPageQuery } from '../../stores/eventContext';

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
  useEventFavoritesStore.setState({ profileFavorites: {} });
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

  it('fills outward from the anchor: before it newest first, after it oldest first', async () => {
    seedProfiles([P]);
    // The upper bound on StartDateTime marks the before-the-anchor request.
    const before = 'StartDateTime%20%3C%3D';
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '' } }] },
      '/groups.json': { groups: [] },
      '/events/index': (url: string) =>
        url.includes(before)
          ? {
              events: [
                { Event: { ...anchorEvent } },
                { Event: { ...anchorEvent, Id: '405', StartDateTime: '2026-09-17 21:13:03' } },
              ],
              pagination: { count: 2 },
            }
          : {
              events: [
                { Event: { ...anchorEvent } },
                { Event: { ...anchorEvent, Id: '408', StartDateTime: '2026-09-17 21:15:03' } },
              ],
              pagination: { count: 2 },
            },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 60, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.rows.map((r) => r.event.Id)).toEqual(['405', '406', '408']);
    const urls = client.calls.map((c) => decodeURIComponent(c.url)).filter((u) => u.includes('/events/index'));
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes('StartDateTime <=:2026-09-17 21:14:03'))).toBe(true);
    expect(urls.some((u) => u.includes('StartDateTime >=:2026-09-17 21:14:03'))).toBe(true);
  });

  it('leaves out monitors excluded from the profile, events and names both', async () => {
    seedProfiles([P], { settings: { p1: { excludedMonitorIds: ['4'] } } });
    installApiClient(
      P,
      fakeApiClient({
        '/monitors.json': {
          monitors: [
            { Monitor: { Id: '3', Name: 'Door' } },
            { Monitor: { Id: '4', Name: 'Hidden' } },
          ],
        },
        '/groups.json': { groups: [] },
        '/events/index': {
          events: [
            { Event: { ...anchorEvent } },
            { Event: { ...anchorEvent, Id: '407', MonitorId: '4', StartDateTime: '2026-09-17 21:15:03' } },
          ],
          pagination: { count: 2 },
        },
      })
    );

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 15, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows.map((r) => r.event.Id)).toEqual(['406']);
    expect(result.current.monitorNames.has('4')).toBe(false);
  });

  describe('the Filtered scope', () => {
    const server = () =>
      fakeApiClient({
        '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '4' } }] },
        '/groups.json': { groups: [] },
        '/events/index': { events: [], pagination: { count: 0 } },
      });
    const eventUrls = (client: ReturnType<typeof fakeApiClient>) =>
      client.calls.map((c) => decodeURIComponent(c.url)).filter((u) => u.includes('/events/index'));

    it('asks with the Events page query, but its own window instead of the page dates', async () => {
      seedProfiles([P]);
      const client = server();
      installApiClient(P, client);
      const pageQuery: EventsPageQuery = {
        filters: {
          notesRegexp: 'detected:',
          archived: true,
          causeExclude: 'Linked',
          startDateTime: '2020-01-01T00:00',
          endDateTime: '2020-01-02T00:00',
        },
        monitorId: '3,7',
        favoritesOnly: false,
        active: true,
      };

      const { result } = renderHook(
        () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'filtered', enabled: true, pageQuery }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.effectiveScope).toBe('filtered');
      expect(result.current.available.filtered).toBe(true);
      const urls = eventUrls(client);
      expect(urls).toHaveLength(2);
      for (const u of urls) {
        expect(u).toContain('Notes REGEXP:detected:');
        expect(u).toContain('Archived:1');
        expect(u).toContain('Cause NOT REGEXP:Linked');
        expect(u).toContain('MonitorId:3');
        expect(u).toContain('MonitorId:7');
        // Not the Linked scope's cameras, and not the page's date range.
        expect(u).not.toContain('MonitorId:4');
        expect(u).not.toContain('2020-01-0');
      }
    });

    it("narrows to the anchor server's own monitors, favorites and tags", async () => {
      seedProfiles([P]);
      useEventFavoritesStore.setState({ profileFavorites: { [P]: ['406', '500'] } });
      const client = server();
      installApiClient(P, client);
      const pageQuery: EventsPageQuery = {
        filters: {},
        // All mode: composite tokens across two servers.
        monitorId: `${P}:3,other:9`,
        favoritesOnly: true,
        active: true,
      };

      const { result } = renderHook(
        () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'filtered', enabled: true, pageQuery }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const urls = eventUrls(client);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u).toContain('MonitorId:3');
        expect(u).not.toContain('MonitorId:9');
        expect(u).toContain('Id IN:406,500');
      }
    });

    it('applies the page tag filter for the anchor server', async () => {
      seedProfiles([P]);
      const client = server();
      installApiClient(P, client);
      const pageQuery: EventsPageQuery = {
        filters: {},
        favoritesOnly: false,
        tagIdsByProfile: { [P]: ['12'] },
        active: true,
      };

      const { result } = renderHook(
        () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'filtered', enabled: true, pageQuery }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const urls = eventUrls(client);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(u).toContain('Tags.Id:12');
    });

    it('is unavailable, and falls back to every camera, without active Events page filters', async () => {
      seedProfiles([P]);
      installApiClient(P, server());

      const { result } = renderHook(
        () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'filtered', enabled: true, pageQuery: null }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.available.filtered).toBe(false);
      expect(result.current.effectiveScope).toBe('all');
    });
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

    await waitFor(() => expect(result.current.available).toEqual({ linked: false, group: true, filtered: false }));
  });

  it('stays loading until groups resolve, even after monitors already have', async () => {
    seedProfiles([P]);
    let resolveGroups: (value: unknown) => void = () => {};
    const groupsPromise = new Promise((resolve) => {
      resolveGroups = resolve;
    });
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '' } }] },
      '/groups.json': () => groupsPromise,
      '/events/index': { events: [], pagination: { count: 0 } },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'all', enabled: true }),
      { wrapper }
    );

    // Monitors have resolved (proof: their names are in) but groups have not.
    await waitFor(() => expect(result.current.monitorNames.get('3')).toBe('Door'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.rows).toEqual([]);

    resolveGroups({ groups: [] });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
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
