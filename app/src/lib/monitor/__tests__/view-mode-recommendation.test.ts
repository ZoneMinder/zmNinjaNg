import { describe, it, expect } from 'vitest';
import { recommendViewMode } from '../view-mode-recommendation';

describe('recommendViewMode', () => {
  it('recommends streaming for a small server', () => {
    expect(recommendViewMode(5, undefined, false)).toEqual({ mode: 'streaming', reason: 'few-monitors' });
  });

  it('recommends snapshot one past the limit, leaving a connection for API calls', () => {
    expect(recommendViewMode(6, undefined, false)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
  });

  it('recommends streaming at any count when multi-port is configured', () => {
    expect(recommendViewMode(40, 30000, false)).toEqual({ mode: 'streaming', reason: 'multi-port' });
  });

  it('recommends snapshot for a big server without multi-port', () => {
    expect(recommendViewMode(20, undefined, false)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
  });

  it('treats an unknown monitor count as a big server', () => {
    expect(recommendViewMode(null, undefined, false)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
    expect(recommendViewMode(null, 30000, false)).toEqual({ mode: 'streaming', reason: 'multi-port' });
  });

  it('recommends streaming with reason no-host-limit when the host lifts the limit and the count is large', () => {
    expect(recommendViewMode(40, undefined, true)).toEqual({ mode: 'streaming', reason: 'no-host-limit' });
  });

  it('still recommends snapshot on a plain web host past the limit', () => {
    expect(recommendViewMode(40, undefined, false)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
  });

  it('multi-port wins over the host reason, few monitors wins over both', () => {
    expect(recommendViewMode(40, 30000, true).reason).toBe('multi-port');
    expect(recommendViewMode(3, undefined, true).reason).toBe('few-monitors');
  });

  it('an unknown count on a lifting host recommends streaming', () => {
    expect(recommendViewMode(null, undefined, true).mode).toBe('streaming');
  });
});
