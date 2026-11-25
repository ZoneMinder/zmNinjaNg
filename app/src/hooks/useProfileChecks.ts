/**
 * useProfileChecks Hook (refs #603)
 *
 * Whether each of a profile's three addresses answers: the portal page, the
 * API (its monitor list, the same `queryKeys.monitors` query the pages hold)
 * and the stream path (useZmsProbes). Each check is undefined while it runs or
 * when it can't tell; a disabled or missing profile gets no checks.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { getSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { probePortal } from '../lib/zm/zms-probe';
import { ZMS_PROBE } from '../lib/zmninja-ng-constants';
import { useZmsProbes } from './useZmsProbes';
import type { Profile } from '../api/types';

export type ProfileCheck = { state: 'ok' } | { state: 'failed'; status: number } | undefined;

export interface ProfileChecks {
  portal: ProfileCheck;
  api: ProfileCheck;
  streaming: ProfileCheck;
}

export function useProfileChecks(profile: Profile | null | undefined): ProfileChecks {
  const active = !!profile && !profile.disabled;
  const ids = useMemo(() => (active && profile ? [profile.id] : []), [active, profile]);

  const portal = useQuery({
    queryKey: queryKeys.portalProbe(profile?.id, profile?.portalUrl ?? ''),
    queryFn: () => probePortal(profile!.portalUrl),
    enabled: active,
    staleTime: ZMS_PROBE.staleTimeMs,
    retry: false,
  });
  const monitors = useQuery({
    queryKey: queryKeys.monitors(profile?.id),
    queryFn: () => getMonitors(getSession(profile!.id).client, profile!.id),
    enabled: active,
  });
  const streams = useZmsProbes(ids).map((e) => e.result);

  const failedStream = streams.find((r) => r?.state === 'failed');
  const errorStatus = (monitors.error as { status?: number } | null)?.status;

  return {
    portal:
      portal.data?.state === 'ok' ? { state: 'ok' }
      : portal.data?.state === 'failed' ? { state: 'failed', status: portal.data.status }
      : undefined,
    api: monitors.data ? { state: 'ok' } : errorStatus ? { state: 'failed', status: errorStatus } : undefined,
    streaming:
      failedStream?.state === 'failed' ? { state: 'failed', status: failedStream.status }
      // One answering path is enough: a second server the app can't reach
      // gives no status, which is no verdict either way.
      : streams.some((r) => r?.state === 'ok') ? { state: 'ok' }
      : undefined,
  };
}
