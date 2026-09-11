/**
 * MonitorDetail Page Tests
 *
 * All-mode deep route (refs #337): `/all/monitors/:profileId/:monitorId` carries
 * the owning profile as a route param. MonitorDetail must fetch via THAT
 * profile's client/keys regardless of which profile (if any) is globally
 * current, and must render the existing error state - never crash - for an
 * unknown profileId.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import MonitorDetail from '../MonitorDetail';
import { getSession, tryGetCurrentSession } from '../../services/sessions';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { useSettingsStore } from '../../stores/settings';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// The real session registry (backed by the seeded profile store and
// fake-store-gates), spied through vi.mock's importOriginal so both exports
// still call through - these tests prove which resolver MonitorDetail
// actually calls rather than reading back a hand-built mock's own answer.
vi.mock('../../services/sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/sessions')>();
  return { ...actual, getSession: vi.fn(actual.getSession), tryGetCurrentSession: vi.fn(actual.tryGetCurrentSession) };
});

const h = vi.hoisted(() => ({
  routeParams: { id: '1' } as Record<string, string | undefined>,
  locationState: {} as Record<string, unknown>,
  zoomReset: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => h.routeParams,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: h.locationState, key: 'k1' }),
}));

vi.mock('../../hooks/useMainScrollRestoration', () => ({
  useMainScrollRestoration: () => {},
}));

const getSessionSpy = vi.mocked(getSession);
const tryGetCurrentSessionSpy = vi.mocked(tryGetCurrentSession);

const useQueryMock = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[]; queryFn: () => unknown; enabled?: boolean }) =>
    useQueryMock(options),
}));

vi.mock('../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getControl: vi.fn(),
  updateMonitor: vi.fn(),
}));
vi.mock('../../api/zones', () => ({ getZones: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/download', () => ({ downloadSnapshotFromElement: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useInsomnia', () => ({ useInsomnia: () => {} }));
vi.mock('../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({ ref: { current: null }, innerRef: { current: null }, reset: h.zoomReset }),
}));
vi.mock('../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({ portalPath: 'https://portal.test/index.php', apiBaseUrl: 'https://api.test' }),
}));

vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../components/monitors/PTZControls', () => ({ PTZControls: () => <div data-testid="ptz-controls" /> }));
const liveMonitorPlayerMock = vi.fn();
vi.mock('../../components/monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: (props: Record<string, unknown>) => {
    liveMonitorPlayerMock(props);
    return <div data-testid="live-player" />;
  },
}));
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({ AnalysisFramesToggle: () => <div /> }));
vi.mock('../../components/monitors/ZoneOverlay', () => ({ ZoneOverlay: () => <div /> }));
vi.mock('../../components/monitors/ZoneLegend', () => ({ ZoneLegend: () => <div /> }));
vi.mock('../../components/monitors/MonitorRecentEvents', () => ({
  MonitorRecentEvents: () => <div data-testid="monitor-recent-events" />,
}));
vi.mock('../../components/monitor-detail/MonitorSettingsDialog', () => ({
  MonitorSettingsDialog: () => <div data-testid="monitor-settings-dialog" />,
}));
vi.mock('../../components/monitor-detail/MonitorControlsCard', () => ({
  MonitorControlsCard: () => <div data-testid="monitor-controls-card" />,
}));
vi.mock('../../components/ui/zoom-controls', () => ({ ZoomControls: () => <div data-testid="zoom-controls" /> }));

vi.mock('../hooks', () => ({
  usePTZControl: () => ({ handlePTZCommand: vi.fn() }),
  useAlarmControl: () => ({
    hasAlarmStatus: false,
    displayAlarmArmed: false,
    alarmStatusLabel: '',
    isAlarmLoading: false,
    isAlarmUpdating: false,
    alarmBorderClass: '',
    handleAlarmToggle: vi.fn(),
  }),
  useModeControl: () => ({ isModeUpdating: false, handleModeChange: vi.fn() }),
  useMonitorNavigation: () => ({
    isSliding: false,
    enabledMonitors: [],
    hasPrev: false,
    hasNext: false,
    onSwipeLeft: vi.fn(),
    onSwipeRight: vi.fn(),
  }),
}));

const monitor = {
  Monitor: {
    Id: '1',
    Name: 'Front Door',
    Width: '640',
    Height: '480',
    Controllable: '0',
    Function: 'Monitor',
  },
  Monitor_Status: {},
};

describe('MonitorDetail All-mode deep route (refs #337)', () => {
  beforeEach(() => {
    h.locationState = {};
    getSessionSpy.mockClear();
    tryGetCurrentSessionSpy.mockClear();
    useQueryMock.mockReset();
    liveMonitorPlayerMock.mockClear();
    h.zoomReset.mockClear();
    seedProfiles(['profile-1', 'profile-b'], { current: 'profile-1' });
  });

  afterEach(() => {
    // The suite-wide afterEach(cleanup) in tests/setup.ts runs AFTER this one
    // (afterEach hooks run LIFO), so without an explicit unmount here,
    // resetProfileFixture's store writes (logoutAll, profiles: []) would
    // synchronously re-render the still-mounted page against reset state -
    // routeProfileId's branch in resolveClient would flip and throw.
    cleanup();
    h.routeParams = { id: '1' };
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches the monitor via the route profileId\'s client and query key', () => {
    h.routeParams = { profileId: 'profile-b', monitorId: '1' };
    const seenKeys: unknown[][] = [];
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      seenKeys.push([...queryKey]);
      if (queryKey[0] === 'monitor') {
        // Invoke the queryFn so we can assert it resolves the client via the
        // route's profileId (getSession), never the current session
        // (tryGetCurrentSession never called).
        queryFn();
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(seenKeys).toContainEqual(['monitor', 'profile-b', '1']);
    expect(getSessionSpy).toHaveBeenCalledWith('profile-b');
    expect(tryGetCurrentSessionSpy).not.toHaveBeenCalled();
  });

  it('passes the route profileId to LiveMonitorPlayer on the All-mode deep route (refs #337 C1)', () => {
    h.routeParams = { profileId: 'profile-b', monitorId: '1' };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'monitor') {
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(liveMonitorPlayerMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-b' })
    );
  });

  it('starts the player in the remembered mute state and persists native-control changes (refs #463)', () => {
    h.routeParams = { id: '1' };
    useSettingsStore.getState().updateProfileSettings('profile-1', { unmutedMonitorIds: ['1'] });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'monitor') {
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(liveMonitorPlayerMock).toHaveBeenCalledWith(expect.objectContaining({ muted: false }));
    const props = liveMonitorPlayerMock.mock.calls.at(-1)?.[0] as { onMutedChange: (m: boolean) => void };
    props.onMutedChange(true);
    expect(useSettingsStore.getState().getProfileSettings('profile-1').unmutedMonitorIds).toEqual([]);
  });

  const monitorQuery = () =>
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'monitor') {
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

  it('replaces the Cap/Anl/Rec header line with the info popover (refs #467)', () => {
    h.routeParams = { id: '1' };
    monitorQuery();

    render(<MonitorDetail />);
    expect(screen.queryByText(/Cap:/)).toBeNull();

    fireEvent.click(screen.getByTestId('monitor-info-btn'));
    expect(screen.getByTestId('monitor-info-function')).toHaveTextContent('Monitor');
    expect(screen.getByTestId('monitor-info-resolution')).toHaveTextContent('640x480');
  });

  it('opens fullscreen for a monitor set to open that way; exiting changes only the session (refs #462, #463)', () => {
    h.routeParams = { id: '1' };
    useSettingsStore.getState().updateProfileSettings('profile-1', { fullscreenMonitorIds: ['1'] });
    monitorQuery();

    render(<MonitorDetail />);
    expect(screen.getByTestId('monitor-detail-exit-fullscreen')).toHaveAttribute('aria-label', 'monitor_detail.exit_fullscreen');

    fireEvent.click(screen.getByTestId('monitor-detail-exit-fullscreen'));
    expect(screen.queryByTestId('monitor-detail-exit-fullscreen')).toBeNull();
    expect(useSettingsStore.getState().getProfileSettings('profile-1').fullscreenMonitorIds).toEqual(['1']);
  });

  it('maximizing a monitor changes only the session and never writes the setting (refs #476)', () => {
    h.routeParams = { id: '1' };
    monitorQuery();

    const { unmount } = render(<MonitorDetail />);
    expect(screen.queryByTestId('monitor-detail-exit-fullscreen')).toBeNull();

    fireEvent.click(screen.getByTestId('monitor-detail-maximize'));
    expect(screen.getByTestId('monitor-detail-exit-fullscreen')).toHaveAttribute('aria-label', 'monitor_detail.exit_fullscreen');
    expect(useSettingsStore.getState().getProfileSettings('profile-1').fullscreenMonitorIds).toEqual([]);
    unmount();

    render(<MonitorDetail />);
    expect(screen.queryByTestId('monitor-detail-exit-fullscreen')).toBeNull();
  });

  // The exit control floats over the feed instead of sitting in a strip above
  // it, so nothing but the picture and that one button is on screen (refs #479).
  it('shows no chrome above the fullscreen feed, only the exit button', () => {
    h.routeParams = { id: '1' };
    useSettingsStore.getState().updateProfileSettings('profile-1', { fullscreenMonitorIds: ['1'] });
    monitorQuery();

    render(<MonitorDetail />);
    const exit = screen.getByTestId('monitor-detail-exit-fullscreen');
    expect(exit.getAttribute('title')).toContain('Front Door');
    expect(exit).toHaveTextContent('');
    expect(screen.queryByText('Front Door')).toBeNull();
  });

  it('opens every monitor fullscreen when the live view setting is on', () => {
    h.routeParams = { id: '1' };
    useSettingsStore.getState().updateProfileSettings('profile-1', { monitorDetailFullscreen: true });
    monitorQuery();

    render(<MonitorDetail />);
    expect(screen.getByTestId('monitor-detail-exit-fullscreen')).toHaveAttribute('aria-label', 'monitor_detail.exit_fullscreen');
    expect(useSettingsStore.getState().getProfileSettings('profile-1').fullscreenMonitorIds).toEqual([]);
  });

  it('falls back to the current session and single-mode key when the route has no profileId', () => {
    h.routeParams = { id: '1' };
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      if (queryKey[0] === 'monitor') {
        queryFn();
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(tryGetCurrentSessionSpy).toHaveBeenCalled();
    expect(getSessionSpy).not.toHaveBeenCalled();
  });

  it('drops the zoom back to fit when the route moves to another monitor (refs #382)', () => {
    // The route element is not keyed on the monitor id, so stepping from one
    // monitor to the next (keyboard jump, prev/next, swipe, auto-cycle) keeps
    // this page mounted, and without this the zoom transform stayed applied to
    // whatever loaded next.
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'monitor') {
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    const { rerender } = render(<MonitorDetail />);
    h.zoomReset.mockClear();

    // A re-render on the same monitor must not disturb a zoom the user set.
    rerender(<MonitorDetail />);
    expect(h.zoomReset).not.toHaveBeenCalled();

    h.routeParams = { id: '2' };
    rerender(<MonitorDetail />);
    expect(h.zoomReset).toHaveBeenCalledTimes(1);

    // Same for the All-mode deep route, where the id is a different param.
    h.routeParams = { profileId: 'profile-b', monitorId: '3' };
    rerender(<MonitorDetail />);
    expect(h.zoomReset).toHaveBeenCalledTimes(2);
  });

  it('renders the existing error state instead of crashing for an unknown route profileId', () => {
    h.routeParams = { profileId: 'unknown-profile', monitorId: '1' };
    useQueryMock.mockImplementation(() => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));

    render(<MonitorDetail />);

    expect(screen.getByText('monitor_detail.load_error')).toBeTruthy();
    expect(getSessionSpy).not.toHaveBeenCalledWith('unknown-profile');
  });
});
