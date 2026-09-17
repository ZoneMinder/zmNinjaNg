import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import { useEventContextStore } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';
import { seedProfiles, resetProfileFixture, makeProfile, asProfileId, fakeApiClient } from '../../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { useSettingsStore } from '../../../../stores/settings';
import { ALL_PROFILES_ID } from '../../../../api/types';

// EventContextButton reads usePermissions (useQuery) unconditionally, same as
// the sibling event-action buttons (EventDeleteButton, EventCard tests).
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Empty monitors/groups/events: enough for useEventsAround to settle without
 *  a scope becoming available, which isn't what these tests are checking. */
function emptyServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [] },
    '/groups.json': { groups: [] },
    '/events/index': { events: [], pagination: { count: 0 } },
  });
}

const event = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
} as never;

const event2 = {
  Id: '407',
  MonitorId: '3',
  Name: 'Back Door',
  StartDateTime: '2026-09-17 21:15:03',
  EndDateTime: '2026-09-17 21:15:41',
  Length: '38.00',
} as never;

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

afterEach(() => {
  useEventContextStore.getState().closePanel();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventContextPanel', () => {
  it('stays closed until something opens it', () => {
    render(<EventContextPanel />);
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
  });

  it('opens on the trigger and names the anchor event', () => {
    renderWithClient(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(screen.getByTestId('event-context-anchor')).toHaveTextContent('Front Door');
    // Close within the test (fireEvent wraps in act()) rather than leaving
    // the panel open for afterEach's closePanel() to unmount outside act().
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('closes again and leaves the page it opened over alone', () => {
    renderWithClient(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    fireEvent.click(screen.getByTestId('event-context-close'));
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
    expect(useEventContextStore.getState().anchor).toBeNull();
  });

  it('opens on the anchor profile\'s own saved window and scope', async () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 30, scope: 'linked' } } } });
    installApiClient(P1, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    // useEventsAround's monitors/groups/events queries resolve through the
    // real fakeApiClient; wait for them to settle (the empty-scope list) so
    // no state update from the resolved queries escapes act().
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('re-seeds from the newly opened profile, not whatever the panel showed before', async () => {
    seedProfiles([makeProfile('p1'), makeProfile('p2')], {
      settings: {
        p1: { eventContext: { windowMinutes: 10, scope: 'all' } },
        p2: { eventContext: { windowMinutes: 60, scope: 'group' } },
      },
    });
    installApiClient(P1, emptyServer());
    installApiClient(P2, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextButton event={event2} profileId={P2} />
        <EventContextPanel />
      </>
    );
    const [openP1, openP2] = screen.getAllByTestId('event-context-open');

    fireEvent.click(openP1);
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));

    fireEvent.click(openP2);
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-60')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('sends the Timeline window to the current profile\'s bucket, not the anchor\'s, in All mode', async () => {
    // The anchor is owned by p1, but the app's current profile is the All-mode
    // aggregate - the case this button is for. useTimelineFilters restores
    // timelinePageFilters from currentProfileId's bucket, so that's where the
    // window has to land or the Timeline page never sees it (refs #494).
    seedProfiles([makeProfile('p1')], { current: ALL_PROFILES_ID });
    installApiClient(P1, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-empty');
    fireEvent.click(screen.getByTestId('event-context-open-timeline'));

    const aggregateFilters = useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).timelinePageFilters;
    const anchorFilters = useSettingsStore.getState().getProfileSettings(P1).timelinePageFilters;
    expect(aggregateFilters.startDateTime).toBe('2026-09-17 21:04:03');
    expect(anchorFilters.startDateTime).toBe('');
  });
});
