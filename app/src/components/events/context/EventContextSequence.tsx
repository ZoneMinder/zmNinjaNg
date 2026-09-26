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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, ListVideo, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { EventThumbnail } from '../EventThumbnail';
import { ReturnFlashArrow } from '../ReturnFlashArrow';
import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { buildReplaySchedule, buildRowThumbnail, buildTogetherSchedule, nearestFirst, offsetLabel } from '../../../lib/event/event-context-view';
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
  const [together, setTogether] = useState(false);
  // Multi-port streaming spreads streams over several ports, each with its own
  // six-connection pool, so only a single-port server needs the cap. Snapshot
  // mode does not change this: event playback always streams.
  const maxStreams = minStreamingPort ? Infinity : EVENT_CONTEXT.togetherMaxStreams;
  const schedule = useMemo(
    () => (together ? buildTogetherSchedule(tiles, rate, maxStreams) : buildReplaySchedule(tiles, rate)),
    [together, tiles, rate, maxStreams]
  );
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
    // A tile queued behind streams that never end (events with no length
    // yet) has an infinite start and never plays.
    const timers = schedule
      .filter((slot) => Number.isFinite(slot.playAtMs))
      .flatMap(({ eventId, playAtMs, stopAtMs }) => [
        setTimeout(() => toggle(eventId, true), playAtMs),
        ...(stopAtMs === null ? [] : [setTimeout(() => toggle(eventId, false), stopAtMs)]),
      ]);
    return () => {
      timers.forEach(clearTimeout);
      setPlaying(new Set());
    };
  }, [open, schedule, run]);

  // A tile that starts playing below the fold scrolls into view. Only newly
  // started tiles count, so a tile that ends never pulls the view back.
  const gridRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const started = tiles.find(({ event }) => playing.has(event.Id) && !shownRef.current.has(event.Id));
    shownRef.current = playing;
    if (!started) return;
    gridRef.current
      ?.querySelector(`[data-testid="event-context-sequence-tile-${started.event.Id}"]`)
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [playing, tiles]);

  const openEvent = (eventId: string) => {
    markViewed(eventId);
    // Same route the panel's list rows take (CompactEventRow).
    navigate(profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[100dvh] max-h-[100dvh] max-w-none gap-1 rounded-none p-1.5 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-lg sm:p-2"
        data-testid="event-context-sequence"
      >
        {/* Only the toolbar and the tiles take space; the title and
            description are for screen readers. */}
        <DialogTitle className="sr-only">{t('events.around.sequence_title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('events.around.sequence_desc', { count: tiles.length })}</DialogDescription>
        {/* pr-8 clears the dialog's own close button in the top corner. */}
        <div className="flex items-center gap-1 border-b border-border/50 pb-1 pr-8">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setTogether((v) => !v)}
            data-mode={together ? 'together' : 'sequence'}
            data-testid="event-context-sequence-together"
          >
            {together ? <LayoutGrid className="h-3.5 w-3.5" /> : <ListVideo className="h-3.5 w-3.5" />}
            {t(together ? 'events.around.sequence_play_all' : 'events.around.sequence_play_sequence')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setRun((n) => n + 1)} data-testid="event-context-sequence-replay">
            <RotateCcw className="h-3.5 w-3.5" />
            {t('events.around.sequence_replay')}
          </Button>
        </div>
        <div ref={gridRef} className="grid grid-cols-2 gap-1 sm:grid-cols-3">
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
                className="min-w-0 rounded-sm border border-border/40 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative w-full overflow-hidden rounded-t-sm bg-black" style={{ aspectRatio: String(aspectRatio) }}>
                  {/* The same blinking triangle that marks a returned-to
                      event, here marking the tiles playing now. */}
                  {isPlaying && <ReturnFlashArrow className="top-1" />}
                  <div className={cn('h-full w-full transition-opacity', !isPlaying && 'opacity-60')}>
                    {isPlaying ? (
                      <EventZmsHoverPlayer
                        descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name, profileId }}
                      />
                    ) : (
                      <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} className="h-full w-full" objectFit="cover" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'absolute right-0.5 top-0.5 rounded-sm px-1 text-[10px]',
                      isAnchor ? 'bg-blue-500/80 text-white' : 'bg-black/60 text-white'
                    )}
                    title={t('events.around.offset_title')}
                  >
                    {isAnchor ? t('events.around.this_event') : offsetLabel(offsetMs)}
                  </span>
                </div>
                <div className="truncate px-1 py-0.5 text-[11px] leading-tight">{monitorName}</div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
