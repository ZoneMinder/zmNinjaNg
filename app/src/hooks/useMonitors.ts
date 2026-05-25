/**
 * useMonitors Hook
 *
 * Centralized hook for fetching and filtering monitors.
 * Replaces the duplicated pattern of querying monitors and filtering enabled ones.
 *
 * Features:
 * - Fetches monitors via React Query
 * - Filters to only enabled (non-deleted) monitors
 * - Provides both full list and enabled monitors
 * - Extracts enabled monitor IDs
 * - Consistent query key with profile ID
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { filterEnabledMonitors } from '../lib/filters';
import { useCurrentProfile } from './useCurrentProfile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useAuthStore } from '../stores/auth';
import type { MonitorData } from '../api/types';

export interface UseMonitorsOptions {
  /** Whether the query is enabled (default: true) */
  enabled?: boolean;
  /** Override polling interval in ms (default: uses bandwidth settings) */
  refetchInterval?: number;
}

export interface UseMonitorsReturn {
  /** All monitors (including deleted) */
  monitors: MonitorData[];
  /** Only enabled (non-deleted) monitors */
  enabledMonitors: MonitorData[];
  /** Array of enabled monitor IDs */
  enabledMonitorIds: string[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

/**
 * Hook to fetch and filter monitors.
 *
 * @param options - Optional configuration
 * @returns Monitor data and query state
 *
 * @example
 * ```typescript
 * const { enabledMonitors, enabledMonitorIds, isLoading } = useMonitors();
 * ```
 */
export function useMonitors(options?: UseMonitorsOptions): UseMonitorsReturn {
  const { currentProfile } = useCurrentProfile();
  const bandwidth = useBandwidthSettings();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['monitors', currentProfile?.id],
    queryFn: () => getMonitors(),
    enabled: (options?.enabled ?? true) && !!currentProfile?.id && isAuthenticated,
    refetchInterval: options?.refetchInterval ?? bandwidth.monitorStatusInterval,
  });

  const monitors = data?.monitors || [];

  const enabledMonitors = useMemo(
    () => filterEnabledMonitors(monitors),
    [monitors]
  );

  const enabledMonitorIds = useMemo(
    () => enabledMonitors.map((m) => m.Monitor.Id),
    [enabledMonitors]
  );

  return {
    monitors,
    enabledMonitors,
    enabledMonitorIds,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
