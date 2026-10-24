/**
 * The enlarged view of a replay tile (TilePreview).
 *
 * A tile playing when the view opens is mirrored (TileMirror): a canvas copies
 * whatever its own <img> shows. The browser already decodes the MJPEG stream
 * into that <img>, so drawImage copies the current frame with no second
 * stream, connection or zms process, and the view stays on the tile's frame.
 * MJPEG fires no event per frame, so it redraws on animation frames, capped
 * at `EVENT_CONTEXT.previewMirrorFps`. The canvas takes the picture's own
 * size, so a full-resolution stream stays sharp when enlarged. Before each
 * draw `next` may move it to another tile, so the view follows the replay:
 * the old tile slides out and the new one slides in.
 *
 * Any other tile opens its own stream, as the other screens' previews do.
 * Either way the monitor name and time run along the bottom.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import { cn } from '../../../lib/utils';

interface TileMirrorProps {
  tileId: string;
  /** The tile to show next, given the one shown now. */
  next: (shown: string) => string;
  /** The <img> a tile shows, if it has one yet. */
  imgOf: (tileId: string) => HTMLImageElement | null | undefined;
  /** The text along the bottom of a tile's view. */
  caption: (tileId: string) => string;
}

function Caption({ tileId, text }: { tileId: string; text: string }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[11px] text-white"
      title={text}
      data-testid={`event-context-sequence-preview-caption-${tileId}`}
    >
      {text}
    </div>
  );
}

export function TileMirror({ tileId, next, imgOf, caption }: TileMirrorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read on every frame, so the loop sees the latest replay state.
  const live = useRef({ next, imgOf });
  useLayoutEffect(() => {
    live.current = { next, imgOf };
  });
  // The tile shown, and the one sliding out after a move.
  const [slides, setSlides] = useState<{ current: string; leaving?: string }>({ current: tileId });
  useEffect(() => {
    if (!slides.leaving) return;
    const timer = setTimeout(() => setSlides((s) => ({ current: s.current })), EVENT_CONTEXT.previewSlideMs);
    return () => clearTimeout(timer);
  }, [slides]);

  useEffect(() => {
    let frame = 0;
    let last = -Infinity;
    let shown = tileId;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / EVENT_CONTEXT.previewMirrorFps) return;
      last = now;
      const nextId = live.current.next(shown);
      if (nextId !== shown) {
        setSlides({ current: nextId, leaving: shown });
        shown = nextId;
      }
      const img = live.current.imgOf(shown);
      const canvas = canvasRef.current;
      // Until the new slide mounts, the canvas is still the old tile's.
      if (!img?.naturalWidth || canvas?.dataset.tile !== shown) return;
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      try {
        canvas.getContext('2d')?.drawImage(img, 0, 0);
      } catch {
        /* a picture mid-swap; the next frame draws it */
      }
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [tileId]);

  // The leaving slide keeps its canvas, which holds its last frame.
  const slide = (id: string, leaving: boolean) => (
    <div
      key={id}
      data-testid="event-context-sequence-preview-slide"
      data-event-id={id}
      data-leaving={leaving}
      className={cn(
        'absolute inset-0 fill-mode-forwards',
        leaving ? 'animate-out slide-out-to-left-full' : slides.leaving && 'animate-in slide-in-from-right-full'
      )}
      style={{ animationDuration: `${EVENT_CONTEXT.previewSlideMs}ms` }}
    >
      <canvas ref={leaving ? undefined : canvasRef} data-tile={id} className="h-full w-full bg-black object-contain" />
      <Caption tileId={id} text={caption(id)} />
    </div>
  );
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {slide(slides.current, false)}
      {slides.leaving && slide(slides.leaving, true)}
    </div>
  );
}

/**
 * Picks the enlarged view once, when it opens: a tile playing then is
 * mirrored and follows the replay on; any other tile plays `stream`. Fixed
 * after that, so a mirror is not swapped for a new stream when its tile ends.
 */
export function TilePreview({ playing, stream, ...mirror }: TileMirrorProps & { playing: boolean; stream: ReactNode }) {
  const [mirrored] = useState(playing);
  if (mirrored) return <TileMirror {...mirror} />;
  return (
    <div className="relative h-full w-full">
      {stream}
      <Caption tileId={mirror.tileId} text={mirror.caption(mirror.tileId)} />
    </div>
  );
}
