/**
 * Advanced Section
 *
 * Self-signed certificates, log redaction, and kiosk PIN settings.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { hasPinStored, storePin, clearPin, verifyPin } from '../../lib/kioskPin';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../../hooks/useBiometricAuth';
import { PinPad, type PinPadMode } from '../kiosk/PinPad';
import { useToast } from '../../hooks/use-toast';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { CertTrustDialog } from '../CertTrustDialog';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { Platform } from '../../lib/platform';
import { log, LogLevel } from '../../lib/logger';
import type { CertInfo } from '../../lib/ssl-trust';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

/** All component logger names, matching Logger's component loggers. */
const COMPONENT_NAMES = [
  'API', 'App', 'Auth', 'Crypto', 'Dashboard', 'Discovery', 'Download',
  'ErrorBoundary', 'EventCard', 'EventDetail', 'EventMontage', 'HTTP',
  'ImageError', 'Kiosk', 'Monitor', 'MonitorCard', 'MonitorDetail',
  'MontageMonitor', 'Navigation', 'NotificationHandler', 'Notifications',
  'NotificationSettings', 'Profile', 'ProfileForm', 'ProfileService',
  'ProfileSwitcher', 'Push', 'QueryCache', 'SecureImage', 'SecureStorage',
  'Server', 'SSLTrust', 'Time', 'VideoMarkers', 'VideoPlayer', 'ZmsEventPlayer',
] as const;

const LOG_LEVEL_OPTIONS = [
  { value: LogLevel.DEBUG, label: 'DEBUG' },
  { value: LogLevel.INFO, label: 'INFO' },
  { value: LogLevel.WARN, label: 'WARN' },
  { value: LogLevel.ERROR, label: 'ERROR' },
  { value: LogLevel.NONE, label: 'NONE' },
] as const;

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

  // The whole Advanced section collapses (power-user settings; collapsed by default).
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

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
      // Biometrics failed/cancelled — fall through to PIN pad
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
        const { applySSLTrustSetting, getServerCertFingerprint } = await import('../../lib/ssl-trust');
        await applySSLTrustSetting(true);
        const info = await getServerCertFingerprint(currentProfile.portalUrl);
        if (info) {
          setCertInfo(info);
          setCertIsChanged(false);
          setCertDialogOpen(true);
          return;
        }
        await applySSLTrustSetting(true, null);
      } catch (error) {
        log.sslTrust('Failed to fetch cert during enable', LogLevel.ERROR, { error });
      }
    }

    if (!checked) {
      const { applySSLTrustSetting } = await import('../../lib/ssl-trust');
      await applySSLTrustSetting(false);
    }
  };

  const handleTrust = async () => {
    if (!currentProfile || !certInfo) return;
    setCertDialogOpen(false);
    updateSettings(currentProfile.id, {
      allowSelfSignedCerts: true,
      trustedCertFingerprint: certInfo.fingerprint,
    });
    const { applySSLTrustSetting } = await import('../../lib/ssl-trust');
    await applySSLTrustSetting(true, certInfo.fingerprint);
  };

  const handleCancelTrust = async () => {
    setCertDialogOpen(false);
    const { applySSLTrustSetting } = await import('../../lib/ssl-trust');
    await applySSLTrustSetting(false);
  };

  const handleReverify = async () => {
    if (!currentProfile) return;
    setReverifying(true);
    try {
      const { applySSLTrustSetting, getServerCertFingerprint } = await import('../../lib/ssl-trust');
      await applySSLTrustSetting(true);
      const info = await getServerCertFingerprint(currentProfile.portalUrl);
      if (info) {
        const isChanged =
          settings.trustedCertFingerprint !== null &&
          info.fingerprint !== settings.trustedCertFingerprint;
        setCertInfo(info);
        setCertIsChanged(isChanged);
        setCertDialogOpen(true);
      }
      await applySSLTrustSetting(true, settings.trustedCertFingerprint);
    } catch (error) {
      log.sslTrust('Failed to re-verify certificate', LogLevel.ERROR, { error });
    } finally {
      setReverifying(false);
    }
  };

  const handleRestartNow = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('restart_app');
  }, []);

  return (
    <>
      <section>
        <SectionHeader
          label={t('settings.section_advanced', 'Advanced')}
          collapsible
          expanded={advancedExpanded}
          onToggle={() => setAdvancedExpanded((v) => !v)}
          testId="settings-advanced-toggle"
        />
        {advancedExpanded && (
        <>
        <SettingsCard>
          {/* Self-signed certs — only relevant for HTTPS */}
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

          {/* Log Redaction */}
          <SettingsRow>
            <RowLabel
              label={t('settings.disable_log_redaction')}
              desc={t('settings.disable_log_redaction_desc')}
            />
            <Switch
              id="log-redaction"
              checked={settings.disableLogRedaction}
              onCheckedChange={(checked) =>
                currentProfile &&
                updateSettings(currentProfile.id, { disableLogRedaction: checked })
              }
              data-testid="settings-log-redaction-switch"
            />
          </SettingsRow>

          {/* Auto-restart (desktop only) — periodically relaunch to release the
              WebKit process memory that no in-process flush reclaims. refs #150 */}
          {Platform.isTauri && (
            <>
              <SettingsRow>
                <RowLabel
                  label={t('settings.auto_restart')}
                  desc={t('settings.auto_restart_desc')}
                />
                <Switch
                  id="auto-restart"
                  checked={settings.autoRestartEnabled}
                  onCheckedChange={(checked) =>
                    currentProfile &&
                    updateSettings(currentProfile.id, { autoRestartEnabled: checked })
                  }
                  data-testid="settings-auto-restart-switch"
                />
              </SettingsRow>
              <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                {settings.autoRestartEnabled && (
                  <>
                    <Input
                      id="auto-restart-interval"
                      type="number"
                      min="1"
                      max="1440"
                      value={settings.autoRestartIntervalMinutes}
                      onChange={(e) =>
                        currentProfile &&
                        updateSettings(currentProfile.id, {
                          autoRestartIntervalMinutes: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-20"
                      data-testid="settings-auto-restart-interval"
                    />
                    <span className="text-xs text-muted-foreground">{t('settings.minutes')}</span>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleRestartNow}
                  data-testid="settings-restart-now"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('settings.restart_now')}
                </Button>
              </div>
            </>
          )}

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

        {/* Component Log Levels — nested inside the Advanced collapsible */}
        <ComponentLogLevels
          settings={settings}
          currentProfile={currentProfile}
          updateSettings={updateSettings}
        />
        </>
        )}
      </section>

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

/** Collapsible section for log level control — global + per-component. */
function ComponentLogLevels({
  settings,
  currentProfile,
  updateSettings,
}: AdvancedSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const overrides = settings.componentLogLevels || {};
  const globalLevel = settings.logLevel;
  const overrideCount = useMemo(
    () => Object.values(overrides).filter((v) => v !== globalLevel).length,
    [overrides, globalLevel],
  );

  // Get effective level for a component (override or global)
  const getEffective = useCallback(
    (component: string) => overrides[component] ?? globalLevel,
    [overrides, globalLevel],
  );

  // Change global level — sets all components to this level (clears overrides)
  const handleGlobalChange = useCallback(
    (value: number) => {
      if (!currentProfile) return;
      updateSettings(currentProfile.id, {
        logLevel: value as LogLevel,
        componentLogLevels: {},
      });
    },
    [currentProfile, updateSettings],
  );

  // Change a single component's level
  const handleComponentChange = useCallback(
    (component: string, value: number) => {
      if (!currentProfile) return;
      const next = { ...overrides };
      if (value === globalLevel) {
        // Same as global — remove override
        delete next[component];
      } else {
        next[component] = value;
      }
      updateSettings(currentProfile.id, { componentLogLevels: next });
    },
    [currentProfile, overrides, globalLevel, updateSettings],
  );

  // Reset all overrides to global
  const handleReset = useCallback(() => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, { componentLogLevels: {} });
  }, [currentProfile, updateSettings]);

  const levelLabel = (level: number) =>
    LOG_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? 'INFO';

  return (
    <div className="mt-4">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-semibold text-primary uppercase tracking-wide mb-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        data-testid="component-log-levels-toggle"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('settings.component_log_levels')}
        <span className="text-xs font-normal text-muted-foreground">
          ({levelLabel(globalLevel)}{overrideCount > 0 ? `, ${overrideCount} custom` : ''})
        </span>
      </button>

      {expanded && (
        <SettingsCard>
          <div className="px-4 py-3">
            {/* Global level — changes all components */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b">
              <div>
                <div className="text-sm font-medium">{t('settings.global_log_level')}</div>
                <p className="text-xs text-muted-foreground">{t('settings.global_log_level_desc')}</p>
              </div>
              <select
                className="text-xs bg-background border rounded px-2 py-1 min-w-[5rem] font-medium"
                value={globalLevel}
                onChange={(e) => handleGlobalChange(parseInt(e.target.value, 10))}
                data-testid="global-log-level-select"
              >
                {LOG_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Per-component overrides */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                {t('settings.component_log_levels_desc')}
              </p>
              {overrideCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive"
                  onClick={handleReset}
                  data-testid="component-log-levels-reset"
                >
                  {t('settings.component_log_reset')}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
              {COMPONENT_NAMES.map((name) => {
                const effective = getEffective(name);
                const isOverridden = overrides[name] !== undefined && overrides[name] !== globalLevel;
                return (
                  <div key={name} className="flex items-center justify-between gap-1 min-w-0">
                    <span
                      className={`text-xs truncate min-w-0 ${isOverridden ? 'font-medium text-primary' : ''}`}
                      title={name}
                    >
                      {name}
                    </span>
                    <select
                      className={`text-xs bg-background border rounded px-1 py-0.5 min-w-[5rem] ${isOverridden ? 'border-primary' : ''}`}
                      value={effective}
                      onChange={(e) => handleComponentChange(name, parseInt(e.target.value, 10))}
                      data-testid={`component-log-level-${name}`}
                    >
                      {LOG_LEVEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
