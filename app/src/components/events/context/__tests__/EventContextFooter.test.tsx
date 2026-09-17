import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  // Fixed: these tests don't exercise the route-change close (EventContextPanel.test.tsx does).
  useLocation: () => ({ pathname: '/events' }),
}));

import { useEventContextStore } from '../../../../stores/eventContext';
import { useSettingsStore } from '../../../../stores/settings';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';
import { seedProfiles, resetProfileFixture, makeProfile, asProfileId, fakeApiClient } from '../../../../tests/profile-fixture';
import { ALL_PROFILES_ID } from '../../../../api/types';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Empty monitors/groups/events: rows stay empty, so `monitorId` resolves to
 *  undefined - what these tests check isn't scope resolution (task 3 covers
 *  that), it's that the footer hands the window on regardless. */
function emptyServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [] },
    '/groups.json': { groups: [] },
    '/events/index': { events: [], pagination: { count: 0 } },
  });
}

/** Two cameras, one event each, so the Events hatch has ids to carry. */
function twoMonitorServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Front Door' } }, { Monitor: { Id: '4', Name: 'Back Door' } }] },
    '/groups.json': { groups: [] },
    '/events/index': {
      events: [
        { Event: { ...event } },
        { Event: { ...event, Id: '407', MonitorId: '4', StartDateTime: '2026-09-17 21:15:03' } },
      ],
      pagination: { count: 2 },
    },
  });
}

const P1 = asProfileId('p1');

const event = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
};

function openPanel() {
  seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 15, scope: 'all' } } } });
  installApiClient(P1, emptyServer());
  renderWithClient(
    <>
      <EventContextButton event={event as never} profileId={P1} />
      <EventContextPanel />
    </>
  );
  fireEvent.click(screen.getByTestId('event-context-open'));
}

afterEach(() => {
  useEventContextStore.getState().closePanel();
  resetProfileFixture();
  resetFakeStoreGates();
  navigate.mockClear();
});

describe('EventContextPanel footer', () => {
  it('sends the window to the timeline filters and navigates', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-timeline'));

    expect(navigate).toHaveBeenCalledWith('/timeline');
    const filters = useSettingsStore.getState().getProfileSettings(P1).timelinePageFilters;
    // TimelineFiltersPanel renders these into <input type="datetime-local">,
    // which renders an empty field for anything that is not browser-local
    // `YYYY-MM-DDTHH:mm`, and Timeline re-reads them as browser-local before
    // converting to the server's zone (refs #494).
    expect(filters.startDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(filters.endDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // p1 keeps UTC, so the window is 20:59:03Z to 21:29:41Z; the input's
    // minute resolution truncates each bound. Comparing instants rather than
    // digits keeps this true whatever zone the test machine runs in.
    expect(new Date(filters.startDateTime).getTime()).toBe(Date.parse('2026-09-17T20:59:00Z'));
    expect(new Date(filters.endDateTime).getTime()).toBe(Date.parse('2026-09-17T21:29:00Z'));
  });

  it('sends the window to the events page as a URL deep link', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-events'));

    expect(navigate).toHaveBeenCalledTimes(1);
    const [target] = navigate.mock.calls[0] as [string];
    const [pathname, query] = target.split('?');
    expect(pathname).toBe('/events');
    const params = new URLSearchParams(query);
    // Browser-local for the same reason the Timeline hatch converts: Events
    // parses the param back with `new Date(...)` in the browser's zone.
    expect(new Date(params.get('startDateTime')!).getTime()).toBe(Date.parse('2026-09-17T20:59:00Z'));
    expect(new Date(params.get('endDateTime')!).getTime()).toBe(Date.parse('2026-09-17T21:29:00Z'));
    // No events in the window (emptyServer): nothing resolved, so no
    // narrowing filter goes on the URL - an all-cameras deep link, not one
    // that (wrongly) matches nothing.
    expect(params.has('monitorId')).toBe(false);
  });

  it('includes the resolved monitor ids on the events deep link when the window found some', async () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 15, scope: 'all' } } } });
    installApiClient(P1, twoMonitorServer());
    renderWithClient(
      <>
        <EventContextButton event={event as never} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-row-407');

    fireEvent.click(screen.getByTestId('event-context-open-events'));

    const [target] = navigate.mock.calls[0] as [string];
    const params = new URLSearchParams(target.split('?')[1]);
    expect(params.get('monitorId')).toBe('3,4');
  });

  it('qualifies the monitor ids with the anchor profile in an aggregate mode', async () => {
    // Aggregate monitor filters are `${profileId}:${monitorId}` tokens
    // (useEventFilters). A bare `3,4` is passed through unchanged to EVERY
    // profile by resolveOwnMonitorIds, so the Events page would land filtered
    // to whatever cameras happen to be numbered 3 and 4 on each server
    // (refs #494).
    seedProfiles([makeProfile('p1')], {
      current: ALL_PROFILES_ID,
      settings: { p1: { eventContext: { windowMinutes: 15, scope: 'all' } } },
    });
    installApiClient(P1, twoMonitorServer());
    renderWithClient(
      <>
        <EventContextButton event={event as never} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-row-407');

    fireEvent.click(screen.getByTestId('event-context-open-events'));

    const [target] = navigate.mock.calls[0] as [string];
    const params = new URLSearchParams(target.split('?')[1]);
    expect(params.get('monitorId')).toBe('p1:3,p1:4');
  });

  it('closes the panel on the way out', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-timeline'));

    expect(useEventContextStore.getState().open).toBe(false);
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
  });
});
