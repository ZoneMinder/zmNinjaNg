import { describe, it, expect, vi } from 'vitest';

// The global setup mocks @capacitor/core without WebPlugin; this test needs the real one.
vi.mock('@capacitor/core', async (importOriginal) => importOriginal());

import { ZmStreamWeb } from '../web';
import { ZmStream, zmFrameUrl, zmFrameStreamId } from '../index';

describe('zm-stream', () => {
  it('web open rejects: the frame transport is native only', async () => {
    await expect(new ZmStreamWeb().open({ url: 'http://x', stallTimeoutMs: 1 }))
      .rejects.toThrow(/native/i);
  });

  it('zmFrameUrl and zmFrameStreamId round-trip', () => {
    expect(zmFrameUrl('7', 3)).toBe('zmframe://frames/7/3');
    expect(zmFrameStreamId('zmframe://frames/7/3')).toBe('7');
    expect(zmFrameStreamId('http://zm/cgi-bin/nph-zms')).toBeNull();
  });

  it('the global test mock is wired: ZmStream.open resolves a mock stream', async () => {
    await expect(ZmStream.open({ url: 'http://x', stallTimeoutMs: 1 }))
      .resolves.toEqual({ streamId: 'mock-stream' });
  });
});
