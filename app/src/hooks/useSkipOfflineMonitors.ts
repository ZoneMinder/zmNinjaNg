/**
 * The "Skip offline monitors" filter (refs #527).
 *
 * One predicate for every surface that lists monitors, so the Monitors page,
 * the montage and live-view navigation all agree on what counts as offline.
 * The answer comes from `getMonitorRunState`, the same run state the status
 * dot renders, never a second copy of the Connected/FPS rule.
 *
 * Each monitor is judged against its OWN server's ZoneMinder version: the
 * field that says whether capture is configured moved in 1.38, and in All mode
 * two servers can be on either side of that. The setting itself is read from
 * the current profile, aggregate included, like the other display preferences
 * on those pages.
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/auth';
import { getMonitorRunState, isMonitorStreamable } from '../lib/monitor/monitor-status';
import { useCurrentProfile } from './useCurrentProfile';
import type { MonitorData, ProfileId } from '../api/types';

/**
 * Whether a monitor has a live picture to show.
 *
 * On-demand monitors always pass: ZoneMinder starts no capture daemon for them
 * until a viewer connects, so they report no status at all, and calling that
 * offline would hide a camera that streams perfectly well once opened.
 */
export function hasLiveStream(
  monitor: MonitorData['Monitor'],
  status: MonitorData['Monitor_Status'],
  zmVersion: string | null,
): boolean {
  if (monitor.Capturing === 'Ondemand') return true;
  return isMonitorStreamable(getMonitorRunState(monitor, status, zmVersion));
}

/**
 * Returns a predicate that keeps the monitors a list should render.
 *
 * `profileId` names the monitor's owning server, needed in All mode; omit it
 * in single mode and the current profile answers.
 */
export function useSkipOfflineMonitors(): (monitor: MonitorData, profileId?: ProfileId) => boolean {
  const { currentProfile, settings } = useCurrentProfile();
  // The slices object is the store's own, not minted here: a selector that
  // built one would loop every subscriber (Stores contract).
  const slices = useAuthStore(useShallow((state) => state.slices));
  const skipOffline = settings.skipOfflineMonitors;
  const fallbackProfileId = currentProfile?.id;

  return useCallback(
    (monitor: MonitorData, profileId?: ProfileId) => {
      if (!skipOffline) return true;
      const owner = profileId ?? fallbackProfileId;
      const zmVersion = owner ? slices[owner]?.version ?? null : null;
      return hasLiveStream(monitor.Monitor, monitor.Monitor_Status, zmVersion);
    },
    [skipOffline, slices, fallbackProfileId],
  );
}
