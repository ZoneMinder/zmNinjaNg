/**
 * When a ZMS event stream counts as done (refs #534). The status answers are
 * the shapes a real ZoneMinder server gave for events 364970 and 364972.
 */
import { describe, it, expect } from 'vitest';
import { nextZmsProbe, ZMS_PROBE_START } from '../useZmsEventProgress';

const status = (progress: number, duration = 31.71, rate = 2) => ({ progress, duration, rate });
const POLL = 3_000;

describe('nextZmsProbe', () => {
  it('tracks the fraction played and is not done mid-event', () => {
    const probe = nextZmsProbe(ZMS_PROBE_START, status(11.15), POLL);
    expect(probe.fraction).toBeCloseTo(11.15 / 31.71);
    expect(probe.done).toBe(false);
  });

  it('predicts where the stream will be at the next poll, at its own rate', () => {
    // At 2x, a 3s poll covers 6s of the event.
    const probe = nextZmsProbe(ZMS_PROBE_START, status(10), POLL);
    expect(probe.ahead).toBeCloseTo(16 / 31.71);
    expect(probe.remainingMs).toBeCloseTo(((31.71 - 10) / 2) * 1000);
    expect(nextZmsProbe(ZMS_PROBE_START, status(30), POLL).ahead).toBe(1);
  });

  it('is done when a replay=none stream pauses on its last frame', () => {
    // The 0.83s event, played once: zms holds it at progress == duration.
    expect(nextZmsProbe(ZMS_PROBE_START, status(0.83, 0.83), POLL)).toMatchObject({ done: true, fraction: 1 });
  });

  it('is done once the stream reaches the end', () => {
    expect(nextZmsProbe(ZMS_PROBE_START, status(31.6), POLL).done).toBe(true);
  });

  it('is done when progress goes backwards, because replay=single loops', () => {
    // Last poll before the end read 31.23/31.71 (under 0.99); the next had wrapped.
    const before = nextZmsProbe(ZMS_PROBE_START, status(31.23), POLL);
    expect(before.done).toBe(false);
    const after = nextZmsProbe(before, status(2.96), POLL);
    expect(after).toMatchObject({ done: true, fraction: 1 });
  });

  it('is done after two answers with no playback state', () => {
    // A sub-second event: zms never opens its control socket.
    const socketMissing = { result: 'Error' } as never;
    const once = nextZmsProbe(ZMS_PROBE_START, socketMissing, POLL);
    expect(once.done).toBe(false);
    expect(nextZmsProbe(once, undefined, POLL).done).toBe(true);
  });

  it('forgets a missed answer once the stream answers again', () => {
    const missed = nextZmsProbe(ZMS_PROBE_START, undefined, POLL);
    const back = nextZmsProbe(missed, status(5), POLL);
    expect(nextZmsProbe(back, undefined, POLL).done).toBe(false);
  });
});
