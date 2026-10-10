import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
import React from 'react';
import { useScopedEvents } from '../useScopedEvents';
import { getEvents } from '../../api/events';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import { queryKeys } from '../../lib/query/query-keys';
import { formatForServerInTz } from '../../lib/time';
import { ALL_PROFILES_ID, asProfileId, type Profile } from '../../api/types';
import type { ApiClient } from '../../api/client';
import type { EventData, EventsResponse } from '../../api/types';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
}));

// Spy on the real useQueries (delegates to actual react-query) so the
// polling-opt-in tests can inspect exactly what query config the hook
// builds, without needing fake timers to prove a refetch never fires.
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  // Plain `(options: unknown) => unknown` shape, not `vi.fn(actual.useQueries)`
  // directly - useQueries' real signature is an overloaded generic that vi.fn's
  // own generic inference can't reconcile with itself (tsc error, no runtime
  // issue). The cast inside just forwards to the real implementation.
  const useQueriesSpy = vi.fn((options: unknown) => (actual.useQueries as (o: unknown) => unknown)(options));
  return { ...actual, useQueries: useQueriesSpy };
});

const profileA: Profile = {
  id: asProfileId('profile-a'),
  name: 'Home',
  apiUrl: 'http://a/api',
  portalUrl: 'http://a',
  cgiUrl: 'http://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
  timezone: 'UTC',
};

const profileB: Profile = {
  id: asProfileId('profile-b'),
  name: 'Work',
  apiUrl: 'http://b/api',
  portalUrl: 'http://b',
  cgiUrl: 'http://b/cgi-bin',
  isDefault: false,
  createdAt: 0,
  timezone: 'America/New_York',
};

function event(id: string, startDateTime: string): EventData {
  return { Event: { Id: id, StartDateTime: startDateTime } } as EventData;
}

function eventsResponse(events: EventData[]): EventsResponse {
  return {
    events,
    pagination: {
      page: 1,
      pageCount: 1,
      current: 1,
      count: events.length,
      prevPage: false,
      nextPage: false,
      limit: 100,
      totalCount: events.length,
    },
  } as EventsResponse;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** Seed the real profile store for the given scope and give each profile a
 * distinguishable fake session client (getEvents is mocked directly, so the
 * client only needs to carry which profile it belongs to). */
function setupScope(profiles: Profile[], mode: 'single' | 'all' = profiles.length === 1 ? 'single' : 'all') {
  seedProfiles(profiles, { current: mode === 'single' ? profiles[0].id : ALL_PROFILES_ID });
  for (const p of profiles) {
    installApiClient(p.id, { profile: p.id } as unknown as ApiClient);
  }
}

const baseOptions = {
  filters: {},
  limit: 100,
  monitorId: undefined,
  isGroupFilterActive: false,
  tagIdsByProfile: undefined,
};

describe('useScopedEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEventFavoritesStore.setState({ profileFavorites: {} });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('orders merged events by true cross-timezone instant, not by wall-clock string', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      // A (UTC) at 14:00 vs B (America/New_York, EST=-05:00) at 10:00 the
      // same day: B's 10:00 EST = 15:00 UTC, so B is the LATER event even
      // though its wall-clock hour reads earlier.
      return isA
        ? eventsResponse([event('a1', '2026-01-15 14:00:00')])
        : eventsResponse([event('b1', '2026-01-15 10:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.events).toHaveLength(2));

    expect(result.current.events.map((e) => e.item.Event.Id)).toEqual(['b1', 'a1']);
  });

  it('keeps colliding event ids distinct across profiles, tagged with the owning profile', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return eventsResponse([event('1', isA ? '2026-01-15 09:00:00' : '2026-01-15 08:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.events).toHaveLength(2));

    const [first, second] = result.current.events;
    expect(first.item.Event.Id).toBe(second.item.Event.Id);
    expect(first.profileId).not.toBe(second.profileId);
    expect(new Set(result.current.events.map((e) => e.profileId)).size).toBe(2);
    expect(result.current.events.find((e) => e.profileId === profileA.id)?.profileName).toBe('Home');
    expect(result.current.events.find((e) => e.profileId === profileB.id)?.profileName).toBe('Work');
  });

  it('sums every profile\'s own totalCount, matching the single query\'s totalCount in single mode (refs #337)', async () => {
    setupScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00'), event('2', '2026-01-15 08:00:00')]));

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totalCount).toBe(2));
  });

  it('sums totalCount across profiles in All mode', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return isA
        ? eventsResponse([event('a1', '2026-01-15 09:00:00')])
        : eventsResponse([event('b1', '2026-01-15 08:00:00'), event('b2', '2026-01-15 07:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(3));
    expect(result.current.totalCount).toBe(3);
  });

  // Events.tsx's "Showing X of Y" needs Y scoped to the active server filter,
  // not every profile in scope - a per-profile breakdown is the minimal
  // addition that lets it recompute that without re-fetching (refs #337).
  it('exposes each profile\'s own totalCount alongside the summed total', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return isA
        ? eventsResponse([event('a1', '2026-01-15 09:00:00')])
        : eventsResponse([event('b1', '2026-01-15 08:00:00'), event('b2', '2026-01-15 07:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totalCount).toBe(3));
    expect(result.current.totalCountByProfile).toEqual({ [profileA.id]: 1, [profileB.id]: 2 });
  });

  it('converts a shared date-range bound per profile using that profile\'s OWN timezone, not one shared value (refs #337)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    // A raw local datetime-local input string, as useEventFilters produces -
    // NOT pre-formatted server text (that conversion now happens per profile
    // inside the hook, not once up front by the caller).
    const filters = { startDateTime: '2026-01-15T10:00:00' };

    renderHook(() => useScopedEvents({ ...baseOptions, filters }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { startDateTime?: string };

    const forA = callFor(profileA)?.startDateTime;
    const forB = callFor(profileB)?.startDateTime;
    expect(forA).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(forB).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // profileA=UTC and profileB=America/New_York (EST=-05:00) render the SAME
    // instant 5 hours apart on the wall clock - not the same shared string,
    // which is what the old caller-pre-converts-once behavior produced.
    expect(forA).not.toBe(forB);
    const hourOf = (s: string) => Number(s!.slice(11, 13));
    expect((hourOf(forA!) - hourOf(forB!) + 24) % 24).toBe(5);
  });

  // refs #337 fix round 1: a profile with no configured timezone must
  // convert date-range filters using the BROWSER zone (formatForServer's
  // historical fallback for the single-mode query this hook replaced), not
  // a hardcoded 'UTC' - the latter silently shifted the query window for
  // such a profile once Events.tsx switched to this hook.
  it('a profile without a timezone converts date filters using the browser zone, matching formatForServer byte-for-byte', async () => {
    const profileNoTz: Profile = { ...profileA, timezone: undefined };
    setupScope([profileNoTz], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    const filters = { startDateTime: '2026-01-15T10:00:00' };
    renderHook(() => useScopedEvents({ ...baseOptions, filters }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(1));

    const sent = vi.mocked(getEvents).mock.calls[0][2] as { startDateTime?: string };
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(sent.startDateTime).toBe(formatForServerInTz(new Date(filters.startDateTime), browserTz));
  });

  it('fans out only each profile\'s own composite monitorId selection (refs #337 I6)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(
      () => useScopedEvents({ ...baseOptions, monitorId: `${profileA.id}:3` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { monitorId?: string; eventIds?: string[] };

    // A's selection stays A's - B never gets filtered by a monitor id that
    // only means something on A's server.
    expect(callFor(profileA)?.monitorId).toBe('3');
    expect(callFor(profileB)?.monitorId).toBeUndefined();
    // ...and B owns none of the selected monitors, so it gets the impossible
    // filter rather than an unfiltered query. This assertion used to read
    // `eventIds` undefined, which encoded the defect: "no monitor of yours was
    // picked" was answered with every event on B's server.
    expect(callFor(profileB)?.eventIds).toEqual([]);
  });

  it('a profile owning none of the selected monitors contributes NO events (refs #337)', async () => {
    setupScope([profileA, profileB]);
    // Mirrors the getEvents contract an empty id set has (covered directly in
    // api/__tests__/events.test.ts): it short-circuits to an empty response
    // without a request, rather than falling through unfiltered.
    vi.mocked(getEvents).mockImplementation(async (client, _profileId, opts) => {
      if (opts?.eventIds?.length === 0) return eventsResponse([]);
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return eventsResponse([event(isA ? 'a1' : 'b1', '2026-01-15 09:00:00')]);
    });

    const { result } = renderHook(
      () => useScopedEvents({ ...baseOptions, monitorId: `${profileA.id}:3` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Filtering to one server's camera must not put the OTHER server's whole
    // event list on screen.
    expect(result.current.events.map((e) => e.item.Event.Id)).toEqual(['a1']);
    expect(result.current.events.every((e) => e.profileId === profileA.id)).toBe(true);
  });

  it('joins multiple composite ids owned by the same profile into one comma list (refs #337 I6)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(
      () => useScopedEvents({ ...baseOptions, monitorId: `${profileA.id}:3,${profileA.id}:5,${profileB.id}:7` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { monitorId?: string };

    expect(callFor(profileA)?.monitorId).toBe('3,5');
    expect(callFor(profileB)?.monitorId).toBe('7');
  });

  it('resolves favoritesOnly per profile - a profile with no favorites contributes nothing (refs #337 I7)', async () => {
    setupScope([profileA, profileB]);
    useEventFavoritesStore.getState().addFavorite(profileA.id, '3');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(() => useScopedEvents({ ...baseOptions, favoritesOnly: true }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { eventIds?: string[] };

    // A's own favorite reaches its query; B (no favorites of its own) gets
    // an impossible filter instead of silently reusing A's list or fetching
    // everything unfiltered.
    expect(callFor(profileA)?.eventIds).toEqual(['3']);
    expect(callFor(profileB)?.eventIds).toEqual([]);
  });

  it('passes no eventIds filter when favoritesOnly is off', async () => {
    setupScope([profileA, profileB]);
    useEventFavoritesStore.getState().addFavorite(profileA.id, '3');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { eventIds?: string[] };

    expect(callFor(profileA)?.eventIds).toBeUndefined();
    expect(callFor(profileB)?.eventIds).toBeUndefined();
  });

  it('sends each profile its OWN tag ids for the same selected tag (refs #337 D4)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    // "person" is tag 1 on A and tag 7 on B. Sending one shared id to both
    // would filter B by whatever tag happens to carry that number there.
    renderHook(
      () => useScopedEvents({ ...baseOptions, tagIdsByProfile: { [profileA.id]: ['1'], [profileB.id]: ['7'] } }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { tagIds?: string[] };

    expect(callFor(profileA)?.tagIds).toEqual(['1']);
    expect(callFor(profileB)?.tagIds).toEqual(['7']);
  });

  it('gives a profile that has none of the selected tags an impossible filter, not an unfiltered query', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(
      () => useScopedEvents({ ...baseOptions, tagIdsByProfile: { [profileA.id]: ['2'], [profileB.id]: [] } }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { tagIds?: string[] };

    // Same shape favoritesOnly uses: an empty list means "matches nothing
    // here", never "no filter" - otherwise filtering by a tag only one server
    // defines would show every event from the other one.
    expect(callFor(profileA)?.tagIds).toEqual(['2']);
    expect(callFor(profileB)?.tagIds).toEqual([]);
  });

  it('passes no tag filter when the caller supplies none', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: Profile) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { tagIds?: string[] };

    expect(callFor(profileA)?.tagIds).toBeUndefined();
    expect(callFor(profileB)?.tagIds).toBeUndefined();
  });

  it('surfaces one failing profile as a ProfileError while the other profile still renders its data', async () => {
    setupScope([profileA, profileB]);
    const failure = new Error('B is down');
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      if (!isA) throw failure;
      return eventsResponse([event('1', '2026-01-15 09:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.errors).toHaveLength(1));

    expect(result.current.errors[0].profileId).toBe(profileB.id);
    expect(result.current.errors[0].profileName).toBe('Work');
    expect(result.current.errors[0].error).toBe(failure);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].profileId).toBe(profileA.id);
    expect(result.current.isLoading).toBe(false);
  });

  it('single-mode profile scope writes to the exact key Events.tsx reads, so the cache entry is shared', async () => {
    setupScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('42', '2026-01-15 09:00:00')]));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    // getEvents called with this profile's session client and id - the same
    // call Events.tsx makes for the current profile.
    expect(vi.mocked(getEvents).mock.calls[0][1]).toBe(profileA.id);

    // Cache entry lives at queryKeys.eventsList(id, ...) with the SAME args
    // Events.tsx passes - a single-mode surface using that key reads this
    // same data without a second network round trip.
    const key = queryKeys.eventsList(
      profileA.id,
      baseOptions.filters,
      baseOptions.limit,
      baseOptions.monitorId,
      baseOptions.isGroupFilterActive,
      undefined,
      baseOptions.tagIdsByProfile
    );
    expect(queryClient.getQueryData(key)).toEqual(eventsResponse([event('42', '2026-01-15 09:00:00')]));
  });

  it('refetchProfile(id) refetches only that profile', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    const callsBefore = vi.mocked(getEvents).mock.calls.length;
    result.current.refetchProfile(profileB.id);

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThan(callsBefore));
    const refetchCallClient = vi.mocked(getEvents).mock.calls[vi.mocked(getEvents).mock.calls.length - 1][0];
    expect((refetchCallClient as unknown as { profile: string }).profile).toBe(profileB.id);
  });

  it('keeps events/errors array identity across an unrelated rerender (combine + replaceEqualDeep)', async () => {
    setupScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    const { result, rerender } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    const eventsRef = result.current.events;
    const errorsRef = result.current.errors;

    rerender();

    expect(result.current.events).toBe(eventsRef);
    expect(result.current.errors).toBe(errorsRef);
  });

  it('keeps the current list on screen while a moved date window fetches (refs #556)', async () => {
    setupScope([profileA], 'single');
    let release: (r: EventsResponse) => void = () => {};
    vi.mocked(getEvents)
      .mockResolvedValueOnce(eventsResponse([event('1', '2026-01-15 09:00:00')]))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const { result, rerender } = renderHook(
      ({ end }) => useScopedEvents({ ...baseOptions, filters: { endDateTime: end } }),
      { wrapper: createWrapper(), initialProps: { end: '2026-01-15T10:00:00' } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ end: '2026-01-15T10:01:00' });
    await waitFor(() => expect(vi.mocked(getEvents)).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.events.map((e) => e.item.Event.Id)).toEqual(['1']);

    release(eventsResponse([event('2', '2026-01-15 10:00:30')]));
    await waitFor(() => expect(result.current.events.map((e) => e.item.Event.Id)).toEqual(['2']));
  });

  it('fetches every profile in scope even when neither has ever authenticated this session (refs #337)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      const calledProfileIds = vi.mocked(getEvents).mock.calls.map(([, id]) => id);
      expect(calledProfileIds).toContain(profileB.id);
    });
  });

  it('does not poll by default - refetchInterval is omitted unless the caller opts in', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.refetchInterval === undefined)).toBe(true);
  });

  it('honors an explicit refetchInterval when the caller opts in, staggered per profile (W8)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents({ ...baseOptions, refetchInterval: 15000 }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    // Index 0 keeps the base period exactly; index 1 gets a distinct,
    // bounded-larger period (stagger-interval.ts) so both profiles' polls
    // don't land as a synchronized burst.
    expect(queries[0].refetchInterval).toBe(15000);
    expect(queries[1].refetchInterval).toBeGreaterThan(15000);
    expect(queries[1].refetchInterval).toBeLessThanOrEqual(15000 * 1.5);
  });
});
