import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { useEventContextStore } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';
import { seedProfiles, resetProfileFixture, makeProfile, asProfileId } from '../../../../tests/profile-fixture';

// EventContextButton reads usePermissions (useQuery) unconditionally, same as
// the sibling event-action buttons (EventDeleteButton, EventCard tests).
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Stub the data hook: this task tests the shell, Task 5 tests the rows.
vi.mock('../../../../hooks/useEventsAround', () => ({
  useEventsAround: () => ({
    rows: [],
    monitorNames: new Map(),
    anchorMs: 0,
    isLoading: false,
    error: null,
    truncated: false,
    available: { linked: false, group: false },
    window: { startDateTime: '', endDateTime: '', anchorMs: 0 },
  }),
}));

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
    expect(screen.getByTestId('event-context-panel')).toBeInTheDocument();
    expect(screen.getByTestId('event-context-anchor')).toHaveTextContent('Front Door');
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

  it('opens on the anchor profile\'s own saved window and scope', () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 30, scope: 'linked' } } } });
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'true');
  });

  it('re-seeds from the newly opened profile, not whatever the panel showed before', () => {
    seedProfiles([makeProfile('p1'), makeProfile('p2')], {
      settings: {
        p1: { eventContext: { windowMinutes: 10, scope: 'all' } },
        p2: { eventContext: { windowMinutes: 60, scope: 'group' } },
      },
    });
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextButton event={event2} profileId={P2} />
        <EventContextPanel />
      </>
    );
    const [openP1, openP2] = screen.getAllByTestId('event-context-open');

    fireEvent.click(openP1);
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));

    fireEvent.click(openP2);
    expect(screen.getByTestId('event-context-window-60')).toHaveAttribute('aria-pressed', 'true');
  });
});
