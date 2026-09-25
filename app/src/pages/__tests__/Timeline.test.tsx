import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Timeline from '../Timeline';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { ALL_PROFILES_ID } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const useTimelineDataMock = vi.fn();
const useScopedTimelineEventsMock = vi.fn();

// usePermissions and useProfileScope now run for real, against the seeded
// profile/settings/auth stores (refs the real-store migration). The
// permission probe resolves without a network call when the seeded profile
// has no username (fetchAccountPermissions short-circuits to
// UNRESTRICTED_PERMISSIONS), so no route needs scripting here.

vi.mock('../../hooks/useTimelineData', () => ({
  useTimelineData: (opts: unknown) => useTimelineDataMock(opts),
}));
vi.mock('../../hooks/useScopedTimelineEvents', () => ({
  useScopedTimelineEvents: (opts: unknown) => useScopedTimelineEventsMock(opts),
}));
vi.mock('../../hooks/useTimelineFilters', () => ({
  useTimelineFilters: () => ({
    selectedMonitorIds: [],
    startDateInput: '',
    endDateInput: '',
    onlyDetectedObjects: false,
    causeFilter: '',
    activeQuickRange: null,
    setSelectedMonitorIds: vi.fn(),
    setStartDateInput: vi.fn(),
    setEndDateInput: vi.fn(),
    setOnlyDetectedObjects: vi.fn(),
    setCauseFilter: vi.fn(),
    setActiveQuickRange: vi.fn(),
    clearFilters: vi.fn(),
    activeFilterCount: 0,
  }),
}));

vi.mock('../../hooks/useTvKeyHandler', () => ({ useTvKeyHandler: () => {} }));
const scopedTagsByKey = vi.fn(() => new Map<string, Array<{ Id: string; Name: string }>>());
vi.mock('../../hooks/useScopedEventTags', () => ({
  useScopedEventTagMapping: () => ({
    eventTagMap: scopedTagsByKey(),
    // Keyed the way the real hook keys it, so the page has to hand over the
    // OWNING profile for the lookup to hit.
    getTagsForEvent: (profileId: string | undefined, eventId: string) =>
      scopedTagsByKey().get(profileId ? `${profileId}:${eventId}` : eventId) ?? [],
  }),
}));

type StubEvent = { id: string; monitorId: string; profileId?: string };
vi.mock('../../components/timeline/TimelineCanvas', () => ({
  TimelineCanvas: (
    { monitors, events, onEventClick, onScrubberEventTap }: {
      monitors: Array<{ id: string; name: string; profileChip?: string; serverStart?: boolean }>;
      events: StubEvent[];
      onEventClick?: (ev: StubEvent) => void;
      onScrubberEventTap?: (eventId: string, profileId?: string) => void;
    }
  ) => (
    <div data-testid="timeline-canvas-stub">
      <span data-testid="timeline-canvas-event-count">{events.length}</span>
      {monitors.map((m) => (
        <div key={m.id} data-testid={`timeline-monitor-row-${m.id}`} data-server-start={String(!!m.serverStart)}>
          {m.name}
          {m.profileChip && <span data-testid="timeline-row-profile-chip">{m.profileChip}</span>}
        </div>
      ))}
      {events.map((e, i) => (
        <button
          key={`${e.id}-${i}`}
          type="button"
          data-testid={`timeline-canvas-event-${e.id}-${i}`}
          data-monitor-id={e.monitorId}
          onClick={() => onEventClick?.(e)}
        >
          {e.monitorId}
        </button>
      ))}
      {/* Stand-in for a scrubber thumbnail tap: carries the event's own
          profileId straight through, exactly like the real ScrubberThumbnail
          (refs #337 Task 3) - never a reverse by-id lookup. */}
      {events.map((e, i) => (
        <button
          key={`scrub-${e.id}-${i}`}
          type="button"
          data-testid={`scrubber-tap-stub-${e.id}-${i}`}
          onClick={() => onScrubberEventTap?.(e.id, e.profileId)}
        >
          tap
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../../components/timeline/TimelineFiltersPanel', () => ({
  TimelineFiltersPanel: () => <div data-testid="timeline-filters-panel-stub" />,
}));
vi.mock('../../components/timeline/TimelineToolbar', () => ({
  TimelineToolbar: () => <div data-testid="timeline-toolbar-stub" />,
}));
vi.mock('../../components/timeline/TimelineStats', () => ({
  TimelineStats: () => <div data-testid="timeline-stats-stub" />,
}));
vi.mock('../../components/timeline/DetectionFilterTabs', () => ({
  DetectionFilterTabs: () => <div data-testid="detection-filter-tabs-stub" />,
  categorizeEvent: () => 'all',
}));
vi.mock('../../components/timeline/EventPreviewPopover', () => ({
  EventPreviewPopover: (
    { event, onOpenEvent }: { event: { id: string; monitorId: string; tags?: string[] }; onOpenEvent: (eventId: string) => void }
  ) => (
    <div
      data-testid="event-preview-popover-stub"
      data-monitor-id={event.monitorId}
      data-tags={(event.tags ?? []).join(',')}
    >
      <button type="button" data-testid="event-preview-popover-open" onClick={() => onOpenEvent(event.id)}>
        open
      </button>
    </div>
  ),
}));

const navigateMock = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ key: 'k', state: {} }),
}));

function defaultSingle() {
  return {
    data: { events: [] },
    isLoading: false,
    error: null,
    enabledMonitors: [],
    allTimelineEvents: [],
    eventIds: [],
    rawEventMap: new Map(),
  };
}

function defaultScoped() {
  return {
    isLoading: false,
    errors: [],
    enabledMonitors: [],
    events: [],
    rawEvents: [],
    eventIds: [],
    refetchProfile: vi.fn(),
  };
}

function renderTimeline() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Timeline />
    </QueryClientProvider>
  );
}

describe('Timeline Page', () => {
  beforeEach(() => {
    scopedTagsByKey.mockReset();
    scopedTagsByKey.mockReturnValue(new Map());
    useTimelineDataMock.mockReset();
    useScopedTimelineEventsMock.mockReset();
    navigateMock.mockClear();
    useTimelineDataMock.mockReturnValue(defaultSingle());
    useScopedTimelineEventsMock.mockReturnValue(defaultScoped());
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('single mode renders via useTimelineData with no aggregation', () => {
    seedProfiles(['profile-1']);
    useTimelineDataMock.mockReturnValue({
      ...defaultSingle(),
      enabledMonitors: [{ Monitor: { Id: '1', Name: 'Front Door' } }],
      allTimelineEvents: [{ id: 'e1', monitorId: '1', startMs: 1000, endMs: 2000, cause: 'Motion', alarmRatio: 0.5, notes: '' }],
    });

    renderTimeline();

    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('1');
    expect(screen.getByTestId('timeline-monitor-row-1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('timeline-row-profile-chip')).not.toBeInTheDocument();
  });

  it('All mode aggregates both profiles\' bands via useScopedTimelineEvents, each chip\'d with its owning profile', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam' } } },
      ],
      events: [
        { id: 'a1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'b1', monitorId: '2', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    renderTimeline();

    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('2');
    // All mode rows/events key by the composite `${profileId}:${monitorId}`
    // (refs #337 I4) even when ids don't collide - single mode stays bare.
    expect(screen.getByTestId('timeline-monitor-row-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('timeline-monitor-row-profile-2:2')).toHaveTextContent('Lobby Cam');
    expect(screen.getByTestId('timeline-canvas-event-a1-0')).toHaveAttribute('data-monitor-id', 'profile-1:1');
    expect(screen.getByTestId('timeline-canvas-event-b1-1')).toHaveAttribute('data-monitor-id', 'profile-2:2');
    const chips = screen.getAllByTestId('timeline-row-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('All mode keeps colliding monitor ids across profiles as distinct rows with events attributed correctly (refs #337 I4)', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '3', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '3', Name: 'Back Door' } } },
      ],
      events: [
        { id: 'a1', monitorId: '3', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'b1', monitorId: '3', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    renderTimeline();

    // Two distinct rows despite the shared bare monitor id "3".
    expect(screen.getByTestId('timeline-monitor-row-profile-1:3')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('timeline-monitor-row-profile-2:3')).toHaveTextContent('Back Door');
    // Each event still points at its own owning profile's row.
    expect(screen.getByTestId('timeline-canvas-event-a1-0')).toHaveAttribute('data-monitor-id', 'profile-1:3');
    expect(screen.getByTestId('timeline-canvas-event-b1-1')).toHaveAttribute('data-monitor-id', 'profile-2:3');
  });

  it('All mode opens the correct owning profile\'s route for colliding event ids (refs #337 I5)', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam' } } },
      ],
      events: [
        { id: 'dup1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'dup1', monitorId: '2', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    renderTimeline();

    // Click the SECOND event (profile-2's "dup1"), then open it.
    fireEvent.click(screen.getByTestId('timeline-canvas-event-dup1-1'));
    fireEvent.click(screen.getByTestId('event-preview-popover-open'));

    expect(navigateMock).toHaveBeenCalledWith('/all/events/profile-2/dup1', expect.anything());
  });

  it('All mode shows the tags of the profile that owns the clicked event (refs #337 D4)', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    // Both servers have an event "dup1" and both have tagged it - differently.
    scopedTagsByKey.mockReturnValue(
      new Map([
        ['profile-1:dup1', [{ Id: '4', Name: 'person' }]],
        ['profile-2:dup1', [{ Id: '9', Name: 'vehicle' }]],
      ])
    );
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam' } } },
      ],
      events: [
        { id: 'dup1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'dup1', monitorId: '2', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    renderTimeline();

    // Click the SECOND event (profile-2's "dup1"): it must show ITS server's
    // tag, not the other server's, and not the empty list All mode used to
    // hard-code here.
    fireEvent.click(screen.getByTestId('timeline-canvas-event-dup1-1'));
    expect(screen.getByTestId('event-preview-popover-stub')).toHaveAttribute('data-tags', 'vehicle');
  });

  it('a scrubber tap on a colliding event id opens the tapped event\'s OWN owning profile\'s route (refs #337 Task 3)', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam' } } },
      ],
      events: [
        { id: 'dup1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'dup1', monitorId: '2', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    renderTimeline();

    // Tap the SECOND event's scrubber stand-in (profile-2's "dup1") directly
    // - never via handleOpenEvent's popover-selection path.
    fireEvent.click(screen.getByTestId('scrubber-tap-stub-dup1-1'));

    expect(navigateMock).toHaveBeenCalledWith('/all/events/profile-2/dup1', expect.anything());
  });

  it('All mode shows a retry-able error strip for a failed profile while the healthy one still renders bands', () => {
    seedProfiles([
      makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
      makeProfile('profile-2', { name: 'Office', timezone: 'America/New_York' }),
    ], { current: ALL_PROFILES_ID });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
      ],
      events: [
        { id: 'a1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('down') }],
    });

    renderTimeline();

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('1');
  });

  // Group by server (refs #529): rows are already one server after another,
  // so the toggle marks where each server starts instead of repeating its
  // chip on every row.
  describe('grouped by server', () => {
    function seedTwoServers() {
      seedProfiles([
        makeProfile('profile-1', { name: 'Home', timezone: 'UTC' }),
        makeProfile('profile-2', { name: 'Office', timezone: 'UTC' }),
      ], { current: ALL_PROFILES_ID });
      const ev = (id: string, monitorId: string, profileId: string, profileChip: string) =>
        ({ id, monitorId, startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId, profileChip });
      useScopedTimelineEventsMock.mockReturnValue({
        ...defaultScoped(),
        enabledMonitors: [
          { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
          { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '2', Name: 'Porch' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '1', Name: 'Lobby Cam' } } },
        ],
        events: [
          ev('a1', '1', 'profile-1', 'Home'),
          ev('a2', '2', 'profile-1', 'Home'),
          ev('b1', '1', 'profile-2', 'Office'),
        ],
      });
    }

    it('names each server once, on its first row, and marks where the next server starts', () => {
      seedTwoServers();
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsGroupByServer: true });

      renderTimeline();

      const rows = ['profile-1:1', 'profile-1:2', 'profile-2:1'].map((id) => screen.getByTestId(`timeline-monitor-row-${id}`));
      expect(rows.map((r) => r.textContent)).toEqual(['Front DoorHome', 'Porch', 'Lobby CamOffice']);
      expect(rows.map((r) => r.getAttribute('data-server-start'))).toEqual(['false', 'false', 'true']);
    });

    it('keeps a chip on every row with the toggle off', () => {
      seedTwoServers();

      renderTimeline();

      const chips = screen.getAllByTestId('timeline-row-profile-chip');
      expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Home', 'Office']);
    });

    it('writes the toggle to the aggregate bucket', () => {
      seedTwoServers();
      renderTimeline();
      const toggle = screen.getByTestId('timeline-group-by-server');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggle);
      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).eventsGroupByServer).toBe(true);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });

    it('offers no toggle for a single profile', () => {
      seedProfiles([makeProfile('profile-1', { name: 'Home', timezone: 'UTC' })]);
      useTimelineDataMock.mockReturnValue(defaultSingle());
      renderTimeline();
      expect(screen.queryByTestId('timeline-group-by-server')).not.toBeInTheDocument();
    });
  });
});
