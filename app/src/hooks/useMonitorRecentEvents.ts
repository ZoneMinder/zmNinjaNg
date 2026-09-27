/**
 * Data hook for the monitor-detail recent-events list. Wraps the events query
 * and the per-monitor hidden toggle. The query is disabled while hidden so no
 * request or refresh fires (refs #213).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getSession, getCurrentSession } from '../services/sessions';
import type { EventData, ProfileId } from '../api/types';
import { useCurrentProfile, useProfileById } from './useCurrentProfile';
import { useAuthSlice } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from './useBandwidthSettings';
import { queryKeys } from '../lib/query/query-keys';
import {
  clampRecentEventsCount,
  isMonitorRecentEventsHidden,
  toggleMonitorRecentEventsHidden,
} from '../lib/monitor/monitor-recent-events';

export interface UseMonitorRecentEvents {
  events: EventData[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hidden: boolean;
  count: number;
  toggleHidden: () => void;
  refetch: () => void;
}

/** @param profileId - Owning profile for an /all/ deep route; defaults to the current profile. */
export function useMonitorRecentEvents(monitorId: string, profileId?: ProfileId): UseMonitorRecentEvents {
  const { profile: ownerProfile, settings } = useProfileById(profileId);
  // How many to show is selection-scoped (refs #536).
  const { settings: selectionSettings } = useCurrentProfile();
  const effectiveProfileId = ownerProfile?.id;
  const isAuthenticated = useAuthSlice(effectiveProfileId ?? null).isAuthenticated;
  const updateProfileSettings = useSettingsStore((s) => s.updateProfileSettings);
  const bandwidth = useBandwidthSettings();

  const count = clampRecentEventsCount(selectionSettings.monitorDetailRecentEventsCount);
  const hiddenList = settings.monitorDetailRecentEventsHidden;
  const hidden = isMonitorRecentEventsHidden(hiddenList, monitorId);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: queryKeys.monitorRecentEvents(effectiveProfileId, monitorId, count),
    queryFn: () => {
      const session = profileId ? getSession(profileId) : getCurrentSession();
      return getEvents(session.client, session.profileId, { monitorId, limit: count, sort: 'StartDateTime', direction: 'desc' });
    },
    enabled: !!effectiveProfileId && isAuthenticated && !hidden,
    refetchInterval: hidden ? false : bandwidth.monitorRecentEventsInterval,
  });

  const events = useMemo(() => (data?.events ?? []).slice(0, count), [data?.events, count]);

  const toggleHidden = () => {
    if (!effectiveProfileId) return;
    updateProfileSettings(effectiveProfileId, {
      monitorDetailRecentEventsHidden: toggleMonitorRecentEventsHidden(hiddenList, monitorId),
    });
  };

  return {
    events,
    isLoading,
    isError,
    isFetching,
    hidden,
    count,
    toggleHidden,
    refetch: () => { void refetch(); },
  };
}
