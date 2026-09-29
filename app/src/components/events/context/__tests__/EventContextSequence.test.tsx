/**
 * Sequence play replays its tiles in runs (refs #534): a tile streams until
 * its ZMS status probe says it is done, then falls back to its thumbnail,
 * which unmounts the player and quits its ZMS stream. Real stores and the
 * real probe; `httpGet` answers each connkey's status query as the test sets
 * it, and the clock is faked.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));
vi.mock('../../../../lib/zm/zms-quit', () => ({
  sendDelayedCmdQuit: vi.fn(),
  cancelPendingQuit: vi.fn(() => false),
}));
// Status answers by connkey. A connkey with no entry is a running stream at
// its start; 'gone' is one whose zms never answers (a sub-second event).
const zmsStatus = new Map<string, number | 'gone'>();
vi.mock('../../../../lib/http', async (importActual) => ({
  ...(await importActual<object>()),
  httpGet: vi.fn(async (url: string) => {
    const state = zmsStatus.get(new URL(url).searchParams.get('connkey') ?? '') ?? 0;
    if (state === 'gone') throw new Error('Socket does not exist');
    return { data: { status: { progress: state, duration: 100 } } };
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; total?: string }) =>
      `${key}${opts?.count !== undefined ? `:${opts.count}` : ''}${opts?.total !== undefined ? `/${opts.total}` : ''}`,
    i18n: { language: 'en' },
  }),
}));

import { EventContextSequence } from '../EventContextSequence';
import { seedProfiles, resetProfileFixture, asProfileId, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { sendDelayedCmdQuit } from '../../../../lib/zm/zms-quit';
import { useReturnHighlightStore } from '../../../../stores/returnHighlight';

/** Event ids whose streams were told to quit, in order. */
const quitIds = () =>
  vi.mocked(sendDelayedCmdQuit).mock.calls.map((c) => (c[2] as { logContext: { eventId: string } }).logContext.eventId);

const P = asProfileId('p1');

const row = (id: string, offsetMs: number, lengthSeconds: number) => ({
  event: { Id: id, MonitorId: '3', Name: `Event ${id}`, StartDateTime: '2026-09-17 21:14:03', Length: String(lengthSeconds) } as never,
  offsetMs,
  isAnchor: offsetMs === 0,
});

// Three runs: none of these overlap, so each plays alone.
const rows = [row('a', -60_000, 10), row('b', 0, 38), row('c', 20 * 60_000, 5)];

function renderGrid(open = true) {
  return render(
    <MemoryRouter>
      <EventContextSequence open={open} onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map([['3', 'Door']])} />
    </MemoryRouter>
  );
}

/** The connkey of the stream a playing tile holds. */
const connkeyOf = (id: string) => {
  const src = screen.getByTestId(`event-context-sequence-tile-${id}`).querySelector('img')?.getAttribute('src') ?? '';
  return new URL(src).searchParams.get('connkey') ?? '';
};

/** Long enough for two status polls at any bandwidth setting. */
const POLLS = 10_000;

/** Lets the probe of each tile named see its stream at `progress` (of 100). */
async function report(ids: string[], progress: number | 'gone') {
  for (const id of ids) zmsStatus.set(connkeyOf(id), progress);
  await act(() => vi.advanceTimersByTimeAsync(POLLS));
}

const finish = (...ids: string[]) => report(ids, 100);

const playingIds = () =>
  screen
    .queryAllByTestId(/^event-context-sequence-tile-/)
    .filter((el) => el.getAttribute('data-playing') === 'true')
    .map((el) => el.getAttribute('data-testid')!.replace('event-context-sequence-tile-', ''));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(sendDelayedCmdQuit).mockClear();
  zmsStatus.clear();
  seedProfiles([P]);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useReturnHighlightStore.getState().clear();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventContextSequence', () => {
  it('plays each run until its stream reports done, however long that takes', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);

    // a is 10s long, but its stream has not reached the end yet: keep playing.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(playingIds()).toEqual(['a']);
    expect(quitIds()).toEqual([]);

    await finish('a');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['b']);
    expect(quitIds()).toEqual(['a']);

    await finish('b');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['c']);

    await finish('c');
    expect(playingIds()).toEqual([]);
    expect(quitIds()).toEqual(['a', 'b', 'c']);
  });

  it('moves on from a stream that never answers its status query', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    await report(['a'], 'gone');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['b']);
  });

  it('draws the progress line of each tile from its probe', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    const line = screen.getByTestId('event-context-sequence-progress-a');
    expect(line).toHaveAttribute('aria-valuenow', '0');
    await report(['a'], 40);
    expect(line).toHaveAttribute('aria-valuenow', '40');
    await finish('a');
    expect(line).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('event-context-sequence-progress-c')).toHaveAttribute('aria-valuenow', '0');
  });

  it('fills the line over the time the stream has left, and snaps it full once done', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    const fill = () => screen.getByTestId('event-context-sequence-progress-a').firstElementChild as HTMLElement;
    // 98 of 100 at 1x: 2s left, which is less than one poll.
    await report(['a'], 98);
    expect(fill().style.width).toBe('100%');
    expect(fill().style.transitionDuration).toBe('2000ms');
    await finish('a');
    expect(fill().style.transitionDuration).toBe('0ms');
  });

  it('starts overlapping tiles at their real spacing, at the hover preview speed', () => {
    seedProfiles([P], { settings: { p1: { hoverPreviewPlaybackRate: 100 } } });
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={[row('x', 0, 10), row('y', 4_000, 10)]} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(playingIds()).toEqual(['x']);
    const img = screen.getByTestId('event-context-sequence-tile-x').querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/[?&]rate=100(&|$)/);
    // Played once and held on the last frame, never looped.
    expect(img?.getAttribute('src')).toMatch(/[?&]replay=none(&|$)/);
    act(() => vi.advanceTimersByTime(1_000));
    expect(playingIds()).toEqual(['x', 'y']);
  });

  it('plays every tile at once after the together toggle is pressed', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);

    // The button names the mode it is in.
    const toggle = screen.getByTestId('event-context-sequence-together');
    expect(toggle).toHaveTextContent('events.around.sequence_play_sequence');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('events.around.sequence_play_all');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a', 'b', 'c']);

    // Each stops when its own stream is done.
    await finish('c');
    expect(playingIds()).toEqual(['a', 'b']);
  });

  it('holds together mode to the stream budget of a server without multiport, freeing a slot when a stream is done', async () => {
    const many = Array.from({ length: 7 }, (_, i) => row(`e${i}`, i * 1_000, 10));
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('event-context-sequence-together'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    await finish('e1');
    expect(playingIds()).toEqual(['e0', 'e2', 'e3', 'e4', 'e5']);
  });

  it('lifts the stream budget when the server has multiport', () => {
    seedProfiles([makeProfile('p1', { minStreamingPort: 30000 })]);
    const many = Array.from({ length: 7 }, (_, i) => row(`e${i}`, i * 1_000, 10));
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('event-context-sequence-together'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toHaveLength(7);
  });

  it('scrolls each tile into view as it starts playing', async () => {
    // jsdom has no scrollIntoView; record which element asked for it.
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-testid') ?? '');
    };
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    await finish('a');
    act(() => vi.advanceTimersByTime(0));
    expect(scrolled).toEqual(['event-context-sequence-tile-a', 'event-context-sequence-tile-b']);
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('holds playback on return and flashes the tile the user came back from', () => {
    // Opening a tile marks it viewed; back remounts the dialog with it.
    useReturnHighlightStore.getState().markViewed('b');
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} returnedFrom="b" />
      </MemoryRouter>
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByTestId('event-context-sequence-tile-b')).toHaveAttribute('data-flash', 'true');
    expect(screen.getByTestId('event-context-sequence-tile-a')).toHaveAttribute('data-flash', 'false');

    act(() => vi.advanceTimersByTime(10_000));
    expect(playingIds()).toEqual([]);

    fireEvent.click(screen.getByTestId('event-context-sequence-replay'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);
  });

  it('continues the replay from the tapped tile, skipping the ones before it', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);

    fireEvent.click(screen.getByTestId('event-context-sequence-tile-b'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['b']);
    expect(quitIds()).toEqual(['a']);

    await finish('b');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['c']);
    await finish('c');
    expect(playingIds()).toEqual([]);
    // a is never replayed from here.
    act(() => vi.advanceTimersByTime(30_000));
    expect(playingIds()).toEqual([]);
  });

  it('in All, starts the tapped tile and every later one together', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('event-context-sequence-together'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a', 'b', 'c']);

    fireEvent.click(screen.getByTestId('event-context-sequence-tile-b'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['b', 'c']);
  });

  it('opens the event on a double tap', () => {
    function Path() {
      return <div data-testid="path">{useLocation().pathname}</div>;
    }
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} />
        <Path />
      </MemoryRouter>
    );
    const tile = screen.getByTestId('event-context-sequence-tile-b');
    fireEvent.click(tile);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(tile);
    expect(screen.getByTestId('path')).toHaveTextContent('/all/events/p1/b');
  });

  it('treats two taps far apart as two plays, not an open', () => {
    function Path() {
      return <div data-testid="path">{useLocation().pathname}</div>;
    }
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} />
        <Path />
      </MemoryRouter>
    );
    const tile = screen.getByTestId('event-context-sequence-tile-b');
    fireEvent.click(tile);
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(tile);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
    expect(playingIds()).toEqual(['b']);
  });

  it('lays the same nearest events out in the columns the user picks, 3 by default, and remembers it', async () => {
    // Radix opens its menu on real timers; nothing here waits on the replay clock.
    vi.useRealTimers();
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, i) => row(`e${i}`, (i - 10) * 1_000, 10));
    const view = () => (
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    const tileIds = () => screen.queryAllByTestId(/^event-context-sequence-tile-/).map((el) => el.dataset.testid);
    const columns = () => screen.getByTestId('event-context-sequence-tile-e10').parentElement?.style.gridTemplateColumns;
    const { unmount } = render(view());
    const nearest = tileIds();
    expect(nearest).toHaveLength(12);
    expect(columns()).toBe('repeat(3, minmax(0, 1fr))');

    await user.click(screen.getByTestId('event-context-sequence-grid'));
    await user.click(screen.getByTestId('event-context-sequence-grid-2'));
    expect(tileIds()).toEqual(nearest);
    expect(columns()).toBe('repeat(2, minmax(0, 1fr))');
    unmount();

    render(view());
    expect(columns()).toBe('repeat(2, minmax(0, 1fr))');
    await user.click(screen.getByTestId('event-context-sequence-grid'));
    await user.click(screen.getByTestId('event-context-sequence-grid-4'));
    expect(tileIds()).toEqual(nearest);
    expect(columns()).toBe('repeat(4, minmax(0, 1fr))');
  });

  it('keeps the playing stream going when the grid size changes', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    // Twenty back-to-back 10s events, none overlapping, anchor at e10.
    const many = Array.from({ length: 20 }, (_, i) => row(`e${i}`, (i - 10) * 20_000, 10));
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    // Tap e10, mid-grid, so it is the one playing.
    fireEvent.click(screen.getByTestId('event-context-sequence-tile-e10'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(playingIds()).toEqual(['e10']);
    const stream = connkeyOf('e10');

    await user.click(screen.getByTestId('event-context-sequence-grid'));
    await user.click(screen.getByTestId('event-context-sequence-grid-2'));
    // Same stream, not a restart.
    expect(playingIds()).toEqual(['e10']);
    expect(connkeyOf('e10')).toBe(stream);
    expect(quitIds()).toEqual([]);
  });

  it('shows as many nearby events as the replay tile setting asks for', () => {
    seedProfiles([P], { settings: { p1: { eventContextReplayTiles: 24 } } });
    const many = Array.from({ length: 30 }, (_, i) => row(`e${i}`, (i - 15) * 1_000, 10));
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    expect(screen.queryAllByTestId(/^event-context-sequence-tile-/)).toHaveLength(24);
    expect(screen.getByTestId('event-context-sequence-nearest')).toHaveTextContent('events.around.sequence_nearest:24/30');
  });

  it('says how many of the nearby events it shows when it cannot show them all', () => {
    const many = Array.from({ length: 15 }, (_, i) => row(`e${i}`, i * 1_000, 10));
    const { rerender } = render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('event-context-sequence-nearest')).toHaveTextContent('events.around.sequence_nearest:12/15');

    rerender(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} truncated />
      </MemoryRouter>
    );
    expect(screen.getByTestId('event-context-sequence-nearest')).toHaveTextContent('events.around.sequence_nearest:12/15+');
  });

  it('keeps the screen awake while open and lets it sleep once closed', async () => {
    // jsdom has no Wake Lock API; stand in for the platform's.
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release, addEventListener: vi.fn() }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });

    const { rerender } = renderGrid();
    await act(async () => {});
    expect(request).toHaveBeenCalledWith('screen');
    expect(release).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <EventContextSequence open={false} onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    await act(async () => {});
    expect(release).toHaveBeenCalled();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('remembers the mode the next time the replay opens', () => {
    const { unmount } = renderGrid();
    fireEvent.click(screen.getByTestId('event-context-sequence-together'));
    expect(screen.getByTestId('event-context-sequence-together')).toHaveAttribute('data-mode', 'together');
    unmount();

    renderGrid();
    expect(screen.getByTestId('event-context-sequence-together')).toHaveAttribute('data-mode', 'together');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a', 'b', 'c']);
  });

  it('starts over from the first tile on replay, on a fresh stream', async () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    const first = connkeyOf('a');
    fireEvent.click(screen.getByTestId('event-context-sequence-replay'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);
    expect(connkeyOf('a')).not.toBe(first);

    await finish('a');
    act(() => vi.advanceTimersByTime(0));
    await finish('b');
    act(() => vi.advanceTimersByTime(0));
    await finish('c');
    expect(playingIds()).toEqual([]);
    fireEvent.click(screen.getByTestId('event-context-sequence-replay'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);
  });

  it('stops every stream when the dialog closes', async () => {
    const { rerender } = renderGrid();
    act(() => vi.advanceTimersByTime(0));
    await finish('a');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['b']);

    rerender(
      <MemoryRouter>
        <EventContextSequence open={false} onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByTestId('event-context-sequence')).toBeNull();
    expect(quitIds()).toEqual(['a', 'b']);
  });
});
