import { Platform } from './platform';
import { log, LogLevel } from './logger';
import type { CertInfo } from '../plugins/ssl-trust/definitions';

declare global {
  interface Window {
    electronSsl?: { setTrustSelfSigned(enabled: boolean): Promise<boolean> };
  }
}

/**
 * Apply the SSL trust override setting.
 * - Native (iOS/Android): enables/disables via SSLTrust Capacitor plugin,
 *   and passes the trusted fingerprint for TOFU validation
 * - Electron: forwards to the main-process net stack via window.electronSsl
 * - Web: no-op
 */
export async function applySSLTrustSetting(enabled: boolean, fingerprint?: string | null): Promise<void> {
  if (Platform.isNative) {
    try {
      const { SSLTrust } = await import('../plugins/ssl-trust');
      if (enabled) {
        await SSLTrust.enable();
        await SSLTrust.setTrustedFingerprint({ fingerprint: fingerprint ?? null });
        log.sslTrust('SSL trust override enabled for self-signed certificates', LogLevel.INFO, {
          hasFingerprint: !!fingerprint,
        });
      } else {
        await SSLTrust.disable();
        log.sslTrust('SSL trust override disabled', LogLevel.DEBUG);
      }
    } catch (error) {
      log.sslTrust('Failed to apply SSL trust setting', LogLevel.ERROR, { error });
    }
  } else if (Platform.isElectron) {
    try {
      if (typeof window !== 'undefined' && window.electronSsl) {
        await window.electronSsl.setTrustSelfSigned(enabled);
        log.sslTrust(
          enabled ? 'Electron SSL trust override enabled' : 'Electron SSL trust override disabled',
          enabled ? LogLevel.INFO : LogLevel.DEBUG
        );
      }
    } catch (error) {
      log.sslTrust('Failed to apply Electron SSL trust setting', LogLevel.ERROR, { error });
    }
  } else {
    log.sslTrust('SSL trust override not applicable on web', LogLevel.DEBUG);
  }
}

/**
 * Fetch the server's TLS certificate fingerprint.
 * Only works on native platforms (iOS/Android).
 * Returns null on web and Electron.
 */
export async function getServerCertFingerprint(url: string): Promise<CertInfo | null> {
  if (!Platform.isNative) return null;
  try {
    const { SSLTrust } = await import('../plugins/ssl-trust');
    const certInfo = await SSLTrust.getServerCertFingerprint({ url });
    log.sslTrust('Fetched server certificate fingerprint', LogLevel.INFO, {
      fingerprint: certInfo.fingerprint,
      subject: certInfo.subject,
    });
    return certInfo;
  } catch (error) {
    log.sslTrust('Failed to fetch server certificate fingerprint', LogLevel.ERROR, { error });
    return null;
  }
}

/**
 * Set the trusted fingerprint on the native plugin.
 * Only works on native platforms (iOS/Android).
 */
export async function setTrustedFingerprint(fingerprint: string | null): Promise<void> {
  if (!Platform.isNative) return;
  try {
    const { SSLTrust } = await import('../plugins/ssl-trust');
    await SSLTrust.setTrustedFingerprint({ fingerprint });
    log.sslTrust('Trusted fingerprint updated', LogLevel.INFO, { hasFingerprint: !!fingerprint });
  } catch (error) {
    log.sslTrust('Failed to set trusted fingerprint', LogLevel.ERROR, { error });
  }
}

export type { CertInfo };
