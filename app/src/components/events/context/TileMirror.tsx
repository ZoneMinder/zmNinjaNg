/**
 * The enlarged view of a replay tile: a canvas that copies whatever picture
 * a tile's own <img> shows (its ZMS stream while playing, its thumbnail
 * otherwise). The browser already decodes the MJPEG stream into that <img>,
 * so drawImage copies the current frame with no second stream, connection or
 * zms process, and the view stays on the tile's frame. MJPEG fires no event
 * per frame, so it redraws on animation frames, capped at
 * `EVENT_CONTEXT.previewMirrorFps`. The canvas takes the picture's own size,
 * so a full-resolution stream stays sharp when enlarged.
 *
 * It starts on `tileId`; before each draw `next` may move it to another tile,
 * so the view can follow the replay from tile to tile.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';

interface TileMirrorProps {
  tileId: string;
  /** The tile to show next, given the one shown now. */
  next: (shown: string) => string;
  /** The <img> a tile shows, if it has one yet. */
  imgOf: (tileId: string) => HTMLImageElement | null | undefined;
}

export function TileMirror({ tileId, next, imgOf }: TileMirrorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read on every frame, so the loop sees the latest replay state.
  const live = useRef({ next, imgOf });
  useLayoutEffect(() => {
    live.current = { next, imgOf };
  });
  useEffect(() => {
    let frame = 0;
    let last = -Infinity;
    let shown = tileId;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / EVENT_CONTEXT.previewMirrorFps) return;
      last = now;
      shown = live.current.next(shown);
      const img = live.current.imgOf(shown);
      const canvas = canvasRef.current;
      if (!img?.naturalWidth || !canvas) return;
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
  return <canvas ref={canvasRef} className="h-full w-full bg-black object-contain" />;
}

/**
 * Picks the enlarged view once, when it opens: a tile playing then mirrors
 * its stream and follows the replay on; any other tile shows `still`, one
 * image request and no stream. Fixed after that, so the mirror is not
 * swapped for a still the moment its tile finishes.
 */
export function TilePreview({ playing, mirror, still }: { playing: boolean; mirror: ReactNode; still: ReactNode }) {
  const [mirrored] = useState(playing);
  return mirrored ? mirror : still;
}
