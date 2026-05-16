/**
 * Kiosk Overlay
 *
 * Full-screen transparent overlay that blocks all interaction when kiosk mode is active.
 * The current view continues to live-update underneath.
 * Only the unlock button (bottom-right) is interactive.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LockOpen } from 'lucide-react';
import { useKioskStore } from '../../stores/kioskStore';
import { verifyPin } from '../../lib/kioskPin';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../../hooks/useBiometricAuth';
import { PinPad } from './PinPad';
import { useToast } from '../../hooks/use-toast';
import { log, LogLevel } from '../../lib/logger';
import { Platform } from '../../lib/platform';

interface KioskOverlayProps {
  onUnlock: () => void;
}

export function KioskOverlay({ onUnlock }: KioskOverlayProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isLocked, unlock, recordFailedAttempt, isCoolingDown, cooldownUntil, unlockRequested, clearUnlockRequest } = useKioskStore();
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  // Block back button / back gesture while locked
  useEffect(() => {
    if (!isLocked) return;

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, '', window.location.href);
    };

    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isLocked]);

  // Block Android hardware back button while locked
  useEffect(() => {
    if (!isLocked) return;

    let removeListener: (() => void) | undefined;

    (async () => {
      if (!Platform.isNative) return;
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', () => {
          // No-op — swallow back button while locked
        });
        removeListener = () => handle.remove();
      } catch {
        // Plugin unavailable
      }
    })();

    return () => {
      removeListener?.();
    };
  }, [isLocked]);

  // Block keyboard shortcuts while locked (but not when PIN pad is open)
  useEffect(() => {
    if (!isLocked || showPinPad) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isLocked, showPinPad]);

  // Respond to unlock requests from sidebar/other UI
  useEffect(() => {
    if (unlockRequested && isLocked) {
      clearUnlockRequest();
      handleUnlockTap();
    }
  }, [unlockRequested]);

  const handleUnlockTap = useCallback(async () => {
    if (isCoolingDown()) {
      log.kiosk('Unlock attempt during cooldown', LogLevel.DEBUG);
      return;
    }

    // Try biometrics first
    const biometricsAvailable = await checkBiometricAvailability();
    if (biometricsAvailable) {
      const result = await authenticateWithBiometrics(t('kiosk.biometric_prompt'));
      if (result.success) {
        log.kiosk('Unlocked via biometrics', LogLevel.INFO);
        unlock();
        onUnlock();
        toast({ title: t('kiosk.unlocked_toast') });
        return;
      }
      // Biometrics failed/cancelled — fall through to PIN
    }

    // Show PIN pad
    setPinError(null);
    setShowPinPad(true);
  }, [isCoolingDown, unlock, onUnlock, toast, t]);

  const handlePinSubmit = useCallback(async (pin: string) => {
    if (isCoolingDown()) return;

    const valid = await verifyPin(pin);
    if (valid) {
      log.kiosk('Unlocked via PIN', LogLevel.INFO);
      setShowPinPad(false);
      unlock();
      onUnlock();
      toast({ title: t('kiosk.unlocked_toast') });
    } else {
      recordFailedAttempt();
      setPinError(t('kiosk.pin_incorrect'));
      log.kiosk('Incorrect PIN attempt', LogLevel.WARN);
    }
  }, [isCoolingDown, unlock, onUnlock, recordFailedAttempt, toast, t]);

  const handlePinCancel = useCallback(() => {
    setShowPinPad(false);
    setPinError(null);
  }, []);

  if (!isLocked) return null;

  return (
    <>
      {/* Transparent overlay blocking all interaction */}
      <div
        className="fixed inset-0 z-[9999]"
        style={{ pointerEvents: 'auto' }}
        data-testid="kiosk-overlay"
      >
        {/* Unlock button — bottom-right, theme-aware */}
        <button
          onClick={handleUnlockTap}
          className="absolute bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 bg-primary/80 hover:bg-primary border-2 border-primary-foreground/30 shadow-lg shadow-primary/30"
          title={t('kiosk.unlock_label')}
          data-testid="kiosk-unlock-button"
        >
          <LockOpen className="h-6 w-6 text-primary-foreground" />
        </button>
      </div>

      {/* PIN pad dialog */}
      {showPinPad && (
        <PinPad
          mode="unlock"
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
          error={pinError}
          cooldownSeconds={cooldownSeconds > 0 ? cooldownSeconds : undefined}
        />
      )}
    </>
  );
}
