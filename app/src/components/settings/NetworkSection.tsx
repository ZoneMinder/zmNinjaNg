/**
 * Network section.
 *
 * Bandwidth mode is selection-scoped and saves through the page's `update`.
 * The server sub-card holds how the app reaches this server: self-signed
 * certificates (with the trust-on-first-use prompt on native), the request
 * timeout, and the multi-port override.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Gauge, Leaf } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { API_REQUEST, getBandwidthSettings, type BandwidthMode } from '../../lib/zmninja-ng-constants';
import { CertTrustDialog } from '../CertTrustDialog';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel, SettingsSubCard } from './SettingsLayout';
import { Platform } from '../../lib/platform';
import { log, LogLevel } from '../../lib/logger';
import type { CertInfo } from '../../lib/security/ssl-trust';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

export interface NetworkSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  /** True while aggregating: server rows then belong to the picked member. */
  isAllMode: boolean;
  serverProfile: Profile | null;
  serverSettings: ProfileSettings;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function NetworkSection({
  settings,
  update,
  isAllMode,
  serverProfile,
  serverSettings,
  updateSettings,
}: NetworkSectionProps) {
  const { t } = useTranslation();

  // Connection settings state
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certIsChanged, setCertIsChanged] = useState(false);
  const [reverifying, setReverifying] = useState(false);

  // Switching the mode also resets this profile's stream values to the
  // mode's defaults. Only with one profile selected: while aggregating the
  // mode is the aggregate's own, and it never rewrites a member's bucket.
  const handleBandwidthModeChange = (isLow: boolean) => {
    const mode: BandwidthMode = isLow ? 'low' : 'normal';
    update('bandwidthMode', mode);
    if (isAllMode || !serverProfile) return;
    const bandwidthDefaults = getBandwidthSettings(mode);
    updateSettings(serverProfile.id, {
      streamScale: bandwidthDefaults.imageScale,
      streamMaxFps: bandwidthDefaults.streamMaxFps,
      snapshotRefreshInterval: bandwidthDefaults.snapshotRefreshInterval,
    });
  };

  // Self-signed cert enable handler
  const handleSelfSignedCertsChange = async (checked: boolean) => {
    if (!serverProfile) return;

    // Update the setting immediately so the switch toggles
    updateSettings(serverProfile.id, {
      allowSelfSignedCerts: checked,
      ...(!checked && { trustedCertFingerprint: null }),
    });

    if (checked && Platform.isNative) {
      try {
        const { applyTrustedCertificates, getServerCertFingerprint } = await import('../../lib/security/ssl-trust');
        await applyTrustedCertificates();
        const info = await getServerCertFingerprint(serverProfile.portalUrl);
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
    if (!serverProfile || !certInfo) return;
    setCertDialogOpen(false);
    updateSettings(serverProfile.id, {
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
    if (!serverProfile) return;
    setReverifying(true);
    try {
      const { applyTrustedCertificates, getServerCertFingerprint } = await import('../../lib/security/ssl-trust');
      await applyTrustedCertificates();
      const info = await getServerCertFingerprint(serverProfile.portalUrl);
      if (info) {
        const isChanged =
          serverSettings.trustedCertFingerprint !== null &&
          info.fingerprint !== serverSettings.trustedCertFingerprint;
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
      <CollapsibleSection id="network" label={t('settings.section_network')}>
        <div className="space-y-3">
          <SettingsCard>
            <SettingsRow>
              <RowLabel
                label={t('settings.bandwidth_mode')}
                desc={
                  settings.bandwidthMode === 'low'
                    ? t('settings.bandwidth_low_desc')
                    : t('settings.bandwidth_normal_desc')
                }
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                {settings.bandwidthMode === 'low' && (
                  <Badge variant="success" className="text-xs">
                    {t('settings.bandwidth_saving')}
                  </Badge>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" />
                  <span>{t('settings.bandwidth_normal')}</span>
                </div>
                <Switch
                  id="bandwidth-mode"
                  checked={settings.bandwidthMode === 'low'}
                  onCheckedChange={handleBandwidthModeChange}
                  data-testid="settings-bandwidth-mode-switch"
                />
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Leaf className="h-3.5 w-3.5 text-green-600" />
                  <span>{t('settings.bandwidth_low')}</span>
                </div>
              </div>
            </SettingsRow>
          </SettingsCard>

          <SettingsSubCard name={serverProfile?.name ?? ''} testId="settings-server-subcard">
            <SettingsCard>
              {/* Self-signed certs: only relevant for HTTPS */}
              {serverProfile?.portalUrl?.startsWith('https') && (<><SettingsRow>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t('settings.allow_self_signed_certs')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings.allow_self_signed_certs_desc')}</div>
                  {serverSettings.allowSelfSignedCerts && (
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
                  checked={serverSettings.allowSelfSignedCerts}
                  onCheckedChange={handleSelfSignedCertsChange}
                  data-testid="settings-self-signed-certs-switch"
                />
              </SettingsRow>

              {/* Cert fingerprint display (only when enabled on native) */}
              {serverSettings.allowSelfSignedCerts && Platform.isNative && (
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
                  {serverSettings.trustedCertFingerprint ? (
                    <p
                      className="font-mono text-[10px] break-all text-muted-foreground leading-relaxed"
                      title={serverSettings.trustedCertFingerprint}
                    >
                      {serverSettings.trustedCertFingerprint}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('ssl.no_fingerprint')}</p>
                  )}
                </div>
              )}
              </>)}

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
                    value={serverSettings.apiTimeoutSeconds}
                    onChange={(e) => {
                      if (!serverProfile) return;
                      const v = Number(e.target.value);
                      const clamped = Number.isFinite(v)
                        ? Math.min(API_REQUEST.maxTimeoutSeconds, Math.max(API_REQUEST.minTimeoutSeconds, Math.round(v)))
                        : API_REQUEST.defaultTimeoutSeconds;
                      updateSettings(serverProfile.id, { apiTimeoutSeconds: clamped });
                    }}
                    className="w-20"
                    data-testid="settings-api-timeout-input"
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.api_timeout_unit')}</span>
                </div>
              </div>

              {/* Force-disable multi-port streaming */}
              <SettingsRow>
                <RowLabel
                  label={t('settings.force_disable_multiport')}
                  desc={t('settings.force_disable_multiport_desc')}
                />
                <Switch
                  id="force-disable-multiport"
                  checked={serverSettings.forceDisableMultiPort}
                  onCheckedChange={(checked) =>
                    serverProfile &&
                    updateSettings(serverProfile.id, { forceDisableMultiPort: checked })
                  }
                  data-testid="settings-force-disable-multiport-switch"
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsSubCard>
        </div>
      </CollapsibleSection>

      <CertTrustDialog
        open={certDialogOpen}
        certInfo={certInfo}
        isChanged={certIsChanged}
        onTrust={handleTrust}
        onCancel={handleCancelTrust}
      />
    </>
  );
}
