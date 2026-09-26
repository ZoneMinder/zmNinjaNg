/**
 * Sequence play: nearby events as tiles that replay in sync (refs #534).
 *
 * The tiles are the `sequenceMaxTiles` events nearest the anchor, in time order.
 * When the dialog opens, a shared clock (buildReplaySchedule) starts each
 * tile's stream at its own moment and stops it when the event ends, so
 * cameras that recorded the same moment play it together. A tile that is not
 * playing shows its thumbnail. Each playing tile is an EventZmsHoverPlayer,
 * which owns its connkey and sends CMD_QUIT when it unmounts: at the end of
 * its slot, on replay, on close, or when a tile opens its event.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { EventThumbnail } from '../EventThumbnail';
import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { buildReplaySchedule, buildRowThumbnail, nearestFirst, offsetLabel } from '../../../lib/event/event-context-view';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import { DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE } from '../../../stores/settings';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { ProfileId } from '../../../api/types';

export interface EventContextSequenceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: EventAroundRow[];
  profileId: ProfileId | undefined;
  monitorNames: Map<string, string>;
}

export function EventContextSequence({ open, onOpenChange, rows, profileId, monitorNames }: EventContextSequenceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const { profile, settings } = useProfileById(profileId);
  const { token: accessToken, isFresh } = useFreshAccessToken(profileId);
  const minStreamingPort = resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);
  const rate = settings.hoverPreviewPlaybackRate ?? DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE;

  const tiles = useMemo(() => nearestFirst(rows, EVENT_CONTEXT.sequenceMaxTiles), [rows]);
  const schedule = useMemo(() => buildReplaySchedule(tiles, rate), [tiles, rate]);
  const [playing, setPlaying] = useState<ReadonlySet<string>>(new Set());
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    const toggle = (id: string, on: boolean) =>
      setPlaying((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    const timers = schedule.flatMap(({ eventId, playAtMs, stopAtMs }) => [
      setTimeout(() => toggle(eventId, true), playAtMs),
      ...(stopAtMs === null ? [] : [setTimeout(() => toggle(eventId, false), stopAtMs)]),
    ]);
    return () => {
      timers.forEach(clearTimeout);
      setPlaying(new Set());
    };
  }, [open, schedule, run]);

  const openEvent = (eventId: string) => {
    markViewed(eventId);
    // Same route the panel's list rows take (CompactEventRow).
    navigate(profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[100dvh] max-h-[100dvh] max-w-none rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-lg"
        data-testid="event-context-sequence"
      >
        <DialogHeader>
          <DialogTitle>{t('events.around.sequence_title')}</DialogTitle>
          <DialogDescription>{t('events.around.sequence_desc', { count: tiles.length })}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(({ event, offsetMs, isAnchor }) => {
            const { urls, aspectRatio } = buildRowThumbnail(event, {
              portalUrl: profile?.portalUrl || '',
              thumbnailChain: settings.thumbnailFallbackChain,
              token: isFresh ? accessToken ?? undefined : undefined,
              minStreamingPort,
              profileId,
            });
            const monitorName = monitorNames.get(event.MonitorId) ?? event.MonitorId;
            const isPlaying = playing.has(event.Id);
            return (
              <button
                key={event.Id}
                type="button"
                onClick={() => openEvent(event.Id)}
                aria-current={isAnchor ? 'true' : undefined}
                aria-label={`${t('common.view')}: ${event.Name}`}
                title={monitorName}
                data-testid={`event-context-sequence-tile-${event.Id}`}
                data-playing={isPlaying}
                className={cn(
                  'min-w-0 rounded-md border text-left hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary',
                  isAnchor && 'ring-2 ring-primary/60 bg-primary/5'
                )}
              >
                <div className="relative w-full overflow-hidden rounded-t-md bg-black" style={{ aspectRatio: String(aspectRatio) }}>
                  {isPlaying ? (
                    <EventZmsHoverPlayer
                      descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name, profileId }}
                    />
                  ) : (
                    <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} className="h-full w-full" objectFit="cover" />
                  )}
                  <span
                    className={cn(
                      'absolute right-1 top-1 rounded px-1 text-xs',
                      isAnchor ? 'bg-blue-500/80 text-white' : 'bg-black/60 text-white'
                    )}
                    title={t('events.around.offset_title')}
                  >
                    {isAnchor ? t('events.around.this_event') : offsetLabel(offsetMs)}
                  </span>
                </div>
                <div className="truncate px-1.5 py-1 text-xs">{monitorName}</div>
              </button>
            );
          })}
        </div>
        <Button variant="outline" size="sm" onClick={() => setRun((n) => n + 1)} data-testid="event-context-sequence-replay">
          <RotateCcw className="h-4 w-4" />
          {t('events.around.sequence_replay')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
