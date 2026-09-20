/**
 * Truth-table coverage for derivePlayerViewState.
 *
 * The live player used to infer its render layers from a tangle of overlapping
 * booleans (showMjpeg, showConnectingBadge, showNoVideo). Those are now a single
 * named PlayerViewState. This table pins the mapping for every combination of the
 * three inputs so a future edit to the derivation is caught here rather than as a
 * black-screen regression on a device the CI can't exercise.
 */

import { describe, it, expect } from 'vitest';
import { derivePlayerViewState, type PlayerViewState } from '../LiveMonitorPlayer';

type Row = {
  isWebRTC: boolean;
  hasVideoFrames: boolean;
  hasMjpegFrame: boolean;
  isAwaitingFrame: boolean;
  expected: PlayerViewState;
};

// All 2^4 input combinations. isAwaitingFrame splits what used to be a
// single 'no-video': a tile still waiting on its first picture is not a tile
// that failed, and on a big montage it waits a long time (refs #507).
const table: Row[] = [
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: true, isAwaitingFrame: true, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: true, isAwaitingFrame: false, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: false, isAwaitingFrame: true, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: false, isAwaitingFrame: false, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: true, isAwaitingFrame: true, expected: 'mjpeg-placeholder' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: true, isAwaitingFrame: false, expected: 'mjpeg-placeholder' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: false, isAwaitingFrame: true, expected: 'connecting' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: false, isAwaitingFrame: false, expected: 'connecting' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: true, isAwaitingFrame: true, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: true, isAwaitingFrame: false, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: false, isAwaitingFrame: true, expected: 'awaiting-frame' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: false, isAwaitingFrame: false, expected: 'no-video' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: true, isAwaitingFrame: true, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: true, isAwaitingFrame: false, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: false, isAwaitingFrame: true, expected: 'awaiting-frame' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: false, isAwaitingFrame: false, expected: 'no-video' },
];

describe('derivePlayerViewState', () => {
  for (const { isWebRTC, hasVideoFrames, hasMjpegFrame, isAwaitingFrame, expected } of table) {
    it(`isWebRTC=${isWebRTC} hasVideoFrames=${hasVideoFrames} hasMjpegFrame=${hasMjpegFrame} awaiting=${isAwaitingFrame} -> ${expected}`, () => {
      expect(
        derivePlayerViewState({ isWebRTC, hasVideoFrames, hasMjpegFrame, isAwaitingFrame }),
      ).toBe(expected);
    });
  }

  it('WebRTC decoded frames win regardless of MJPEG placeholder', () => {
    expect(
      derivePlayerViewState({
        isWebRTC: true,
        hasVideoFrames: true,
        hasMjpegFrame: true,
        isAwaitingFrame: false,
      }),
    ).toBe('mse-playing');
  });

  it('MJPEG frame availability is what separates mjpeg from the empty states', () => {
    const base = { isWebRTC: false, hasVideoFrames: false, isAwaitingFrame: false };
    expect(derivePlayerViewState({ ...base, hasMjpegFrame: true })).toBe('mjpeg');
    expect(derivePlayerViewState({ ...base, hasMjpegFrame: false })).toBe('no-video');
  });

  it('separates a tile still waiting from a tile that has given up', () => {
    // A 76-tile montage shares six connections per host, so most tiles wait a
    // long time for their first picture. Rendering that wait as the same
    // VideoOff icon an errored tile shows made a slow grid read as a broken one
    // (refs #507). Waiting is only claimed while nothing has errored.
    const base = { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: false };
    expect(derivePlayerViewState({ ...base, isAwaitingFrame: true })).toBe('awaiting-frame');
    expect(derivePlayerViewState({ ...base, isAwaitingFrame: false })).toBe('no-video');
  });
});
