/**
 * Composite monitor-id scoping for the All-mode server-grouped filter
 * (refs #337 I6). Two servers can report the same bare monitor id; the
 * selection stored for the filter must be `${profileId}:${monitorId}` so
 * picking a monitor on one server's group never also selects the other
 * server's monitor of the same id.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventsFilterPopover } from '../EventsFilterPopover';
import type { MonitorData } from '../../../api/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../ui/popover', () => ({
  PopoverContent: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
}));
vi.mock('../../ui/quick-date-range-buttons', () => ({ QuickDateRangeButtons: () => <div /> }));

vi.mock('../../filters/MonitorFilterPopover', () => ({
  MonitorFilterPopoverContent: (
    { monitors, selectedMonitorIds, onSelectionChange, idPrefix }: {
      monitors: MonitorData[];
      selectedMonitorIds: string[];
      onSelectionChange: (ids: string[]) => void;
      idPrefix?: string;
    }
  ) => (
    <div data-testid={`monitor-filter-${idPrefix}`}>
      <span data-testid={`selected-${idPrefix}`}>{selectedMonitorIds.join(',')}</span>
      {monitors.map((m) => (
        <button
          key={m.Monitor.Id}
          type="button"
          data-testid={`toggle-${idPrefix}-${m.Monitor.Id}`}
          onClick={() => onSelectionChange([...selectedMonitorIds, m.Monitor.Id])}
        >
          {m.Monitor.Name}
        </button>
      ))}
    </div>
  ),
}));

function monitor(id: string, name: string): MonitorData {
  return { Monitor: { Id: id, Name: name } } as MonitorData;
}

function baseProps() {
  return {
    monitors: [],
    selectedMonitorIds: [] as string[],
    onMonitorSelectionChange: vi.fn(),
    favoritesOnly: false,
    onFavoritesOnlyChange: vi.fn(),
    archivedOnly: false,
    onArchivedOnlyChange: vi.fn(),
    startDateInput: '',
    onStartDateChange: vi.fn(),
    endDateInput: '',
    onEndDateChange: vi.fn(),
    onQuickRangeSelect: vi.fn(),
    onApplyFilters: vi.fn(),
    onClearFilters: vi.fn(),
  };
}

// Typing a date used to reach the page on every keystroke. Each one made a new
// events query, which came back pending with no rows, so the page swapped in
// its loading skeleton and tore the open panel down mid-edit: the field lost
// focus after one character and the next digit went to the Apply button
// (refs #495).
describe('EventsFilterPopover date editing (refs #495)', () => {
  it('holds the typed date locally and reports it once, on blur', async () => {
    const onStartDateChange = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        startDateInput="2026-09-12T09:35:40"
        onStartDateChange={onStartDateChange}
      />
    );

    const user = userEvent.setup();
    const input = screen.getByTestId('events-start-date') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '2026-12-12T09:35:40');

    expect(onStartDateChange).not.toHaveBeenCalled();
    expect(input.value).toContain('2026-12-12');

    await user.tab();

    expect(onStartDateChange).toHaveBeenCalledTimes(1);
    expect(onStartDateChange).toHaveBeenCalledWith(expect.stringContaining('2026-12-12'));
  });

  it('shows a date the page sets while the field is not being edited', () => {
    const { rerender } = render(
      <EventsFilterPopover {...baseProps()} startDateInput="2026-09-12T09:35:40" />
    );
    rerender(<EventsFilterPopover {...baseProps()} startDateInput="2026-08-03T06:04:07" />);

    expect((screen.getByTestId('events-start-date') as HTMLInputElement).value).toContain('2026-08-03');
  });
});

describe('EventsFilterPopover server-grouped monitor selection (refs #337 I6)', () => {
  it('selecting a monitor on one server does not select the other server\'s same-id monitor', async () => {
    const onMonitorSelectionChange = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        onMonitorSelectionChange={onMonitorSelectionChange}
        serverGroups={[
          { profileId: 'profile-a', profileName: 'Home', monitors: [monitor('3', 'Front Door')] },
          { profileId: 'profile-b', profileName: 'Office', monitors: [monitor('3', 'Lobby Cam')] },
        ]}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('toggle-events-profile-a-3'));

    expect(onMonitorSelectionChange).toHaveBeenCalledWith(['profile-a:3']);
  });

  it('each group only shows its own composite selection, stripped of the profile prefix', () => {
    render(
      <EventsFilterPopover
        {...baseProps()}
        selectedMonitorIds={['profile-a:3', 'profile-b:5']}
        serverGroups={[
          { profileId: 'profile-a', profileName: 'Home', monitors: [monitor('3', 'Front Door')] },
          { profileId: 'profile-b', profileName: 'Office', monitors: [monitor('5', 'Lobby Cam')] },
        ]}
      />
    );

    expect(screen.getByTestId('selected-events-profile-a')).toHaveTextContent('3');
    expect(screen.getByTestId('selected-events-profile-b')).toHaveTextContent('5');
  });

  it('a group\'s selection change preserves the other group\'s composite ids untouched', async () => {
    const onMonitorSelectionChange = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        onMonitorSelectionChange={onMonitorSelectionChange}
        selectedMonitorIds={['profile-b:3']}
        serverGroups={[
          { profileId: 'profile-a', profileName: 'Home', monitors: [monitor('3', 'Front Door')] },
          { profileId: 'profile-b', profileName: 'Office', monitors: [monitor('3', 'Lobby Cam')] },
        ]}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('toggle-events-profile-a-3'));

    expect(onMonitorSelectionChange).toHaveBeenCalledWith(['profile-b:3', 'profile-a:3']);
  });
});
