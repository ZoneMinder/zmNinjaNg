/**
 * Corner drag to resize one tile of a CSS grid (refs #534). Each column and
 * row is an `fr` weight; dragging a tile's corner sets its column's and row's
 * weight from the pointer, so the tile grows while the tiles sharing its row
 * or column give way, and the grid keeps its size. Layout only: nothing
 * remounts, so streams in the tiles keep playing.
 *
 * The weights reset whenever the column or row count changes.
 */
import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { resizeTrack } from '../lib/event/event-context-view';

interface Drag {
  col: number;
  row: number;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
  w0: number;
  h0: number;
  cols0: number[];
  rows0: number[];
  width: number;
  height: number;
}

const ones = (n: number) => Array.from({ length: n }, () => 1);

export function useGridTrackResize(gridRef: RefObject<HTMLElement | null>, cols: number, rows: number) {
  const [weights, setWeights] = useState<{ cols: number[]; rows: number[] } | null>(null);
  const current =
    weights && weights.cols.length === cols && weights.rows.length === rows
      ? weights
      : { cols: ones(cols), rows: ones(rows) };
  const drag = useRef<Drag | null>(null);

  /** Pointer props for a corner handle of the tile at (col, row). `sx` and
   *  `sy` are +1 for a right or bottom corner, -1 for a left or top one. */
  const handleProps = (col: number, row: number, sx: number, sy: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const grid = gridRef.current;
      const tile = e.currentTarget.parentElement;
      if (!grid || !tile) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const style = getComputedStyle(grid);
      const rect = tile.getBoundingClientRect();
      drag.current = {
        col, row, sx, sy,
        x0: e.clientX,
        y0: e.clientY,
        w0: rect.width,
        h0: rect.height,
        cols0: current.cols,
        rows0: current.rows,
        // Track space only: the gaps between tracks do not stretch.
        width: grid.clientWidth - (parseFloat(style.columnGap) || 0) * (cols - 1),
        height: grid.clientHeight - (parseFloat(style.rowGap) || 0) * (rows - 1),
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      setWeights({
        cols: resizeTrack(d.cols0, d.col, d.w0 + (e.clientX - d.x0) * d.sx, d.width),
        rows: resizeTrack(d.rows0, d.row, d.h0 + (e.clientY - d.y0) * d.sy, d.height),
      });
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    // The handle sits inside the tile's button; a drag is not a tap on it.
    onClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation(),
  });

  return { colWeights: current.cols, rowWeights: current.rows, handleProps };
}
