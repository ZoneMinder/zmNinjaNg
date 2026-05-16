/**
 * Kiosk Store
 *
 * Manages kiosk (lock) mode state. Ephemeral — resets to unlocked on app restart.
 * PIN storage is handled separately by lib/kioskPin.ts via secure storage.
 */

import { create } from 'zustand';
import { KIOSK } from '../lib/zmninja-ng-constants';

interface KioskState {
  isLocked: boolean;
  previousInsomniaState: boolean;
  pinAttempts: number;
  cooldownUntil: number | null;
  unlockRequested: boolean;

  lock: (currentInsomniaState: boolean) => void;
  unlock: () => void;
  requestUnlock: () => void;
  clearUnlockRequest: () => void;
  recordFailedAttempt: () => void;
  isCoolingDown: () => boolean;
}

export const useKioskStore = create<KioskState>()((set, get) => ({
  isLocked: false,
  previousInsomniaState: false,
  pinAttempts: 0,
  cooldownUntil: null,
  unlockRequested: false,

  lock: (currentInsomniaState: boolean) => {
    set({
      isLocked: true,
      previousInsomniaState: currentInsomniaState,
      pinAttempts: 0,
      cooldownUntil: null,
      unlockRequested: false,
    });
  },

  unlock: () => {
    set({
      isLocked: false,
      pinAttempts: 0,
      cooldownUntil: null,
      unlockRequested: false,
    });
  },

  requestUnlock: () => {
    set({ unlockRequested: true });
  },

  clearUnlockRequest: () => {
    set({ unlockRequested: false });
  },

  recordFailedAttempt: () => {
    const { cooldownUntil, pinAttempts } = get();
    // Reset counter if previous cooldown has expired
    const currentAttempts = (cooldownUntil && Date.now() >= cooldownUntil) ? 0 : pinAttempts;
    const attempts = currentAttempts + 1;
    set({
      pinAttempts: attempts,
      cooldownUntil: attempts >= KIOSK.maxPinAttempts ? Date.now() + KIOSK.cooldownMs : null,
    });
  },

  isCoolingDown: () => {
    const { cooldownUntil } = get();
    if (!cooldownUntil) return false;
    return Date.now() < cooldownUntil;
  },
}));
