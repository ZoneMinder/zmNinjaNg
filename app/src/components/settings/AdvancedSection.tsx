/**
 * Advanced Section
 *
 * Self-signed certificates, log redaction, and kiosk PIN settings.
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Lock } from 'lucide-react';
import { hasPinStored, storePin, clearPin, verifyPin } from '../../lib/kioskPin';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../../hooks/useBiometricAuth';
import { PinPad, type PinPadMode } from '../kiosk/PinPad';
import { useToast } from '../../hooks/use-toast';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { API_REQUEST } from '../../lib/zmninja-ng-constants';
import { CertTrustDialog } from '../CertTrustDialog';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { useDeveloperNoticeStore } from '../../stores/developerNotices';
import { Platform } from '../../lib/platform';
import { log, LogLevel } from '../../lib/logger';
import type { CertInfo } from '../../lib/security/ssl-trust';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

export interface AdvancedSectionProps {
  settings: ProfileSettings;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function AdvancedSection({
  settings,
  currentProfile,
  updateSettings,
}: AdvancedSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // Developer notices visibility is device-global, so it reads/writes the
  // developer notice store directly rather than the profile settings helper.
  const showDeveloperNotices = useDeveloperNoticeStore((s) => s.showNotices);
  const setShowDeveloperNotices = useDeveloperNoticeStore((s) => s.setShowNotices);

  // Connection settings state
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certIsChanged, setCertIsChanged] = useState(false);
  const [reverifying, setReverifying] = useState(false);

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

  // Self-signed cert enable handler
  const handleSelfSignedCertsChange = async (checked: boolean) => {
    if (!currentProfile) return;

    // Update the setting immediately so the switch toggles
    updateSettings(currentProfile.id, {
      allowSelfSignedCerts: checked,
      ...(!checked && { trustedCertFingerprint: null }),
    });

    if (checked && Platform.isNative) {
      try {
        const { applyTrustedCertificates, getServerCertFingerprint } = await import('../../lib/security/ssl-trust');
        await applyTrustedCertificates();
        const info = await getServerCertFingerprint(currentProfile.portalUrl);
        if (info) {
          setCertInfo(info);
          setCertIsChanged(false);
          setCertDialogOpen(true);
          return;
        }
        await applyTrustedCertificates();
      } catch (error) {
        log.sslTrust('Failed to fetch cert during enable', LogLevel.ERROR, { error });
      }
    }

    if (!checked) {
      const { applyTrustedCertificates } = await import('../../lib/security/ssl-trust');
      await applyTrustedCertificates();
    }
  };

  const handleTrust = async () => {
    if (!currentProfile || !certInfo) return;
    setCertDialogOpen(false);
    updateSettings(currentProfile.id, {
      allowSelfSignedCerts: true,
      trustedCertFingerprint: certInfo.fingerprint,
    });
    const { applyTrustedCertificates } = await import('../../lib/security/ssl-trust');
    await applyTrustedCertificates();
  };

  const handleCancelTrust = async () => {
    setCertDialogOpen(false);
    const { applyTrustedCertificates } = await import('../../lib/security/ssl-trust');
    await applyTrustedCertificates();
  };

  const handleReverify = async () => {
    if (!currentProfile) return;
    setReverifying(true);
    try {
      const { applyTrustedCertificates, getServerCertFingerprint } = await import('../../lib/security/ssl-trust');
      await applyTrustedCertificates();
      const info = await getServerCertFingerprint(currentProfile.portalUrl);
      if (info) {
        const isChanged =
          settings.trustedCertFingerprint !== null &&
          info.fingerprint !== settings.trustedCertFingerprint;
        setCertInfo(info);
        setCertIsChanged(isChanged);
        setCertDialogOpen(true);
      }
      await applyTrustedCertificates();
    } catch (error) {
      log.sslTrust('Failed to re-verify certificate', LogLevel.ERROR, { error });
    } finally {
      setReverifying(false);
    }
  };

  return (
    <>
      <CollapsibleSection
        id="advanced"
        label={t('settings.section_advanced', 'Advanced')}
        defaultOpen={false}
      >
        <SettingsCard>
          {/* Self-signed certs: only relevant for HTTPS */}
          {currentProfile?.portalUrl?.startsWith('https') && (<><SettingsRow>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('settings.allow_self_signed_certs')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.allow_self_signed_certs_desc')}</div>
              {settings.allowSelfSignedCerts && (
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-medium">
                  {t('settings.allow_self_signed_certs_warning')}
                </p>
              )}
              {Platform.isDesktopOrWeb && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings.self_signed_certs_desktop_note')}
                </p>
              )}
            </div>
            <Switch
              id="self-signed-certs"
              checked={settings.allowSelfSignedCerts}
              onCheckedChange={handleSelfSignedCertsChange}
              data-testid="settings-self-signed-certs-switch"
            />
          </SettingsRow>

          {/* Cert fingerprint display (only when enabled on native) */}
          {settings.allowSelfSignedCerts && Platform.isNative && (
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">{t('ssl.trusted_fingerprint')}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={handleReverify}
                  disabled={reverifying}
                  data-testid="cert-reverify-button"
                >
                  <RefreshCw className={`h-3 w-3 ${reverifying ? 'animate-spin' : ''}`} />
                  {t('ssl.reverify_button')}
                </Button>
              </div>
              {settings.trustedCertFingerprint ? (
                <p
                  className="font-mono text-[10px] break-all text-muted-foreground leading-relaxed"
                  title={settings.trustedCertFingerprint}
                >
                  {settings.trustedCertFingerprint}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('ssl.no_fingerprint')}</p>
              )}
            </div>
          )}
          </>)}

          {/* Force-disable multi-port streaming */}
          <SettingsRow>
            <RowLabel
              label={t('settings.force_disable_multiport')}
              desc={t('settings.force_disable_multiport_desc')}
            />
            <Switch
              id="force-disable-multiport"
              checked={settings.forceDisableMultiPort}
              onCheckedChange={(checked) =>
                currentProfile &&
                updateSettings(currentProfile.id, { forceDisableMultiPort: checked })
              }
              data-testid="settings-force-disable-multiport-switch"
            />
          </SettingsRow>

          {/* Show developer notices (device-global, not profile-scoped) */}
          <SettingsRow>
            <RowLabel
              label={t('settings.show_developer_notices')}
              desc={t('settings.show_developer_notices_desc')}
            />
            <Switch
              id="show-developer-notices"
              checked={showDeveloperNotices}
              onCheckedChange={setShowDeveloperNotices}
              data-testid="settings-show-developer-notices"
            />
          </SettingsRow>

          {/* API request timeout */}
          <div className="px-4 py-3 space-y-2">
            <RowLabel
              label={t('settings.api_timeout')}
              desc={t('settings.api_timeout_desc')}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Input
                id="api-timeout"
                type="number"
                min={API_REQUEST.minTimeoutSeconds}
                max={API_REQUEST.maxTimeoutSeconds}
                value={settings.apiTimeoutSeconds}
                onChange={(e) => {
                  if (!currentProfile) return;
                  const v = Number(e.target.value);
                  const clamped = Number.isFinite(v)
                    ? Math.min(API_REQUEST.maxTimeoutSeconds, Math.max(API_REQUEST.minTimeoutSeconds, Math.round(v)))
                    : API_REQUEST.defaultTimeoutSeconds;
                  updateSettings(currentProfile.id, { apiTimeoutSeconds: clamped });
                }}
                className="w-20"
                data-testid="settings-api-timeout-input"
              />
              <span className="text-xs text-muted-foreground">{t('settings.api_timeout_unit')}</span>
            </div>
          </div>

          {/* Kiosk PIN */}
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
          </SettingsRow>
        </SettingsCard>
      </CollapsibleSection>

      <CertTrustDialog
        open={certDialogOpen}
        certInfo={certInfo}
        isChanged={certIsChanged}
        onTrust={handleTrust}
        onCancel={handleCancelTrust}
      />

      {showPinPad && (
        <PinPad
          mode={pinPadMode}
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
          error={pinError}
        />
      )}
    </>
  );
}

