/**
 * Hook for monitor navigation in detail view
 *
 * Handles swipe navigation, cycling, and prev/next monitor logic.
 */

import { useMemo, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../../api/monitors';
import { getSession, getCurrentSession } from '../../services/sessions';
import { filterEnabledMonitors } from '../../lib/monitor/filters';
import { getMonitorRunState, isMonitorStreamable } from '../../lib/monitor/monitor-status';
import { useAuthSlice } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import { MONITOR_NAVIGATION } from '../../lib/zmninja-ng-constants';
import { queryKeys } from '../../lib/query/query-keys';
import type { MonitorData, ProfileId } from '../../api/types';

interface UseMonitorNavigationOptions {
  currentMonitorId: string | undefined;
  cycleSeconds?: number;
  /**
   * Owning profile for an /all/ deep route; defaults to the current profile.
   * Also selects the path template prev/next/cycle navigate to: when set,
   * `/all/monitors/:profileId/:id` (stays in owning-profile context)
   * instead of `/monitors/:id`.
   */
  profileId?: ProfileId;
}

interface UseMonitorNavigationReturn {
  enabledMonitors: MonitorData[];
  currentIndex: number;
  hasPrev: boolean;
  hasNext: boolean;
  swipeNavigation: ReturnType<typeof useSwipeNavigation>;
  isSliding: boolean;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}

/**
 * Whether stepping through live view should stop on this monitor (refs #527).
 *
 * A monitor with capture off, or whose daemon reports no frames, has no stream
 * to show, so swipe/prev/next/cycle pass over it. Two monitors stay in the
 * rotation regardless: an on-demand one, which has no running daemon and so no
 * status until a viewer connects, and the one being viewed, whose removal would
 * leave the page with no way to step out of it.
 */
function isNavigable(m: MonitorData, currentMonitorId: string, zmVersion: string | null): boolean {
  if (m.Monitor.Id === currentMonitorId) return true;
  if (m.Monitor.Capturing === 'Ondemand') return true;
  return isMonitorStreamable(getMonitorRunState(m.Monitor, m.Monitor_Status, zmVersion));
}

export function useMonitorNavigation({
  currentMonitorId,
  cycleSeconds = 0,
  profileId,
}: UseMonitorNavigationOptions): UseMonitorNavigationReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSliding, setIsSliding] = useState(false);
  const { currentProfile } = useCurrentProfile();
  const effectiveProfileId = profileId ?? currentProfile?.id;
  const monitorPath = (id: string) => (profileId ? `/all/monitors/${profileId}/${id}` : `/monitors/${id}`);

  // Fetch all monitors for navigation
  const { data: monitorsData } = useQuery({
    queryKey: queryKeys.monitors(effectiveProfileId),
    queryFn: () => {
      const session = profileId ? getSession(profileId) : getCurrentSession();
      return getMonitors(session.client, session.profileId);
    },
  });

  const zmVersion = useAuthSlice(effectiveProfileId ?? null).version;
  const skipOffline = useSettingsStore((state) =>
    effectiveProfileId ? state.getProfileSettings(effectiveProfileId).skipOfflineMonitors : false,
  );

  // Get enabled monitors list and find current monitor index
  const { enabledMonitors, currentIndex, hasPrev, hasNext } = useMemo(() => {
    if (!monitorsData?.monitors || !currentMonitorId) {
      return { enabledMonitors: [] as MonitorData[], currentIndex: -1, hasPrev: false, hasNext: false };
    }
    const enabled = filterEnabledMonitors(monitorsData.monitors).filter(
      (m) => !skipOffline || isNavigable(m, currentMonitorId, zmVersion),
    );
    const idx = enabled.findIndex((m) => m.Monitor.Id === currentMonitorId);
    return {
      enabledMonitors: enabled,
      currentIndex: idx,
      hasPrev: idx > 0,
      hasNext: idx < enabled.length - 1,
    };
  }, [monitorsData?.monitors, currentMonitorId, skipOffline, zmVersion]);

  // Navigation callbacks. Stepping between monitors replaces the current history
  // entry (so prev/next don't build a back-stack) and carries the original
  // `from` referrer forward, so the back button returns to the view the user
  // came from (e.g. montage), not the previously viewed monitor. refs #180
  const onSwipeLeft = () => {
    if (hasNext) {
      const nextMonitor = enabledMonitors[currentIndex + 1];
      navigate(monitorPath(nextMonitor.Monitor.Id), { replace: true, state: location.state });
    }
  };

  const onSwipeRight = () => {
    if (hasPrev) {
      const prevMonitor = enabledMonitors[currentIndex - 1];
      navigate(monitorPath(prevMonitor.Monitor.Id), { replace: true, state: location.state });
    }
  };

  // Swipe navigation between monitors
  const swipeNavigation = useSwipeNavigation({
    onSwipeLeft,
    onSwipeRight,
    threshold: 80,
    enabled: enabledMonitors.length > 1,
  });

  // Slide animation on monitor change
  useEffect(() => {
    if (!currentMonitorId) return;
    setIsSliding(true);
    const timeout = window.setTimeout(() => setIsSliding(false), MONITOR_NAVIGATION.slideAnimationMs);
    return () => window.clearTimeout(timeout);
  }, [currentMonitorId]);

  // Auto-cycle through monitors
  useEffect(() => {
    if (!cycleSeconds || cycleSeconds <= 0) return;
    if (enabledMonitors.length < 2 || currentIndex < 0) return;

    const intervalId = window.setInterval(() => {
      const nextIndex = currentIndex + 1 < enabledMonitors.length ? currentIndex + 1 : 0;
      const nextMonitor = enabledMonitors[nextIndex];
      navigate(monitorPath(nextMonitor.Monitor.Id), { replace: true, state: location.state });
    }, cycleSeconds * 1000);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monitorPath is derived from profileId, already a dep
  }, [currentIndex, enabledMonitors, location.state, navigate, cycleSeconds, profileId]);

  return {
    enabledMonitors,
    currentIndex,
    hasPrev,
    hasNext,
    swipeNavigation,
    isSliding,
    onSwipeLeft,
    onSwipeRight,
  };
}
