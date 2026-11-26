/**
 * Profile Form Page
 *
 * Unified form for adding ZoneMinder server profiles.
 * Used for both initial setup (when no profiles exist) and adding additional profiles.
 * Shows welcome messaging when this is the user's first profile.
 */

import { ZMS_PROBE } from '../lib/zmninja-ng-constants';
import { useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, HintButton } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { useProfileStore } from '../stores/profile';
import type { ApiClient } from '../api/client';
import type { LoginResponse } from '../api/types';
import { createStoreApiClient } from '../api/store-gates';
import { asProfileId } from '../api/types';
import { streamUrlUnconfirmed, discoverUrls, DiscoveryError } from '../services/discovery';
import { Switch } from '../components/ui/switch';
import { Video, Server, ShieldCheck, ArrowRight, Loader2, Eye, EyeOff, ArrowLeft, QrCode, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { log, LogLevel } from '../lib/logger';
import { fetchGo2RTCPath } from '../api/auth';
import { QRScanner } from '../components/QRScanner';
import { parseQRProfile } from '../services/qr-profile';
import { toast } from 'sonner';
import { CertTrustDialog } from '../components/CertTrustDialog';
import { Platform } from '../lib/platform';
import type { CertInfo } from '../lib/security/ssl-trust';

export default function ProfileForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const addProfile = useProfileStore((state) => state.addProfile);
  const profiles = useProfileStore((state) => state.profiles);

  // Check if this is the first profile (initial setup)
  const isFirstProfile = profiles.length === 0;
  const returnTo = searchParams.get('returnTo') || '/monitors';

  // Default to demo server only for first profile
  const [profileName, setProfileName] = useState('');
  const [portalUrl, setPortalUrl] = useState(isFirstProfile ? 'https://demo.zoneminder.com' : '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Manual URL entry mode
  const [showManualUrls, setShowManualUrls] = useState(false);
  const [manualApiUrl, setManualApiUrl] = useState('');
  const [manualCgiUrl, setManualCgiUrl] = useState('');

  // Self-signed certificate support
  const [allowSelfSignedCerts, setAllowSelfSignedCerts] = useState(false);

  // TOFU cert trust dialog state
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const certResolveRef = useRef<((trusted: boolean) => void) | null>(null);

  // Show the TOFU dialog and wait for user to trust or reject
  const requestCertTrust = useCallback((info: CertInfo): Promise<boolean> => {
    return new Promise((resolve) => {
      setCertInfo(info);
      setCertDialogOpen(true);
      certResolveRef.current = resolve;
    });
  }, []);

  const handleCertTrust = useCallback(() => {
    setCertDialogOpen(false);
    certResolveRef.current?.(true);
    certResolveRef.current = null;
  }, []);

  const handleCertCancel = useCallback(() => {
    setCertDialogOpen(false);
    certResolveRef.current?.(false);
    certResolveRef.current = null;
  }, []);

  // QR Scanner state
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Abort controller for cancelling discovery
  const abortControllerRef = useRef<AbortController | null>(null);

  // The URLs the last attempt worked out before it failed, for Save anyway (refs #613).
  const attemptUrlsRef = useRef<{ portalUrl: string; apiUrl: string; cgiUrl: string } | null>(null);

  // Handle QR code scan result
  const handleQRScan = (data: string) => {
    const result = parseQRProfile(data);

    if (!result.success) {
      log.profileForm('QR profile parse failed', LogLevel.WARN, { error: result.error });
      toast.error(t(`qr_scanner.parse_errors.${result.error}`));
      return;
    }

    log.profileForm('QR profile imported', LogLevel.INFO, { name: result.data.name });

    // Pre-fill form fields with scanned data
    setProfileName(result.data.name);
    setPortalUrl(result.data.portalUrl);
    if (result.data.username) setUsername(result.data.username);
    if (result.data.password) setPassword(result.data.password);

    // If manual URLs were provided in QR, enable manual mode
    if (result.data.apiUrl || result.data.cgiUrl) {
      setShowManualUrls(true);
      if (result.data.apiUrl) setManualApiUrl(result.data.apiUrl);
      if (result.data.cgiUrl) setManualCgiUrl(result.data.cgiUrl);
    }

    toast.success(t('qr_scanner.import_success', { name: result.data.name }));
  };


  // Cancel ongoing discovery
  const handleCancelDiscovery = () => {
    if (abortControllerRef.current) {
      log.profileForm('Cancelling discovery', LogLevel.INFO);
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setTesting(false);
    setError('');
  };

  const nameFor = (portal: string) =>
    profileName.trim() || (portal.includes('demo.zoneminder.com') ? 'Demo Server' : 'My ZoneMinder');

  // Saves what the failed attempt got to, or what was typed, without a login
  // (refs #613). The Profiles page then shows what fails.
  const handleSaveAnyway = async () => {
    const typed = (/^https?:\/\//.test(portalUrl) ? portalUrl : `https://${portalUrl}`).replace(/\/+$/, '');
    const urls = attemptUrlsRef.current ?? (showManualUrls && manualApiUrl && manualCgiUrl
      ? { portalUrl: typed, apiUrl: manualApiUrl, cgiUrl: manualCgiUrl }
      : { portalUrl: typed, apiUrl: `${typed}/api`, cgiUrl: `${typed}/cgi-bin/nph-zms` });
    try {
      const id = asProfileId(crypto.randomUUID());
      await addProfile({
        name: nameFor(urls.portalUrl),
        ...urls,
        username: username.trim() || undefined,
        password: password || undefined,
        isDefault: isFirstProfile,
        cgiUrlGuessed: true,
      }, id);
      if (allowSelfSignedCerts) {
        const { useSettingsStore } = await import('../stores/settings');
        useSettingsStore.getState().updateProfileSettings(id, { allowSelfSignedCerts: true, trustedCertFingerprint: null });
      }
      log.profileForm('Profile saved without a working connection', LogLevel.INFO, { profileId: id });
      navigate(isFirstProfile ? returnTo : '/profiles');
    } catch (err: unknown) {
      setError((err as Error).message || t('setup.connection_failed'));
    }
  };

  const handleTestConnection = async () => {
    setError('');
    setSuccess(false);
    setTesting(true);

    // Mint this profile's id up front: the connection test below builds an
    // auth session (discovery probe, optional credentials login) before the
    // profile is saved. Minting here means that session, and the profile
    // addProfile saves at the end of this flow, share the same id instead of
    // the test session being orphaned under a scratch id. Refs #337.
    const profileId = asProfileId(crypto.randomUUID());
    attemptUrlsRef.current = null;

    // Create abort controller for this connection attempt
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Enable trust-all for HTTP before any network calls (needed for discovery).
      // This profile isn't saved yet, so pass it as a candidate: the union
      // computed from the store alone wouldn't know about it.
      if (allowSelfSignedCerts) {
        const { applyTrustedCertificates } = await import('../lib/security/ssl-trust');
        await applyTrustedCertificates({ urls: [portalUrl], fingerprint: null, enabled: allowSelfSignedCerts });
      }

      const normalizedUsername = username.trim();
      const hasUsername = normalizedUsername.length > 0;
      const hasPassword = password.length > 0;

      if ((hasUsername && !hasPassword) || (hasPassword && !hasUsername)) {
        throw new Error(t('setup.credentials_incomplete'));
      }

      log.profileForm('Testing connection', LogLevel.INFO, { portalUrl });

      let confirmedPortalUrl: string;
      let apiUrl: string;
      let cgiUrl: string;
      let go2rtcPath: string | null = null;
      let acceptedFingerprint: string | null = null;
      // The profile isn't saved yet (addProfile runs at the end of this flow),
      // so there's no session to pull a client from; both branches below build
      // one directly for this candidate profileId. Refs #337.
      let profileClient: ApiClient | undefined;
      // Discovery logs in to read ZM_PATH_ZMS; reuse that instead of paying
      // ZoneMinder's ~0.6s password hash a second time.
      let discoveredLogin: LoginResponse | undefined;
      // No frame confirmed the stream path (refs #603, #613).
      let cgiUrlGuessed = false;
      let cgiUrlUnverified = false;

      if (showManualUrls) {
        // Manual URL entry mode
        log.profileForm('Using manual URLs', LogLevel.INFO);
        if (!manualApiUrl || !manualCgiUrl) {
          throw new Error(t('setup.enter_both_urls'));
        }

        // Validate that portal and API have matching protocols
        const portalHasProtocol = portalUrl.startsWith('http://') || portalUrl.startsWith('https://');
        const portalProtocol = portalUrl.startsWith('https://') ? 'https' : 'http';
        const apiHasProtocol = manualApiUrl.startsWith('http://') || manualApiUrl.startsWith('https://');
        const apiProtocol = manualApiUrl.startsWith('https://') ? 'https' : 'http';

        if (portalHasProtocol && apiHasProtocol && portalProtocol !== apiProtocol) {
          throw new Error(
            t('setup.protocol_mismatch', {
              portalProtocol,
              apiProtocol,
            })
          );
        }

        // Ensure portal URL has protocol for manual mode
        confirmedPortalUrl = portalUrl;
        if (!confirmedPortalUrl.startsWith('http://') && !confirmedPortalUrl.startsWith('https://')) {
          confirmedPortalUrl = `https://${confirmedPortalUrl}`;
        }

        apiUrl = manualApiUrl;
        cgiUrl = manualCgiUrl;
        log.profileForm('Manual URLs set', LogLevel.INFO, { portalUrl: confirmedPortalUrl, apiUrl, cgiUrl });

        // Build the API client for the manual URL
        const client = createStoreApiClient(apiUrl, undefined, profileId);
        profileClient = client;
      } else {
        // Discover URLs from portal URL
        // Pass credentials if provided to fetch accurate ZM_PATH_ZMS from server
        log.profileForm('Discovering URLs', LogLevel.INFO);
        const credentials = hasUsername && hasPassword ? { username: normalizedUsername, password } : undefined;
        const discovered = await discoverUrls(portalUrl, {
          profileId,
          credentials,
          signal,
          onClientCreated: (client) => {
            profileClient = client;
          },
        });
        log.profileForm('Successfully connected', LogLevel.INFO, { apiUrl: discovered.apiUrl });
        confirmedPortalUrl = discovered.portalUrl;
        apiUrl = discovered.apiUrl;
        cgiUrl = discovered.cgiUrl;
        discoveredLogin = discovered.loginResponse;
        cgiUrlGuessed = streamUrlUnconfirmed(discovered);
        cgiUrlUnverified = discovered.cgiUrlVerified === false;
        log.profileForm('URLs discovered', LogLevel.INFO, { portalUrl: confirmedPortalUrl, apiUrl, cgiUrl });
      }

      attemptUrlsRef.current = { portalUrl: confirmedPortalUrl, apiUrl, cgiUrl };

      // TOFU: after discovery succeeds, fetch the server cert and ask user to trust it
      if (allowSelfSignedCerts && Platform.isNative) {
        const { getServerCertFingerprint, applyTrustedCertificates } = await import('../lib/security/ssl-trust');
        const info = await getServerCertFingerprint(confirmedPortalUrl);
        if (info) {
          const trusted = await requestCertTrust(info);
          if (!trusted) {
            // This return precedes any login attempt below, so there are no
            // tokens to clean up here.
            await applyTrustedCertificates();
            setTesting(false);
            return;
          }
          // Save to local var (React state update from handleCertTrust is batched
          // and won't be available until next render)
          acceptedFingerprint = info.fingerprint;
          // Apply fingerprint-based trust (installs WebView handler). Still a
          // candidate: the profile isn't saved until after login/discovery succeeds.
          await applyTrustedCertificates({
            urls: [confirmedPortalUrl, apiUrl, cgiUrl],
            fingerprint: acceptedFingerprint,
            enabled: allowSelfSignedCerts,
          });
        }
      }

      // If credentials are provided, try to login
      if (normalizedUsername && hasPassword) {
        log.profileForm('Attempting login with provided credentials', LogLevel.INFO, { username: normalizedUsername });
        try {
          const { useAuthStore } = await import('../stores/auth');

          // Clear any existing auth state to ensure clean login
          // This prevents old tokens from interfering with new profile login
          useAuthStore.getState().logout(profileId);
          log.profileForm('Cleared existing auth state for fresh login', LogLevel.DEBUG);

          if (discoveredLogin) {
            useAuthStore.getState().setTokens(profileId, discoveredLogin);
            log.profileForm('Reused the login discovery performed', LogLevel.INFO);
          } else {
            await useAuthStore.getState().login(profileId, normalizedUsername, password, profileClient);
            log.profileForm('Login successful', LogLevel.INFO);
          }

          // Note: ZMS path is already fetched during discovery when credentials are provided,
          // so cgiUrl is already set correctly. We just need to fetch Go2RTC path here.

          // Fetch Go2RTC path if configured (optional, not all servers have it)
          go2rtcPath = await fetchGo2RTCPath(profileClient!);
          if (go2rtcPath) {
            log.profileForm('Go2RTC path fetched from server config', LogLevel.INFO, {
              go2rtcPath
            });
          } else {
            log.profileForm('Go2RTC not configured on server', LogLevel.INFO);
          }
        } catch (loginError: unknown) {
          log.profileForm('Login failed', LogLevel.ERROR, loginError);
          throw new Error(t('setup.login_failed', { error: (loginError as Error).message || 'Unknown error' }));
        }
      }

      setSuccess(true);
      setError('');

      // Generate profile name if not provided
      const finalProfileName = nameFor(confirmedPortalUrl);

      log.profileForm('Adding new profile', LogLevel.INFO, { profileName: finalProfileName });
      await addProfile({
        name: finalProfileName,
        portalUrl: confirmedPortalUrl,
        apiUrl,
        cgiUrl,
        username: normalizedUsername || undefined,
        password: password || undefined,
        isDefault: isFirstProfile,
        go2rtcUrl: go2rtcPath || undefined,
        ...(cgiUrlGuessed ? { cgiUrlGuessed: true } : {}),
      }, profileId);
      log.profileForm('Profile created', LogLevel.INFO, { profileName: finalProfileName, profileId });

      // Save self-signed cert setting and trusted fingerprint to the new profile
      if (allowSelfSignedCerts) {
        const { useSettingsStore } = await import('../stores/settings');
        useSettingsStore.getState().updateProfileSettings(profileId, {
          allowSelfSignedCerts: true,
          trustedCertFingerprint: acceptedFingerprint,
        });
        // Re-apply from committed state now that the profile is saved (no more candidate).
        const { applyTrustedCertificates } = await import('../lib/security/ssl-trust');
        await applyTrustedCertificates();
      }

      // Switch to the newly created profile (unless it's the first profile, which is auto-set as current)
      if (!isFirstProfile) {
        const switchProfile = useProfileStore.getState().switchProfile;
        log.profileForm('Switching to newly created profile', LogLevel.INFO, { profileId });
        await switchProfile(profileId);
      }

      // The destination page is the confirmation; a fixed pause before it
      // was one more second on every first connect.
      // A toast, not a hint by the CGI field: that field is hidden while
      // discovery runs and the form navigates away on success.
      if (cgiUrlGuessed) {
        const key = cgiUrlUnverified ? 'setup.cgi_url_unverified' : 'setup.cgi_url_guessed';
        toast.warning(t(key, { cgiUrl }), { duration: ZMS_PROBE.guessedToastMs, closeButton: true });
      }
      navigate(returnTo);
    } catch (err: unknown) {
      // The failed/cancelled attempt may have landed real tokens under this
      // profile's minted id (a successful login before a later step, e.g.
      // addProfile, threw). addProfile may have already saved the profile
      // by the time a later step throws (e.g. switchProfile below); logout
      // here is self-healing in that case, since bootstrap re-auths saved
      // profiles from their stored credentials on next launch. When
      // addProfile itself never ran, this clears the only trace of that
      // login attempt's tokens - nothing else would. Refs #337.
      const { useAuthStore } = await import('../stores/auth');
      useAuthStore.getState().logout(profileId);

      // Don't show error if cancelled by user
      if (err instanceof DiscoveryError && err.code === 'CANCELLED') {
        log.profileForm('Discovery cancelled by user', LogLevel.INFO);
        return;
      }
      setError((err as Error).message || t('setup.connection_failed'));
      setSuccess(false);
    } finally {
      abortControllerRef.current = null;
      setTesting(false);
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-background relative overflow-y-auto p-4" data-tv-region="setup-screen">
      {/* Background Effects - clipped so the glows past the edge don't make the page scroll sideways (refs #587) */}
      <div className="absolute inset-0 overflow-hidden" data-testid="setup-background">
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]" />
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-50 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/20 rounded-full blur-3xl opacity-50" />
      </div>

      <Card className="w-full max-w-md mx-auto my-auto border-border/50 shadow-2xl backdrop-blur-xl bg-card/80 z-10">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 ring-1 ring-primary/20">
            <Video className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-lg font-bold tracking-tight">
            {isFirstProfile ? t('setup.welcome') : t('profiles.add_dialog_title')}
          </CardTitle>
          <CardDescription className="text-base mt-2">
            {isFirstProfile ? t('setup.subtitle') : t('profiles.add_dialog_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* QR Import Button */}
          <Button
            variant="outline"
            onClick={() => setShowQRScanner(true)}
            className="w-full"
            data-testid="qr-import-button"
          >
            <QrCode className="mr-2 h-4 w-4" />
            {t('qr_scanner.import_button')}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {t('qr_scanner.or_manual')}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profileName" className="text-sm font-medium">{t('setup.profile_name')}</Label>
            <Input
              id="profileName"
              type="text"
              placeholder={t('setup.profile_name_placeholder')}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              disabled={testing}
              className="h-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors"
              data-testid="setup-profile-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portal" className="text-sm font-medium">{t('setup.server_url')}</Label>
            <div className="relative">
              <Server className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="portal"
                type="text"
                placeholder="https://demo.zoneminder.com"
                value={portalUrl}
                onChange={(e) => setPortalUrl(e.target.value)}
                disabled={testing}
                className="h-10 !pl-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors"
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="setup-portal-url"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('setup.server_url_hint')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">{t('setup.username')}</Label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="username"
                type="text"
                placeholder={t('setup.username_placeholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={testing}
                className="h-10 !pl-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors"
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="setup-username"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">{t('setup.password')}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword || !password ? 'text' : 'password'}
                placeholder={t('setup.password_placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={testing}
                className="h-10 pr-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                data-testid="setup-password"
              />
              {password && (
                <HintButton
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  title={showPassword ? t('common.hide_password') : t('common.show_password')}
                  aria-label={showPassword ? t('common.hide_password') : t('common.show_password')}
                  data-testid="setup-password-toggle"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </HintButton>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('setup.credentials_optional')}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="self-signed-certs" className="text-sm text-muted-foreground cursor-pointer">
              {t('settings.allow_self_signed_certs')}
            </Label>
            <Switch
              id="self-signed-certs"
              checked={allowSelfSignedCerts}
              onCheckedChange={setAllowSelfSignedCerts}
              data-testid="setup-self-signed-certs-switch"
            />
          </div>

          {/* Manual URL Entry Toggle */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowManualUrls(!showManualUrls)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="setup-manual-urls-toggle"
            >
              {showManualUrls ? t('setup.use_auto_discovery') : t('setup.manual_urls')}
            </button>
          </div>

          {showManualUrls && (
            <div className="space-y-4 pt-2 border-t">
              <div className="space-y-2">
                <Label htmlFor="apiUrl" className="text-sm font-medium">{t('setup.api_url')}</Label>
                <Input
                  id="apiUrl"
                  type="text"
                  placeholder="http://example.com/zm/api"
                  value={manualApiUrl}
                  onChange={(e) => setManualApiUrl(e.target.value)}
                  disabled={testing}
                  className="h-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors font-mono text-sm"
                  autoCapitalize="none"
                  autoCorrect="off"
                  data-testid="setup-api-url"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cgiUrl" className="text-sm font-medium">{t('setup.cgi_url')}</Label>
                <Input
                  id="cgiUrl"
                  type="text"
                  placeholder="http://example.com/zm/cgi-bin"
                  value={manualCgiUrl}
                  onChange={(e) => setManualCgiUrl(e.target.value)}
                  disabled={testing}
                  className="h-10 bg-background/50 border-input/50 focus:border-primary/50 transition-colors font-mono text-sm"
                  autoCapitalize="none"
                  autoCorrect="off"
                  data-testid="setup-cgi-url"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-600 dark:text-green-400">
              {t('setup.success')}
            </div>
          )}

          {testing && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('setup.testing')}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          {testing ? (
            <Button
              variant="destructive"
              onClick={handleCancelDiscovery}
              className="w-full h-11 text-base font-medium"
              data-testid="cancel-discovery-button"
            >
              <X className="mr-2 h-4 w-4" />
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              onClick={handleTestConnection}
              disabled={!portalUrl}
              className="w-full h-11 text-base font-medium shadow-lg shadow-primary/20"
              data-testid="connect-button"
            >
              {isFirstProfile ? t('setup.connect') : t('profiles.add')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}

          {error && !testing && (
            <Button
              variant="outline"
              onClick={handleSaveAnyway}
              className="w-full"
              data-testid="setup-save-anyway"
            >
              {t('setup.save_anyway')}
            </Button>
          )}

          {!isFirstProfile && !testing && (
            <Button
              variant="outline"
              onClick={() => navigate('/profiles')}
              disabled={testing}
              className="w-full"
              data-testid="setup-back-button"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.cancel')}
            </Button>
          )}
        </CardFooter>
      </Card>

      {/* QR Scanner Dialog */}
      <QRScanner
        open={showQRScanner}
        onOpenChange={setShowQRScanner}
        onScan={handleQRScan}
      />

      {/* TOFU Certificate Trust Dialog */}
      <CertTrustDialog
        open={certDialogOpen}
        certInfo={certInfo}
        isChanged={false}
        onTrust={handleCertTrust}
        onCancel={handleCertCancel}
      />
    </div>
  );
}
