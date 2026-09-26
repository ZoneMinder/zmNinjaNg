/**
 * Sequence play replays its tiles on one shared clock (refs #534): each tile
 * streams only inside its own slot, then falls back to its thumbnail, which
 * unmounts the player and quits its ZMS stream. Real stores; the clock is
 * faked.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));
vi.mock('../../../../lib/zm/zms-quit', () => ({
  sendDelayedCmdQuit: vi.fn(),
  cancelPendingQuit: vi.fn(() => false),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => `${key}${opts?.count !== undefined ? `:${opts.count}` : ''}`,
    i18n: { language: 'en' },
  }),
}));

import { EventContextSequence } from '../EventContextSequence';
import { seedProfiles, resetProfileFixture, asProfileId, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { sendDelayedCmdQuit } from '../../../../lib/zm/zms-quit';

/** Event ids whose streams were told to quit, in order. */
const quitIds = () =>
  vi.mocked(sendDelayedCmdQuit).mock.calls.map((c) => (c[2] as { logContext: { eventId: string } }).logContext.eventId);

const P = asProfileId('p1');

const row = (id: string, offsetMs: number, lengthSeconds: number) => ({
  event: { Id: id, MonitorId: '3', Name: `Event ${id}`, StartDateTime: '2026-09-17 21:14:03', Length: String(lengthSeconds) } as never,
  offsetMs,
  isAnchor: offsetMs === 0,
});

// At the default 2x rate: a plays 0-5s; the 50s gap before the anchor is cut,
// so b plays 5-24s; the 20 minute gap is cut too, so c plays 24-26.5s.
const rows = [row('a', -60_000, 10), row('b', 0, 38), row('c', 20 * 60_000, 5)];

function renderGrid(open = true) {
  return render(
    <MemoryRouter>
      <EventContextSequence open={open} onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map([['3', 'Door']])} />
    </MemoryRouter>
  );
}

const playingIds = () =>
  screen
    .queryAllByTestId(/^event-context-sequence-tile-/)
    .filter((el) => el.getAttribute('data-playing') === 'true')
    .map((el) => el.getAttribute('data-testid')!.replace('event-context-sequence-tile-', ''));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(sendDelayedCmdQuit).mockClear();
  seedProfiles([P]);
});

afterEach(() => {
  vi.useRealTimers();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventContextSequence', () => {
  it('plays each tile inside its own slot, one after another across a cut gap', () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);

    act(() => vi.advanceTimersByTime(5_000));
    expect(playingIds()).toEqual(['b']);
    expect(quitIds()).toEqual(['a']);

    act(() => vi.advanceTimersByTime(19_000));
    expect(playingIds()).toEqual(['c']);

    act(() => vi.advanceTimersByTime(2_500));
    expect(playingIds()).toEqual([]);
    expect(quitIds()).toEqual(['a', 'b', 'c']);
  });

  it('runs the clock and the streams at the hover preview speed', () => {
    seedProfiles([P], { settings: { p1: { hoverPreviewPlaybackRate: 100 } } });
    renderGrid();
    // At 1x, a plays 0-10s; at the default 2x it would have ended at 5s.
    act(() => vi.advanceTimersByTime(6_000));
    expect(playingIds()).toEqual(['a']);
    const img = screen.getByTestId('event-context-sequence-tile-a').querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/[?&]rate=100(&|$)/);

    act(() => vi.advanceTimersByTime(4_000));
    expect(playingIds()).toEqual(['b']);
  });

  it('plays every tile at once after the together toggle is pressed', () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);

    const toggle = screen.getByTestId('event-context-sequence-together');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a', 'b', 'c']);

    // Each still stops at its own end: c (5s, so 2.5s at 2x) first.
    act(() => vi.advanceTimersByTime(2_500));
    expect(playingIds()).toEqual(['a', 'b']);
  });

  it('holds together mode to the stream budget of a server without multiport', () => {
    const many = Array.from({ length: 7 }, (_, i) => row(`e${i}`, i * 1_000, 10));
    render(
      <MemoryRouter>
        <EventContextSequence open onOpenChange={() => {}} rows={many} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('event-context-sequence-together'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toHaveLength(5);
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

  it('starts over from the first tile on replay', () => {
    renderGrid();
    act(() => vi.advanceTimersByTime(30_000));
    expect(playingIds()).toEqual([]);

    fireEvent.click(screen.getByTestId('event-context-sequence-replay'));
    act(() => vi.advanceTimersByTime(0));
    expect(playingIds()).toEqual(['a']);
  });

  it('stops every stream when the dialog closes', () => {
    const { rerender } = renderGrid();
    act(() => vi.advanceTimersByTime(6_000));
    expect(playingIds()).toEqual(['b']);

    rerender(
      <MemoryRouter>
        <EventContextSequence open={false} onOpenChange={() => {}} rows={rows} profileId={P} monitorNames={new Map()} />
      </MemoryRouter>
    );
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByTestId('event-context-sequence')).toBeNull();
    // One 6s step batches a's start and stop, so only b ever mounted.
    expect(quitIds()).toEqual(['b']);
  });
});
