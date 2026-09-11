/**
 * EventDetail Page Tests
 *
 * Covers the favorite toggle only. `isFavorited` is a store getter whose function
 * reference never changes, so a subscription that returns it verbatim is shallow-equal
 * forever and the star never flips. These tests click the real button against the real
 * favorites store and assert the DOM and the toast both follow the new state.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventDetail from '../EventDetail';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import { useSettingsStore } from '../../stores/settings';
import { getEvent } from '../../api/events';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId, type FakeApiClient } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const useQueryMock = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();

// Mutable knobs read by the mocks below so individual tests can vary the
// next-event result (#250). Settings that drive the page (continuous play,
// forced ZMS monitors) now live in the real settings store, seeded per test.
const h = vi.hoisted(() => ({
  goToNextEvent: vi.fn(),
  locationState: {} as Record<string, unknown>,
  routeParams: { id: '101' } as Record<string, string | undefined>,
  translate: vi.fn((key: string) => key),
  logEventDetail: vi.fn(),
  logOther: vi.fn(),
  toastError: vi.fn(),
  zoomReset: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => useQueryMock(options),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => h.toastError(message),
    info: (message: string) => toastInfo(message),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => h.routeParams,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: h.locationState }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: h.translate, i18n: { language: 'en' } }),
}));

// EventDetail pulls in modules that each use their own log.* helper; a Proxy answers
// every component name with a no-op instead of listing them. `eventDetail` gets a
// stable spy so the forced-ZMS diagnostic can be asserted.
vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, {
    get: (_target, prop: string) => (prop === 'eventDetail' ? h.logEventDetail : h.logOther),
  }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../lib/platform', () => ({
  Platform: { isNative: false, isTVDevice: false },
}));

vi.mock('../../api/events', () => ({
  getEvent: vi.fn(),
  getEventVideoUrl: vi.fn(() => 'https://example.test/video.mp4'),
  getEventImageUrl: vi.fn(() => 'https://example.test/thumb.jpg'),
  setEventArchived: vi.fn(),
}));

vi.mock('../../api/monitors', () => ({ getMonitor: vi.fn() }));

vi.mock('../../services/download', () => ({ downloadEventVideo: vi.fn() }));

vi.mock('../../hooks/useEventTags', () => ({
  useEventTagMapping: () => ({ getTagsForEvent: () => [] }),
}));

vi.mock('../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({
    fmtDate: () => '2024-01-01',
    fmtTime: () => '10:00:00',
    fmtDateTime: () => '2024-01-01 10:00:00',
  }),
}));

vi.mock('../../hooks/useTvMode', () => ({ useTvMode: () => ({ isTvMode: false }) }));

vi.mock('../../hooks/useEventNavigation', () => ({
  useEventNavigation: () => ({
    goToPrevEvent: vi.fn(),
    goToNextEvent: h.goToNextEvent,
    isLoadingPrev: false,
    isLoadingNext: false,
  }),
}));

vi.mock('../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({ portalPath: 'https://portal.test/index.php' }),
}));

vi.mock('../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({
    ref: { current: null },
    innerRef: { current: null },
    scale: 1,
    isZoomed: false,
    reset: h.zoomReset,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panLeft: vi.fn(),
    panRight: vi.fn(),
    panUp: vi.fn(),
    panDown: vi.fn(),
  }),
}));

vi.mock('../../components/ui/zoom-controls', () => ({
  ZoomControls: () => <div data-testid="zoom-controls" />,
}));

vi.mock('../../components/events/Mp4EventPlayer', () => ({
  Mp4EventPlayer: ({ onEnded, onError, muted, onMutedChange, fill, onFullscreenChange }: {
    onEnded?: () => void;
    onError?: () => void;
    muted?: boolean;
    onMutedChange?: (muted: boolean) => void;
    fill?: boolean;
    onFullscreenChange?: (fullscreen: boolean) => void;
  }) => (
    <div data-testid="mp4-player" data-muted={String(muted ?? true)} data-fill={String(fill ?? false)}>
      <button data-testid="mp4-fire-ended" onClick={() => onEnded?.()} />
      <button data-testid="mp4-fire-error" onClick={() => onError?.()} />
      <button data-testid="mp4-fire-unmute" onClick={() => onMutedChange?.(false)} />
      <button data-testid="mp4-fire-fullscreen" onClick={() => onFullscreenChange?.(true)} />
      <button data-testid="mp4-fire-exit-fullscreen" onClick={() => onFullscreenChange?.(false)} />
    </div>
  ),
}));

vi.mock('../../components/events/ZmsEventPlayer', () => ({
  ZmsEventPlayer: ({ onEnded, fullscreen }: { onEnded?: () => void; fullscreen?: boolean }) => (
    <div data-testid="zms-player" data-fullscreen={String(fullscreen ?? false)}>
      <button data-testid="zms-fire-ended" onClick={() => onEnded?.()} />
    </div>
  ),
}));

const event = {
  Event: {
    Id: '101',
    MonitorId: '1',
    StorageId: null,
    Name: 'Motion Event',
    Cause: 'Motion',
    Notes: '',
    StartDateTime: '2024-01-01 10:00:00',
    EndDateTime: '2024-01-01 10:00:12',
    Width: '640',
    Height: '480',
    Orientation: 'ROTATE_0',
    Length: '12',
    Frames: '120',
    AlarmFrames: '5',
    AlarmFrameId: '1',
    MaxScoreFrameId: '2',
    MaxScore: '30',
    AvgScore: '10',
    DiskSpace: '1024',
    DefaultVideo: '',
    Videoed: '0',
    SaveJPEGs: '3',
    Archived: '0',
  },
};

const monitorData = { Monitor: { Id: '1', Name: 'Front Door', Width: '640', Height: '480', Orientation: 'ROTATE_0' } };

function favoriteButton() {
  return screen.getByTestId('event-detail-favorite-button');
}

function star() {
  return favoriteButton().querySelector('svg') as SVGElement;
}

const PROFILE_1 = asProfileId('profile-1');
const PROFILE_B = asProfileId('profile-b');

function setSettings(profileId: string, overrides: Record<string, unknown>) {
  useSettingsStore.getState().updateProfileSettings(profileId, overrides);
}

let clientA: FakeApiClient;
let clientB: FakeApiClient;

beforeEach(() => {
  seedProfiles(['profile-1', 'profile-b'], { current: 'profile-1' });
  clientA = fakeApiClient({ '/servers.json': { servers: [] } });
  clientB = fakeApiClient({ '/servers.json': { servers: [] } });
  installApiClient(PROFILE_1, clientA);
  installApiClient(PROFILE_B, clientB);
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventDetail favorite toggle', () => {
  beforeEach(() => {
    useEventFavoritesStore.setState({ profileFavorites: {} });
    toastSuccess.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') {
        return { data: event, isLoading: false, error: null };
      }
      if (queryKey[0] === 'monitor') {
        return { data: monitorData, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });
  });

  it('starts unfavorited when the store has no entry for the event', () => {
    render(<EventDetail />);
    expect(star()).not.toHaveClass('fill-current');
  });

  it('fills the star and records the favorite when the button is clicked', () => {
    render(<EventDetail />);

    fireEvent.click(favoriteButton());

    expect(star()).toHaveClass('fill-current');
    expect(useEventFavoritesStore.getState().profileFavorites['profile-1']).toEqual(['101']);
    expect(toastSuccess).toHaveBeenCalledWith('events.added_to_favorites');
  });

  it('empties the star and reports removal on a second click', () => {
    render(<EventDetail />);

    fireEvent.click(favoriteButton());
    toastSuccess.mockClear();
    fireEvent.click(favoriteButton());

    expect(star()).not.toHaveClass('fill-current');
    expect(useEventFavoritesStore.getState().profileFavorites['profile-1']).toEqual([]);
    expect(toastSuccess).toHaveBeenCalledWith('events.removed_from_favorites');
  });

  it('re-renders when the favorite is set from outside the component', () => {
    render(<EventDetail />);
    expect(star()).not.toHaveClass('fill-current');

    act(() => useEventFavoritesStore.getState().addFavorite('profile-1', '101'));

    expect(star()).toHaveClass('fill-current');
  });
});

describe('EventDetail continuous playback (#250)', () => {
  beforeEach(() => {
    toastInfo.mockClear();
    h.goToNextEvent.mockReset();
    h.locationState = {};
    h.translate.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') return { data: event, isLoading: false, error: null };
      if (queryKey[0] === 'monitor') return { data: monitorData, isLoading: false, error: null };
      return { data: null, isLoading: false, error: null };
    });
  });

  it('toggling continuous play persists the setting for the profile', () => {
    render(<EventDetail />);
    fireEvent.click(screen.getByTestId('event-detail-continuous-play'));
    expect(
      useSettingsStore.getState().getProfileSettings('profile-1').eventContinuousPlay
    ).toBe(true);
  });

  it('advances to the next event when a video ends and continuous play is on', async () => {
    setSettings(PROFILE_1, { eventContinuousPlay: true });
    h.goToNextEvent.mockResolvedValue(true);
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    await waitFor(() => expect(h.goToNextEvent).toHaveBeenCalledTimes(1));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('announces the monitor and time after an automatic advance', async () => {
    h.locationState = { continuousPlayback: true };
    render(<EventDetail />);

    await waitFor(() => expect(h.translate).toHaveBeenCalledWith(
      'event_detail.continuous_playing',
      { monitor: 'Front Door', id: '1' },
    ));
    render(toastInfo.mock.calls[0][0]);
    expect(screen.getByText('2024-01-01 10:00:00')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('shows "no more videos" and stops when there is no next event', async () => {
    setSettings(PROFILE_1, { eventContinuousPlay: true });
    h.goToNextEvent.mockResolvedValue(false);
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('event_detail.no_more_videos'));
  });

  it('does not advance when continuous play is off', () => {
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    expect(h.goToNextEvent).not.toHaveBeenCalled();
  });
});

/**
 * Per-monitor "always use ZMS for events" (#313).
 *
 * Monitors on the list skip MP4 entirely, so there is no failed request and no
 * error toast on any visit. The log has to say the setting is the reason, since
 * that is the only trace of why MP4 was never tried.
 */
describe('EventDetail forced ZMS playback (#313)', () => {
  const mp4Event = {
    Event: { ...event.Event, DefaultVideo: '101-video.mp4', Videoed: '1' },
  };

  beforeEach(() => {
    h.routeParams = { id: '101' };
    h.locationState = {};
    h.logEventDetail.mockClear();
    h.toastError.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') return { data: mp4Event, isLoading: false, error: null };
      if (queryKey[0] === 'monitor') return { data: monitorData, isLoading: false, error: null };
      return { data: null, isLoading: false, error: null };
    });
  });

  it('plays a video event through MP4 when the monitor is not on the list', () => {
    render(<EventDetail />);

    expect(screen.getByTestId('mp4-player')).toBeTruthy();
    expect(screen.queryByTestId('zms-player')).toBeNull();
  });

  // Page-level fullscreen for MP4 too (refs #462): video.js's own fullscreen
  // put a position:fixed player inside the pinch-zoom container, and a
  // transformed container becomes a fixed element's containing block, so
  // pinch worked or not depending on which state it started from.
  it('opens the page fullscreen with the player filling it when the setting is on; Exit changes only the session', () => {
    setSettings(PROFILE_1, { eventPlaybackFullscreen: true });
    render(<EventDetail />);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'true');
    expect(screen.getByTestId('event-detail-exit-fullscreen')).toHaveAttribute('aria-label', 'monitor_detail.exit_fullscreen');
    expect(screen.queryByTestId('event-detail-back')).toBeNull();

    fireEvent.click(screen.getByTestId('event-detail-exit-fullscreen'));
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'false');
    expect(screen.getByTestId('event-detail-back')).toBeTruthy();
    expect(useSettingsStore.getState().getProfileSettings(PROFILE_1).eventPlaybackFullscreen).toBe(true);
  });

  it("the player's own fullscreen button takes the page along without writing the setting (refs #476)", () => {
    const { unmount } = render(<EventDetail />);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'false');

    fireEvent.click(screen.getByTestId('mp4-fire-fullscreen'));
    expect(useSettingsStore.getState().getProfileSettings(PROFILE_1).eventPlaybackFullscreen).toBe(false);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'true');

    fireEvent.click(screen.getByTestId('mp4-fire-exit-fullscreen'));
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'false');
    unmount();

    // The next event opens normally: only Settings > Playback turns this on.
    h.routeParams = { id: '102' };
    render(<EventDetail />);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-fill', 'false');
    expect(screen.queryByTestId('event-detail-exit-fullscreen')).toBeNull();
  });

  it('starts the MP4 player muted and remembers an unmute for every later event (refs #463)', () => {
    const { unmount } = render(<EventDetail />);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-muted', 'true');

    fireEvent.click(screen.getByTestId('mp4-fire-unmute'));
    expect(useSettingsStore.getState().getProfileSettings(PROFILE_1).eventPlaybackMuted).toBe(false);
    unmount();

    h.routeParams = { id: '102' };
    render(<EventDetail />);
    expect(screen.getByTestId('mp4-player')).toHaveAttribute('data-muted', 'false');
  });

  it('still falls back to ZMS with a toast when MP4 fails on an unlisted monitor', () => {
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('mp4-fire-error'));

    expect(screen.getByTestId('zms-player')).toBeTruthy();
    expect(h.toastError).toHaveBeenCalledWith('event_detail.video_playback_failed');
  });

  // Falling back is a fact about one event's video, not a mode. Continuous
  // playback (#250) walks to the next event through this same mounted page, so
  // the flag has to clear or every later event plays through ZMS - and shows
  // the fallback notice - even when its own video is fine (#340).
  it('tries MP4 again on the next event after one event fell back to ZMS', () => {
    const { rerender } = render(<EventDetail />);
    fireEvent.click(screen.getByTestId('mp4-fire-error'));
    expect(screen.getByTestId('zms-player')).toBeTruthy();

    h.routeParams = { id: '102' };
    rerender(<EventDetail />);

    expect(screen.getByTestId('mp4-player')).toBeTruthy();
    expect(screen.queryByTestId('zms-player')).toBeNull();
  });

  it('plays ZMS fullscreen when the setting is on, with an exit bar that changes only the session (refs #462)', () => {
    setSettings(PROFILE_1, { forceZmsMonitorIds: ['1'], eventPlaybackFullscreen: true });
    render(<EventDetail />);

    expect(screen.getByTestId('zms-player')).toHaveAttribute('data-fullscreen', 'true');
    expect(screen.getByTestId('event-detail-exit-fullscreen')).toHaveAttribute('aria-label', 'monitor_detail.exit_fullscreen');
    expect(screen.queryByTestId('event-detail-back')).toBeNull();

    fireEvent.click(screen.getByTestId('event-detail-exit-fullscreen'));
    expect(screen.getByTestId('zms-player')).toHaveAttribute('data-fullscreen', 'false');
    expect(screen.getByTestId('event-detail-back')).toBeTruthy();
    expect(useSettingsStore.getState().getProfileSettings(PROFILE_1).eventPlaybackFullscreen).toBe(true);
  });

  it('never mounts the MP4 player for a monitor on the list', () => {
    setSettings(PROFILE_1, { forceZmsMonitorIds: ['1'] });
    render(<EventDetail />);

    expect(screen.getByTestId('zms-player')).toBeTruthy();
    expect(screen.queryByTestId('mp4-player')).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('logs that the setting is why MP4 was skipped, naming the monitor', () => {
    setSettings(PROFILE_1, { forceZmsMonitorIds: ['1'] });
    render(<EventDetail />);

    const forcedCall = h.logEventDetail.mock.calls.find(
      ([message]) => typeof message === 'string' && message.includes('always use ZMS'),
    );
    expect(forcedCall).toBeDefined();
    expect(forcedCall![0]).toBe(
      'Monitor 1 is set to always use ZMS for events, so MP4 playback was not attempted',
    );
    expect(forcedCall![1]).toBe(1); // LogLevel.INFO
    expect(forcedCall![2]).toEqual({ monitorId: '1', eventId: '101' });
  });

  it('leaves other monitors on MP4 while one monitor is forced', () => {
    setSettings(PROFILE_1, { forceZmsMonitorIds: ['7'] });
    render(<EventDetail />);

    expect(screen.getByTestId('mp4-player')).toBeTruthy();
    expect(h.logEventDetail.mock.calls.some(
      ([message]) => typeof message === 'string' && message.includes('always use ZMS'),
    )).toBe(false);
  });
});

/**
 * All-mode deep route (refs #337): `/all/events/:profileId/:eventId` carries
 * the owning profile as a route param. EventDetail must fetch via THAT
 * profile's client/keys regardless of which profile (if any) is globally
 * current, and must render the existing error state - never crash - for an
 * unknown profileId.
 */
describe('EventDetail All-mode deep route (refs #337)', () => {
  beforeEach(() => {
    h.locationState = {};
    useQueryMock.mockReset();
  });

  afterEach(() => {
    h.routeParams = { id: '101' };
  });

  it('drops the zoom back to fit when the route moves to another event (refs #382)', () => {
    // Same shape as MonitorDetail: the route element is not keyed on the event
    // id, so stepping to the next event keeps this page mounted and without
    // this the zoom stayed on whatever loaded next.
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') return { data: event, isLoading: false, error: null };
      if (queryKey[0] === 'monitor') return { data: monitorData, isLoading: false, error: null };
      return { data: null, isLoading: false, error: null };
    });

    const { rerender } = render(<EventDetail />);
    h.zoomReset.mockClear();

    // A re-render on the same event must not disturb a zoom the user set.
    rerender(<EventDetail />);
    expect(h.zoomReset).not.toHaveBeenCalled();

    h.routeParams = { id: '102' };
    rerender(<EventDetail />);
    expect(h.zoomReset).toHaveBeenCalledTimes(1);

    // Same for the All-mode deep route, where the id is a different param.
    h.routeParams = { profileId: 'profile-b', eventId: '103' };
    rerender(<EventDetail />);
    expect(h.zoomReset).toHaveBeenCalledTimes(2);
  });

  it('fetches the event via the route profileId\'s client and query key', () => {
    h.routeParams = { profileId: 'profile-b', eventId: '101' };
    const seenKeys: unknown[][] = [];
    // queryFn fires once, like the real react-query cache (which memoizes per
    // key) rather than on every render - a re-render past the point the
    // session was resolved must not re-run resolveClient.
    let queryFnCalled = false;
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      seenKeys.push([...queryKey]);
      if (queryKey[0] === 'event') {
        // Actually invoke the queryFn so we can assert it resolves the
        // client via the route's profileId (getSession), not the current
        // session (tryGetCurrentSession never called): the real session
        // registry hands back the client installed for profile-b.
        if (!queryFnCalled) {
          queryFnCalled = true;
          queryFn();
        }
        return { data: event, isLoading: false, error: null };
      }
      if (queryKey[0] === 'monitor') {
        return { data: monitorData, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });

    render(<EventDetail />);

    expect(seenKeys).toContainEqual(['event', 'profile-b', '101']);
    expect(vi.mocked(getEvent)).toHaveBeenCalledWith(clientB, '101');
  });

  it('falls back to the current session and single-mode key when the route has no profileId', () => {
    h.routeParams = { id: '101' };
    let queryFnCalled = false;
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      if (queryKey[0] === 'event') {
        if (!queryFnCalled) {
          queryFnCalled = true;
          queryFn();
        }
        return { data: event, isLoading: false, error: null };
      }
      if (queryKey[0] === 'monitor') {
        return { data: monitorData, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });

    render(<EventDetail />);

    // No route profileId falls back to the current profile (profile-1), so
    // the client that resolved is the one installed for it, not profile-b's.
    expect(vi.mocked(getEvent)).toHaveBeenCalledWith(clientA, '101');
  });

  it('renders the existing error state instead of crashing for an unknown route profileId', () => {
    h.routeParams = { profileId: 'unknown-profile', eventId: '101' };
    useQueryMock.mockImplementation(() => ({ data: null, isLoading: false, error: null }));

    render(<EventDetail />);

    expect(screen.getByText('event_detail.load_error')).toBeTruthy();
  });
});
