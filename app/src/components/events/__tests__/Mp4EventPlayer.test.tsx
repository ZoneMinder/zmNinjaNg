/**
 * Mp4EventPlayer source-update tests.
 *
 * The page rebuilds the video URL whenever the access token refreshes, so the
 * src prop changes with only its token query parameter different. The player
 * must carry playback position and play/pause state across that swap, while a
 * genuinely different event still starts at the beginning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Mp4EventPlayer } from '../Mp4EventPlayer';
import { log } from '../../../lib/logger';

const h = vi.hoisted(() => {
  const state = {
    src: '',
    currentTime: 0,
    paused: true,
    poster: '',
    autoplay: false,
    fluid: true,
    fill: false,
    rate: 1,
    defaultRate: 1,
    disposed: false,
  };
  const listeners = new Map<string, Array<() => void>>();

  const add = (event: string, handler: () => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler]);
  };
  const remove = (event: string, handler: () => void) => {
    listeners.set(event, (listeners.get(event) ?? []).filter((fn) => fn !== handler));
  };

  const play = vi.fn(() => {
    state.paused = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => { state.paused = true; });

  const player = {
    isDisposed: () => state.disposed,
    dispose: () => { state.disposed = true; },
    currentSrc: () => state.src,
    src: (sources?: Array<{ src: string; type?: string }>) => {
      if (sources) {
        state.src = sources[0]?.src ?? '';
        state.currentTime = 0;
        if (state.autoplay) state.paused = false;
      }
      return state.src;
    },
    currentTime: (time?: number) => {
      if (typeof time === 'number') state.currentTime = time;
      return state.currentTime;
    },
    paused: (paused?: boolean) => {
      if (typeof paused === 'boolean') state.paused = paused;
      return state.paused;
    },
    play,
    pause,
    poster: (poster?: string) => {
      if (typeof poster === 'string') state.poster = poster;
      return state.poster;
    },
    autoplay: (autoplay?: boolean) => {
      if (typeof autoplay === 'boolean') state.autoplay = autoplay;
      return state.autoplay;
    },
    fluid: (fluid?: boolean) => {
      if (typeof fluid === 'boolean') state.fluid = fluid;
      return state.fluid;
    },
    fill: (fill?: boolean) => {
      if (typeof fill === 'boolean') state.fill = fill;
      return state.fill;
    },
    playbackRate: (rate?: number) => {
      if (typeof rate === 'number') state.rate = rate;
      return state.rate;
    },
    defaultPlaybackRate: (rate?: number) => {
      if (typeof rate === 'number') state.defaultRate = rate;
      return state.defaultRate;
    },
    on: (events: string | string[], handler: () => void) => {
      const names = Array.isArray(events) ? events : [events];
      names.forEach((event) => add(event, handler));
    },
    one: (event: string, handler: () => void) => {
      const wrapped = () => {
        remove(event, wrapped);
        handler();
      };
      add(event, wrapped);
    },
    off: (event: string, handler: () => void) => remove(event, handler),
    readyState: () => 1,
    isReady_: true,
    emit: (event: string) => {
      [...(listeners.get(event) ?? [])].forEach((handler) => handler());
    },
  };

  const videojs = vi.fn((_element: unknown, options?: { sources?: Array<{ src: string }>; autoplay?: boolean }, ready?: () => void) => {
    state.src = options?.sources?.[0]?.src ?? '';
    state.autoplay = options?.autoplay ?? false;
    if (state.autoplay) state.paused = false;
    ready?.();
    return player;
  }) as unknown as { (...args: unknown[]): typeof player; log: () => void };
  videojs.log = vi.fn();

  return { player, videojs, state, play, pause };
});

vi.mock('video.js', () => ({ default: h.videojs }));
vi.mock('videojs-markers', () => ({}));
vi.mock('../../../contexts/PipContext', () => ({
  usePip: () => ({
    adoptForPip: vi.fn(),
    reclaimFromPip: vi.fn(),
    closePip: vi.fn(),
    activePipEventId: null,
    enterAndroidPip: vi.fn(),
    getAndroidPipPosition: vi.fn(() => 0),
    isAndroid: false,
  }),
}));
vi.mock('../../../plugins/pip', () => ({
  Pip: { isPipSupported: vi.fn().mockResolvedValue({ supported: false }) },
}));

function tokenSrc(token: string, eid = '101') {
  return `https://zm.test/index.php?mode=mp4&format=h264&eid=${eid}&view=view_video&token=${token}`;
}

beforeEach(() => {
  h.state.src = '';
  h.state.currentTime = 0;
  h.state.paused = true;
  h.state.poster = '';
  h.state.autoplay = false;
  h.state.fluid = true;
  h.state.fill = false;
  h.state.rate = 1;
  h.state.defaultRate = 1;
  h.state.disposed = false;
  h.play.mockClear();
  h.pause.mockClear();
});

describe('Mp4EventPlayer src refresh', () => {
  it('resumes a playing video at the same position when only the token changes', () => {
    const { rerender } = render(<Mp4EventPlayer src={tokenSrc('old')} />);
    expect(h.player.currentSrc()).toBe(tokenSrc('old'));

    act(() => {
      h.player.currentTime(42);
      h.player.paused(false);
    });

    rerender(<Mp4EventPlayer src={tokenSrc('new')} />);
    expect(h.player.currentSrc()).toBe(tokenSrc('new'));

    act(() => h.player.emit('loadedmetadata'));

    expect(h.player.currentTime()).toBe(42);
    expect(h.player.paused()).toBe(false);
    expect(h.play).toHaveBeenCalled();
  });

  it('stays paused when only the token changes on a paused video', () => {
    const { rerender } = render(<Mp4EventPlayer src={tokenSrc('old')} autoplay />);
    expect(h.player.paused()).toBe(false);

    act(() => {
      h.player.paused(true);
      h.player.currentTime(42);
    });

    rerender(<Mp4EventPlayer src={tokenSrc('new')} autoplay />);
    act(() => h.player.emit('loadedmetadata'));

    expect(h.player.currentTime()).toBe(42);
    expect(h.player.paused()).toBe(true);
    expect(h.pause).toHaveBeenCalled();
    expect(h.play).not.toHaveBeenCalled();
  });

  it('starts a different event from the beginning', () => {
    const { rerender } = render(<Mp4EventPlayer src={tokenSrc('old', '101')} />);

    act(() => {
      h.player.currentTime(42);
      h.player.paused(false);
    });

    rerender(<Mp4EventPlayer src={tokenSrc('new', '102')} />);
    act(() => h.player.emit('loadedmetadata'));

    expect(h.player.currentTime()).toBe(0);
    expect(h.play).not.toHaveBeenCalled();
  });

  it('logs a refused resume instead of leaving the play() rejection unhandled', async () => {
    const logSpy = vi.spyOn(log, 'videoPlayer');
    const { rerender } = render(<Mp4EventPlayer src={tokenSrc('old')} />);
    act(() => {
      h.player.currentTime(42);
      h.player.paused(false);
    });

    const refusal = new Error('NotAllowedError');
    h.play.mockImplementationOnce(() => Promise.reject(refusal));
    rerender(<Mp4EventPlayer src={tokenSrc('new')} />);
    await act(async () => h.player.emit('loadedmetadata'));

    expect(logSpy).toHaveBeenCalledWith(
      'Resume after token refresh failed',
      expect.anything(),
      { error: refusal },
    );
    logSpy.mockRestore();
  });
});
