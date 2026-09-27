/**
 * Live Ollama reachability for the assistant header dot (refs #246).
 *
 * Only the Ollama backend has a "connection" to report: on-device WebLLM runs
 * in-process, so this hook reports `enabled: false` for it and the dot hides.
 * When Ollama is selected it reuses the same `GET /models` reachability probe as
 * the settings Test-connection button, re-run on the bandwidth-scoped interval
 * (rule 8) while the assistant panel is open. The query is mounted only with the
 * header, so it stops polling when the panel closes.
 */
import { useQuery } from '@tanstack/react-query';
import { useCurrentProfile, useProfileById } from './useCurrentProfile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { getSecureValue } from '../lib/security/secureStorage';
import { listOpenAiModels, suggestOllamaBaseUrl } from '../lib/assistant/providers/openai';
import { queryKeys } from '../lib/query/query-keys';
import { ASSISTANT } from '../lib/zmninja-ng-constants';

export type OllamaHealthStatus = 'checking' | 'connected' | 'disconnected';

export interface OllamaHealth {
  /** True only when the Ollama backend is selected. The dot renders nothing
   *  otherwise, so callers can mount it unconditionally. */
  enabled: boolean;
  status: OllamaHealthStatus;
}

export function useOllamaHealth(): OllamaHealth {
  const { currentProfile } = useCurrentProfile();
  // Assistant keys are server-scoped: read the probed profile's own bucket (refs #536).
  const { settings } = useProfileById(currentProfile?.id);
  const bandwidth = useBandwidthSettings();
  // Same resolution the panel and Settings use: an unset URL falls back to the
  // profile's own ZoneMinder host, so the status dot reports on the server the
  // assistant would actually talk to.
  const baseUrl = (
    settings.assistantOllamaBaseUrl ||
    suggestOllamaBaseUrl(currentProfile?.apiUrl) ||
    ''
  ).replace(/\/+$/, '');
  const enabled = settings.assistantBackend === 'ollama' && !!currentProfile && baseUrl.length > 0;

  const query = useQuery({
    queryKey: queryKeys.assistantOllamaHealth(currentProfile?.id, baseUrl),
    queryFn: async () => {
      const apiKey = currentProfile
        ? ((await getSecureValue(`${ASSISTANT.apiKeyStoragePrefix}${currentProfile.id}`)) ?? undefined)
        : undefined;
      // Reachability only, with the short Test-connection timeout: a status dot
      // has no reason to wait the 120s chat-turn timeout for an unreachable
      // host. Resolving means reachable; a throw means down.
      await listOpenAiModels(baseUrl, apiKey, ASSISTANT.testConnectionTimeoutMs);
      return true;
    },
    enabled,
    refetchInterval: bandwidth.assistantHealthInterval,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // First probe (no result yet) reads as checking. After that isSuccess /
  // isError latch the last known state and stay put during a background
  // refetch, so the dot never flickers to amber every interval.
  let status: OllamaHealthStatus = 'checking';
  if (query.isSuccess) status = 'connected';
  else if (query.isError) status = 'disconnected';

  return { enabled, status };
}
