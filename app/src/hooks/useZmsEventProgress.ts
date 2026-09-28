/**
 * How far a ZMS event stream has played, from its CMD_QUERY status (refs #534).
 *
 * Sequence play waits on this rather than on the event's nominal length: a
 * stream runs at whatever pace the server manages. Its tiles stream with
 * `replay=none`, which plays once and pauses on the last frame with progress
 * equal to duration. Two fallbacks cover other shapes seen on a real server:
 * progress going backwards (a `replay=single` stream loops back to the start),
 * and a run of answers with no playback state (ZMS_STREAM_DEAD_POLLS), which
 * is what a stream whose control socket never opened looks like.
 *
 * Between polls, `ahead` is where the stream should be at the next one, from
 * the rate the status reports, so a progress line can ease toward it. When
 * the end falls before the next poll, one extra check runs just after it.
 */
import { useEffect, useRef } from 'react';
import { httpGet } from '../lib/http';
import { useBandwidthSettings } from './useBandwidthSettings';
import { ZMS_END_CHECK_MARGIN_MS, ZMS_EVENT_END_FRACTION, ZMS_STREAM_DEAD_POLLS } from '../lib/zmninja-ng-constants';

export interface ZmsProbe {
  /** 0 to 1. */
  fraction: number;
  /** Where the stream should be at the next poll, 0 to 1. */
  ahead: number;
  /** Wall-clock time left in the stream, or null when it is not known. */
  remainingMs: number | null;
  /** Polls in a row that carried no playback state. */
  misses: number;
  done: boolean;
}

export const ZMS_PROBE_START: ZmsProbe = { fraction: 0, ahead: 0, remainingMs: null, misses: 0, done: false };

interface ZmsStatus {
  progress?: unknown;
  duration?: unknown;
  /** Playback speed as a multiple (2 = 2x). */
  rate?: unknown;
}

/** Folds one status answer (undefined for a failed poll) into the probe. */
export function nextZmsProbe(prev: ZmsProbe, status: ZmsStatus | undefined, pollMs: number): ZmsProbe {
  const { progress, duration, rate } = status ?? {};
  if (typeof progress !== 'number' || typeof duration !== 'number' || duration <= 0) {
    const misses = prev.misses + 1;
    return { ...prev, remainingMs: null, misses, done: misses >= ZMS_STREAM_DEAD_POLLS };
  }
  const fraction = Math.min(1, progress / duration);
  if (fraction >= ZMS_EVENT_END_FRACTION || fraction < prev.fraction) {
    return { fraction: 1, ahead: 1, remainingMs: 0, misses: 0, done: true };
  }
  const speed = typeof rate === 'number' && rate > 0 ? rate : 1;
  return {
    fraction,
    ahead: Math.min(1, (progress + (pollMs / 1000) * speed) / duration),
    remainingMs: ((duration - progress) / speed) * 1000,
    misses: 0,
    done: false,
  };
}

/**
 * Polls `controlUrl` (a CMD_QUERY URL for the stream's connkey) and reports
 * each probe until one is done. Does nothing without `onProbe`.
 */
export function useZmsEventProgress(controlUrl: string, onProbe: ((probe: ZmsProbe) => void) | undefined) {
  const { zmsStatusInterval } = useBandwidthSettings();
  const onProbeRef = useRef(onProbe);
  useEffect(() => {
    onProbeRef.current = onProbe;
  });
  const polling = Boolean(onProbe) && Boolean(controlUrl);

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let probe = ZMS_PROBE_START;
    let endCheck: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let status: ZmsStatus | undefined;
      try {
        status = (await httpGet<{ status?: ZmsStatus }>(controlUrl, { signal: controller.signal })).data?.status;
      } catch {
        status = undefined;
      }
      if (controller.signal.aborted) return;
      probe = nextZmsProbe(probe, status, zmsStatusInterval);
      onProbeRef.current?.(probe);
      if (probe.done) {
        clearInterval(timer);
        return;
      }
      if (probe.remainingMs !== null && probe.remainingMs < zmsStatusInterval) {
        clearTimeout(endCheck);
        endCheck = setTimeout(tick, probe.remainingMs + ZMS_END_CHECK_MARGIN_MS);
      }
    };
    const timer = setInterval(tick, zmsStatusInterval);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(endCheck);
    };
  }, [polling, controlUrl, zmsStatusInterval]);
}
