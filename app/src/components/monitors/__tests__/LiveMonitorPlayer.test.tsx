/**
 * LiveMonitorPlayer MJPEG recovery tests.
 *
 * Regression coverage for refs #150: when the Electron window is occluded the
 * MJPEG <img> connection drops and onError latches mjpegError=true, which
 * unmounts the <img>. The visibility/focus resume then mints a new connkey
 * (new imageSrc), and the tile must re-render the <img> instead of staying on
 * the VideoOff placeholder. Before the fix, mjpegError was never cleared on a
 * connkey change, so the feed only recovered on a full remount (route change).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { LiveMonitorPlayer } from '../LiveMonitorPlayer';
import { MONTAGE_GRID, GO2RTC_FRAME_POLL_MS } from '../../../lib/zmninja-ng-constants';
import { asProfileId, type Monitor, type Profile } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

function withQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

let mockMjpegReturn: {
  streamUrl: string;
  imageSrc: string;
  imgRef: { current: HTMLImageElement | null };
  regenerateConnection: () => void;
  reportStreamError: () => void;
  reportStreamLoad: () => void;
  hasFrame: boolean;
};

// Every request the player has made of the MJPEG hook, so a test can assert
// what this tile asks ZM for and whether it is streaming at all.
const streamCalls: Array<{ streamOptions?: { maxfps?: number; scale?: number }; enabled?: boolean }> = [];

// A fresh object per call, the way the real hook does it: useMonitorStream
// returns a bare object literal, so its result is a new reference on every
// render. Returning the same object here hid a bug where a hook dependency on
// that result re-ran an effect every render. imgRef is deliberately shared
// across the copies, because the real hook's useRef object is stable.
vi.mock('../../../hooks/useMonitorStream', () => ({
  useMonitorStream: (opts: {
    streamOptions?: { maxfps?: number; scale?: number };
    enabled?: boolean;
  }) => {
    streamCalls.push(opts);
    return { ...mockMjpegReturn };
  },
}));

const go2rtc = vi.hoisted(() => ({
  state: 'connecting' as string,
  optionsLog: [] as Array<{ monitorId: string; enabled?: boolean }>,
  // What the hook reports as its <video>. Null unless a test hands over an
  // element with decoded frames on it, which is how the player learns that
  // go2rtc is carrying the picture.
  video: null as { videoWidth: number; videoHeight: number; paused: boolean; play: () => Promise<void> } | null,
}));

vi.mock('../../../hooks/useGo2RTCStream', () => ({
  useGo2RTCStream: (opts: { monitorId: string; enabled?: boolean }) => {
    go2rtc.optionsLog.push(opts);
    return {
      state: go2rtc.state,
      error: go2rtc.state === 'error' ? 'Go2RTC WebSocket connection failed' : null,
      activeProtocol: null,
      getVideoElement: () => go2rtc.video,
      retry: vi.fn(),
      stop: vi.fn(),
    };
  },
}));

vi.mock('../../../hooks/useVisibilityResume', () => ({
  useVisibilityResume: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, videoPlayer: vi.fn() } };
});

const monitor = { Id: '1', Name: 'Front Door', Go2RTCEnabled: false } as unknown as Monitor;
const profile = {
  id: 'profile-1',
  name: 'Test',
  apiUrl: 'https://t',
  portalUrl: 'https://t',
  cgiUrl: 'https://t/cgi-bin',
  isDefault: false,
  createdAt: 0,
} as Profile;

// Real profile/settings/auth stores, seeded for every profile id used across
// this file's describes. No username on any of them by default, so
// usePermissions resolves UNRESTRICTED_PERMISSIONS with no network call -
// never denied, the same "not denied" outcome the old blanket permission
// mock gave every describe but the one that overrides it below.
beforeEach(() => {
  seedProfiles([makeProfile('profile-1'), makeProfile('profile-a'), makeProfile('profile-b')]);
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('LiveMonitorPlayer MJPEG recovery', () => {
  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
  });

  it('re-renders the MJPEG <img> after an error once a new connkey arrives', () => {
    const { rerender } = render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    // Stream is up: the <img> is mounted.
    expect(screen.getByTestId('video-player-mjpeg')).toHaveAttribute(
      'src',
      'https://t/stream?connkey=1',
    );

    // Occlusion drops the connection -> the <img> errors and unmounts.
    fireEvent.error(screen.getByTestId('video-player-mjpeg'));
    expect(screen.queryByTestId('video-player-mjpeg')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-player-loading')).toBeInTheDocument();

    // Visibility/focus resume mints a fresh connkey (new imageSrc).
    mockMjpegReturn = {
      ...mockMjpegReturn,
      streamUrl: 'https://t/stream?connkey=2',
      imageSrc: 'https://t/stream?connkey=2',
    };
    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    // The tile must recover with the new stream, not stay on VideoOff.
    expect(screen.getByTestId('video-player-mjpeg')).toHaveAttribute(
      'src',
      'https://t/stream?connkey=2',
    );
  });

  // The error latch is what holds the tile on the VideoOff placeholder until a
  // genuinely new connkey arrives. If anything unlatches it early, the <img>
  // remounts against the same dead URL and errors again, and each error
  // clears the pending reconnect timer and bumps the attempt counter, so the
  // backoff burns at error-loop speed until the stream is released for good.
  // Every page that streams is affected, not only Live Activity.
  it('keeps the MJPEG error latched across re-renders that bring no new connkey', () => {
    const { rerender } = render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    fireEvent.error(screen.getByTestId('video-player-mjpeg'));
    expect(screen.queryByTestId('video-player-mjpeg')).not.toBeInTheDocument();

    // Unrelated re-renders: imageSrc is unchanged, so the connection is still
    // the dead one and the <img> must stay unmounted.
    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));
    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(screen.queryByTestId('video-player-mjpeg')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-player-loading')).toBeInTheDocument();
    // One error, so one reconnect request: a relatch loop would report more.
    expect(mockMjpegReturn.reportStreamError).toHaveBeenCalledTimes(1);
  });

  it('asks the stream hook to auto-reconnect when the MJPEG <img> errors', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));
    fireEvent.error(screen.getByTestId('video-player-mjpeg'));
    expect(mockMjpegReturn.reportStreamError).toHaveBeenCalledTimes(1);
  });

  // refs #313: the browser paints its broken-image glyph as soon as the load
  // fails, and React's error event is default priority, so the commit that
  // unmounts the <img> lands a frame or more later. On Live Activity the exit
  // view transition snapshots the page in that gap and freezes the glyph for
  // the length of the fade. The element itself has to stop presenting the
  // broken image inside the handler.
  it('leaves the errored MJPEG <img> unpaintable rather than showing a broken image', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));
    const img = screen.getByTestId('video-player-mjpeg');

    fireEvent.error(img);

    // Asserted on the element the browser would have painted, not on a flag.
    expect(img.style.visibility).toBe('hidden');
  });

  it('restores a visible MJPEG <img> across repeated reconnects', () => {
    const { rerender } = render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    for (const connkey of ['2', '3']) {
      fireEvent.error(screen.getByTestId('video-player-mjpeg'));

      mockMjpegReturn = {
        ...mockMjpegReturn,
        streamUrl: `https://t/stream?connkey=${connkey}`,
        imageSrc: `https://t/stream?connkey=${connkey}`,
      };
      rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

      const recovered = screen.getByTestId('video-player-mjpeg');
      expect(recovered).toBeVisible();
      expect(recovered).toHaveAttribute('src', `https://t/stream?connkey=${connkey}`);
    }
  });
});

describe('LiveMonitorPlayer Go2RTC failure cache scoping', () => {
  const go2rtcProfile = { ...profile, go2rtcUrl: 'https://t/go2rtc' } as Profile;

  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
    go2rtc.state = 'connecting';
    go2rtc.optionsLog = [];
  });

  // Whether the latest mount asked the Go2RTC hook to connect for this monitor.
  const latestEnabled = (monitorId: string): boolean | undefined =>
    [...go2rtc.optionsLog].reverse().find((o) => o.monitorId === monitorId)?.enabled;

  it('single-monitor view does not inherit a montage-recorded Go2RTC failure', () => {
    const rtcMonitor = { Id: 'cache-a', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

    // A montage tile fails Go2RTC and records the failure in the shared cache.
    go2rtc.state = 'error';
    const montage = render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />));
    montage.unmount();

    // The single-monitor view opts out of the shared cache: it must still try
    // Go2RTC even though the montage run just marked this monitor failed.
    go2rtc.state = 'connecting';
    render(withQuery(
      <LiveMonitorPlayer
        monitor={rtcMonitor}
        profile={go2rtcProfile}
        bypassGo2rtcFailureCache
        forceViewMode="streaming"
      />,
    ));

    expect(latestEnabled('cache-a')).toBe(true);
  });

  it('montage tiles still inherit the shared Go2RTC failure cache', () => {
    const rtcMonitor = { Id: 'cache-b', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

    // First montage tile fails and records the failure.
    go2rtc.state = 'error';
    const first = render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />));
    first.unmount();

    // A subsequent montage tile for the same monitor skips Go2RTC (MJPEG fallback).
    go2rtc.state = 'connecting';
    render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />));

    expect(latestEnabled('cache-b')).toBe(false);
  });

  // refs #337: two independent ZM servers (two profiles) can assign the same
  // monitor id. A failure recorded for profile A's monitor must not silently
  // skip Go2RTC for profile B's unrelated monitor sharing that id.
  it('a Go2RTC failure recorded for one profile does not affect another profile with the same monitorId', () => {
    const rtcMonitor = { Id: 'cache-c', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;
    const profileA = { ...go2rtcProfile, id: 'profile-a' } as Profile;
    const profileB = { ...go2rtcProfile, id: 'profile-b' } as Profile;

    // Profile A's tile fails Go2RTC and records the failure.
    go2rtc.state = 'error';
    const a = render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={profileA} />));
    a.unmount();

    // Profile B's tile for the SAME monitor id must still try Go2RTC.
    go2rtc.state = 'connecting';
    render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={profileB} />));

    expect(latestEnabled('cache-c')).toBe(true);
  });
});

// refs #337: All Servers mode can ask every tile for a cheaper stream
// (Settings > All Servers performance > stream tuning). The player is the
// place that turns that into what ZM is actually asked for.
describe('LiveMonitorPlayer reduced stream tuning', () => {
  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
    seedProfiles([makeProfile('profile-1')], { settings: { 'profile-1': { streamMaxFps: 10, streamScale: 50 } } });
    streamCalls.length = 0;
  });

  const latestOptions = () => streamCalls[streamCalls.length - 1]?.streamOptions;

  it('asks for the owning profile\'s own frame rate and scale by default', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(latestOptions()).toEqual({ maxfps: 10, scale: 50 });
  });

  it('asks for less when the tile is told to reduce', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} reduceStream />));

    expect(latestOptions()).toEqual({
      maxfps: MONTAGE_GRID.reducedMaxFps,
      scale: MONTAGE_GRID.reducedScale,
    });
  });

  // Zoom magnifies the frame that arrived, so a 50% stream is 50% of the
  // detail however far the user zooms in. The page asks for the full frame for
  // as long as they stay zoomed (refs #478).
  it('asks for the full-size frame while the view is zoomed', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} fullResolution />));

    expect(latestOptions()).toEqual({ maxfps: 10, scale: 100 });
  });

  it('gives the full-size frame back when the view zooms out', () => {
    const { rerender } = render(
      withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} fullResolution />),
    );

    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(latestOptions()).toEqual({ maxfps: 10, scale: 50 });
  });

  it('keeps a profile already streaming below the ceiling where it is', () => {
    seedProfiles([makeProfile('profile-1')], { settings: { 'profile-1': { streamMaxFps: 2, streamScale: 10 } } });

    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} reduceStream />));

    expect(latestOptions()).toEqual({ maxfps: 2, scale: 10 });
  });
});

// refs #337: All Servers mode can stop streaming while the page is out of
// sight (Settings > All Servers performance). Disabling the stream hooks is
// what makes that a real stop: useStreamLifecycle CMD_QUITs the connkey on
// the way down, so no nph-zms process is left running on the server.
describe('LiveMonitorPlayer paused tiles', () => {
  const go2rtcProfile = { ...profile, go2rtcUrl: 'https://t/go2rtc' } as Profile;
  const rtcMonitor = { Id: 'paused-rtc', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
    streamCalls.length = 0;
    go2rtc.state = 'connecting';
    go2rtc.optionsLog = [];
  });

  const latestStreamEnabled = () => streamCalls[streamCalls.length - 1]?.enabled;
  const latestGo2rtcEnabled = (monitorId: string) =>
    [...go2rtc.optionsLog].reverse().find((o) => o.monitorId === monitorId)?.enabled;

  it('streams while not paused', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(latestStreamEnabled()).toBe(true);
  });

  it('drops the MJPEG connection while paused', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} paused />));

    expect(latestStreamEnabled()).toBe(false);
  });

  it('drops the go2rtc connection while paused', () => {
    render(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} paused />));

    expect(latestGo2rtcEnabled('paused-rtc')).toBe(false);
  });

  it('reconnects when the pause lifts', () => {
    const { rerender } = render(withQuery(
      <LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} paused />
    ));

    rerender(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />));

    expect(latestGo2rtcEnabled('paused-rtc')).toBe(true);
    expect(latestStreamEnabled()).toBe(true);
  });
});

// A paused WebRTC tile holds no connection, so it has no frames either. Both
// halves of that matter: the tile must not claim to be playing video it no
// longer receives, and the resume must start from cold rather than dropping a
// freeze watchdog on a stream that is still negotiating (refs #337).
describe('LiveMonitorPlayer paused WebRTC frames', () => {
  const go2rtcProfile = { ...profile, go2rtcUrl: 'https://t/go2rtc' } as Profile;
  const rtcMonitor = { Id: 'paused-frames', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

  beforeEach(() => {
    mockMjpegReturn = {
      // No MJPEG stream at all, so the tile's rendered state is only ever
      // about the go2rtc video.
      streamUrl: '',
      imageSrc: '',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
    streamCalls.length = 0;
    go2rtc.state = 'connected';
    go2rtc.optionsLog = [];
    go2rtc.video = { videoWidth: 640, videoHeight: 480, paused: false, play: () => Promise.resolve() };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    go2rtc.video = null;
    go2rtc.state = 'connecting';
  });

  /** The VideoOff placeholder: shown whenever the tile has no picture to show. */
  const isShowingPlaceholder = () => screen.queryByTestId('video-player-loading') !== null;

  const letFramesArrive = () => {
    act(() => {
      vi.advanceTimersByTime(GO2RTC_FRAME_POLL_MS * 2);
    });
  };

  it('shows the placeholder while paused even though the go2rtc hook still reports frames', () => {
    const { rerender } = render(withQuery(
      <LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />
    ));
    letFramesArrive();
    expect(isShowingPlaceholder()).toBe(false);

    rerender(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} paused />));
    // The real hook stops on the way into a pause, but it does so in its own
    // effect, and its last reported state outlives the render that paused the
    // tile. Nothing the hook says can put live video on a paused tile.
    letFramesArrive();

    expect(isShowingPlaceholder()).toBe(true);
  });

  it('comes back from a pause on the cold-start path, not mid-stream', () => {
    const { rerender } = render(withQuery(
      <LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />
    ));
    letFramesArrive();

    rerender(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} paused />));
    // The connection is gone: go2rtc reports idle and there is no video.
    go2rtc.state = 'idle';
    go2rtc.video = null;
    rerender(withQuery(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />));

    // Still on the placeholder, waiting for the first frame of the new
    // connection. Carrying the old "has frames" across the pause would instead
    // start the freeze watchdog against a stream that has not connected yet,
    // and its retries would fire before the first frame could arrive.
    expect(isShowingPlaceholder()).toBe(true);
  });
});

/**
 * Streaming is its own ZoneMinder permission (refs #344).
 *
 * `zms.cpp` checks Stream for a live monitor, independently of Monitors. An
 * account with Monitors View and Stream None sees every camera listed and gets
 * a stream that 403s - and because a denied stream is just an image that never
 * loads, no failing request exists for the app to notice. Without the probe
 * this is a permanently broken tile with no explanation.
 */
describe('LiveMonitorPlayer without streaming permission', () => {
  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: true,
    };
  });

  // Real usePermissions probe: 'profile-1' needs a username (else the probe
  // short-circuits to unrestricted with no request at all) and a scripted
  // /users.json naming its Stream column.
  function seedStreamPermission(stream: string) {
    seedProfiles([makeProfile('profile-1', { username: 'bob' })]);
    installApiClient(asProfileId('profile-1'), fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Stream: stream } }] } }));
  }

  it('explains the refusal instead of showing a tile that can never load', async () => {
    seedStreamPermission('None');

    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    await waitFor(() => expect(screen.getByTestId('video-player-no-permission')).toBeInTheDocument());
    expect(screen.queryByTestId('video-player-mjpeg')).not.toBeInTheDocument();
  });

  // The probe is inherently async (a real network round trip), so the very
  // first render - before any verdict is known - still asks for a stream;
  // what matters is that once ZoneMinder answers "None", the request stops.
  it('does not ask ZoneMinder for a stream it will refuse', async () => {
    seedStreamPermission('None');

    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    await waitFor(() => expect(screen.getByTestId('video-player-no-permission')).toBeInTheDocument());
    expect(streamCalls.at(-1)?.enabled).toBe(false);
  });

  it('streams normally when the account may stream', async () => {
    seedStreamPermission('View');

    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    await waitFor(() => expect(screen.getByTestId('video-player-mjpeg')).toBeInTheDocument());
    expect(screen.queryByTestId('video-player-no-permission')).not.toBeInTheDocument();
  });

  it('streams while the permission is still unknown', () => {
    // Unknown must never withhold video: an account that can stream would lose
    // it for no reason.
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(screen.queryByTestId('video-player-no-permission')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-player-mjpeg')).toBeInTheDocument();
  });
});

// refs #352: on a mobile resume the element still holds whatever the dead
// connection left on it - a partially written JPEG, or the browser's
// broken-image glyph after WebKit re-fetches an evicted image against a dead
// connkey. Neither fires an error the player can react to in time, so a mounted
// <img> is only allowed to paint once the src it holds has produced a frame.
describe('LiveMonitorPlayer MJPEG frame gating', () => {
  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
      reportStreamError: vi.fn(),
      reportStreamLoad: vi.fn(),
      hasFrame: false,
    };
  });

  it('keeps a connected but frameless <img> unpaintable and shows the placeholder', () => {
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    // Mounted, because an unmounted element can never load.
    const img = screen.getByTestId('video-player-mjpeg');
    expect(img).toHaveAttribute('src', 'https://t/stream?connkey=1');
    expect(img).not.toBeVisible();
    expect(screen.getByTestId('video-player-loading')).toBeInTheDocument();
  });

  it('paints the <img> and drops the placeholder once a frame arrives', () => {
    const { rerender } = render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    mockMjpegReturn = { ...mockMjpegReturn, hasFrame: true };
    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(screen.getByTestId('video-player-mjpeg')).toBeVisible();
    expect(screen.queryByTestId('video-player-loading')).not.toBeInTheDocument();
  });

  it('hides the picture again when the stream loses its frame', () => {
    mockMjpegReturn = { ...mockMjpegReturn, hasFrame: true };
    const { rerender } = render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));
    expect(screen.getByTestId('video-player-mjpeg')).toBeVisible();

    // A resume withdraws the frame without any error event and before the new
    // connkey lands, so imageSrc is still the old one here.
    mockMjpegReturn = { ...mockMjpegReturn, hasFrame: false };
    rerender(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(screen.getByTestId('video-player-mjpeg')).not.toBeVisible();
    expect(screen.getByTestId('video-player-loading')).toBeInTheDocument();
  });

  // A failing load with alt text makes WebKit draw its glyph next to the text.
  // Nothing describes a live video feed in words anyway; the surrounding tile
  // carries the monitor name.
  it('gives the stream image no alt text to render on failure', () => {
    mockMjpegReturn = { ...mockMjpegReturn, hasFrame: true };
    render(withQuery(<LiveMonitorPlayer monitor={monitor} profile={profile} />));

    expect(screen.getByTestId('video-player-mjpeg')).toHaveAttribute('alt', '');
  });
});
