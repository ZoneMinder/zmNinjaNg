/**
 * useZmsProbes Hook (refs #603)
 *
 * Probes each distinct nph-zms URL the given profiles' monitors stream from,
 * once per URL (see lib/zm/zms-probe.ts). The monitor lists come from the
 * same `queryKeys.monitors` queries the pages already hold, without a refetch
 * interval of their own. Each URL resolves through the profile's own server
 * map, so a multi-server profile probes one URL per server. Results stay
 * fresh for `ZMS_PROBE.staleTimeMs`; a changed CGI path is a new key, so the
 * next view probes it.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { getSession } from '../services/sessions';
import { useProfileStore } from '../stores/profile';
import { useAuthStore } from '../stores/auth';
import { queryKeys } from '../lib/query/query-keys';
import { getServerMap, getServerMapVersion, resolveMonitorUrls, subscribeServerMap } from '../lib/zm/server-resolver';
import { pickProbeTargets, probeZms, type ZmsProbeResult } from '../lib/zm/zms-probe';
import { ZMS_PROBE } from '../lib/zmninja-ng-constants';
import type { ProfileId } from '../api/types';

export interface ZmsProbeEntry {
  profileId: ProfileId;
  profileName: string;
  recordingUrl: string;
  /** Undefined while the probe runs. */
  result: ZmsProbeResult | undefined;
}

async function runProbe(profileId: ProfileId, recordingUrl: string, monitorId: string): Promise<ZmsProbeResult> {
  let token: string | null;
  try {
    // A fresh token, so an expired one never reads as a 403.
    token = await useAuthStore.getState().getFreshAccessToken(profileId);
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  }
  return probeZms(recordingUrl, monitorId, token);
}

/** `fresh` probes again on every mount, ignoring a cached result (the Profiles page diagnoses with it). */
export function useZmsProbes(profileIds: readonly ProfileId[], { fresh = false }: { fresh?: boolean } = {}): ZmsProbeEntry[] {
  const allProfiles = useProfileStore((state) => state.profiles);
  const idsKey = profileIds.join('\n');
  const profiles = useMemo(() => {
    const ids = idsKey ? idsKey.split('\n') : [];
    return allProfiles.filter((p) => ids.includes(p.id));
  }, [allProfiles, idsKey]);

  const monitorLists = useQueries({
    queries: profiles.map((p) => ({
      queryKey: queryKeys.monitors(p.id),
      queryFn: () => getMonitors(getSession(p.id).client, p.id),
    })),
    combine: (results) => results.map((r) => r.data?.monitors),
  });

  const serverMapVersion = useSyncExternalStore(subscribeServerMap, getServerMapVersion);

  const targets = useMemo(() => {
    void serverMapVersion; // re-resolve when any server map changes
    return profiles.flatMap((p, i) => {
      const serverMap = getServerMap(p.id);
      const defaults = { portalUrl: p.portalUrl, cgiUrl: p.cgiUrl, apiUrl: p.apiUrl };
      return pickProbeTargets(
        monitorLists[i] ?? [],
        (serverId) => resolveMonitorUrls(serverId, serverMap, defaults).recordingUrl,
      ).map((t) => ({ ...t, profileId: p.id, profileName: p.name }));
    });
  }, [profiles, monitorLists, serverMapVersion]);

  return useQueries({
    queries: targets.map((t) => ({
      queryKey: queryKeys.zmsProbe(t.profileId, t.recordingUrl),
      queryFn: () => runProbe(t.profileId, t.recordingUrl, t.monitorId),
      staleTime: ZMS_PROBE.staleTimeMs,
      retry: false,
      ...(fresh ? { refetchOnMount: 'always' as const } : {}),
    })),
    combine: (results) =>
      targets.map(({ profileId, profileName, recordingUrl }, i) => ({
        profileId,
        profileName,
        recordingUrl,
        result: results[i]?.data,
      })),
  });
}
