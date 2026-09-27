/**
 * useCertTrustPrompt
 *
 * Drives the "trust this server's certificate" flow: fetch the current server
 * certificate, show the TOFU dialog, and pin its fingerprint on accept. Used by
 * the CertTrustBanner (and reusable elsewhere) so a self-signed server can be
 * trusted without digging into Settings.
 *
 * Native only. On web/desktop getServerCertFingerprint returns null, so prompt()
 * is a no-op.
 */

import { useCallback, useState } from 'react';
import { Platform } from '../lib/platform';
import { useCurrentProfile, useProfileById } from './useCurrentProfile';
import { useSettingsStore } from '../stores/settings';
import { log, LogLevel } from '../lib/logger';
import type { CertInfo } from '../lib/security/ssl-trust';

export interface CertTrustDialogProps {
  open: boolean;
  certInfo: CertInfo | null;
  isChanged: boolean;
  onTrust: () => void;
  onCancel: () => void;
}

export interface UseCertTrustPromptResult {
  /** Fetch the server cert and open the trust dialog. */
  prompt: () => Promise<void>;
  /** True while the certificate is being fetched. */
  verifying: boolean;
  /** Spread onto <CertTrustDialog />. */
  dialogProps: CertTrustDialogProps;
}

export function useCertTrustPrompt(): UseCertTrustPromptResult {
  const { currentProfile } = useCurrentProfile();
  // Certificate trust is server-scoped: read the profile being trusted (refs #536).
  const { settings } = useProfileById(currentProfile?.id);
  const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);

  const [open, setOpen] = useState(false);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [isChanged, setIsChanged] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const prompt = useCallback(async () => {
    if (!currentProfile || !Platform.isNative) return;
    setVerifying(true);
    try {
      const { applyTrustedCertificates, getServerCertFingerprint } = await import('../lib/security/ssl-trust');
      await applyTrustedCertificates();
      const info = await getServerCertFingerprint(currentProfile.portalUrl);
      if (info) {
        const stored = settings.trustedCertFingerprint;
        setIsChanged(stored !== null && info.fingerprint !== stored);
        setCertInfo(info);
        setOpen(true);
      } else {
        log.sslTrust('Could not fetch certificate to verify', LogLevel.WARN);
      }
    } catch (error) {
      log.sslTrust('Failed to fetch certificate for trust prompt', LogLevel.ERROR, { error });
    } finally {
      setVerifying(false);
    }
  }, [currentProfile, settings.trustedCertFingerprint]);

  const onTrust = useCallback(async () => {
    if (!currentProfile || !certInfo) return;
    setOpen(false);
    updateProfileSettings(currentProfile.id, {
      allowSelfSignedCerts: true,
      trustedCertFingerprint: certInfo.fingerprint,
    });
    const { applyTrustedCertificates } = await import('../lib/security/ssl-trust');
    await applyTrustedCertificates();
  }, [currentProfile, certInfo, updateProfileSettings]);

  const onCancel = useCallback(() => {
    setOpen(false);
  }, []);

  return { prompt, verifying, dialogProps: { open, certInfo, isChanged, onTrust, onCancel } };
}
