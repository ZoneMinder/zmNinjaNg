import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Home, Moon, Power, RotateCcw, RotateCw, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';
import type { ProfileId, ZMControl } from '../../api/types';
import { usePermissions } from '../../hooks/usePermissions';
import { canUseControl } from '../../lib/permissions/zm-permissions';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { UI_INTERACTIONS } from '../../lib/zmninja-ng-constants';

interface PTZControlsProps {
  onCommand: (command: string) => void;
  /**
   * Profile whose ZoneMinder account these commands run as. Defaults to the
   * current profile; an All-mode caller must pass the monitor's owner.
   */
  profileId?: ProfileId | null;
  className?: string;
  disabled?: boolean;
  control?: ZMControl;
}

interface HoldButtonProps {
  command: string;
  stopCommand?: string;
  // If set, the command is re-fired every `repeatIntervalMs` while held.
  // Used for Rel/Abs drivers where one button-press would otherwise produce
  // only a single discrete step: repeating gives press-and-hold UX parity
  // with continuous-mode drivers, at the cost of slightly stepped motion.
  repeatIntervalMs?: number;
  onCommand: (command: string) => void;
  disabled?: boolean;
  className?: string;
  variant?: 'outline' | 'secondary' | 'destructive';
  size?: 'icon' | 'sm';
  title?: string;
  testId?: string;
  children: ReactNode;
}

// Press-to-start / release-to-stop. For continuous drivers we fire one start
// command on pointerdown and rely on the camera to keep moving until moveStop.
// For Rel/Abs drivers we re-fire the step command on a timer while held.
// ZM's protocol has no "continuous" verb on those drivers, so a stream of
// step commands is the only way to get hold-to-move UX.
function HoldButton({
  command,
  stopCommand,
  repeatIntervalMs,
  onCommand,
  disabled,
  className,
  variant = 'outline',
  size = 'icon',
  title,
  testId,
  children,
}: HoldButtonProps) {
  const activePointerRef = useRef<number | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || activePointerRef.current !== null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointerRef.current = e.pointerId;
      onCommand(command);
      if (repeatIntervalMs) {
        clearRepeat();
        repeatTimerRef.current = setInterval(() => onCommand(command), repeatIntervalMs);
      }
    },
    [clearRepeat, command, disabled, onCommand, repeatIntervalMs]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (activePointerRef.current !== e.pointerId) return;
      activePointerRef.current = null;
      clearRepeat();
      if (stopCommand) onCommand(stopCommand);
    },
    [clearRepeat, onCommand, stopCommand]
  );

  // The unmount cleanup runs with `[]` deps, so it would close over the
  // handlers captured at mount. Mirror them, as useStreamLifecycle does.
  const cleanupParamsRef = useRef({ onCommand, stopCommand });
  useEffect(() => {
    cleanupParamsRef.current = { onCommand, stopCommand };
  }, [onCommand, stopCommand]);

  // Unmount while held (panel collapsed, monitor switched, page left): pointerup
  // never arrives, so a continuous driver would keep panning until it hits a
  // physical limit, and the repeat timer would keep issuing requests from a dead
  // component. The activePointerRef guard makes this a no-op on StrictMode's
  // throwaway dev mount, where no pointer was ever captured.
  useEffect(() => {
    return () => {
      clearRepeat();
      if (activePointerRef.current === null) return;
      activePointerRef.current = null;
      const { onCommand: latestOnCommand, stopCommand: latestStopCommand } = cleanupParamsRef.current;
      if (latestStopCommand) latestOnCommand(latestStopCommand);
    };
  }, [clearRepeat]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(e) => e.preventDefault()}
      // touch-action:none prevents the browser from scrolling/zooming the
      // page when the user holds inside a PTZ button on a touch device.
      style={{ touchAction: 'none' }}
    >
      {children}
    </Button>
  );
}

export function PTZControls({ onCommand, profileId, className, disabled, control }: PTZControlsProps) {
  const { t } = useTranslation();

  // Controllable is what the camera can do; Control is what this account may
  // ask of it. ZoneMinder checks the second in ajax/control.php, so a denied
  // account gets no pad rather than buttons that always fail (refs #344).
  const { currentProfile } = useCurrentProfile();
  const { permissions } = usePermissions(profileId ?? currentProfile?.id);
  const controlDenied = canUseControl(permissions) === 'denied';

  const canMove = control?.CanMove === '1';
  // The driver decides which axes exist. ZoneMinder hides the up/down arrows
  // without CanTilt and left/right without CanPan (skins/classic/includes/
  // control_functions.php), so a pan-only driver never gets tilt buttons whose
  // commands it would reject. Present means '1', as everywhere else here: the
  // schema coerces the field to a string, so a server answering with a JSON
  // boolean or an empty column would slip past a `!== '0'` test. An absent
  // field is the one case treated as capable, since losing every arrow on a
  // control definition that never sent the column is worse than showing one
  // that does nothing.
  const canPan = control?.CanPan === undefined || control.CanPan === '1';
  const canTilt = control?.CanTilt === undefined || control.CanTilt === '1';
  // Diagonals need both axes, matching $hasDiag in control_functions.php.
  const canMoveDiag = canPan && canTilt && control?.CanMoveDiag === '1';
  const canMoveCon = control?.CanMoveCon === '1';
  const canMoveRel = control?.CanMoveRel === '1';
  const canMoveAbs = control?.CanMoveAbs === '1';

  const canZoom = control?.CanZoom === '1';
  const canZoomCon = control?.CanZoomCon === '1';
  const canZoomRel = control?.CanZoomRel === '1';
  const canZoomAbs = control?.CanZoomAbs === '1';

  const hasPresets = control?.HasPresets === '1';
  const numPresets = parseInt(control?.NumPresets || '0', 10);
  const hasHome = control?.HasHomePreset === '1' || hasPresets;
  const canWake = control?.CanWake === '1';
  const canSleep = control?.CanSleep === '1';
  const canReset = control?.CanReset === '1';
  const canReboot = control?.CanReboot === '1';

  const movePrefix = canMoveCon ? 'moveCon' : (canMoveRel ? 'moveRel' : 'moveCon');
  const zoomPrefix = canZoomCon ? 'zoomCon' : (canZoomRel ? 'zoomRel' : 'zoomCon');

  // Hold-to-move UX for both continuous and Rel/Abs drivers. moveStop is sent
  // on release in both cases (continuous needs it; Rel/Abs ignores it but it
  // costs nothing and is a safety net if a step is in flight).
  const moveRepeatMs = canMoveCon ? undefined : UI_INTERACTIONS.ptzHoldRepeatMs;
  const zoomRepeatMs = canZoomCon ? undefined : UI_INTERACTIONS.ptzHoldRepeatMs;

  if (!control) {
    return null;
  }

  const moveModeKey = canMoveCon ? 'ptz.mode_continuous' : (canMoveRel ? 'ptz.mode_relative' : (canMoveAbs ? 'ptz.mode_absolute' : null));
  const zoomModeKey = canZoomCon ? 'ptz.mode_continuous' : (canZoomRel ? 'ptz.mode_relative' : (canZoomAbs ? 'ptz.mode_absolute' : null));

  if (controlDenied) return null;

  return (
    <div className={cn("flex flex-col items-center gap-4 p-4 bg-card/50 rounded-xl border shadow-sm backdrop-blur-sm", className)} data-testid="ptz-controls">
      {(canMove || canZoom) && (moveModeKey || zoomModeKey) && (
        <div className="-mb-2 flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground/70" data-testid="ptz-mode-indicator">
          <div className="flex gap-2">
            {canMove && moveModeKey && <span>{t('ptz.move')}: {t(moveModeKey)}</span>}
            {canMove && canZoom && moveModeKey && zoomModeKey && <span>·</span>}
            {canZoom && zoomModeKey && <span>{t('ptz.zoom')}: {t(zoomModeKey)}</span>}
          </div>
          {(canMove || canZoom) && <div>{t('ptz.hold_hint')}</div>}
        </div>
      )}
      {canMove && (
        <div className="grid grid-cols-3 gap-2">
          <HoldButton
            command={`${movePrefix}UpLeft`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full rotate-[-45deg]", !canMoveDiag && "invisible")}
            title={t('ptz.move_up_left')}
            testId="ptz-up-left"
          >
            <ArrowUp className="h-4 w-4" />
          </HoldButton>
          <HoldButton
            command={`${movePrefix}Up`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full", !canTilt && "invisible")}
            title={t('ptz.move_up')}
            testId="ptz-up"
          >
            <ArrowUp className="h-4 w-4" />
          </HoldButton>
          <HoldButton
            command={`${movePrefix}UpRight`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full rotate-[45deg]", !canMoveDiag && "invisible")}
            title={t('ptz.move_up_right')}
            testId="ptz-up-right"
          >
            <ArrowUp className="h-4 w-4" />
          </HoldButton>

          <HoldButton
            command={`${movePrefix}Left`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full", !canPan && "invisible")}
            title={t('ptz.move_left')}
            testId="ptz-left"
          >
            <ArrowLeft className="h-4 w-4" />
          </HoldButton>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive"
            onClick={() => onCommand('moveStop')}
            disabled={disabled}
            title={t('ptz.stop')}
            data-testid="ptz-stop"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
          <HoldButton
            command={`${movePrefix}Right`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full", !canPan && "invisible")}
            title={t('ptz.move_right')}
            testId="ptz-right"
          >
            <ArrowRight className="h-4 w-4" />
          </HoldButton>

          <HoldButton
            command={`${movePrefix}DownLeft`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full rotate-[-135deg]", !canMoveDiag && "invisible")}
            title={t('ptz.move_down_left')}
            testId="ptz-down-left"
          >
            <ArrowUp className="h-4 w-4" />
          </HoldButton>
          <HoldButton
            command={`${movePrefix}Down`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full", !canTilt && "invisible")}
            title={t('ptz.move_down')}
            testId="ptz-down"
          >
            <ArrowDown className="h-4 w-4" />
          </HoldButton>
          <HoldButton
            command={`${movePrefix}DownRight`}
            stopCommand="moveStop"
            repeatIntervalMs={moveRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className={cn("rounded-full rotate-[135deg]", !canMoveDiag && "invisible")}
            title={t('ptz.move_down_right')}
            testId="ptz-down-right"
          >
            <ArrowUp className="h-4 w-4" />
          </HoldButton>
        </div>
      )}

      {canZoom && (
        <div className="flex items-center gap-4 w-full justify-center border-t pt-4">
          <HoldButton
            command={`${zoomPrefix}Wide`}
            stopCommand="moveStop"
            repeatIntervalMs={zoomRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className="rounded-full"
            title={t('ptz.zoom_out')}
            testId="ptz-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </HoldButton>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('ptz.zoom')}</span>
          <HoldButton
            command={`${zoomPrefix}Tele`}
            stopCommand="moveStop"
            repeatIntervalMs={zoomRepeatMs}
            onCommand={onCommand}
            disabled={disabled}
            className="rounded-full"
            title={t('ptz.zoom_in')}
            testId="ptz-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </HoldButton>
        </div>
      )}

      {(canWake || canSleep || canReboot) && (
        <div className="flex items-center gap-2 w-full justify-center border-t pt-4">
          {canWake && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onCommand('wake')}
              disabled={disabled}
              title={t('ptz.wake')}
              data-testid="ptz-wake"
            >
              <Power className="h-4 w-4 mr-2" />
              {t('ptz.wake')}
            </Button>
          )}
          {canSleep && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onCommand('sleep')}
              disabled={disabled}
              title={t('ptz.sleep')}
              data-testid="ptz-sleep"
            >
              <Moon className="h-4 w-4 mr-2" />
              {t('ptz.sleep')}
            </Button>
          )}
          {canReboot && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onCommand('reboot')}
              disabled={disabled}
              title={t('ptz.reboot')}
              data-testid="ptz-reboot"
            >
              <RotateCw className="h-4 w-4 mr-2" />
              {t('ptz.reboot')}
            </Button>
          )}
        </div>
      )}

      {(hasHome || canReset) && (
        <div className="flex items-center gap-2 w-full justify-center border-t pt-4">
          {hasHome && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => onCommand('presetHome')}
              disabled={disabled}
              title={t('ptz.home')}
              data-testid="ptz-home"
            >
              <Home className="h-4 w-4 mr-2" />
              {t('ptz.home')}
            </Button>
          )}
          {canReset && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onCommand('reset')}
              disabled={disabled}
              title={t('ptz.reset')}
              data-testid="ptz-reset"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('ptz.reset')}
            </Button>
          )}
        </div>
      )}

      {hasPresets && numPresets > 0 && (
        <div className="w-full border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-center mb-2">{t('ptz.presets')}</p>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: numPresets }, (_, i) => i + 1).map((num) => (
              <Button
                key={num}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full px-0"
                onClick={() => onCommand(`presetGoto${num}`)}
                disabled={disabled}
                data-testid={`ptz-preset-${num}`}
              >
                {num}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
