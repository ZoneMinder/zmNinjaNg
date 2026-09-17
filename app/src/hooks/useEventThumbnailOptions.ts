/**
 * Per-profile inputs `buildRowThumbnail` needs (refs #494): the portal URL,
 * thumbnail fallback chain, a fresh token and the resolved multi-port base.
 * Shared by the "around this event" list and graph views so both build the
 * exact same thumbnail chain for the same event.
 */
import { useProfileById } from './useCurrentProfile';
import { useFreshAccessToken } from './useFreshAccessToken';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import type { RowThumbnailOptions } from '../lib/event/event-context-view';
import type { ProfileId } from '../api/types';

export function useEventThumbnailOptions(profileId: ProfileId | undefined): RowThumbnailOptions {
  const { profile, settings } = useProfileById(profileId);
  const { token: accessToken, isFresh } = useFreshAccessToken(profileId);
  const minStreamingPort = resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);
  return {
    portalUrl: profile?.portalUrl || '',
    thumbnailChain: settings.thumbnailFallbackChain,
    token: isFresh ? accessToken ?? undefined : undefined,
    minStreamingPort,
    profileId,
  };
}
