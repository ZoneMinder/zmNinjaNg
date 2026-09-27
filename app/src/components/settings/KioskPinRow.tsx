/**
 * Kiosk PIN row: set, change or clear the PIN that unlocks kiosk mode.
 * Changing or clearing asks for biometrics first and falls back to the
 * current PIN. The PIN lives in secure storage (lib/kioskPin), not in
 * profile settings.
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { hasPinStored, storePin, clearPin, verifyPin } from '../../lib/kioskPin';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../../hooks/useBiometricAuth';
import { PinPad, type PinPadMode } from '../kiosk/PinPad';
import { useToast } from '../../hooks/use-toast';
import { Button } from '../ui/button';
import { SettingsRow, RowLabel } from './SettingsLayout';

export function KioskPinRow() {
  const { t } = useTranslation();
  const { toast } = useToast();

  // Kiosk PIN state
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinPadMode, setPinPadMode] = useState<PinPadMode>('set');
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  // Tracks what action to take after verifying current PIN: 'clear' or 'change'
  const [pendingAction, setPendingAction] = useState<'clear' | 'change' | null>(null);

  // Check PIN status on first render
  useEffect(() => {
    hasPinStored().then(setHasPin);
  }, []);

  // Try biometrics first, fall back to PIN pad for verification
  const verifyIdentity = useCallback(async (action: 'clear' | 'change'): Promise<boolean> => {
    const biometricsAvailable = await checkBiometricAvailability();
    if (biometricsAvailable) {
      const result = await authenticateWithBiometrics(t('kiosk.biometric_prompt'));
      if (result.success) return true;
      // Biometrics failed/cancelled: fall through to PIN pad
    }
    setPendingAction(action);
    setPinPadMode('unlock');
    setPinError(null);
    setShowPinPad(true);
    return false;
  }, [t]);

  const handleSetOrChangePin = useCallback(async () => {
    if (hasPin) {
      const verified = await verifyIdentity('change');
      if (verified) {
        // Biometrics passed, go straight to set new PIN
        setPendingAction(null);
        setPinPadMode('set');
        setPinError(null);
        setPendingPin(null);
        setShowPinPad(true);
      }
    } else {
      setPendingAction(null);
      setPinPadMode('set');
      setPinError(null);
      setPendingPin(null);
      setShowPinPad(true);
    }
  }, [hasPin, verifyIdentity]);

  const handleClearPin = useCallback(async () => {
    const verified = await verifyIdentity('clear');
    if (verified) {
      // Biometrics passed, clear immediately
      await clearPin();
      setHasPin(false);
      toast({ title: t('kiosk.pin_cleared') });
    }
  }, [verifyIdentity, toast, t]);

  const handlePinSubmit = useCallback(async (pin: string) => {
    if (pinPadMode === 'unlock') {
      // Verifying current PIN before clear or change
      const valid = await verifyPin(pin);
      if (!valid) {
        setPinError(t('kiosk.pin_incorrect'));
        return;
      }
      if (pendingAction === 'clear') {
        await clearPin();
        setShowPinPad(false);
        setHasPin(false);
        setPendingAction(null);
        toast({ title: t('kiosk.pin_cleared') });
      } else if (pendingAction === 'change') {
        // PIN verified, now set new one
        setPendingAction(null);
        setPinPadMode('set');
        setPinError(null);
      }
    } else if (pinPadMode === 'set') {
      setPendingPin(pin);
      setPinPadMode('confirm');
      setPinError(null);
    } else if (pinPadMode === 'confirm') {
      if (pin === pendingPin) {
        try {
          await storePin(pin);
          setShowPinPad(false);
          setPendingPin(null);
          setHasPin(true);
          toast({ title: t('kiosk.pin_changed') });
        } catch {
          setPinError(t('common.unknown_error'));
        }
      } else {
        setPinError(t('kiosk.pin_mismatch'));
        setPinPadMode('set');
        setPendingPin(null);
      }
    }
  }, [pinPadMode, pendingPin, pendingAction, toast, t]);

  const handlePinCancel = useCallback(() => {
    setShowPinPad(false);
    setPendingPin(null);
    setPinError(null);
    setPendingAction(null);
  }, []);

  // The PIN pad is a fixed overlay; it renders inside the row so the row
  // stays one card child.
  return (
    <SettingsRow>
      <RowLabel
        label={t('kiosk.pin_setting_label')}
        desc={t('kiosk.pin_setting_desc')}
      />
      <div className="flex items-center gap-2">
        {hasPin && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={handleClearPin}
            data-testid="settings-kiosk-clear-pin"
          >
            {t('common.clear')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleSetOrChangePin}
          data-testid="settings-kiosk-change-pin"
        >
          <Lock className="h-3 w-3" />
          {hasPin ? t('kiosk.change_pin') : t('kiosk.set_pin_title')}
        </Button>
      </div>
      {showPinPad && (
        <PinPad
          mode={pinPadMode}
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
          error={pinError}
        />
      )}
    </SettingsRow>
  );
}
