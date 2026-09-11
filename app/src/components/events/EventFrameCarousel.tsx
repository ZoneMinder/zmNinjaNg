/**
 * Event Frame Carousel
 *
 * Collapsible strip of the significant frames ZoneMinder keeps for an event:
 * the alarm frame, the snapshot, and the annotated object-detection image
 * (issue #272). Tapping one opens it full size in a zoomable viewer.
 *
 * ZoneMinder exposes no API that reports which of these frames exist, so each
 * candidate is rendered and removed when its image fails to load. The card
 * renders nothing once every candidate has failed.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Images } from 'lucide-react';
import { getEventImageUrl } from '../../api/events';
import { CollapsibleCard } from '../ui/collapsible-card';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { ZoomControls } from '../ui/zoom-controls';
import { useZoomPan } from '../../hooks/useZoomPan';
import {
  EVENT_FRAMES_OPEN_STORAGE_KEY,
  EVENT_FRAME_THUMB_WIDTH,
  EVENT_FRAME_TYPES,
} from '../../lib/zmninja-ng-constants';

type EventFrameType = (typeof EVENT_FRAME_TYPES)[number];

interface EventFrameCarouselProps {
  portalUrl: string;
  eventId: string;
  token?: string;
  apiUrl?: string;
  minStreamingPort?: number;
  monitorId?: string;
  /** Whether the event recorded an alarm frame. Skips that candidate when false. */
  hasAlarmFrame: boolean;
  /**
   * Called when the full-size viewer opens or closes, so the page can pause
   * playback while the image covers the player and resume it afterwards.
   */
  onViewerOpenChange?: (open: boolean) => void;
}

export function EventFrameCarousel({
  portalUrl,
  eventId,
  token,
  apiUrl,
  minStreamingPort,
  monitorId,
  hasAlarmFrame,
  onViewerOpenChange,
}: EventFrameCarouselProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<EventFrameType[]>([]);
  const [activeFrame, setActiveFrame] = useState<EventFrameType | null>(null);

  const frames = useMemo(
    () =>
      EVENT_FRAME_TYPES.filter(
        (type) => (type !== 'alarm' || hasAlarmFrame) && !failed.includes(type)
      ),
    [hasAlarmFrame, failed]
  );

  const imageUrl = useCallback(
    (type: EventFrameType, width?: number) =>
      getEventImageUrl(portalUrl, eventId, type, {
        token,
        width,
        apiUrl,
        minStreamingPort,
        monitorId,
      }),
    [portalUrl, eventId, token, apiUrl, minStreamingPort, monitorId]
  );

  const handleViewerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setActiveFrame(null);
      onViewerOpenChange?.(open);
    },
    [onViewerOpenChange]
  );

  const openFrame = useCallback(
    (type: EventFrameType) => {
      setActiveFrame(type);
      onViewerOpenChange?.(true);
    },
    [onViewerOpenChange]
  );

  if (frames.length === 0) return null;

  return (
    <>
      <CollapsibleCard
        data-testid="event-frames-card"
        storageKey={EVENT_FRAMES_OPEN_STORAGE_KEY}
        header={
          <div className="flex items-center gap-2">
            <Images className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{t('event_detail.frames_title')}</span>
          </div>
        }
      >
        <div className="flex gap-2 overflow-x-auto pb-1">
          {frames.map((type) => (
            <button
              key={type}
              type="button"
              className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => openFrame(type)}
              aria-label={t('event_detail.view_frame', { type: t(`event_detail.frame_type.${type}`) })}
              data-testid={`event-frame-thumb-${type}`}
            >
              <img
                src={imageUrl(type, EVENT_FRAME_THUMB_WIDTH)}
                alt={t(`event_detail.frame_type.${type}`)}
                className="w-30 h-20 object-cover rounded border"
                onError={() => setFailed((prev) => (prev.includes(type) ? prev : [...prev, type]))}
              />
              <p className="text-xs text-center mt-1 text-muted-foreground min-w-0 truncate w-30">
                {t(`event_detail.frame_type.${type}`)}
              </p>
            </button>
          ))}
        </div>
      </CollapsibleCard>

      {activeFrame && (
        <EventFrameViewer
          src={imageUrl(activeFrame)}
          label={t(`event_detail.frame_type.${activeFrame}`)}
          onOpenChange={handleViewerOpenChange}
        />
      )}
    </>
  );
}

/**
 * Full-size view of one frame. Mounted only while a frame is open, so its
 * zoom/pan state starts fresh each time instead of reopening at the last
 * scale, and the hook stays out of the carousel's own render.
 */
function EventFrameViewer({
  src,
  label,
  onOpenChange,
}: {
  src: string;
  label: string;
  onOpenChange: (open: boolean) => void;
}) {
  // Destructured rather than kept whole: handing an object that still carries
  // the two refs to ZoomControls trips react-hooks/refs (rule 31).
  const { ref, innerRef, ...controls } = useZoomPan();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] w-full p-2 bg-black border-0"
        data-testid="event-frame-viewer"
        // The frame itself is the content; the title names it, so Radix's
        // description slot has nothing to add.
        aria-describedby={undefined}
      >
        <DialogTitle className="text-sm text-white">{label}</DialogTitle>
        <div ref={ref} className="relative overflow-hidden touch-none">
          <div ref={innerRef}>
            <img
              src={src}
              alt={label}
              className="w-full max-h-[80vh] object-contain"
              data-testid="event-frame-viewer-image"
            />
          </div>
          <ZoomControls zoomPan={controls} className="bottom-2 left-2" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
