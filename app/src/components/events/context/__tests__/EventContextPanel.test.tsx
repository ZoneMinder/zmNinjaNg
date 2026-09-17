import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEventContextStore } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';

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

afterEach(() => useEventContextStore.getState().closePanel());

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
});
