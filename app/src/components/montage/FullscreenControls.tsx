/**
 * Fullscreen Controls
 *
 * Persistent thin top bar for fullscreen montage mode.
 * Always visible — no hide/show toggle, no gesture conflicts.
 * Sits in the safe-area-inset-top space (free space on notch devices).
 */

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RefreshCw, Minimize, Menu, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useKioskLock } from '../../hooks/useKioskLock';
import { PinPad } from '../kiosk/PinPad';

interface FullscreenControlsProps {
  onRefetch: () => void;
  onExitFullscreen: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
}

export function FullscreenControls({
  onRefetch,
  onExitFullscreen,
  showLabels,
  onToggleLabels,
}: FullscreenControlsProps) {
  const { t } = useTranslation();
  const {
    isLocked, showSetPin, setPinMode, pinError,
    handleLockToggle, handleSetPinSubmit, handleSetPinCancel,
  } = useKioskLock();

  return (
    <>
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-black/50 backdrop-blur-sm pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))] pt-[var(--sai-top,env(safe-area-inset-top))]"
      data-testid="montage-fullscreen-toolbar"
    >
      <div className="h-8 flex items-center justify-between px-3">
        <span className="text-white/70 font-medium text-xs">{t('montage.title')}</span>
        <div className="flex items-center gap-1">
          <Button
            onClick={onToggleLabels}
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              showLabels
                ? "text-white bg-white/20 hover:bg-white/30"
                : "text-white/70 hover:text-white hover:bg-white/10"
            )}
            title={t('montage.toggle_labels')}
            aria-label={t('montage.toggle_labels')}
            data-testid="montage-toggle-labels"
          >
            <Menu className="h-3.5 w-3.5" />
          </Button>
          <Button
            onClick={onRefetch}
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white hover:bg-white/10 h-7 w-7"
            data-testid="montage-fullscreen-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            onClick={handleLockToggle}
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white hover:bg-white/10 h-7 w-7"
            title={t('kiosk.lock_label')}
            data-testid="fullscreen-kiosk-lock"
          >
            <Lock className="h-3.5 w-3.5" />
          </Button>
          {!isLocked && (
            <Button
              onClick={onExitFullscreen}
              variant="ghost"
              size="sm"
              className="bg-red-600/80 hover:bg-red-600 text-white h-7 px-2 text-xs"
              data-testid="montage-exit-fullscreen"
            >
              <Minimize className="h-3.5 w-3.5 mr-1" />
              {t('montage.exit')}
            </Button>
          )}
        </div>
      </div>
    </div>
    {showSetPin && (
      <PinPad
        mode={setPinMode}
        onSubmit={handleSetPinSubmit}
        onCancel={handleSetPinCancel}
        error={pinError}
      />
    )}
    </>
  );
}
