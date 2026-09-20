import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Monitors from '../Monitors';
import { ALL_PROFILES_ID } from '../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';
import { log } from '../../lib/logger';
import { MONTAGE_GRID } from '../../lib/zmninja-ng-constants';
import {
  installMockIntersectionObserver,
  latestIntersectionObserver,
} from '../../tests/mock-intersection-observer';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// usePermissions probes this on mount; the account-permissions boundary
// itself isn't this suite's subject, so it's stubbed to a harmless verdict.
vi.mock('../../api/users', () => ({
  fetchAccountPermissions: vi.fn().mockResolvedValue({ system: 'Edit' }),
}));

// Its own tests cover the button's two gates; stubbing keeps useAssistantEnabled's
// settings-store reads out of this file's mock surface, as with the analysis
// toggle above.
vi.mock('../../components/assistant/NinjiiToolbarButton', () => ({
  NinjiiToolbarButton: () => null,
}));


const useScopedMonitorsMock = vi.fn();

vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => useScopedMonitorsMock(),
}));

vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ isFilterActive: false, filteredMonitorIds: [], isFilterReady: true }),
}));

const useScopedMonitorNewEventsMock = vi.fn();

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  useScopedMonitorNewEvents: () => useScopedMonitorNewEventsMock(),
  scopedMonitorEventKey: (profileId: string, monitorId: string) => `${profileId}:${monitorId}`,
}));

vi.mock('../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/logger')>();
  return { ...actual, log: { ...actual.log, monitor: vi.fn() } };
});

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

vi.mock('../../components/monitors/MonitorCard', () => ({
  MonitorCard: ({
    monitor,
    profileId,
    profileChip,
    newEventCount,
    tileRef,
    paused,
  }: {
    monitor: { Id: string; Name: string };
    profileId?: string;
    profileChip?: string;
    newEventCount?: number;
    tileRef?: (element: HTMLElement | null) => void;
    paused?: boolean;
  }) => (
    // The real card puts tileRef on its own outer element and hands `paused`
    // to the player; both are the seam viewport gating works through, so the
    // double has to expose them or a gating test passes against nothing.
    <div ref={tileRef} data-paused={String(!!paused)} data-testid={`monitor-card-${monitor.Id}`}>
      {monitor.Name}
      {profileChip && <span data-testid="monitor-profile-chip">{profileChip}</span>}
      {newEventCount !== undefined && (
        <span data-testid={`monitor-new-events-badge-${profileId ?? 'single'}-${monitor.Id}`}>
          {newEventCount}
        </span>
      )}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'monitors.count' && params?.count !== undefined) {
        return `count-${params.count}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Its own tests cover the toggle (including how it resolves the page's
// Streaming Mode in All mode); stubbing keeps that resolution's stores out of
// this file's mock surface.
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({
  AnalysisFramesToggle: () => <div data-testid="analysis-frames-toggle-stub" />,
}));

const SETTINGS = {
  monitorsViewMode: 'list' as 'list' | 'grid',
  monitorsFeedFit: 'contain' as const,
  monitorGridCols: 2,
  monitorsGroupByServer: false,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Monitors />
    </QueryClientProvider>
  );
}

function singleProfile(overrides: Partial<typeof SETTINGS> = {}) {
  seedProfiles([makeProfile('profile-1', { name: 'Home' })], {
    current: 'profile-1',
    settings: { 'profile-1': { ...SETTINGS, ...overrides } },
  });
}

function allMode(profileCount: number) {
  const profiles = Array.from({ length: profileCount }, (_, i) => makeProfile(`profile-${i + 1}`));
  seedProfiles(profiles, {
    current: ALL_PROFILES_ID,
    settings: { [ALL_PROFILES_ID]: SETTINGS },
  });
}

describe('Monitors Page', () => {
  beforeEach(() => {
    useScopedMonitorsMock.mockReset();
    useScopedMonitorNewEventsMock.mockReset();
    useScopedMonitorNewEventsMock.mockReturnValue({ counts: {}, newest: {} });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows empty state when no monitors are available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('monitors-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('monitors-empty-state')).toHaveTextContent('monitors.no_cameras');
  });

  it('renders monitor cards when data is available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('monitor-grid')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Back Door');
  });

  it('All mode renders each profile\'s monitors with a profile chip', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Lobby Cam');
    const chips = screen.getAllByTestId('monitor-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('sections the grid by server, and collapsing one hides only its cards', () => {
    allMode(2);
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { monitorsGroupByServer: true });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();
    expect(screen.getByTestId('monitors-group-toggle-profile-1')).toHaveTextContent('Home');
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');

    fireEvent.click(screen.getByTestId('monitors-group-toggle-profile-1'));

    expect(screen.queryByTestId('monitor-card-1')).toBeNull();
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Lobby Cam');
    expect(screen.getByTestId('monitors-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');
  });

  it('All mode renders a distinct new-event count per owning profile for a colliding monitor id', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '1', Name: 'Front Door (Office)', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });
    useScopedMonitorNewEventsMock.mockReturnValue({
      counts: { 'profile-1:1': 2, 'profile-2:1': 7 },
      newest: { 'profile-1:1': 'a', 'profile-2:1': 'b' },
    });

    renderPage();

    expect(screen.getByTestId('monitor-new-events-badge-profile-1-1')).toHaveTextContent('2');
    expect(screen.getByTestId('monitor-new-events-badge-profile-2-1')).toHaveTextContent('7');
  });

  it('All mode shows an error strip for a failed profile with zero monitors while the healthy profile still renders', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        // profile-2 has no entry here: its error produced zero monitors, so
        // its strip should show (unlike the suppressed-strip case below).
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [
        { profileId: 'profile-2', profileName: 'Office', error: new Error('network down') },
      ],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('monitors-all-failed-state')).not.toBeInTheDocument();
  });

  it('suppresses the error strip for a profile that still has cached monitors despite a background refetch error', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        // profile-2 has an error below AND a monitor here: a background
        // refetch failure (e.g. offline) while cached data still renders,
        // same as the old single-mode "error and !data" wall it replaces.
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [
        { profileId: 'profile-2', profileName: 'Office', error: new Error('offline') },
      ],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Lobby Cam');
    expect(screen.queryByTestId('profile-error-strip-profile-2')).not.toBeInTheDocument();
  });

  it('All mode shows the all-failed empty state when every profile errors', () => {
    allMode(2);
    const refetchProfile = vi.fn();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [
        { profileId: 'profile-1', profileName: 'Home', error: new Error('down') },
        { profileId: 'profile-2', profileName: 'Office', error: new Error('down') },
      ],
      isLoading: true, // Total-outage case: isLoading never clears (refs #337, Task 4 finding).
      refetchProfile,
    });

    renderPage();

    expect(screen.getByTestId('monitors-all-failed-state')).toBeInTheDocument();
    expect(screen.getByTestId('monitors-all-failed-state')).toHaveTextContent('monitors.all_failed_title');
    expect(screen.getByTestId('profile-error-strip-profile-1')).toBeInTheDocument();
    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
  });

  it('single mode drops the profile-name prefix from the error strip message', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [
        { profileId: 'profile-1', profileName: 'Home', error: new Error('network down') },
      ],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    const strip = screen.getByTestId('profile-error-strip-profile-1');
    expect(strip).not.toHaveTextContent('Home:');
  });

  it('All mode keeps the profile-name prefix so a multi-server error strip is attributable', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [
        { profileId: 'profile-2', profileName: 'Office', error: new Error('network down') },
      ],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId('profile-error-strip-profile-2')).toHaveTextContent('Office:');
  });
  // A long monitor list is the same problem as a big montage: a browser opens
  // six connections to one host, so the cards below the fold queue requests
  // ahead of the visible ones and the feeds on screen stay blank, silently
  // (refs #507). Both view modes are covered - a list row is taller than a
  // grid tile, so a list fits even fewer cards on screen.
  describe('viewport gating', () => {
    const manyMonitors = (count: number) => {
      useScopedMonitorsMock.mockReturnValue({
        monitors: Array.from({ length: count }, (_, i) => ({
          profileId: 'profile-1',
          profileName: 'Home',
          item: {
            Monitor: { Id: String(i + 1), Name: `Cam ${i + 1}`, Deleted: false },
            Monitor_Status: { Status: 'Connected' },
          },
        })),
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
    };

    /**
     * What scrolls is the app shell around the page, not the page's own
     * container, and jsdom computes no layout - so say so explicitly. Setting
     * it on <body> is what the page walks up to find.
     */
    const shellScrolls = (scrolls: boolean) => {
      document.body.style.overflowY = scrolls ? 'auto' : 'visible';
      Object.defineProperty(document.body, 'scrollHeight', {
        value: scrolls ? 4000 : 0,
        configurable: true,
      });
      Object.defineProperty(document.body, 'clientHeight', { value: 800, configurable: true });
    };

    const allPaused = () =>
      screen.getAllByTestId(/^monitor-card-/).map((el) => el.getAttribute('data-paused'));

    const cardPaused = (id: string) =>
      screen.getByTestId(`monitor-card-${id}`).getAttribute('data-paused');

    beforeEach(() => {
      installMockIntersectionObserver();
      shellScrolls(true);
    });

    afterEach(() => {
      shellScrolls(false);
      vi.unstubAllGlobals();
    });

    it('holds every card in a long list until the observer places it', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);

      renderPage();

      // An unplaced card counts as gated, so none of them opens a connection
      // it would have to close again a frame later.
      expect(allPaused()).not.toContain('false');
    });

    it('holds every card in a long grid the same way', () => {
      singleProfile({ monitorsViewMode: 'grid' });
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);

      renderPage();

      expect(screen.getAllByTestId(/^monitor-card-/)).toHaveLength(
        MONTAGE_GRID.viewportGatingMinTiles + 1
      );
      expect(allPaused()).not.toContain('false');
    });

    it('opens the card the observer reports in view and leaves the rest closed', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);

      renderPage();
      act(() => {
        latestIntersectionObserver().fire([
          { target: screen.getByTestId('monitor-card-1'), isIntersecting: true },
        ]);
      });

      expect(cardPaused('1')).toBe('false');
      expect(cardPaused('2')).toBe('true');
    });

    // The line a device log is read against: whether the page is gating at all.
    it('reports whether the list is gating at all', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);
      // Other tests in this file render the page too; only this render's line
      // should be read.
      vi.mocked(log.monitor).mockClear();

      renderPage();

      // The last line, not the first: the container's scroll parent is known
      // from the commit that mounts it, so the first line is the page before
      // it had one.
      const reported = vi
        .mocked(log.monitor)
        .mock.calls.filter(([message]) => String(message).includes('List viewport gating'))
        .at(-1);
      expect(reported?.[2]).toMatchObject({
        enabled: true,
        tiles: MONTAGE_GRID.viewportGatingMinTiles + 1,
        rooted: true,
      });
    });

    it('leaves a list short enough to fit on screen alone', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles);

      renderPage();

      expect(allPaused()).not.toContain('true');
    });

    it('leaves every card streaming when nothing around the page scrolls', () => {
      // No scroll parent means every card is on screen, so there is nothing to
      // hold: gating stands down rather than blanking a page that fits.
      singleProfile();
      shellScrolls(false);
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);

      renderPage();

      expect(allPaused()).not.toContain('true');
    });
  });
});
