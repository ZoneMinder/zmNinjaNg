/**
 * Sequence play: nearby events as tiles that replay in sync (refs #534).
 *
 * The tiles are the N x N events nearest the anchor (the grid menu picks N,
 * remembered per device), split evenly before and after it, in time order.
 * In order, the tiles play in runs of overlapping events (buildReplayRuns):
 * inside a run each starts at its real offset, so cameras that recorded the
 * same moment play it together, and the next run starts once every tile in
 * this one is done. Done comes from probing the tile's ZMS stream
 * (useZmsEventProgress), never from a timer, since a stream does not keep to
 * the event's nominal length; the same probe draws each tile's progress line.
 * A tile that is not playing shows its thumbnail. Each playing tile is an
 * EventZmsHoverPlayer, which owns its connkey and sends CMD_QUIT when it
 * unmounts: once done, on replay, on close, or when a tile opens its event.
 *
 * Back from an event opened here reopens this dialog (the panel keeps it as
 * a history entry). It then holds playback and blinks the tile the user came
 * from, the way the Events list marks a returned-to row, until Replay or the
 * mode button starts playback again.
 *
 * One tap on a tile restarts the replay from that tile, in the current
 * mode; a second tap right after opens its event.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Grid2x2, LayoutGrid, ListVideo, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { EventThumbnail } from '../EventThumbnail';
import { GridColumnsMenu } from '../../common/GridColumnsMenu';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { ReturnFlashArrow } from '../ReturnFlashArrow';
import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';
import { useCurrentProfile, useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useReturnFlash } from '../../../hooks/useReturnFlash';
import { useInsomnia } from '../../../hooks/useInsomnia';
import { useBandwidthSettings } from '../../../hooks/useBandwidthSettings';
import type { ZmsProbe } from '../../../hooks/useZmsEventProgress';
import type { EventContextHistoryState } from '../../../stores/eventContext';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { buildReplayRuns, buildRowThumbnail, currentRunIndex, togetherPlaying, balancedAroundAnchor, offsetLabel } from '../../../lib/event/event-context-view';
import { EVENT_CONTEXT, STORAGE_KEYS } from '../../../lib/zmninja-ng-constants';
import { DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE } from '../../../stores/settings';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { Event, ProfileId } from '../../../api/types';

/** The mode last picked on this device: a per-device convenience, so a
 *  blocked or missing store just starts in order (Settings contract). */
function readStoredTogether(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.eventContextReplayMode) === 'all';
  } catch {
    return false;
  }
}

/** The grid size last picked on this device, if it is one still offered. */
function readStoredGrid(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEYS.eventContextReplayGrid));
    return (EVENT_CONTEXT.sequenceGridSizes as readonly number[]).includes(n) ? n : EVENT_CONTEXT.sequenceDefaultGrid;
  } catch {
    return EVENT_CONTEXT.sequenceDefaultGrid;
  }
}

function storeGrid(n: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.eventContextReplayGrid, String(n));
  } catch {
    /* next open starts at the default */
  }
}

function storeTogether(together: boolean) {
  try {
    localStorage.setItem(STORAGE_KEYS.eventContextReplayMode, together ? 'all' : 'in-order');
  } catch {
    /* next open starts in order */
  }
}

const DONE_PROBE: ZmsProbe = { fraction: 1, ahead: 1, remainingMs: 0, misses: 0, done: true };

export interface EventContextSequenceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: EventAroundRow[];
  profileId: ProfileId | undefined;
  monitorNames: Map<string, string>;
  /** The tile whose event the user just came back from, if any. */
  returnedFrom?: string;
  /** The panel's list itself was cut off, so the total is a floor. */
  truncated?: boolean;
}

export function EventContextSequence({ open, onOpenChange, rows, profileId, monitorNames, returnedFrom, truncated }: EventContextSequenceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const { profile, settings } = useProfileById(profileId);
  // Previews are selection-scoped: they follow the current selection, not
  // the owning server (refs #536).
  const { settings: selectionSettings } = useCurrentProfile();
  const { token: accessToken, isFresh } = useFreshAccessToken(profileId);
  const minStreamingPort = resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);
  const rate = selectionSettings.hoverPreviewPlaybackRate ?? DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE;

  const isMobile = useIsMobile();
  const [grid, setGrid] = useState(readStoredGrid);
  const tiles = useMemo(() => balancedAroundAnchor(rows, grid * grid), [rows, grid]);
  // The screen stays awake for as long as the replay is open, on top of (never
  // instead of) the user's Insomnia setting, which is left alone. Tied to the
  // dialog rather than to "a tile is playing": in order, one tile stops and the
  // next starts on separate timers, and dropping the lock in between would let
  // a phone whose idle timeout has already passed dim at once.
  useInsomnia({ enabled: open });
  const [together, setTogether] = useState(readStoredTogether);
  const { zmsStatusInterval } = useBandwidthSettings();
  // Multi-port streaming spreads streams over several ports, each with its own
  // six-connection pool, so only a single-port server needs the cap. Snapshot
  // mode does not change this: event playback always streams.
  const maxStreams = minStreamingPort ? Infinity : EVENT_CONTEXT.togetherMaxStreams;
  // A tapped tile becomes the start of the replay: it plays at once and the
  // tiles after it follow in the current mode; the ones before it are skipped.
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [held, setHeld] = useState(Boolean(returnedFrom));
  // What the probes have reported this run, and which in-order tiles have
  // reached their start offset inside the current run.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [probes, setProbes] = useState<ReadonlyMap<string, ZmsProbe>>(new Map());
  const [due, setDue] = useState<ReadonlySet<string>>(new Set());
  const startRun = (from: string | null) => {
    setStartFrom(from);
    setHeld(false);
    setDone(new Set());
    setProbes(new Map());
    setDue(new Set());
    setRun((n) => n + 1);
  };
  const restart = () => startRun(null);

  const queue = useMemo(() => {
    if (held) return [];
    return tiles.slice(Math.max(0, tiles.findIndex(({ event }) => event.Id === startFrom)));
  }, [held, tiles, startFrom]);
  const runs = useMemo(() => buildReplayRuns(queue, rate), [queue, rate]);
  const runIndex = together ? -1 : currentRunIndex(runs, done);
  const currentRun = runs[runIndex];

  // In order: each tile of the current run becomes due at its offset.
  useEffect(() => {
    if (!open || !currentRun) return;
    const timers = currentRun.map(({ eventId, startMs }) =>
      setTimeout(() => setDue((prev) => new Set(prev).add(eventId)), startMs)
    );
    return () => timers.forEach(clearTimeout);
  }, [open, currentRun, run]);

  const playing = useMemo<ReadonlySet<string>>(() => {
    if (!open) return new Set();
    if (together) return new Set(togetherPlaying(queue.map(({ event }) => event.Id), done, maxStreams));
    return new Set(currentRun?.filter(({ eventId }) => due.has(eventId) && !done.has(eventId)).map((c) => c.eventId));
  }, [open, together, queue, done, maxStreams, currentRun, due]);

  const onProbe = (eventId: string, probe: ZmsProbe) => {
    setProbes((prev) => new Map(prev).set(eventId, probe));
    if (probe.done) setDone((prev) => new Set(prev).add(eventId));
  };

  // A tile that starts playing below the fold scrolls into view. Only newly
  // started tiles count, so a tile that ends never pulls the view back.
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollToTile = (eventId: string, block: ScrollLogicalPosition) =>
    gridRef.current
      ?.querySelector(`[data-testid="event-context-sequence-tile-${eventId}"]`)
      ?.scrollIntoView?.({ block, behavior: 'smooth' });
  const shownRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const started = tiles.find(({ event }) => playing.has(event.Id) && !shownRef.current.has(event.Id));
    shownRef.current = playing;
    if (started) scrollToTile(started.event.Id, 'nearest');
  }, [playing, tiles]);

  // On return, bring the tile the user came from into view, once its row is in.
  const returnScrolledRef = useRef(false);
  useEffect(() => {
    if (!returnedFrom || returnScrolledRef.current || !tiles.some(({ event }) => event.Id === returnedFrom)) return;
    returnScrolledRef.current = true;
    scrollToTile(returnedFrom, 'center');
  }, [returnedFrom, tiles]);

  // One tap plays the tile; a second tap on it within doubleTapMs opens it.
  const lastTapRef = useRef<{ eventId: string; at: number } | null>(null);
  const tapTile = (eventId: string, now: number) => {
    const last = lastTapRef.current;
    lastTapRef.current = { eventId, at: now };
    if (last?.eventId === eventId && now - last.at <= EVENT_CONTEXT.doubleTapMs) {
      openEvent(eventId);
      return;
    }
    startRun(eventId);
  };

  const openEvent = (eventId: string) => {
    markViewed(eventId);
    // Record the tile on this dialog's own history entry first, so back from
    // the event reopens the dialog on it.
    const state: EventContextHistoryState = {
      ...(location.state as EventContextHistoryState | null),
      eventContextSequence: { returnedFrom: eventId },
    };
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state });
    // Same route the panel's list rows take (CompactEventRow).
    navigate(profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Phones: fill the screen inside the system bars. Android and iOS draw
        // the app under them, so a box from the top edge put the toolbar and
        // the close button under the status bar. Insetting the box itself
        // (rather than padding it) moves the dialog's own close button too.
        // From sm up it is the stock centred dialog again.
        className={cn(
          'bottom-[var(--sai-bottom,0px)] left-[var(--sai-left,0px)] right-[var(--sai-right,0px)] top-[var(--sai-top,0px)]',
          'max-h-none w-auto max-w-none translate-x-0 translate-y-0 gap-1 rounded-none p-1.5',
          'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
          'sm:bottom-auto sm:left-[50%] sm:right-auto sm:top-[50%] sm:max-h-[calc(100dvh-2rem)] sm:w-full sm:max-w-[min(95vw,var(--replay-max-w))]',
          'sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-2',
          'sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
          // Above the sticky toolbar, which would otherwise paint over it.
          '[&>[data-testid=dialog-close-button]]:z-20'
        )}
        data-testid="event-context-sequence"
        style={{
          ['--replay-max-w' as string]: `calc((100dvh - 2rem - ${EVENT_CONTEXT.sequenceChromeRem}rem - ${grid} * ${EVENT_CONTEXT.sequenceRowLabelRem}rem) * 16 / 9)`,
        }}
      >
        {/* Only the toolbar and the tiles take space; the title and
            description are for screen readers. */}
        <DialogTitle className="sr-only">{t('events.around.sequence_title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('events.around.sequence_desc', { count: tiles.length })}</DialogDescription>
        {/* pr-8 clears the dialog's own close button in the top corner. */}
        {/* Sticky, so the controls stay in reach while the tiles scroll. */}
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border/50 bg-background pb-1 pr-8">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              storeTogether(!together);
              setTogether(!together);
              restart();
            }}
            data-mode={together ? 'together' : 'sequence'}
            data-testid="event-context-sequence-together"
          >
            {together ? <LayoutGrid className="h-3.5 w-3.5" /> : <ListVideo className="h-3.5 w-3.5" />}
            {t(together ? 'events.around.sequence_play_all' : 'events.around.sequence_play_sequence')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={restart} data-testid="event-context-sequence-replay">
            <RotateCcw className="h-3.5 w-3.5" />
            {t('events.around.sequence_replay')}
          </Button>
          <GridColumnsMenu
            isMobile={isMobile}
            gridCols={grid}
            title={t('events.around.sequence_grid')}
            triggerIcon={Grid2x2}
            triggerTestId="event-context-sequence-grid"
            presets={EVENT_CONTEXT.sequenceGridSizes.map((n) => ({
              cols: n,
              icon: LayoutGrid,
              label: t('events.around.sequence_grid_size', { n }),
              testId: `event-context-sequence-grid-${n}`,
            }))}
            onApplyGridLayout={(n) => {
              storeGrid(n);
              setGrid(n);
              restart();
            }}
          />
          {tiles.length < rows.length && (
            <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground" data-testid="event-context-sequence-nearest">
              {t('events.around.sequence_nearest', {
                count: tiles.length,
                total: `${rows.length}${truncated ? '+' : ''}`,
              })}
            </span>
          )}
        </div>
        <div ref={gridRef} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${grid}, minmax(0, 1fr))` }}>
          {tiles.map(({ event, offsetMs, isAnchor }) => {
            const { urls, aspectRatio } = buildRowThumbnail(event, {
              portalUrl: profile?.portalUrl || '',
              thumbnailChain: settings.thumbnailFallbackChain,
              token: isFresh ? accessToken ?? undefined : undefined,
              minStreamingPort,
              profileId,
            });
            return (
              <SequenceTile
                key={event.Id}
                event={event}
                offsetMs={offsetMs}
                isAnchor={isAnchor}
                urls={urls}
                aspectRatio={aspectRatio}
                monitorName={monitorNames.get(event.MonitorId) ?? event.MonitorId}
                isPlaying={playing.has(event.Id)}
                run={run}
                probe={done.has(event.Id) ? DONE_PROBE : probes.get(event.Id)}
                progressStepMs={zmsStatusInterval}
                onProbe={(probe) => onProbe(event.Id, probe)}
                profileId={profileId}
                onTap={(at) => tapTile(event.Id, at)}
              />
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SequenceTileProps {
  event: Event;
  offsetMs: number;
  isAnchor: boolean;
  urls: string[];
  aspectRatio: number;
  monitorName: string;
  isPlaying: boolean;
  /** Keys the player, so a restart gets a fresh stream even for a tile already playing. */
  run: number;
  /** The tile's last stream probe; none before it plays. */
  probe: ZmsProbe | undefined;
  /** Time between probes. The line eases toward `probe.ahead` across it, or
   *  across the time left when the stream ends sooner, and snaps full once done. */
  progressStepMs: number;
  onProbe: (probe: ZmsProbe) => void;
  profileId: ProfileId | undefined;
  /** Called with the click's own timestamp, in ms. */
  onTap: (at: number) => void;
}

function SequenceTile({ event, offsetMs, isAnchor, urls, aspectRatio, monitorName, isPlaying, run, probe, progressStepMs, onProbe, profileId, onTap }: SequenceTileProps) {
  const { t } = useTranslation();
  const flash = useReturnFlash(event.Id);
  return (
    <button
      type="button"
      onClick={(e) => onTap(e.timeStamp)}
      aria-current={isAnchor ? 'true' : undefined}
      aria-label={`${monitorName}, ${event.Name}. ${t('events.around.sequence_tile_hint')}`}
      title={`${monitorName}. ${t('events.around.sequence_tile_hint')}`}
      data-testid={`event-context-sequence-tile-${event.Id}`}
      data-playing={isPlaying}
      data-flash={flash}
      className="min-w-0 rounded-sm border border-border/40 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full overflow-hidden rounded-t-sm bg-black" style={{ aspectRatio: String(aspectRatio) }}>
        {/* The blinking triangle marks a playing tile, or the tile the user
            just came back from while playback is held. */}
        {(isPlaying || flash) && <ReturnFlashArrow className="top-1" />}
        <div className={cn('h-full w-full transition-opacity', !isPlaying && 'opacity-60')}>
          {isPlaying ? (
            <EventZmsHoverPlayer
              key={run}
              descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name, profileId }}
              onProbe={onProbe}
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
        <div
          role="progressbar"
          aria-label={t('events.around.sequence_progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((probe?.fraction ?? 0) * 100)}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20"
          data-testid={`event-context-sequence-progress-${event.Id}`}
        >
          <div
            className="h-full bg-sky-400 transition-[width] ease-linear"
            style={{
              width: `${(probe?.ahead ?? 0) * 100}%`,
              transitionDuration: `${probe?.done ? 0 : Math.min(progressStepMs, probe?.remainingMs ?? progressStepMs)}ms`,
            }}
          />
        </div>
      </div>
      <div className="truncate px-1 py-0.5 text-[11px] leading-tight">{monitorName}</div>
    </button>
  );
}
