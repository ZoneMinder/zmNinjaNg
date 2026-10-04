import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { StrictMode } from 'react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { ZmsEventPlayer } from '../ZmsEventPlayer';
import { asProfileId, type ProfileId } from '../../../api/types';
import {
  ZM_INTEGRATION,
  EVENT_SEEK_FLUSH_DELAY_MS,
  ZMS_STREAM_DEAD_POLLS,
  ZMS_STREAM_MAX_RESTARTS,
} from '../../../lib/zmninja-ng-constants';
import * as freshTokenModule from '../../../hooks/useFreshAccessToken';
import { useAuthStore } from '../../../stores/auth';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

const httpGetMock = vi.fn().mockResolvedValue({ data: {} });

vi.mock('../../../lib/http', () => ({
  httpGet: (...args: unknown[]) => httpGetMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, zmsEventPlayer: vi.fn(), eventProgressBar: vi.fn() } };
});

vi.mock('../../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({
    ref: () => {},
    innerRef: () => {},
    scale: 1,
    isZoomed: false,
    reset: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panLeft: vi.fn(),
    panRight: vi.fn(),
    panUp: vi.fn(),
    panDown: vi.fn(),
  }),
}));

vi.mock('../../../api/events', () => ({
  getEventImageUrl: vi.fn().mockReturnValue('https://zm.test/image.jpg'),
}));

function renderPlayer(
  props: { suspended?: boolean; showNotice?: boolean; profileId?: ProfileId; fullscreen?: boolean } = {}
) {
  return render(
    <ZmsEventPlayer
      portalUrl="https://zm.test"
      eventId="42"
      profileId={undefined}
      token="tok"
      totalFrames={100}
      alarmFrames={0}
      eventLength={10}
      {...props}
    />
  );
}

function getStreamImg(): HTMLImageElement {
  return screen.getByAltText('event_detail.event_playback') as HTMLImageElement;
}

function connkeyOf(url: string): string | null {
  return new URL(url).searchParams.get('connkey');
}

function quitCalls() {
  return httpGetMock.mock.calls.filter(
    (call) => new URL(call[0] as string).searchParams.get('command') === '17'
  );
}

function commandOf(url: string): string | null {
  return new URL(url).searchParams.get('command');
}

function callsForCommand(cmd: string) {
  return httpGetMock.mock.calls.filter((call) => commandOf(call[0] as string) === cmd);
}

// jsdom does no layout, so stub the scrub track as a 0..200px-wide element.
function stubTrack(): HTMLElement {
  const track = screen.getByTestId('event-progress-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0, width: 200, top: 0, height: 8, right: 200, bottom: 8, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return track;
}

// Real profile/settings/auth stores for every test in this file: 'current'
// is the page's own profile (unparented calls resolve to it), 'p-owner' and
// 'p-cold' back the token-freshness describe below. bandwidthMode 'low'
// gives useBandwidthSettings a real (now unmocked) zmsStatusInterval of 5s -
// POLL_MS below matches it.
beforeEach(() => {
  seedProfiles(['current', 'p-owner', 'p-cold'], {
    settings: { current: { bandwidthMode: 'low' }, 'p-owner': { bandwidthMode: 'low' }, 'p-cold': { bandwidthMode: 'low' } },
  });
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('ZmsEventPlayer', () => {
  beforeEach(() => {
    cleanup();
    httpGetMock.mockClear();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      // clear, not run: the status poll is a setInterval that runAllTimers
      // would loop on forever.
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    // Restore the default resolved value: a test that installs its own
    // implementation must not leak into the next one.
    httpGetMock.mockReset();
    httpGetMock.mockResolvedValue({ data: {} });
  });

  // The ZMS notice explains an unexpected substitution, so it shows only when
  // MP4 playback failed and the page fell back to ZMS (#340). A JPEG-only
  // event, TV mode, or the per-monitor force setting are not substitutions.
  it('gives the picture the full height in fullscreen instead of a 16:9 box (refs #462)', () => {
    renderPlayer();
    expect(screen.getByTestId('zms-video-area').className).toContain('aspect-video');
    expect(screen.queryByTestId('zms-fullscreen-controls')).toBeNull();
    expect(screen.getByTestId('zms-speed-100')).toBeTruthy();

    cleanup();
    renderPlayer({ fullscreen: true });
    const area = screen.getByTestId('zms-video-area');
    expect(area.className).not.toContain('aspect-video');
    expect(area.className).toContain('h-full');
    // Only transport and progress ride on the picture; the full card with
    // speed presets would leave a landscape phone no room for it.
    const overlay = screen.getByTestId('zms-fullscreen-controls');
    expect(overlay.contains(screen.getByTestId('zms-play-pause'))).toBe(true);
    expect(screen.queryByTestId('zms-speed-100')).toBeNull();
  });

  it('shows the ZMS notice only when playback fell back from video', () => {
    renderPlayer();
    expect(screen.queryByText('event_detail.zms_playback')).toBeNull();

    cleanup();
    renderPlayer({ showNotice: true });
    expect(screen.getByText('event_detail.zms_playback')).toBeTruthy();
  });

  // Suspension (#272, #547): something covers the stream (the frame viewer,
  // the Nearby panel). A paused zms keeps its MJPEG response open and holds
  // one of the browser's connections to the server, so the stream is quit,
  // not paused, and a running one restarts on a fresh connkey on release.
  const suspendedPlayer = (suspended: boolean) => (
    <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" profileId={undefined} token="tok" totalFrames={100}
      alarmFrames={0} eventLength={10} suspended={suspended} />
  );

  it('quits a running stream while suspended and restarts it on a fresh connkey on release', () => {
    const { rerender } = renderPlayer();
    const streamConnkey = connkeyOf(getStreamImg().src);
    fireEvent.load(getStreamImg());

    rerender(suspendedPlayer(true));
    expect(quitCalls().map((c) => connkeyOf(c[0] as string))).toEqual([streamConnkey]);
    expect(callsForCommand('1')).toHaveLength(0);

    rerender(suspendedPlayer(false));
    expect(connkeyOf(getStreamImg().src)).not.toBe(streamConnkey);
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.pause');
  });

  // Back from a nearby event lands on this event with the panel already open,
  // so the player mounts suspended. Starting the stream then would hold a
  // connection behind the panel and leak it when release restarts the stream.
  it('starts no stream while mounted suspended, and one on release', () => {
    const { rerender } = render(suspendedPlayer(true));
    expect(screen.queryByAltText('event_detail.event_playback')).toBeNull();

    rerender(suspendedPlayer(false));
    expect(connkeyOf(getStreamImg().src)).toBeTruthy();
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.pause');
    expect(quitCalls()).toHaveLength(0);
  });

  it('does not quit the suspended stream a second time on unmount', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderPlayer();
    fireEvent.load(getStreamImg());
    rerender(suspendedPlayer(true));

    unmount();
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);

    expect(quitCalls()).toHaveLength(1);
  });

  it('leaves an already paused stream stopped after suspension, and play starts a new one', () => {
    const { rerender } = renderPlayer();
    const streamConnkey = connkeyOf(getStreamImg().src);
    fireEvent.load(getStreamImg());
    fireEvent.click(screen.getByTitle('event_detail.pause'));

    rerender(suspendedPlayer(true));
    rerender(suspendedPlayer(false));
    expect(quitCalls()).toHaveLength(1);
    expect(connkeyOf(getStreamImg().src)).toBe(streamConnkey);
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.play');

    fireEvent.click(screen.getByTestId('zms-play-pause'));
    expect(connkeyOf(getStreamImg().src)).not.toBe(streamConnkey);
    expect(callsForCommand('2')).toHaveLength(0);
  });

  // The frame carousel above the player owns the alarm-frame thumbnail now
  // (refs #272); only the quick-jump button remains here for seeking to it.
  it('shows no alarm-frame thumbnail, only the quick-jump button', () => {
    render(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" profileId={undefined} token="tok" totalFrames={100}
        alarmFrames={5} alarmFrameId="10" maxScoreFrameId="20" eventLength={10} />
    );

    expect(screen.queryByTestId('zms-jump-to-alarm-frame')).toBeNull();
    expect(screen.getByTestId('zms-quick-jump-alarm-frame')).toBeTruthy();
    expect(screen.getByTestId('zms-jump-to-max-score-frame')).toBeTruthy();
  });

  it('drops the max-score card when it is the same frame as the alarm', () => {
    render(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" profileId={undefined} token="tok" totalFrames={100}
        alarmFrames={5} alarmFrameId="10" maxScoreFrameId="10" eventLength={10} />
    );

    expect(screen.queryByTestId('zms-jump-to-max-score-frame')).toBeNull();
  });

  it('stops at the event end instead of requesting a ZMS replay loop', () => {
    renderPlayer();

    expect(new URL(getStreamImg().src).searchParams.get('replay')).toBe('none');
  });

  it('seeks against the ZMS-reported duration, not the DB event length', async () => {
    vi.useFakeTimers();
    // eventLength prop is 10, but the running stream reports a 20s duration.
    httpGetMock.mockImplementation((url: string) => {
      if (commandOf(url) === '99') {
        return Promise.resolve({ data: { status: { progress: 0, duration: 20 } } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPlayer();
    fireEvent.load(getStreamImg());

    // Fire one status poll so the player learns the real duration (20s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Seek to the end: the offset must be the full reported duration (20s),
    // not the DB Length (10s).
    fireEvent.click(screen.getByTestId('zms-go-to-end'));

    const seek = callsForCommand('14').at(-1);
    expect(seek).toBeDefined();
    expect(new URL(seek![0] as string).searchParams.get('offset')).toBe('20');
  });

  it('scrubs with seek alone, without pausing or resuming the stream', () => {
    renderPlayer();
    fireEvent.load(getStreamImg());
    const track = stubTrack();

    // Grabbing/moving the scrub bar issues a seek (CMD_SEEK = 14)...
    fireEvent.mouseDown(track, { clientX: 100 });
    expect(callsForCommand('14').length).toBeGreaterThan(0);

    fireEvent.mouseUp(window);

    // ...but never pauses (CMD_PAUSE = 1) or resumes (CMD_PLAY = 2): the seek
    // drives playback by itself (refs #196).
    expect(callsForCommand('1')).toHaveLength(0);
    expect(callsForCommand('2')).toHaveLength(0);
  });

  it('repeats a settled seek after a delay to flush the paused frame (refs #196)', async () => {
    // A paused/idle zms only pushes its next MJPEG frame on the 5s keepalive, so
    // a lone seek shows ~5s late in the <img>. Repeating the seek makes a second
    // frame flush the first. streamDuration is null here (no poll yet), so the
    // stream is not confirmed advancing and the flush must fire.
    vi.useFakeTimers();
    renderPlayer();
    fireEvent.load(getStreamImg());

    fireEvent.click(screen.getByTestId('zms-go-to-end'));

    // The immediate seek goes out first.
    let seeks = callsForCommand('14');
    expect(seeks).toHaveLength(1);
    const offset = new URL(seeks[0][0] as string).searchParams.get('offset');

    // Before the delay elapses, no repeat yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_SEEK_FLUSH_DELAY_MS - 50);
    });
    expect(callsForCommand('14')).toHaveLength(1);

    // After the delay, a second seek to the same offset flushes the frame.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    seeks = callsForCommand('14');
    expect(seeks).toHaveLength(2);
    expect(new URL(seeks[1][0] as string).searchParams.get('offset')).toBe(offset);
  });

  it('does not repeat the seek while the stream is confirmed playing (refs #196)', async () => {
    // With a working status poll and isPlaying, frames already flow, so the next
    // played frame flushes the seek. Repeating it would yank playback backward.
    vi.useFakeTimers();
    httpGetMock.mockImplementation((url: string) => {
      if (commandOf(url) === '99') {
        return Promise.resolve({ data: { status: { progress: 1, duration: 20 } } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPlayer();
    fireEvent.load(getStreamImg());

    // One poll teaches the player the stream is advancing (duration known).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    httpGetMock.mockClear();

    fireEvent.click(screen.getByTestId('zms-go-to-end'));
    expect(callsForCommand('14')).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_SEEK_FLUSH_DELAY_MS + 100);
    });
    // Still only the one seek: no flush repeat while playing.
    expect(callsForCommand('14')).toHaveLength(1);
  });

  it('keeps the img src and connkey unchanged when playback speed changes', () => {
    renderPlayer();
    const initialSrc = getStreamImg().src;
    const initialConnkey = connkeyOf(initialSrc);
    expect(initialConnkey).toBeTruthy();
    expect(new URL(initialSrc).searchParams.get('rate')).toBe('100');

    fireEvent.click(screen.getByTestId('zms-speed-200'));

    expect(getStreamImg().src).toBe(initialSrc);
    expect(connkeyOf(getStreamImg().src)).toBe(initialConnkey);
  });

  it('sends CMD_VARPLAY with the new rate over the existing connkey on speed change', () => {
    renderPlayer();
    const streamConnkey = connkeyOf(getStreamImg().src);

    fireEvent.click(screen.getByTestId('zms-speed-200'));

    const varplayCall = httpGetMock.mock.calls.find(
      (call) => new URL(call[0] as string).searchParams.get('command') === '15'
    );
    expect(varplayCall).toBeDefined();
    const url = new URL(varplayCall![0] as string);
    expect(url.searchParams.get('rate')).toBe('200');
    expect(url.searchParams.get('connkey')).toBe(streamConnkey);
  });

  it('resumes the playing state after a speed change', () => {
    renderPlayer();
    // Pause first (command=1)
    fireEvent.click(screen.getByTestId('zms-play-pause'));
    const pauseCall = httpGetMock.mock.calls.find(
      (call) => new URL(call[0] as string).searchParams.get('command') === '1'
    );
    expect(pauseCall).toBeDefined();

    fireEvent.click(screen.getByTestId('zms-speed-50'));

    // Player shows the pause icon again, meaning isPlaying is true
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.pause');
  });

  it('sends one CMD_QUIT with a timeout for the stream connkey on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderPlayer();
    const img = getStreamImg();
    const streamConnkey = connkeyOf(img.src);
    fireEvent.load(img);

    unmount();
    // The quit is delayed by a grace period so a remount can cancel it
    expect(quitCalls()).toHaveLength(0);
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs + 1);

    const quits = quitCalls();
    expect(quits).toHaveLength(1);
    expect(connkeyOf(quits[0][0] as string)).toBe(streamConnkey);
    // API_REQUEST.cmdQuitTimeoutSeconds (3), converted to ms
    expect(quits[0][1]).toEqual({ timeoutMs: 3000 });
  });

  it('does not send CMD_QUIT on unmount when the stream never loaded', () => {
    vi.useFakeTimers();
    const { unmount } = renderPlayer();

    unmount();
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);

    expect(quitCalls()).toHaveLength(0);
  });

  it('does not kill the live stream under StrictMode double-mount', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <StrictMode>
        <ZmsEventPlayer
          portalUrl="https://zm.test"
          eventId="42"
          profileId={undefined}
          token="tok"
          totalFrames={100}
          alarmFrames={0}
          eventLength={10}
        />
      </StrictMode>
    );
    const img = getStreamImg();
    const streamConnkey = connkeyOf(img.src);
    fireEvent.load(img);

    // No CMD_QUIT while the component remains mounted, even after the
    // StrictMode mount -> cleanup -> mount cycle and the grace delay
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);
    expect(quitCalls()).toHaveLength(0);

    unmount();
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);

    const quits = quitCalls();
    expect(quits).toHaveLength(1);
    expect(connkeyOf(quits[0][0] as string)).toBe(streamConnkey);
  });
});

/**
 * zms exits when it cannot serve a frame: a decode failure paints an error such
 * as "Failed getting frame" into the MJPEG stream and quits. The <img> then
 * holds that last frame forever, so the only way out was leaving the event and
 * coming back. Once its process is gone, zms answers the status query without
 * playback state, which is what these tests drive.
 */
describe('ZmsEventPlayer stream recovery', () => {
  // Matches the zmsStatusInterval the bandwidth mock reports.
  const POLL_MS = 5000; // matches bandwidthMode 'low' -> zmsStatusInterval

  const pollTimes = async (count: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * count);
    });
  };

  beforeEach(() => {
    cleanup();
    httpGetMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    httpGetMock.mockReset();
    httpGetMock.mockResolvedValue({ data: {} });
  });

  it('restarts the stream on a fresh connkey after zms drops it', async () => {
    // The default mock answers every query with no playback state.
    renderPlayer();
    const before = connkeyOf(getStreamImg().src);
    fireEvent.load(getStreamImg());

    await pollTimes(ZMS_STREAM_DEAD_POLLS);

    expect(connkeyOf(getStreamImg().src)).not.toBe(before);
  });

  it('leaves a stream that reports playback alone', async () => {
    httpGetMock.mockImplementation((url: string) =>
      commandOf(url) === '99'
        ? Promise.resolve({ data: { status: { progress: 1, duration: 20 } } })
        : Promise.resolve({ data: {} })
    );
    renderPlayer();
    const before = connkeyOf(getStreamImg().src);
    fireEvent.load(getStreamImg());

    await pollTimes(ZMS_STREAM_DEAD_POLLS + 2);

    expect(connkeyOf(getStreamImg().src)).toBe(before);
  });

  it('resumes from the frame the stream died on, not the start', async () => {
    // First poll puts the playhead halfway through a 100-frame event; every
    // later poll reports nothing, so the stream is judged gone from frame 50.
    let polls = 0;
    httpGetMock.mockImplementation((url: string) => {
      if (commandOf(url) !== '99') return Promise.resolve({ data: {} });
      polls += 1;
      return Promise.resolve(
        polls === 1 ? { data: { status: { progress: 5, duration: 10 } } } : { data: {} }
      );
    });
    renderPlayer();
    expect(new URL(getStreamImg().src).searchParams.get('frame')).toBe('1');
    fireEvent.load(getStreamImg());

    // Settle the first poll on its own: batching several fake-timer ticks into
    // one advance lets a later tick read the playhead before the earlier one's
    // state has committed.
    await pollTimes(1);
    await pollTimes(ZMS_STREAM_DEAD_POLLS);

    expect(new URL(getStreamImg().src).searchParams.get('frame')).toBe('50');
  });

  it('stops restarting at the cap, and starts a new stream when the user hits play', async () => {
    renderPlayer();
    const seen = new Set([connkeyOf(getStreamImg().src)]);

    // Each restart needs its own load before the next death can be detected.
    for (let i = 0; i < ZMS_STREAM_MAX_RESTARTS + 1; i += 1) {
      fireEvent.load(getStreamImg());
      await pollTimes(ZMS_STREAM_DEAD_POLLS);
      seen.add(connkeyOf(getStreamImg().src));
    }
    expect(seen.size).toBe(ZMS_STREAM_MAX_RESTARTS + 1);

    const stalled = connkeyOf(getStreamImg().src);
    // Giving up stops the polling and shows the stream as stopped, so the
    // button offers play rather than pause.
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.play');

    fireEvent.click(screen.getByTestId('zms-play-pause'));

    expect(connkeyOf(getStreamImg().src)).not.toBe(stalled);
  });
});

/**
 * Refs #337. Inside a server group there is no current profile, so the
 * player's own token-freshness check has to name the event's owning profile.
 * Unparented it resolved to the empty auth slice (requiresAuth true, no
 * token), the stream URL stayed empty, and JPEG-only playback never started.
 */
describe('ZmsEventPlayer token freshness', () => {
  beforeEach(() => {
    cleanup();
  });

  it('asks about the owning profile, not the current one', () => {
    const spy = vi.spyOn(freshTokenModule, 'useFreshAccessToken');
    renderPlayer({ profileId: asProfileId('p-owner') });
    expect(spy).toHaveBeenCalledWith('p-owner');
  });

  it('streams the event once that profile has a fresh token', () => {
    renderPlayer({ profileId: asProfileId('p-owner') });
    expect(getStreamImg().getAttribute('src')).toContain('zm.test');
  });

  // An <img src=""> paints the browser's broken-image glyph and its alt text
  // over the no-video placeholder, which is what the placeholder is for.
  it('renders no image at all while the URL is unavailable', () => {
    // No token at all for p-cold (real useFreshAccessToken): requiresAuth
    // stays true with nothing to refresh into, so isFresh is false.
    useAuthStore.getState().logout(asProfileId('p-cold'));
    renderPlayer({ profileId: asProfileId('p-cold') });

    expect(screen.queryByAltText('event_detail.event_playback')).toBeNull();
  });
});
