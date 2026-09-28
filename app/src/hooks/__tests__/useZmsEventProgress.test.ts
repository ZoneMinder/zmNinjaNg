/**
 * When a ZMS event stream counts as done (refs #534). The status answers are
 * the shapes a real ZoneMinder server gave for events 364970 and 364972.
 */
import { describe, it, expect } from 'vitest';
import { nextZmsProbe, ZMS_PROBE_START } from '../useZmsEventProgress';

const status = (progress: number, duration = 31.71) => ({ progress, duration });

describe('nextZmsProbe', () => {
  it('tracks the fraction played and is not done mid-event', () => {
    const probe = nextZmsProbe(ZMS_PROBE_START, status(11.15));
    expect(probe.fraction).toBeCloseTo(11.15 / 31.71);
    expect(probe.done).toBe(false);
  });

  it('is done once the stream reaches the end', () => {
    expect(nextZmsProbe(ZMS_PROBE_START, status(31.6)).done).toBe(true);
  });

  it('is done when progress goes backwards, because replay=single loops', () => {
    // Last poll before the end read 31.23/31.71 (under 0.99); the next had wrapped.
    const before = nextZmsProbe(ZMS_PROBE_START, status(31.23));
    expect(before.done).toBe(false);
    const after = nextZmsProbe(before, status(2.96));
    expect(after).toMatchObject({ done: true, fraction: 1 });
  });

  it('is done after two answers with no playback state', () => {
    // A sub-second event: zms never opens its control socket.
    const socketMissing = { result: 'Error' } as never;
    const once = nextZmsProbe(ZMS_PROBE_START, socketMissing);
    expect(once.done).toBe(false);
    expect(nextZmsProbe(once, undefined).done).toBe(true);
  });

  it('forgets a missed answer once the stream answers again', () => {
    const missed = nextZmsProbe(ZMS_PROBE_START, undefined);
    const back = nextZmsProbe(missed, status(5));
    expect(nextZmsProbe(back, undefined).done).toBe(false);
  });
});
