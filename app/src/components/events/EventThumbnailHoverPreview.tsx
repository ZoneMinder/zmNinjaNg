/**
 * Event Thumbnail Hover Preview
 *
 * Wrapper that plays the event via ZMS on hover. A fresh connkey is
 * generated when the preview opens; on close, CMD_QUIT is sent to tear
 * down the stream.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { HoverPreview } from '../ui/hover-preview';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { getEventZmsUrl, getZmsControlUrl } from '../../lib/url-builder';
import { httpGet } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { ZMS_COMMANDS } from '../../lib/zm-constants';
import type { Event } from '../../api/types';

export interface EventZmsHoverDescriptor {
  eventId: string;
  monitorId: string;
  name?: string;
}

/**
 * Module-level map of pending CMD_QUIT dispatches keyed by connkey.
 * Lets StrictMode's double-mount in dev cancel the intermediate quit
 * rather than churning the zms process.
 */
const pendingQuits = new Map<string, number>();
const QUIT_DELAY_MS = 150;

interface EventThumbnailHoverPreviewProps {
  event: Event;
  aspectRatio: number;
  /** Legacy props (kept for API compatibility, unused in ZMS playback path) */
  urls?: string[];
  cacheKey?: string;
  alt?: string;
  children: ReactNode;
}

export function EventThumbnailHoverPreview({
  event,
  aspectRatio,
  children,
}: EventThumbnailHoverPreviewProps) {
  return (
    <HoverPreview
      aspectRatio={aspectRatio}
      testId="event-thumbnail-hover-preview"
      renderPreview={() => (
        <EventZmsHoverPlayer
          descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name }}
        />
      )}
    >
      {children}
    </HoverPreview>
  );
}

/**
 * Inner player — only mounted while the preview is open.
 * Mount → new connkey + event ZMS stream. Unmount → CMD_QUIT.
 */
export function EventZmsHoverPlayer({ descriptor }: { descriptor: EventZmsHoverDescriptor }) {
  const { currentProfile } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();

  const connkey = useMemo(
    () => Math.floor(Math.random() * 1_000_000_000).toString(),
    [],
  );

  const portalUrl = currentProfile?.portalUrl ?? '';
  const tokenOpts = {
    token: accessToken ?? undefined,
    apiUrl: currentProfile?.apiUrl,
    minStreamingPort: currentProfile?.minStreamingPort,
    monitorId: descriptor.monitorId,
  };

  const streamUrl = portalUrl && isAccessTokenFresh
    ? getEventZmsUrl(portalUrl, descriptor.eventId, {
        ...tokenOpts,
        connkey,
        rate: 100,
        maxfps: 30,
        replay: 'single',
      })
    : '';

  // Log when hover playback starts. Tear down the zms process on unmount,
  // but delay it so StrictMode's dev-mode remount (or rapid hover out/in)
  // can cancel the CMD_QUIT and keep reusing the same connkey.
  useEffect(() => {
    // If a quit was pending for this connkey (dev remount or rapid
    // hover out/in), cancel it. Otherwise, log the new start.
    const pending = pendingQuits.get(connkey);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      pendingQuits.delete(connkey);
    } else if (streamUrl) {
      log.zmsEventPlayer('Hover preview stream started', LogLevel.INFO, {
        eventId: descriptor.eventId,
        monitorId: descriptor.monitorId,
        connkey,
        url: streamUrl,
      });
    }

    return () => {
      if (!portalUrl) return;
      const controlUrl = getZmsControlUrl(portalUrl, ZMS_COMMANDS.cmdQuit, connkey, tokenOpts);
      const timerId = window.setTimeout(() => {
        pendingQuits.delete(connkey);
        log.zmsEventPlayer('Hover preview stream stopping — sending CMD_QUIT', LogLevel.INFO, {
          eventId: descriptor.eventId,
          monitorId: descriptor.monitorId,
          connkey,
          url: controlUrl,
        });
        // Fire-and-forget — connection may already be closed
        httpGet(controlUrl).catch((err) => {
          log.zmsEventPlayer('Failed to send CMD_QUIT for hover preview', LogLevel.DEBUG, {
            eventId: descriptor.eventId,
            error: String(err),
          });
        });
      }, QUIT_DELAY_MS);
      pendingQuits.set(connkey, timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!streamUrl) {
    return <div className="w-full h-full bg-black" />;
  }

  return (
    <img
      src={streamUrl}
      alt={descriptor.name ?? ''}
      className="w-full h-full object-contain bg-black"
    />
  );
}
