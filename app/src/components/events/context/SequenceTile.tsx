/**
 * One tile of the Replay grid (EventContextSequence): the event's stream
 * while it plays and its thumbnail otherwise, with its offset, progress line,
 * corner handles while the pencil is pressed, and the hover preview.
 */
import { useTranslation } from 'react-i18next';
import { EventThumbnail } from '../EventThumbnail';
import { ReturnFlashArrow } from '../ReturnFlashArrow';
import { EventZmsHoverPlayer } from '../EventThumbnailHoverPreview';
import { HoverPreview } from '../../ui/hover-preview';
import { TilePreview } from './TileMirror';
import { useReturnFlash } from '../../../hooks/useReturnFlash';
import { useZoomPan } from '../../../hooks/useZoomPan';
import type { useGridTrackResize } from '../../../hooks/useGridTrackResize';
import type { ZmsProbe } from '../../../hooks/useZmsEventProgress';
import { offsetLabel } from '../../../lib/event/event-context-view';
import { cn } from '../../../lib/utils';
import type { Event, ProfileId } from '../../../api/types';

const RESIZE_CORNERS = [
  { sx: -1, sy: -1, corner: 'tl' },
  { sx: 1, sy: -1, corner: 'tr' },
  { sx: -1, sy: 1, corner: 'bl' },
  { sx: 1, sy: 1, corner: 'br' },
] as const;

export interface SequenceTileProps {
  event: Event;
  offsetMs: number;
  isAnchor: boolean;
  urls: string[];
  /** Width over height of the event's picture, for the enlarged view. */
  aspectRatio: number;
  /** The Replay hover preview setting is on. */
  preview: boolean;
  /** Which tile the enlarged view moves on to, where a tile's picture is,
   *  and the caption under it (TilePreview). */
  previewNext: (shown: string) => string;
  previewImg: (eventId: string) => HTMLImageElement | null | undefined;
  previewCaption: (eventId: string) => string;
  /** Pointer props for the corner handle that moves the tile's left or right
   *  edge (sx -1 or 1) and its top or bottom edge (sy -1 or 1); no handles
   *  without it. */
  /** Pencil pressed: the tile zooms and pans, and shows its corner handles. */
  editing: boolean;
  resizeHandle?: (sx: number, sy: number) => ReturnType<ReturnType<typeof useGridTrackResize>['handleProps']>;
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

export function SequenceTile({ event, offsetMs, isAnchor, urls, aspectRatio, preview, previewNext, previewImg, previewCaption, editing, resizeHandle, monitorName, isPlaying, run, probe, progressStepMs, onProbe, profileId, onTap }: SequenceTileProps) {
  const { t } = useTranslation();
  const flash = useReturnFlash(event.Id);
  // Keys off: every tile has one of these, and arrows are window-wide.
  const { ref: zoomRef, innerRef: zoomInnerRef } = useZoomPan({ enabled: editing, keyboard: false });
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
      className="relative flex min-h-0 min-w-0 flex-col rounded-sm border border-border/40 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div ref={zoomRef} className="relative min-h-0 w-full flex-1 overflow-hidden rounded-t-sm bg-black">
        {/* The blinking triangle marks a playing tile, or the tile the user
            just came back from while playback is held. */}
        {(isPlaying || flash) && <ReturnFlashArrow className="top-1" />}
        {/* Hover or long press enlarges the tile (TilePreview). Off with the
            pencil, where a press pans. */}
        <HoverPreview
          aspectRatio={aspectRatio}
          disabled={editing || !preview}
          testId="event-context-sequence-preview"
          renderPreview={() => (
            <TilePreview
              playing={isPlaying}
              tileId={event.Id}
              next={previewNext}
              imgOf={previewImg}
              caption={previewCaption}
              stream={<EventZmsHoverPlayer descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name, profileId }} />}
            />
          )}
        >
        <div className={cn('h-full w-full transition-opacity', !isPlaying && 'opacity-60')}>
          <div ref={zoomInnerRef} data-testid={`event-context-sequence-zoom-${event.Id}`}>
          {isPlaying ? (
            <EventZmsHoverPlayer
              key={run}
              descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name, profileId }}
              onProbe={onProbe}
            />
          ) : (
            <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} className="h-full w-full" objectFit="contain" />
          )}
          </div>
        </div>
        </HoverPreview>
        <span
          className={cn(
            'absolute top-0.5 rounded-sm px-1 text-[10px]',
            // Clear of the top-right handle while the handles show.
            resizeHandle ? 'right-4 [@media(pointer:coarse)]:right-7' : 'right-0.5',
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
      {/* Corner handles while the pencil is pressed, drawn as Montage's
          edit-mode L bracket (--edit-handle), so it is clear where a drag
          starts. Siblings of the zoom box, so a handle drag never pans. touch-none so a drag on a phone resizes instead of
          scrolling. Pointer-only: the layout is a view preference. */}
      {resizeHandle && RESIZE_CORNERS.map(({ sx, sy, corner }) => (
        <span
          key={corner}
          aria-hidden
          data-testid={`event-context-sequence-resize-${event.Id}-${corner}`}
          className={cn(
            'absolute z-10 h-4 w-4 touch-none border-[color:var(--edit-handle)] [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7',
            sy < 0 ? 'top-0 border-t-[3px]' : 'bottom-0 border-b-[3px]',
            sx < 0 ? 'left-0 border-l-[3px]' : 'right-0 border-r-[3px]',
            sy < 0 ? (sx < 0 ? 'rounded-tl-sm' : 'rounded-tr-sm') : sx < 0 ? 'rounded-bl-sm' : 'rounded-br-sm',
            sx * sy > 0 ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
          )}
          {...resizeHandle(sx, sy)}
        />
      ))}
    </button>
  );
}
