/**
 * The "Skip monitors that aren't capturing" filter (refs #527).
 *
 * One predicate for every surface that lists monitors, so the Monitors page,
 * the montage and live-view navigation all agree.
 *
 * It reads configuration only, never the daemon's live status. Status flaps:
 * ZoneMinder rewrites Monitor_Status about every FPSReportInterval frames, and
 * a reconnecting camera reports Running with 0 fps for a cycle or two. Hiding
 * on that would drop a tile out of the montage on one poll and bring it back on
 * the next, tearing down and restarting its stream, at exactly the moment the
 * user wants to watch the camera come back. Configuration does not flap. A
 * camera that IS meant to capture but has died stays visible with the red dot
 * the status rule already gives it, which is the honest answer.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import type { MonitorData } from '../api/types';

/**
 * Whether this monitor is configured to capture at all.
 *
 * 1.38 split `Function` into Capturing/Analysing/Recording and still sends
 * both, so reading `Capturing` first and falling back covers either server
 * without asking which version it is. `Ondemand` is capture, just deferred
 * until a viewer connects, so it passes.
 */
export function isCaptureEnabled(monitor: MonitorData['Monitor']): boolean {
  return (monitor.Capturing ?? monitor.Function) !== 'None';
}

/** Returns a predicate that keeps the monitors a list should render. */
export function useSkipOfflineMonitors(): (monitor: MonitorData) => boolean {
  const { settings } = useCurrentProfile();
  const skipOffline = settings.skipOfflineMonitors;

  return useCallback(
    (monitor: MonitorData) => !skipOffline || isCaptureEnabled(monitor.Monitor),
    [skipOffline],
  );
}
