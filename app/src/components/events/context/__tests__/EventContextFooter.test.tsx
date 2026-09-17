import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
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
} as never;

function openPanel() {
  seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 15, scope: 'all' } } } });
  installApiClient(P1, emptyServer());
  renderWithClient(
    <>
      <EventContextButton event={event} profileId={P1} />
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

  it('sends the window to the events page as nav state', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-events'));

    expect(navigate).toHaveBeenCalledWith('/events', {
      state: {
        eventFilters: {
          startDateTime: '2026-09-17 20:59:03',
          endDateTime: '2026-09-17 21:29:41',
          monitorId: undefined,
        },
      },
    });
  });

  it('closes the panel on the way out', async () => {
    openPanel();
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('event-context-open-timeline'));

    expect(useEventContextStore.getState().open).toBe(false);
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
  });
});
