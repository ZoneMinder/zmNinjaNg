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
    linkedFilter: 'all' as const,
    onLinkedFilterChange: vi.fn(),
  };
}

// Typing a date used to reach the page on every keystroke, and later on every
// blur. Either way the page started a new events query, came back pending with
// no rows, swapped in its loading skeleton and tore this panel down mid-edit -
// so a character was lost, and moving from the start field to the end field
// reloaded the page under the user (refs #495).
// ZoneMinder records a linked monitor whenever its partner alarms. Some people
// want only those events, most want them out of the way (refs #493).
describe('EventsFilterPopover linked events row (refs #493)', () => {
  it('marks the chosen option pressed and the others not', () => {
    render(<EventsFilterPopover {...baseProps()} linkedFilter="hide" />);

    expect(screen.getByTestId('events-linked-hide')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('events-linked-all')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('events-linked-only')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the option that was pressed', async () => {
    const onLinkedFilterChange = vi.fn();
    render(<EventsFilterPopover {...baseProps()} onLinkedFilterChange={onLinkedFilterChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-linked-only'));

    expect(onLinkedFilterChange).toHaveBeenCalledWith('only');
  });

  it('does not report the option that is already chosen', async () => {
    const onLinkedFilterChange = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        linkedFilter="only"
        onLinkedFilterChange={onLinkedFilterChange}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-linked-only'));

    expect(onLinkedFilterChange).not.toHaveBeenCalled();
  });
});

describe('EventsFilterPopover date editing (refs #495)', () => {
  it('reports nothing while a date is typed', async () => {
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
  });

  it('reports nothing when focus moves from the start field to the end field', async () => {
    const onStartDateChange = vi.fn();
    const onEndDateChange = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        startDateInput="2026-09-12T09:35:40"
        endDateInput="2026-09-13T09:35:40"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />
    );

    const user = userEvent.setup();
    const start = screen.getByTestId('events-start-date') as HTMLInputElement;
    await user.clear(start);
    await user.type(start, '2026-12-12T09:35:40');
    await user.click(screen.getByTestId('events-end-date'));

    expect(onStartDateChange).not.toHaveBeenCalled();
    expect(onEndDateChange).not.toHaveBeenCalled();
  });

  it('reports both dates when Apply is pressed, and applies that range', async () => {
    const onStartDateChange = vi.fn();
    const onEndDateChange = vi.fn();
    const onApplyFilters = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        startDateInput="2026-09-12T09:35:40"
        endDateInput="2026-09-13T09:35:40"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
        onApplyFilters={onApplyFilters}
      />
    );

    const user = userEvent.setup();
    const start = screen.getByTestId('events-start-date') as HTMLInputElement;
    await user.clear(start);
    await user.type(start, '2026-12-12T09:35:40');
    await user.click(screen.getByTestId('events-apply-filters'));

    expect(onStartDateChange).toHaveBeenCalledWith(expect.stringContaining('2026-12-12'));
    expect(onEndDateChange).not.toHaveBeenCalled();
    expect(onApplyFilters).toHaveBeenCalledWith({
      startDateTime: expect.stringContaining('2026-12-12'),
      endDateTime: expect.stringContaining('2026-09-13'),
    });
  });

  it('reports the date when Enter is pressed in the field', async () => {
    const onStartDateChange = vi.fn();
    const onApplyFilters = vi.fn();
    render(
      <EventsFilterPopover
        {...baseProps()}
        startDateInput="2026-09-12T09:35:40"
        onStartDateChange={onStartDateChange}
        onApplyFilters={onApplyFilters}
      />
    );

    const user = userEvent.setup();
    const start = screen.getByTestId('events-start-date') as HTMLInputElement;
    await user.clear(start);
    await user.type(start, '2026-12-12T09:35:40{Enter}');

    expect(onStartDateChange).toHaveBeenCalledWith(expect.stringContaining('2026-12-12'));
    expect(onApplyFilters).toHaveBeenCalled();
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

// Chromium draws a calendar button on these inputs but will not open its
// chooser from it while they sit inside the Radix popover layer - the same
// fields in the timeline's plain panel open it fine, and showPicker() called
// from here works. So the panel hides the browser's dead button and offers its
// own (refs #507).
describe('EventsFilterPopover date picker button', () => {
  const clickPickerButton = async (buttonId: string, fieldId: string) => {
    const field = screen.getByTestId(fieldId) as HTMLInputElement;
    const showPicker = vi.fn();
    (field as unknown as { showPicker: () => void }).showPicker = showPicker;
    await userEvent.setup().click(screen.getByTestId(buttonId));
    return showPicker;
  };

  it('opens the picker for the start field', async () => {
    render(<EventsFilterPopover {...baseProps()} startDateInput="2026-09-12T09:35:40" />);

    expect(await clickPickerButton('events-start-date-picker', 'events-start-date'))
      .toHaveBeenCalledTimes(1);
  });

  it('opens the picker for the end field', async () => {
    render(<EventsFilterPopover {...baseProps()} endDateInput="2026-09-13T09:35:40" />);

    expect(await clickPickerButton('events-end-date-picker', 'events-end-date'))
      .toHaveBeenCalledTimes(1);
  });

  it('leaves the other field alone, so each button opens its own date', async () => {
    render(
      <EventsFilterPopover
        {...baseProps()}
        startDateInput="2026-09-12T09:35:40"
        endDateInput="2026-09-13T09:35:40"
      />
    );

    const start = screen.getByTestId('events-start-date') as HTMLInputElement;
    const startPicker = vi.fn();
    (start as unknown as { showPicker: () => void }).showPicker = startPicker;

    expect(await clickPickerButton('events-end-date-picker', 'events-end-date')).toHaveBeenCalled();
    expect(startPicker).not.toHaveBeenCalled();
  });

  it('names each button for a screen reader', () => {
    render(<EventsFilterPopover {...baseProps()} />);

    expect(screen.getByTestId('events-start-date-picker')).toHaveAccessibleName();
    expect(screen.getByTestId('events-end-date-picker')).toHaveAccessibleName();
  });
});
