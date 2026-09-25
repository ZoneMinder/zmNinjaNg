import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { EventsWidget } from '../EventsWidget';
import * as sessions from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { ALL_PROFILES_ID } from '../../../../api/types';
import type { Profile, EventData } from '../../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: () => '2:19 PM' }),
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });
const profileC = makeProfile('profile-c', { name: 'Cabin' });

function event(id: string, name: string, startDateTime: string): EventData {
  return {
    Event: {
      Id: id,
      Name: name,
      StartDateTime: startDateTime,
      Cause: 'Motion',
      Length: '10',
      Notes: '',
    },
  } as EventData;
}

// Real profile store + real session registry (fake-store-gates), so
// getEvents (kept mocked - it's not the sanctioned api/* boundary this file
// targets) is told which profile's client it received by REFERENCE against
// the real per-profile session clients, rather than a fabricated marker.
function seedScope(profiles: Profile[], mode?: 'single' | 'all') {
  const resolvedMode = mode ?? (profiles.length > 1 ? 'all' : 'single');
  seedProfiles(profiles, { current: resolvedMode === 'all' ? ALL_PROFILES_ID : profiles[0].id });
  // Distinct client instances per profile: the fake session registry's
  // fallback client is otherwise the SAME object for every profile that
  // doesn't get one installed, which would make a by-reference branch below
  // match every profile identically.
  for (const p of profiles) installApiClient(p.id, fakeApiClient());
}

function renderWidget(props: React.ComponentProps<typeof EventsWidget> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventsWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every seeded profile below defaults to bandwidthMode 'normal', whose
    // real getBandwidthSettings() gives eventsWidgetInterval 30000 - the
    // same value the old mock hardcoded.
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // profiles.length > 1 as the All-mode signal breaks the moment a delete
  // brings the scope down to one profile while still IN All mode (mode
  // stays 'all', but the count-based heuristic silently flips to single-mode
  // behavior): chips disappear and links stop deep-linking through /all
  // (refs #337, final fix wave).
  it('a single remaining profile in All mode still chips and deep-links via /all (refs #337)', async () => {
    seedScope([profileA], 'all');
    vi.mocked(getEvents).mockResolvedValue({
      events: [event('1', 'Front Door A', '2026-08-03 10:00:00')],
    } as never);

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<EventsWidget />} />
            <Route path="/all/events/:profileId/:eventId" element={<div data-testid="landed-all-route" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('Front Door A')).toBeInTheDocument());
    expect(screen.getByTestId('widget-profile-chip')).toHaveTextContent('Home');

    fireEvent.click(screen.getByText('Front Door A'));
    expect(screen.getByTestId('landed-all-route')).toBeInTheDocument();
  });

  it('All mode: aggregates both profiles\' events with a profile chip per row (refs #337)', async () => {
    seedScope([profileA, profileB]);
    const clientA = sessions.getSession(profileA.id).client;
    vi.mocked(getEvents).mockImplementation(async (client) =>
      (client === clientA
        ? { events: [event('1', 'Front Door A', '2026-08-03 10:00:00')] }
        : { events: [event('1', 'Back Yard B', '2026-08-03 11:00:00')] }) as never
    );

    renderWidget();

    await waitFor(() => expect(screen.getByText('Front Door A')).toBeInTheDocument());
    expect(screen.getByText('Back Yard B')).toBeInTheDocument();

    const chips = screen.getAllByTestId('widget-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(expect.arrayContaining(['Home', 'Work']));
  });

  it('single mode: no chip, exact single-profile query', async () => {
    seedScope([profileA]);
    const getSessionSpy = vi.spyOn(sessions, 'getSession');
    vi.mocked(getEvents).mockResolvedValue({
      events: [event('9', 'Solo Event', '2026-08-03 09:00:00')],
      pagination: { totalCount: 1 },
    } as never);

    renderWidget();

    await waitFor(() => expect(screen.getByText('Solo Event')).toBeInTheDocument());
    expect(screen.queryByTestId('widget-profile-chip')).toBeNull();
    expect(getSessionSpy).toHaveBeenCalledWith(profileA.id);
  });

  it('does not throw when rendered under the All-mode sentinel with zero events yet', () => {
    seedScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    expect(() => renderWidget()).not.toThrow();
  });

  it('single profile erroring with zero data shows the error branch, not the empty state (refs #337)', async () => {
    seedScope([profileA]);
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
    expect(screen.queryByText('dashboard.no_recent_events')).toBeNull();
  });

  // Picks from several servers: each server is asked only for its own
  // monitors, and a server with no picks is not asked at all (refs #529).
  it('queries only the servers with picks, each filtered to its own monitor ids', async () => {
    seedScope([profileA, profileB, profileC]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget({
      monitorRefs: [
        { profileId: profileA.id, monitorId: '1' },
        { profileId: profileB.id, monitorId: '5' },
        { profileId: profileA.id, monitorId: '2' },
      ],
    });

    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));
    const filterByProfile = Object.fromEntries(
      vi.mocked(getEvents).mock.calls.map(([, profileId, filters]) => [profileId, filters?.monitorId])
    );
    expect(filterByProfile).toEqual({ [profileA.id]: '1,2', [profileB.id]: '5' });
  });

  it('with no picks, queries every server unfiltered', async () => {
    seedScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget({ monitorRefs: [] });

    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getEvents).mock.calls.map(([, , filters]) => filters?.monitorId)).toEqual([undefined, undefined]);
  });

  it('shows the empty state when every picked server has left the scope', async () => {
    seedScope([profileA, profileB]);

    renderWidget({ monitorRefs: [{ profileId: profileC.id, monitorId: '1' }] });

    expect(await screen.findByText('dashboard.no_recent_events')).toBeInTheDocument();
    expect(getEvents).not.toHaveBeenCalled();
  });
});
