/**
 * Hook for monitor navigation in detail view
 *
 * Handles swipe navigation, cycling, and prev/next monitor logic.
 */

import { useMemo, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../../api/monitors';
import { filterEnabledMonitors } from '../../lib/filters';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import type { MonitorData } from '../../api/types';

interface UseMonitorNavigationOptions {
  currentMonitorId: string | undefined;
  cycleSeconds?: number;
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

export function useMonitorNavigation({
  currentMonitorId,
  cycleSeconds = 0,
}: UseMonitorNavigationOptions): UseMonitorNavigationReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSliding, setIsSliding] = useState(false);

  // Fetch all monitors for navigation
  const { data: monitorsData } = useQuery({
    queryKey: ['monitors'],
    queryFn: () => getMonitors(),
  });

  // Get enabled monitors list and find current monitor index
  const { enabledMonitors, currentIndex, hasPrev, hasNext } = useMemo(() => {
    if (!monitorsData?.monitors || !currentMonitorId) {
      return { enabledMonitors: [] as MonitorData[], currentIndex: -1, hasPrev: false, hasNext: false };
    }
    const enabled = filterEnabledMonitors(monitorsData.monitors);
    const idx = enabled.findIndex((m) => m.Monitor.Id === currentMonitorId);
    return {
      enabledMonitors: enabled,
      currentIndex: idx,
      hasPrev: idx > 0,
      hasNext: idx < enabled.length - 1,
    };
  }, [monitorsData?.monitors, currentMonitorId]);

  // Navigation callbacks
  const onSwipeLeft = () => {
    if (hasNext) {
      const nextMonitor = enabledMonitors[currentIndex + 1];
      navigate(`/monitors/${nextMonitor.Monitor.Id}`, { state: { from: location.pathname } });
    }
  };

  const onSwipeRight = () => {
    if (hasPrev) {
      const prevMonitor = enabledMonitors[currentIndex - 1];
      navigate(`/monitors/${prevMonitor.Monitor.Id}`, { state: { from: location.pathname } });
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
    const timeout = window.setTimeout(() => setIsSliding(false), 450);
    return () => window.clearTimeout(timeout);
  }, [currentMonitorId]);

  // Auto-cycle through monitors
  useEffect(() => {
    if (!cycleSeconds || cycleSeconds <= 0) return;
    if (enabledMonitors.length < 2 || currentIndex < 0) return;

    const intervalId = window.setInterval(() => {
      const nextIndex = currentIndex + 1 < enabledMonitors.length ? currentIndex + 1 : 0;
      const nextMonitor = enabledMonitors[nextIndex];
      navigate(`/monitors/${nextMonitor.Monitor.Id}`, { state: { from: location.pathname } });
    }, cycleSeconds * 1000);

    return () => window.clearInterval(intervalId);
  }, [currentIndex, enabledMonitors, location.pathname, navigate, cycleSeconds]);

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
