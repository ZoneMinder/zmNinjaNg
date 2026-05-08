/**
 * EventPreviewPopover
 *
 * Fixed-position popover shown when an event bar is clicked/tapped
 * on the timeline canvas. Shows a snapshot, metadata, and action buttons.
 * Tapping outside the popover dismisses it.
 */

import { memo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Clock, AlertTriangle, Tag, VideoOff, Camera } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getEventImageUrl } from '../../api/events';
import { getPortalUrlForEvent } from '../../lib/server-resolver';
import { resolveFallbackFids } from '../../lib/thumbnail-chain';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import type { MonitorsResponse } from '../../api/types';
import { HoverPreview } from '../ui/hover-preview';
import { EventZmsHoverPlayer } from '../events/EventThumbnailHoverPreview';

interface EventPreviewPopoverProps {
  event: {
    id: string;
    monitorId: string;
    cause: string;
    startDateTime: string;
    duration: string;
    alarmFrames: string;
    notes: string | null;
    monitorName: string;
    tags?: string[];
  };
  position: { x: number; y: number };
  onOpenEvent: (eventId: string) => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

/** Extract detected objects from Notes, stripping everything after | in each entry. */
function parseDetectedObjects(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/detected:(.*)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.split('|')[0].trim())
    .filter(Boolean);
}

export const EventPreviewPopover = memo(function EventPreviewPopover({
  event,
  position,
  onOpenEvent,
  onClose,
}: EventPreviewPopoverProps) {
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const queryClient = useQueryClient();

  const profilePortalUrl = currentProfile?.portalUrl ?? '';
  const monitors = (queryClient.getQueryData<MonitorsResponse>(['monitors']))?.monitors ?? [];
  const portalUrl = getPortalUrlForEvent(event.monitorId, monitors, profilePortalUrl);
  const tokenOpts = {
    token: accessToken ?? undefined,
    minStreamingPort: currentProfile?.minStreamingPort,
    monitorId: event.monitorId,
  };
  const fids = resolveFallbackFids(settings.thumbnailFallbackChain);
  const candidates = isAccessTokenFresh
    ? fids.map((fid) => ({
        fid,
        url: getEventImageUrl(portalUrl, event.id, fid, tokenOpts),
      }))
    : [];

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [resolvedFrame, setResolvedFrame] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Preload off-screen: try each candidate until one loads successfully
  useEffect(() => {
    let cancelled = false;
    if (candidates.length === 0) {
      if (isAccessTokenFresh) setImgFailed(true);
      return () => { cancelled = true; };
    }

    setImgFailed(false);
    (async () => {
      for (const { fid, url } of candidates) {
        if (cancelled) return;
        const ok = await new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (cancelled) return;
        if (ok) {
          setResolvedSrc(url);
          setResolvedFrame(fid);
          return;
        }
      }
      if (!cancelled) setImgFailed(true);
    })();

    return () => { cancelled = true; };
  }, [event.id, isAccessTokenFresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameLabels: Record<string, string> = {
    objdetect: 'AI Detect',
    alarm: 'Alarm',
    snapshot: 'Snapshot',
  };

  const parsed = parseISO(event.startDateTime.replace(' ', 'T'));
  const dateLabel = format(parsed, 'EEE, MMM d');
  const timeLabel = format(parsed, 'HH:mm:ss');
  const duration = formatDuration(parseFloat(event.duration) || 0);
  const detectedObjects = parseDetectedObjects(event.notes);
  const tags = event.tags ?? [];

  return (
    <>
      {/* Invisible backdrop — tap anywhere outside to dismiss */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        data-testid="event-preview-backdrop"
      />

      <div
        className="fixed z-50 w-72 rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
        style={{
          left: Math.min(position.x, window.innerWidth - 300),
          top: Math.min(position.y + 12, window.innerHeight - 350),
        }}
        data-testid="event-preview-popover"
      >
        <div className="relative">
          {imgFailed ? (
            <div className="aspect-video bg-muted/30 rounded-t-lg flex items-center justify-center">
              <VideoOff className="h-8 w-8 text-muted-foreground/40" />
            </div>
          ) : resolvedSrc ? (
            settings.hoverPreview.timeline ? (
              <HoverPreview
                aspectRatio={16 / 9}
                testId="event-thumbnail-hover-preview"
                renderPreview={() => (
                  <EventZmsHoverPlayer
                    descriptor={{ eventId: event.id, monitorId: event.monitorId }}
                  />
                )}
              >
                <img
                  src={resolvedSrc}
                  alt=""
                  className="aspect-video bg-black rounded-t-lg overflow-hidden object-contain w-full"
                />
              </HoverPreview>
            ) : (
              <img
                src={resolvedSrc}
                alt=""
                className="aspect-video bg-black rounded-t-lg overflow-hidden object-contain w-full"
              />
            )
          ) : (
            <div className="aspect-video bg-muted/30 rounded-t-lg flex items-center justify-center">
              <Camera className="h-8 w-8 text-muted-foreground/40 animate-pulse" />
            </div>
          )}
          {resolvedFrame && (
            <span className="absolute top-1.5 right-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white/80">
              {frameLabels[resolvedFrame] ?? resolvedFrame}
            </span>
          )}
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate min-w-0" title={event.monitorName}>
              {event.monitorName}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <AlertTriangle className="h-3 w-3" />
              {event.cause}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{dateLabel}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeLabel}
            </span>
            <span>{duration}</span>
          </div>

          {/* Detected objects */}
          {detectedObjects.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detectedObjects.map((obj) => (
                <Badge key={obj} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {obj}
                </Badge>
              ))}
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="text-xs h-7 flex-1"
              onClick={() => onOpenEvent(event.id)}
              data-testid="event-preview-open"
            >
              <Play className="h-3 w-3 mr-1" />
              {t('timeline.play_event')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
});
