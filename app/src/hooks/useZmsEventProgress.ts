/**
 * How far a ZMS event stream has played, from its CMD_QUERY status (refs #534).
 *
 * Sequence play waits on this rather than on the event's nominal length: a
 * stream runs at whatever pace the server manages. A real server showed two
 * cases a plain "progress >= 0.99" check misses. `replay=single` loops back
 * to the start instead of exiting, and the last poll before the loop can read
 * under 0.99, so progress going backwards also means done. A sub-second event
 * never opens its control socket at all, so a run of answers with no playback
 * state (ZMS_STREAM_DEAD_POLLS) means done as well.
 */
import { useEffect, useRef } from 'react';
import { httpGet } from '../lib/http';
import { useBandwidthSettings } from './useBandwidthSettings';
import { ZMS_EVENT_END_FRACTION, ZMS_STREAM_DEAD_POLLS } from '../lib/zmninja-ng-constants';

export interface ZmsProbe {
  /** 0 to 1. */
  fraction: number;
  /** Polls in a row that carried no playback state. */
  misses: number;
  done: boolean;
}

export const ZMS_PROBE_START: ZmsProbe = { fraction: 0, misses: 0, done: false };

interface ZmsStatus {
  progress?: unknown;
  duration?: unknown;
}

/** Folds one status answer (undefined for a failed poll) into the probe. */
export function nextZmsProbe(prev: ZmsProbe, status: ZmsStatus | undefined): ZmsProbe {
  const { progress, duration } = status ?? {};
  if (typeof progress !== 'number' || typeof duration !== 'number' || duration <= 0) {
    const misses = prev.misses + 1;
    return { ...prev, misses, done: misses >= ZMS_STREAM_DEAD_POLLS };
  }
  const fraction = Math.min(1, progress / duration);
  if (fraction >= ZMS_EVENT_END_FRACTION || fraction < prev.fraction) return { fraction: 1, misses: 0, done: true };
  return { fraction, misses: 0, done: false };
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
    const tick = async () => {
      let status: ZmsStatus | undefined;
      try {
        status = (await httpGet<{ status?: ZmsStatus }>(controlUrl, { signal: controller.signal })).data?.status;
      } catch {
        status = undefined;
      }
      if (controller.signal.aborted) return;
      probe = nextZmsProbe(probe, status);
      onProbeRef.current?.(probe);
      if (probe.done) clearInterval(timer);
    };
    const timer = setInterval(tick, zmsStatusInterval);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [polling, controlUrl, zmsStatusInterval]);
}
