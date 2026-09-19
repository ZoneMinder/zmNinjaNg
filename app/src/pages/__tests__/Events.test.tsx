import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import Events from '../Events';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';
import { eventInstant } from '../../lib/event/event-instant';
import type { EventData } from '../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | object)[] }) => useQueryMock(options),
  keepPreviousData: (previousData: unknown) => previousData,
}));

const useScopedEventsMock = vi.fn();
const useScopedMonitorsMock = vi.fn();

// The fan-out itself is covered in useScopedEventTags' own suite; stubbed
// here so this page suite keeps its narrow react-query mock. The returned map
// is keyed the way the real hook keys it, so the page's own lookup is still
// under test.
const eventTagMapMock = vi.fn(() => new Map<string, Array<{ Id: string; Name: string }>>());
const availableTagsMock = vi.fn(() => [] as Array<{ Id: string; Name: string }>);
vi.mock('../../hooks/useScopedEventTags', () => ({
  useScopedTags: () => ({
    availableTags: availableTagsMock(),
    tagsSupported: true,
    isLoadingTags: false,
    resolveOwnTagIds: (t: string[]) => t,
  }),
  useScopedEventTagMapping: () => ({ eventTagMap: eventTagMapMock(), getTagsForEvent: () => [] }),
}));
vi.mock('../../hooks/useScopedEvents', () => ({
  useScopedEvents: (options: unknown) => useScopedEventsMock(options),
}));
vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => useScopedMonitorsMock(),
}));
// useProfileScope, stores/profile, stores/auth and stores/settings now run
// for real, against the seeded profile/settings/auth stores (singleScope()/
// allScope() below) - useCurrentProfile's isAllMode and useProfileScope's
// mode agree because both derive from the same real currentProfileId.

const applyFilters = vi.fn();
const setStartDateInput = vi.fn();
const setEndDateInput = vi.fn();
const clearFilters = vi.fn();
const clearDateRange = vi.fn();

// Mutable per-test overrides for the fields the clear-date-range render condition
// depends on (startDateInput / endDateInput / activeQuickRange). A monitor card's
// Events link deep-links to ?monitorId=<id>&startDateTime=<watermark>, which
// useEventFilters hydrates into startDateInput with activeQuickRange left null
// (see the "hydrates startDateInput from a deep-linked date" test in
// hooks/__tests__/useEventFilters.test.ts, which covers that hydration against the
// real hook). Controlling the three fields directly here exercises the same
// downstream state without re-parsing a URL through this file's other mocks.
let favoritesOnlyOverride = false;
let eventFiltersOverrides: {
  startDateInput?: string;
  endDateInput?: string;
  activeQuickRange?: number | null;
  selectedTagIds?: string[];
} = {};

vi.mock('../../hooks/useEventFilters', () => ({
  ALL_TAGS_FILTER_ID: '__all_tags__',
  useEventFilters: () => ({
    filters: {},
    selectedMonitorIds: [],
    selectedTagIds: [],
    startDateInput: '',
    endDateInput: '',
    favoritesOnly: favoritesOnlyOverride,
    activeQuickRange: null,
    setSelectedMonitorIds: vi.fn(),
    setSelectedTagIds: vi.fn(),
    setStartDateInput,
    setEndDateInput,
    setFavoritesOnly: vi.fn(),
    setActiveQuickRange: vi.fn(),
    applyFilters,
    clearFilters,
    clearDateRange,
    activeFilterCount: 0,
    ...eventFiltersOverrides,
  }),
}));

vi.mock('../../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
    threshold: 0,
    bind: () => ({}),
  }),
}));

vi.mock('../../components/events/EventCard', () => ({
  EventCard: ({ event, monitorName, profileChip, tags }: { event: { Id: string }; monitorName: string; profileChip?: string; tags?: Array<{ Name: string }> }) => (
    <div data-testid="event-card-item">
      {event.Id}-{monitorName}
      {profileChip && <span data-testid="event-card-profile-chip">{profileChip}</span>}
      {tags?.map((t) => <span key={t.Name} data-testid="event-card-tag">{t.Name}</span>)}
    </div>
  ),
}));

vi.mock('../../components/events/EventHeatmap', () => ({
  EventHeatmap: ({ startDate, endDate }: { startDate?: Date; endDate?: Date }) => (
    <div
      data-testid="event-heatmap"
      data-start={startDate?.getTime() ?? ''}
      data-end={endDate?.getTime() ?? ''}
    />
  ),
}));

vi.mock('../../components/events/EventMontageView', () => ({
  EventMontageView: () => <div data-testid="events-montage-grid" />,
}));

vi.mock('../../components/filters/MonitorFilterPopover', () => ({
  MonitorFilterPopoverContent: () => <div data-testid="monitor-filter" />,
}));

// Inert unless clicked: the range it reports is fixed, so a test can assert
// exactly what the page writes into the date inputs (refs #495).
vi.mock('../../components/ui/quick-date-range-buttons', () => ({
  QuickDateRangeButtons: ({ onRangeSelect }: { onRangeSelect: (r: { start: Date; end: Date; hours: number }) => void }) => (
    <button
      data-testid="quick-range"
      onClick={() => onRangeSelect({ start: new Date('2026-08-03T06:04:07'), end: new Date('2026-08-03T10:04:09'), hours: 4 })}
    >
      range
    </button>
  ),
}));

vi.mock('../../components/ui/pull-to-refresh-indicator', () => ({
  PullToRefreshIndicator: () => <div data-testid="pull-indicator" />,
}));

vi.mock('../../components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

let mockSearchParams = new URLSearchParams();
const setSearchParamsMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: {} }),
  useSearchParams: () => [mockSearchParams, setSearchParamsMock],
}));

const profileA = { id: asProfileId('profile-1'), name: 'Home', portalUrl: 'https://a', apiUrl: 'https://a/api', timezone: 'UTC' };
const profileB = { id: asProfileId('profile-2'), name: 'Office', portalUrl: 'https://b', apiUrl: 'https://b/api', timezone: 'America/New_York' };

function singleScope() {
  seedProfiles([makeProfile('profile-1', profileA)], { current: 'profile-1' });
}

function allScope() {
  seedProfiles(
    [makeProfile('profile-1', profileA), makeProfile('profile-2', profileB)],
    { current: ALL_PROFILES_ID }
  );
}

function scopedEvents(overrides: Partial<ReturnType<typeof defaultScopedEvents>> = {}) {
  useScopedEventsMock.mockReturnValue({ ...defaultScopedEvents(), ...overrides });
}

function defaultScopedEvents() {
  return {
    events: [] as Array<{ profileId: string; profileName: string; item: { Event: { Id: string; MonitorId: string; StartDateTime?: string } } }>,
    errors: [] as Array<{ profileId: string; profileName: string; error: unknown }>,
    isLoading: false,
    isFetching: false,
    totalCount: undefined as number | undefined,
    totalCountByProfile: {} as Record<string, number>,
    refetchProfile: vi.fn(),
    refetchAll: vi.fn(async () => {}),
  };
}

describe('Events Page', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'monitors') {
        return { data: { monitors: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'tags') {
        return { data: { tags: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'eventTags') {
        return { data: new Map(), isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });
    eventTagMapMock.mockReset();
    eventTagMapMock.mockReturnValue(new Map());
    availableTagsMock.mockReset();
    availableTagsMock.mockReturnValue([]);
    useScopedEventsMock.mockReset();
    useScopedMonitorsMock.mockReset();
    useScopedMonitorsMock.mockReturnValue({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() });
    singleScope();
    scopedEvents();
    applyFilters.mockClear();
    setStartDateInput.mockClear();
    setEndDateInput.mockClear();
    clearFilters.mockClear();
    clearDateRange.mockClear();
    setSearchParamsMock.mockClear();
    mockSearchParams = new URLSearchParams();
    eventFiltersOverrides = {};
    favoritesOnlyOverride = false;
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // A quick range populates the two date inputs, which carry step="1". Writing
  // minute precision there made the value change shape on the first keystroke,
  // and the browser dropped the segment being edited: typing 30 landed 03
  // (refs #495).
  it('writes the quick range into the date inputs at the precision they report', () => {
    render(<Events />);

    fireEvent.click(screen.getAllByTestId('quick-range')[0]);

    expect(setStartDateInput).toHaveBeenCalledWith('2026-08-03T06:04:07');
    expect(setEndDateInput).toHaveBeenCalledWith('2026-08-03T10:04:09');
  });

  it('shows empty state when no events exist', () => {
    render(<Events />);
    expect(screen.getByTestId('events-empty-state')).toHaveTextContent('events.no_events');
  });

  it('renders event list when events are available', () => {
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '100', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'monitors') {
        return {
          data: { monitors: [{ Monitor: { Id: '1', Name: 'Front Door', Deleted: false } }] },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'tags') {
        return { data: { tags: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'eventTags') {
        return { data: new Map(), isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<Events />);

    expect(screen.getByTestId('event-list')).toHaveTextContent('100-Front Door');
    expect(screen.getByTestId('event-card-item')).toHaveTextContent('100-Front Door');
  });

  it('applies and clears filters from the filter panel', async () => {
    render(<Events />);

    expect(screen.getByTestId('events-filter-panel')).toHaveTextContent('common.filter');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-apply-filters'));
    await user.click(screen.getByTestId('events-clear-filters'));

    expect(applyFilters).toHaveBeenCalled();
    expect(clearFilters).toHaveBeenCalled();
  });

  // refs #239: a monitor card's Events button deep-links to
  // ?monitorId=<id>&startDateTime=<watermark>, which hydrates startDateInput while
  // leaving activeQuickRange null (verified against the real hook in
  // hooks/__tests__/useEventFilters.test.ts). The clear-date button must still show
  // up in that case, not only when a quick-range chip set activeQuickRange.
  it('shows the clear-date button for a URL-driven date range with no active quick range', () => {
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.getByTestId('events-clear-quick-range')).toHaveAttribute('title', 'common.clear');
  });

  it('hides the clear-date button when no date range and no quick range are active', () => {
    eventFiltersOverrides = { startDateInput: '', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.queryByTestId('events-clear-quick-range')).not.toBeInTheDocument();
  });

  it('clicking the clear-date button calls clearDateRange, which preserves monitorId (refs #194)', async () => {
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-clear-quick-range'));

    expect(clearDateRange).toHaveBeenCalled();
    // clearDateRange itself (not this button) is what preserves monitorId; that
    // contract is covered directly in useEventFilters.test.ts's
    // "clearDateRange (refs #194)" describe block.
  });

  it('single mode calls useScopedEvents for its data with no refetchInterval passed (no polling, refs #337)', () => {
    render(<Events />);

    expect(useScopedEventsMock).toHaveBeenCalled();
    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { refetchInterval?: number } | undefined;
    expect(options?.refetchInterval).toBeUndefined();
  });

  // "All tags" expands to every available tag id. When that list is empty -
  // cold load, a failed /tags request, a server without tag support - the
  // expansion produces [], which is a truthy filter meaning "matches nothing",
  // so the list would go silently empty with no banner explaining why. Single
  // mode too, not just All mode.
  it('sends no tag filter when "All tags" is selected but no tags have loaded', () => {
    eventFiltersOverrides = { selectedTagIds: ['__all_tags__'] };
    availableTagsMock.mockReturnValue([]);

    render(<Events />);

    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { tagIdsByProfile?: unknown };
    expect(options?.tagIdsByProfile).toBeUndefined();
  });

  it('expands "All tags" to every loaded tag id when there are some', () => {
    eventFiltersOverrides = { selectedTagIds: ['__all_tags__'] };
    availableTagsMock.mockReturnValue([{ Id: '1', Name: 'person' }, { Id: '2', Name: 'cat' }]);

    render(<Events />);

    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { tagIdsByProfile?: Record<string, string[]> };
    expect(options?.tagIdsByProfile).toEqual({ 'profile-1': ['1', '2'] });
  });

  it('single mode leaves the montage toggle enabled with no gate notice (refs #337 fix round 1)', () => {
    render(<Events />);

    expect(screen.getByTestId('events-view-toggle')).not.toBeDisabled();
    expect(screen.queryByTestId('events-montage-gate')).not.toBeInTheDocument();
  });

  // refs #337 round 2: the I9 fix dropped the persisted write for the
  // ?view=montage deep link but left the settings-sync effect (which also
  // fires on mount) free to immediately overwrite the deep link's
  // setViewMode('montage') with the persisted (list) preference - a
  // same-mount race that silently broke the deep link.
  it('a ?view=montage deep link renders montage without a persisted write, surviving the settings-sync effect on the same mount (refs #337 round 2)', () => {
    mockSearchParams = new URLSearchParams('view=montage');
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);

    // EventMontageView is mocked to a bare decorative div (no text/attrs); its
    // presence vs. the list view's is the only observable signal, so pair it
    // with the list view's absence to pin down which branch actually rendered.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
    // The deep link rendered montage without ever persisting it: the stored
    // preference is still the default ('list'), not overwritten to 'montage'.
    expect(useSettingsStore.getState().getProfileSettings('profile-1').eventsViewMode).toBe('list');
  });

  // viewMode is derived from the ?view param and the persisted preference, so
  // switching back to list is entirely the two writes below: nothing else
  // clears the param, and leaving it set would pin the page in montage while
  // the toggle claims to have switched.
  it('switching back to list both persists list and clears the ?view param', () => {
    useSettingsStore.getState().updateProfileSettings('profile-1', { eventsViewMode: 'montage' });
    mockSearchParams = new URLSearchParams('view=montage&monitorId=4');
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);
    // Precondition: the page really is in montage, so the click below means
    // "switch to list" rather than "switch to montage". EventMontageView is a
    // bare decorative mock, so pair its presence with the list view's absence.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('events-view-toggle'));

    expect(useSettingsStore.getState().getProfileSettings('profile-1').eventsViewMode).toBe('list');
    const nextParams = setSearchParamsMock.mock.calls.at(-1)?.[0] as URLSearchParams;
    expect(nextParams.get('view')).toBeNull();
    // The other filters ride along in the same object and must survive.
    expect(nextParams.get('monitorId')).toBe('4');
  });

  it('settings-sync still applies the persisted view when no ?view param is present (refs #337 round 2)', () => {
    useSettingsStore.getState().updateProfileSettings('profile-1', { eventsViewMode: 'montage' });
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);

    // EventMontageView is mocked to a bare decorative div (no text/attrs);
    // pair its presence with the list view's absence to confirm the
    // persisted setting actually won the branch, not just that something rendered.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
  });

  describe('All mode', () => {
    it('renders both profiles\' events with a profile chip per row', () => {
      allScope();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(2);
      const chips = screen.getAllByTestId('event-card-profile-chip');
      expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
    });

    it('tags a colliding event id from the server that owns it (refs #337 D4)', () => {
      allScope();
      // Both servers have an event 1. Before the fan-out, tags in All mode
      // were fetched from the current profile only (there is none) and looked
      // up by bare event id, so one server's tags could land on the other
      // server's row.
      eventTagMapMock.mockReturnValue(
        new Map([
          ['profile-1:1', [{ Id: '4', Name: 'person' }]],
          ['profile-2:1', [{ Id: '9', Name: 'vehicle' }]],
        ])
      );
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 09:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards[0]).toHaveTextContent('person');
      expect(cards[0]).not.toHaveTextContent('vehicle');
      expect(cards[1]).toHaveTextContent('vehicle');
      expect(cards[1]).not.toHaveTextContent('person');
    });

    // ZoneMinder cannot combine its Tags.Id: filter with the favorites Id IN:
    // query, so that one combination falls to a client-side pass. In All mode
    // the selection is tag NAMES (ids differ per server), and matching them
    // against tag.Id there drops every row.
    it('matches the favorites+tags client pass by tag name in All mode (refs #337 D4)', () => {
      allScope();
      eventFiltersOverrides = { selectedTagIds: ['person'] };
      favoritesOnlyOverride = true;
      eventTagMapMock.mockReturnValue(
        new Map([
          ['profile-1:1', [{ Id: '4', Name: 'person' }]],
          ['profile-2:2', [{ Id: '9', Name: 'vehicle' }]],
        ])
      );
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 09:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('person');
    });

    // heatmapDateRange (the OTHER consumer of event timestamps besides the
    // buckets fixed earlier) must derive its start/end from the same real
    // instants (eventInstant) the buckets use - a naively-derived window can
    // fall short of an instant the buckets would otherwise place inside it,
    // silently dropping that event from the heatmap (refs #337). Goes
    // through the real heatmapDateRange computation (no explicit
    // start/endDateTime filter), not explicit start/end props passed
    // straight to EventHeatmap - that's what the earlier per-widget
    // timezone tests couldn't catch.
    it('heatmapDateRange spans both events\' real instants across two profile timezones', () => {
      allScope();
      const startDateTime = '2026-06-15 06:00:00';
      scopedEvents({
        events: [
          { profileId: profileA.id, profileName: profileA.name, item: { Event: { Id: '1', MonitorId: '1', StartDateTime: startDateTime } } },
          { profileId: profileB.id, profileName: profileB.name, item: { Event: { Id: '2', MonitorId: '1', StartDateTime: startDateTime } } },
        ] as never,
      });

      render(<Events />);

      const heatmap = screen.getByTestId('event-heatmap');
      const rangeStart = Number(heatmap.getAttribute('data-start'));
      const rangeEnd = Number(heatmap.getAttribute('data-end'));

      const instantA = eventInstant({ Event: { StartDateTime: startDateTime } } as EventData, profileA.timezone);
      const instantB = eventInstant({ Event: { StartDateTime: startDateTime } } as EventData, profileB.timezone);
      // America/New_York is 4h behind UTC in June: the two real instants
      // are genuinely 4h apart, not the same millisecond a naive parse of
      // the identical wall-clock string would have produced.
      expect(instantB - instantA).toBe(4 * 60 * 60 * 1000);

      expect(rangeStart).toBeLessThanOrEqual(instantA);
      expect(rangeEnd).toBeGreaterThanOrEqual(instantA);
      expect(rangeStart).toBeLessThanOrEqual(instantB);
      expect(rangeEnd).toBeGreaterThanOrEqual(instantB);
    });

    it('leaves the montage toggle enabled with no gate notice, and renders montage (refs #337 Task 2 fix round 3)', () => {
      allScope();
      mockSearchParams = new URLSearchParams('view=montage');
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
      });

      render(<Events />);

      expect(screen.getByTestId('events-view-toggle')).not.toBeDisabled();
      expect(screen.queryByTestId('events-montage-gate')).not.toBeInTheDocument();
      // EventMontageView is mocked to a bare decorative div (no text/attrs);
      // pair its presence with the list view's absence.
      expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
    });

    it('the server filter chip row hides a profile\'s slice when toggled off', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsServerFilter: [asProfileId('profile-1')] });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('1-');
      expect(screen.getByTestId('events-server-filter-profile-1')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('events-server-filter-profile-2')).toHaveAttribute('aria-pressed', 'false');
    });

    it('drops a deleted profile\'s id from the persisted server filter instead of silently hiding everything (refs #337)', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsServerFilter: [asProfileId('deleted-profile-id')] });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      // The persisted filter named only a profile that no longer exists - that
      // must reconcile to "no filter", not silently hide every real profile.
      expect(screen.getAllByTestId('event-card-item')).toHaveLength(2);
    });

    it('keeps a persisted filter\'s live ids while dropping only the deleted one', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsServerFilter: [asProfileId('profile-1'), asProfileId('deleted-profile-id')] });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('1-');
    });

    it('"Showing X of Y" reflects only the server-filtered profiles, not every profile in scope (refs #337)', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsServerFilter: [asProfileId('profile-1')] });
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
        totalCount: 5,
        totalCountByProfile: { 'profile-1': 1, 'profile-2': 4 },
      });

      render(<Events />);

      expect(screen.getByText('events.showing_of_total:{"showing":1,"total":1}')).toHaveTextContent(
        'events.showing_of_total:{"showing":1,"total":1}'
      );
    });

    it('shows a localized hint instead of the plain empty state when the server filter hides every profile (refs #337)', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsServerFilter: [] });
      scopedEvents({ events: [] });

      render(<Events />);

      expect(screen.getByTestId('events-filter-empty-hint')).toHaveTextContent('events.filter_hides_everything');
      expect(screen.queryByTestId('events-empty-state')).not.toBeInTheDocument();
    });

    it('shows an error strip for a failed profile with zero events while the healthy profile still renders', () => {
      allScope();
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
        errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('down') }],
      });

      render(<Events />);

      expect(screen.getByTestId('profile-error-strip-profile-2')).toHaveTextContent('Office:');
      expect(screen.getByTestId('event-card-item')).toHaveTextContent('1-Camera 1');
      expect(screen.queryByTestId('events-all-failed-state')).not.toBeInTheDocument();
    });

    it('a ?profileId= deep link narrows the view without persisting it (refs #337 I9)', () => {
      allScope();
      mockSearchParams = new URLSearchParams('profileId=profile-2');
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('2-');
      // The deep link filters this render only - it must never write the
      // persisted All-mode server filter, which stays at its default (null).
      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).eventsServerFilter).toBeNull();
    });

    it('shows every server again once the ?profileId= param is gone, with no filter left persisted (refs #337 I9)', () => {
      allScope();
      mockSearchParams = new URLSearchParams();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      expect(screen.getAllByTestId('event-card-item')).toHaveLength(2);
    });

    it('shows the all-failed empty state when every profile errors', () => {
      allScope();
      scopedEvents({
        events: [],
        errors: [
          { profileId: 'profile-1', profileName: 'Home', error: new Error('down') },
          { profileId: 'profile-2', profileName: 'Office', error: new Error('down') },
        ],
      });

      render(<Events />);

      // Confirms the branch that rendered is genuinely the all-failed state,
      // not merely that some empty-state div exists.
      expect(screen.queryByTestId('events-empty-state')).toBeNull();
      expect(screen.getByTestId('events-all-failed-state')).toHaveTextContent('events.all_failed_title');
    });

    it('persists the group-by-server toggle to the aggregate bucket', () => {
      allScope();
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
      });

      render(<Events />);

      const toggle = screen.getByTestId('events-group-by-server');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(toggle);

      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).eventsGroupByServer).toBe(true);
      expect(screen.getByTestId('events-group-by-server')).toHaveAttribute('aria-pressed', 'true');
      // Separate key from the monitors/montage toggle: one must not move the
      // other.
      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).monitorsGroupByServer).toBe(false);
    });

    it('sections the list by owning server when the toggle is on', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsGroupByServer: true });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 12:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 11:00:00' } } },
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '3', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const sections = screen.getAllByTestId(/^events-group-section-/);
      expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
        'events-group-section-profile-1',
        'events-group-section-profile-2',
      ]);
      expect(within(sections[0]).getByTestId('events-group-toggle-profile-1')).toHaveTextContent('Home');
      // Interleaved input: event 3 belongs with event 1 under Home, in the
      // time order it arrived, and event 2 sits alone under Office.
      expect(within(sections[0]).getAllByTestId('event-card-item').map((c) => c.textContent)).toEqual([
        '1-Camera 1Home',
        '3-Camera 1Home',
      ]);
      expect(within(sections[1]).getByTestId('events-group-toggle-profile-2')).toHaveTextContent('Office');
      expect(within(sections[1]).getAllByTestId('event-card-item').map((c) => c.textContent)).toEqual([
        '2-Camera 1Office',
      ]);
      // One count header for the whole view, not one per section.
      expect(screen.getAllByText('events.showing_events:{"count":3}')).toHaveLength(1);
    });

    it('offers a jump button per server, carrying that server\'s count', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsGroupByServer: true });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 12:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 11:00:00' } } },
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '3', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const bar = screen.getByTestId('events-group-jump-bar');
      expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home(2)', 'Office(1)']);
    });

    it('collapsing a server section hides its events and keeps the rest', () => {
      allScope();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsGroupByServer: true });
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 12:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 11:00:00' } } },
        ],
      });

      render(<Events />);

      fireEvent.click(screen.getByTestId('events-group-toggle-profile-1'));

      expect(screen.getAllByTestId('event-card-item').map((c) => c.textContent)).toEqual([
        '2-Camera 1Office',
      ]);
      // Collapsing is not filtering: the header, its count and the page total
      // still cover both servers.
      expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveTextContent('Home');
      expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveTextContent('1');
      expect(screen.getAllByText('events.showing_events:{"count":2}')).toHaveLength(1);
    });

    it('leaves the list unsectioned when the toggle is off', () => {
      allScope();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 12:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 11:00:00' } } },
        ],
      });

      render(<Events />);

      expect(screen.queryAllByTestId(/^events-group-section-/)).toHaveLength(0);
      expect(screen.getAllByTestId('event-card-item').map((c) => c.textContent)).toEqual([
        '1-Camera 1Home',
        '2-Camera 1Office',
      ]);
    });
  });

  it('single profile has no group-by-server toggle', () => {
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);

    // The toolbar rendered (the view toggle is always there); the server
    // toggle is the one that must be absent outside an aggregate.
    expect(screen.getByTestId('events-view-toggle')).toHaveAttribute('aria-label', 'events.view_montage');
    expect(screen.queryByTestId('events-group-by-server')).toBeNull();
  });
});
