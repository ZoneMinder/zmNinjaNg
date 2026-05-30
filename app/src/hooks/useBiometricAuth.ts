/**
 * Biometric Auth Hook
 *
 * Platform-aware biometric authentication:
 * - Capacitor (iOS/Android): uses @aparajita/capacitor-biometric-auth
 * - Web / Electron: not supported, falls back to PIN
 */

import { log, LogLevel } from '../lib/logger';

interface BiometricResult {
  success: boolean;
  error?: string;
}

/**
 * Check if biometric authentication is available on the current device.
 */
export async function checkBiometricAvailability(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    log.auth('Capacitor biometric check', LogLevel.DEBUG, {
      isAvailable: result.isAvailable,
      biometryType: result.biometryType,
    });
    return result.isAvailable;
  } catch {
    log.auth('No biometric auth available on this platform', LogLevel.DEBUG);
    return false;
  }
}

/**
 * Attempt biometric authentication.
 * Returns { success: true } if authenticated, { success: false, error } otherwise.
 */
export async function authenticateWithBiometrics(reason: string): Promise<BiometricResult> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Use PIN',
      allowDeviceCredential: false,
    });
    log.auth('Capacitor biometric authentication succeeded', LogLevel.INFO);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Biometric auth failed';
    log.auth('Biometric authentication failed', LogLevel.DEBUG, { error: message });
    return { success: false, error: message };
  }
}
