/**
 * Download trigger for a ZoneMinder event's video (refs #494). Renders
 * nothing when the event has no video. Resolves its own owning profile's
 * portal URL, access token and min-streaming-port from `profileId`, the same
 * per-row pattern EventListView's EventItem and EventMontageView's tile use
 * for thumbnails (refs #337). Click propagation is stopped so it never
 * triggers the parent card/tile's navigation.
 */
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { downloadEventVideo } from '../../services/download';
import { getPortalUrlForMonitor } from '../../lib/zm/server-resolver';
import { useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { Platform } from '../../lib/platform';
import type { Event, ProfileId } from '../../api/types';

async function triggerHaptic(): Promise<void> {
  if (Platform.isNative) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics not available, silently ignore
    }
  }
}

interface EventDownloadButtonProps {
  event: Event;
  /** Owning profile: the event's own profileId in All mode, the current
   *  profile in single mode (refs #337). */
  profileId?: ProfileId;
  /** The event's monitor's ServerId, for multi-server portal routing
   *  (a monitor can be recorded on a different server than the profile's
   *  default). Omit when unknown; falls back to the profile's own portal. */
  monitorServerId?: string | null;
  className?: string;
}

export function EventDownloadButton({ event, profileId, monitorServerId, className }: EventDownloadButtonProps) {
  const { t } = useTranslation();
  const { profile, settings } = useProfileById(profileId);
  const { token, isFresh } = useFreshAccessToken(profileId);
  const minStreamingPort = resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);

  if (event.Videoed !== '1') return null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await triggerHaptic();
    const portalUrl = getPortalUrlForMonitor(monitorServerId, profile?.portalUrl || '', profileId);
    downloadEventVideo(portalUrl, event.Id, event.Name, isFresh ? token ?? undefined : undefined, minStreamingPort, event.MonitorId);
    // Background task drawer will show download progress
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn('h-7 w-7', className)}
      onClick={handleDownload}
      title={t('eventMontage.download_video')}
      aria-label={t('eventMontage.download_video')}
      data-testid="event-download-button"
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}
