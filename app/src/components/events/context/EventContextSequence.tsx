/**
 * Sequence play: nearby events as tiles that replay in sync (refs #534).
 *
 * The tiles are up to `eventContextReplayTiles` (a setting) events split
 * evenly before and after the anchor, in time order. The grid menu picks N x N (remembered per
 * device): N columns, sized so N rows fit the screen; the rest scroll.
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
 * from, the way the Events list marks a returned-to row, until Play picks
 * up from that tile or Restart starts over. Play/Pause holds playback the
 * same way: the streams stop, Play starts the paused tile again from its
 * beginning, and the last press is remembered on this device, so a replay
 * paused last time opens paused.
 *
 * One tap on a tile restarts the replay from that tile; a second tap right
 * after opens its event. With the pencil pressed, dragging a tile's corner
 * resizes it inside the grid (useGridTrackResize), and each tile zooms and
 * pans like the event and monitor views (useZoomPan); taps do nothing then,
 * so a pan does not restart the replay. Sizes and zoom stay after the pencil
 * is released.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Grid2x2, LayoutGrid, Pause, Pencil, Play, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { GridColumnsMenu } from '../../common/GridColumnsMenu';
import { useIsPhone } from '../../../hooks/useIsMobile';
import { useCurrentProfile, useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useInsomnia } from '../../../hooks/useInsomnia';
import { useBandwidthSettings } from '../../../hooks/useBandwidthSettings';
import { useGridTrackResize } from '../../../hooks/useGridTrackResize';
import { useDateTimeFormat } from '../../../hooks/useDateTimeFormat';
import { SequenceTile } from './SequenceTile';
import type { ZmsProbe } from '../../../hooks/useZmsEventProgress';
import type { EventContextHistoryState } from '../../../stores/eventContext';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { buildReplayRuns, buildRowThumbnail, currentRunIndex, balancedAroundAnchor } from '../../../lib/event/event-context-view';
import { EVENT_CONTEXT, STORAGE_KEYS } from '../../../lib/zmninja-ng-constants';
import { DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE } from '../../../stores/settings';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { ProfileId } from '../../../api/types';

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

/** Whether the last Play/Pause press on this device paused the replay. */
function readStoredPaused(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.eventContextReplayPaused) === 'true';
  } catch {
    return false;
  }
}

function storePaused(paused: boolean) {
  try {
    localStorage.setItem(STORAGE_KEYS.eventContextReplayPaused, String(paused));
  } catch {
    /* next open plays */
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

  const isPhone = useIsPhone();
  const [grid, setGrid] = useState(readStoredGrid);
  const [resizing, setResizing] = useState(false);
  const tileCount = selectionSettings.eventContextReplayTiles;
  const tiles = useMemo(() => balancedAroundAnchor(rows, tileCount), [rows, tileCount]);
  // The screen stays awake for as long as the replay is open, on top of (never
  // instead of) the user's Insomnia setting, which is left alone. Tied to the
  // dialog rather than to "a tile is playing": in order, one tile stops and the
  // next starts on separate timers, and dropping the lock in between would let
  // a phone whose idle timeout has already passed dim at once.
  useInsomnia({ enabled: open });
  const { zmsStatusInterval } = useBandwidthSettings();
  // A tapped tile becomes the start of the replay: it plays at once and the
  // tiles after it follow; the ones before it are skipped.
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  // Held: nothing plays until Play, a tap or Restart. Opens held after a
  // return from an event, or when Pause was the last press on this device.
  const [held, setHeld] = useState(() => Boolean(returnedFrom) || readStoredPaused());
  // Where Play picks up: the tile that was playing at the pause, or the one
  // the user came back from.
  const resumeFromRef = useRef<string | null>(returnedFrom ?? null);
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
  const currentRun = runs[currentRunIndex(runs, done)];
  const running = Boolean(currentRun);

  // Each tile of the current run becomes due at its offset.
  useEffect(() => {
    if (!open || !currentRun) return;
    const timers = currentRun.map(({ eventId, startMs }) =>
      setTimeout(() => setDue((prev) => new Set(prev).add(eventId)), startMs)
    );
    return () => timers.forEach(clearTimeout);
  }, [open, currentRun, run]);

  const playing = useMemo<ReadonlySet<string>>(() => {
    if (!open) return new Set();
    return new Set(currentRun?.filter(({ eventId }) => due.has(eventId) && !done.has(eventId)).map((c) => c.eventId));
  }, [open, currentRun, due, done]);

  const togglePlay = () => {
    storePaused(running);
    if (running) {
      resumeFromRef.current = tiles.find(({ event }) => playing.has(event.Id))?.event.Id ?? null;
      setHeld(true);
      return;
    }
    const from = resumeFromRef.current;
    resumeFromRef.current = null;
    startRun(from);
  };

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
  const rowCount = Math.ceil(tiles.length / grid);
  const { colWeights, rowWeights, handleProps, reset: resetTileSizes } = useGridTrackResize(gridRef, grid, rowCount);
  const rowWeightSum = rowWeights.reduce((a, b) => a + b, 0);
  const shownRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const started = tiles.find(({ event }) => playing.has(event.Id) && !shownRef.current.has(event.Id));
    shownRef.current = playing;
    // Not under an open preview: on a computer, any scroll closes it.
    if (started && !document.querySelector('[data-testid="event-context-sequence-preview"]')) {
      scrollToTile(started.event.Id, 'nearest');
    }
  }, [playing, tiles]);

  // On return, bring the tile the user came from into view, once its row is in.
  const returnScrolledRef = useRef(false);
  useEffect(() => {
    if (!returnedFrom || returnScrolledRef.current || !tiles.some(({ event }) => event.Id === returnedFrom)) return;
    returnScrolledRef.current = true;
    scrollToTile(returnedFrom, 'center');
  }, [returnedFrom, tiles]);

  // An open preview follows the replay: once the tile it shows is done, it
  // moves on to the first tile playing.
  const nextPreviewTile = (shown: string) =>
    done.has(shown) ? tiles.find(({ event }) => playing.has(event.Id))?.event.Id ?? shown : shown;
  // Only a playing tile's stream: between runs the view holds its last frame
  // rather than drawing the low-res thumbnail the tile falls back to.
  const tileImg = (eventId: string) => playing.has(eventId)
    ? gridRef.current?.querySelector<HTMLImageElement>(`[data-testid="event-context-sequence-zoom-${eventId}"] img`)
    : null;
  const { fmtTime } = useDateTimeFormat();
  const previewCaption = (eventId: string) => {
    const event = tiles.find((tile) => tile.event.Id === eventId)?.event;
    if (!event) return '';
    return `${monitorNames.get(event.MonitorId) ?? event.MonitorId} · ${fmtTime(new Date(event.StartDateTime.replace(' ', 'T')))}`;
  };

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
    // Same route and event list the panel's rows give it (CompactEventRow).
    navigate(profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`, {
      state: { eventContextQueue: rows.map((r) => r.event.Id) } satisfies EventContextHistoryState,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Phones: fill the screen inside the system bars. Android and iOS draw
        // the app under them, so a box from the top edge put the toolbar and
        // the close button under the status bar. Insetting the box itself
        // (rather than padding it) moves the dialog's own close button too.
        // Phones stay full screen in landscape too; on anything else (always
        // sm and up) it is the stock centred dialog again.
        className={cn(
          'bottom-[var(--sai-bottom,0px)] left-[var(--sai-left,0px)] right-[var(--sai-right,0px)] top-[var(--sai-top,0px)]',
          'max-h-none w-auto max-w-none translate-x-0 translate-y-0 gap-1 rounded-none p-1.5',
          'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
          !isPhone && [
            'sm:bottom-auto sm:left-[50%] sm:right-auto sm:top-[50%] sm:max-h-[calc(100dvh-2rem)] sm:w-full sm:max-w-[min(95vw,var(--replay-max-w))]',
            'sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-2',
            'sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
          ],
          // Above the sticky toolbar, which would otherwise paint over it.
          '[&>[data-testid=dialog-close-button]]:z-20'
        )}
        data-testid="event-context-sequence"
        style={{
          // As wide as the rows the tiles fill can be while they fit on screen.
          ['--replay-max-w' as string]: `calc((100dvh - 2rem - ${EVENT_CONTEXT.sequenceChromeRem}rem - ${Math.max(rowCount, 1)} * ${EVENT_CONTEXT.sequenceRowLabelRem}rem) * 16 / 9 * ${grid} / ${Math.max(rowCount, 1)})`,
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
            className="h-7 px-2"
            aria-label={t(running ? 'event_detail.pause' : 'event_detail.play')}
            title={t(running ? 'event_detail.pause' : 'event_detail.play')}
            onClick={togglePlay}
            data-testid="event-context-sequence-play"
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={restart} data-testid="event-context-sequence-replay">
            <RotateCcw className="h-3.5 w-3.5" />
            {t('events.around.sequence_replay')}
          </Button>
          <GridColumnsMenu
            isMobile={isPhone}
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
              // Layout only: the tiles and their streams stay as they are.
              setGrid(n);
              resetTileSizes();
            }}
          />
          <Button
            variant={resizing ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2"
            aria-pressed={resizing}
            aria-label={t('events.around.sequence_resize')}
            title={t('events.around.sequence_resize')}
            onClick={() => setResizing((on) => !on)}
            data-testid="event-context-sequence-resize-toggle"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {tiles.length < rows.length && (
            <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground" data-testid="event-context-sequence-nearest">
              {t('events.around.sequence_nearest', {
                count: tiles.length,
                total: `${rows.length}${truncated ? '+' : ''}`,
              })}
            </span>
          )}
        </div>
        {/* A container, so the rows can size from the grid's width (cqw): a
            row is one 16:9 tile plus its name, scaled by its drag weight. */}
        <div style={{ containerType: 'inline-size' }}>
        <div
          ref={gridRef}
          className="grid gap-1"
          data-testid="event-context-sequence-grid-tiles"
          style={{
            ['--replay-row' as string]: `calc((100cqw - ${grid - 1} * 0.25rem) / ${grid} * 9 / 16 + ${EVENT_CONTEXT.sequenceRowLabelRem}rem)`,
            gridTemplateColumns: colWeights.map((w) => `minmax(0, ${w}fr)`).join(' '),
            gridTemplateRows: rowWeights.map((w) => `calc(var(--replay-row) * ${(rowCount * w) / rowWeightSum})`).join(' '),
          }}
        >
          {tiles.map(({ event, offsetMs, isAnchor }, i) => {
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
                preview={selectionSettings.hoverPreview.replay}
                previewNext={nextPreviewTile}
                previewImg={tileImg}
                previewCaption={previewCaption}
                resizeHandle={resizing ? (sx, sy) => handleProps(i % grid, Math.floor(i / grid), sx, sy) : undefined}
                monitorName={monitorNames.get(event.MonitorId) ?? event.MonitorId}
                isPlaying={playing.has(event.Id)}
                run={run}
                probe={done.has(event.Id) ? DONE_PROBE : probes.get(event.Id)}
                progressStepMs={zmsStatusInterval}
                onProbe={(probe) => onProbe(event.Id, probe)}
                profileId={profileId}
                editing={resizing}
                onTap={(at) => { if (!resizing) tapTile(event.Id, at); }}
              />
            );
          })}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
