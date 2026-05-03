/**
 * Zoom Controls
 *
 * Overlay with zoom +/-, pan arrows (when zoomed), and reset.
 * All buttons support click-and-hold for repeated action.
 * Designed to sit inside a position:relative container.
 */

import { useRef, useCallback, type PointerEvent } from 'react';
import { Button } from './button';
import { ZoomIn, ZoomOut, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { UI_INTERACTIONS } from '../../lib/zmninja-ng-constants';

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onPanUp: () => void;
  onPanDown: () => void;
  isZoomed: boolean;
  scale: number;
  className?: string;
}

/** Returns pointerDown/pointerUp/pointerLeave handlers that repeat `action` while held. */
function useHoldRepeat(action: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(
    (e: PointerEvent) => {
      // Capture pointer so we get pointerup even if cursor leaves
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      action();
      const repeat = () => {
        action();
        timer.current = setTimeout(repeat, UI_INTERACTIONS.holdRepeatIntervalMs);
      };
      timer.current = setTimeout(repeat, UI_INTERACTIONS.holdInitialDelayMs);
    },
    [action],
  );

  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop };
}

const btn = 'h-7 w-7 opacity-70 hover:opacity-100';

export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onPanLeft,
  onPanRight,
  onPanUp,
  onPanDown,
  isZoomed,
  scale,
  className,
}: ZoomControlsProps) {
  const { t } = useTranslation();

  const holdZoomIn = useHoldRepeat(onZoomIn);
  const holdZoomOut = useHoldRepeat(onZoomOut);
  const holdLeft = useHoldRepeat(onPanLeft);
  const holdRight = useHoldRepeat(onPanRight);
  const holdUp = useHoldRepeat(onPanUp);
  const holdDown = useHoldRepeat(onPanDown);

  return (
    <div className={cn('absolute z-10 flex items-center gap-1', className)}>
      <Button variant="secondary" size="icon" className={btn} {...holdZoomOut}
        title={t('ptz.zoom_out')} aria-label={t('ptz.zoom_out')} data-testid="zoom-out-button">
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button variant="secondary" size="icon" className={btn} {...holdZoomIn}
        title={t('ptz.zoom_in')} aria-label={t('ptz.zoom_in')} data-testid="zoom-in-button">
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      {isZoomed && (
        <>
          <div className="w-px h-5 bg-border/50 mx-0.5" />
          <Button variant="secondary" size="icon" className={btn} {...holdLeft}
            title={t('ptz.move_left')} aria-label={t('ptz.move_left')} data-testid="pan-left-button">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="icon" className={btn} {...holdUp}
            title={t('ptz.move_up')} aria-label={t('ptz.move_up')} data-testid="pan-up-button">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="icon" className={btn} {...holdDown}
            title={t('ptz.move_down')} aria-label={t('ptz.move_down')} data-testid="pan-down-button">
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="icon" className={btn} {...holdRight}
            title={t('ptz.move_right')} aria-label={t('ptz.move_right')} data-testid="pan-right-button">
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-5 bg-border/50 mx-0.5" />
          <Button variant="secondary" size="sm" className="h-7 text-xs opacity-80 hover:opacity-100 gap-1"
            onClick={onReset} data-testid="zoom-reset-button">
            <RotateCcw className="h-3 w-3" />
            {Math.round(scale * 100)}%
          </Button>
        </>
      )}
    </div>
  );
}
