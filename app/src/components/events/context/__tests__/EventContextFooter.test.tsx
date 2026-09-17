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
    expect(useSettingsStore.getState().getProfileSettings(P1).timelinePageFilters).toMatchObject({
      startDateTime: '2026-09-17 20:59:03',
      endDateTime: '2026-09-17 21:29:41',
    });
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
    expect(params.get('startDateTime')).toBe('2026-09-17 20:59:03');
    expect(params.get('endDateTime')).toBe('2026-09-17 21:29:41');
    // No events in the window (emptyServer): nothing resolved, so no
    // narrowing filter goes on the URL - an all-cameras deep link, not one
    // that (wrongly) matches nothing.
    expect(params.has('monitorId')).toBe(false);
  });

  it('includes the resolved monitor ids on the events deep link when the window found some', async () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 15, scope: 'all' } } } });
    installApiClient(
      P1,
      fakeApiClient({
        '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Front Door' } }, { Monitor: { Id: '4', Name: 'Back Door' } }] },
        '/groups.json': { groups: [] },
        '/events/index': {
          events: [
            { Event: { ...event } },
            { Event: { ...event, Id: '407', MonitorId: '4', StartDateTime: '2026-09-17 21:15:03' } },
          ],
          pagination: { count: 2 },
        },
      })
    );
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

  it('closes the panel on the way out', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-timeline'));

    expect(useEventContextStore.getState().open).toBe(false);
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
  });
});
