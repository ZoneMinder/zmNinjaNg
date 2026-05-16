/**
 * Profile Bootstrap Helpers
 *
 * Shared bootstrap logic used by both switchProfile and onRehydrateStorage
 * to avoid code duplication.
 */

import type { Profile } from '../api/types';
import { getServerTimeZone } from '../api/time';
import { fetchGo2RTCPath, fetchZmsPath } from '../api/auth';
import { log, LogLevel } from '../lib/logger';

export interface BootstrapContext {
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
}

/**
 * Bootstrap authentication with stored credentials
 */
export async function bootstrapAuth(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  if (!profile.username || !profile.password) {
    log.profileService('No credentials stored, skipping authentication', LogLevel.INFO);
    log.profileService('This is normal for public servers', LogLevel.INFO);
    // Mark as authenticated so API client doesn't try to re-login
    const { useAuthStore } = await import('../stores/auth');
    useAuthStore.getState().setTokens({});
    return;
  }

  log.profileService('Authenticating with stored credentials', LogLevel.INFO, {
    username: profile.username,
  });

  try {
    const decryptedPassword = await context.getDecryptedPassword(profile.id);
    if (!decryptedPassword) {
      throw new Error('Failed to decrypt password');
    }

    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore.getState().login(profile.username, decryptedPassword);
    log.profileService('Authentication successful', LogLevel.INFO);
  } catch (authError: unknown) {
    log.profileService(
      'Authentication failed - this might be OK if server does not require auth',
      LogLevel.WARN,
      { error: authError }
    );
  }
}

/**
 * Bootstrap server timezone
 */
export async function bootstrapTimezone(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  try {
    log.profileService('Fetching server timezone', LogLevel.INFO);
    const { useAuthStore } = await import('../stores/auth');
    const { accessToken } = useAuthStore.getState();
    const timezone = await getServerTimeZone(accessToken || undefined);

    if (timezone !== profile.timezone) {
      log.profileService('Server timezone fetched', LogLevel.INFO, { timezone });
      await context.updateProfile(profile.id, { timezone });
    }
  } catch (tzError) {
    log.profileService('Failed to fetch server timezone', LogLevel.WARN, {
      error: tzError,
    });
  }
}

/**
 * Bootstrap ZMS path and update CGI URL
 */
export async function bootstrapZmsPath(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  try {
    log.profileService('Fetching ZMS path from server config', LogLevel.INFO);
    const zmsPath = await fetchZmsPath();

    if (!zmsPath || !profile.portalUrl) {
      log.profileService('ZMS path not available, keeping current CGI URL', LogLevel.INFO, {
        cgiUrl: profile.cgiUrl,
      });
      return;
    }

    try {
      const url = new URL(profile.portalUrl);
      const newCgiUrl = `${url.origin}${zmsPath}`;

      if (newCgiUrl !== profile.cgiUrl) {
        log.profileService('ZMS path fetched, updating CGI URL', LogLevel.INFO, {
          oldCgiUrl: profile.cgiUrl,
          zmsPath,
          newCgiUrl,
        });
        await context.updateProfile(profile.id, { cgiUrl: newCgiUrl });
      } else {
        log.profileService('ZMS path matches current CGI URL, no update needed', LogLevel.INFO, {
          cgiUrl: profile.cgiUrl,
        });
      }
    } catch (urlError) {
      log.profileService('Failed to construct CGI URL from ZMS path', LogLevel.WARN, {
        portalUrl: profile.portalUrl,
        zmsPath,
        error: urlError,
      });
    }
  } catch (zmsError) {
    log.profileService('Failed to fetch ZMS path', LogLevel.WARN, {
      error: zmsError,
    });
  }
}

/**
 * Bootstrap Go2RTC path and update profile
 */
export async function bootstrapGo2RTCPath(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  try {
    log.profileService('Fetching Go2RTC path from server config', LogLevel.INFO);
    const go2rtcPath = await fetchGo2RTCPath();

    if (!go2rtcPath) {
      log.profileService('Go2RTC not configured on server', LogLevel.INFO);
      // Clear go2rtcUrl if it was previously set but is now missing
      if (profile.go2rtcUrl) {
        await context.updateProfile(profile.id, { go2rtcUrl: undefined });
      }
      return;
    }

    if (go2rtcPath !== profile.go2rtcUrl) {
      log.profileService('Go2RTC path fetched, updating profile', LogLevel.INFO, {
        oldGo2rtcUrl: profile.go2rtcUrl,
        newGo2rtcUrl: go2rtcPath,
      });
      await context.updateProfile(profile.id, { go2rtcUrl: go2rtcPath });
    } else {
      log.profileService('Go2RTC path matches current value, no update needed', LogLevel.INFO, {
        go2rtcUrl: profile.go2rtcUrl,
      });
    }
  } catch (go2rtcError) {
    log.profileService('Failed to fetch Go2RTC path', LogLevel.INFO, {
      error: go2rtcError,
    });
  }
}

/**
 * Bootstrap multi-port streaming configuration
 */
export async function bootstrapMultiPortStreaming(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  try {
    log.profileService('Fetching server configuration for multi-port streaming', LogLevel.INFO);
    const { fetchMinStreamingPort } = await import('../api/server');
    const minPort = await fetchMinStreamingPort();

    if (minPort === null) {
      log.profileService('Multi-port streaming not configured on server', LogLevel.DEBUG);
      return;
    }

    log.profileService('Multi-port streaming enabled', LogLevel.INFO, { minPort });

    // Update profile with minStreamingPort if changed
    if (profile.minStreamingPort !== minPort) {
      await context.updateProfile(profile.id, { minStreamingPort: minPort });
    }

    // For NEW profiles (no existing settings), default to streaming mode
    // For existing profiles, respect user's current settings
    try {
      const { useSettingsStore } = await import('../stores/settings');
      const settingsStore = useSettingsStore.getState();
      const hasExistingSettings = settingsStore.profileSettings[profile.id] !== undefined;

      if (!hasExistingSettings) {
        log.profileService('New profile with multi-port: defaulting to streaming mode', LogLevel.INFO);
        settingsStore.updateProfileSettings(profile.id, { viewMode: 'streaming' });
      } else {
        log.profileService('Existing profile: preserving current viewMode setting', LogLevel.DEBUG);
      }
    } catch (settingsError) {
      log.profileService('Failed to configure view mode', LogLevel.WARN, {
        error: settingsError,
      });
    }
  } catch (configError) {
    log.profileService(
      'Failed to fetch MIN_STREAMING_PORT - multi-port may be unavailable',
      LogLevel.WARN,
      { error: configError }
    );
  }
}

/**
 * Bootstrap multi-server map from /servers.json
 */
export async function bootstrapServerMap(): Promise<void> {
  try {
    const { getServers } = await import('../api/server');
    const { buildServerMap, setServerMap } = await import('../lib/server-resolver');

    log.profileService('Fetching server list for multi-server routing', LogLevel.INFO);
    const servers = await getServers();

    if (servers.length === 0) {
      log.profileService('No servers returned, single-server mode', LogLevel.DEBUG);
      return;
    }

    const serverMap = buildServerMap(servers);
    setServerMap(serverMap);

    log.profileService('Multi-server map initialized', LogLevel.INFO, {
      serverCount: servers.length,
      mappedCount: serverMap.size,
    });
  } catch (error) {
    log.profileService('Failed to fetch servers, single-server fallback', LogLevel.WARN, {
      error,
    });
  }
}

/**
 * Bootstrap SSL trust setting before any API calls.
 * If self-signed certs are enabled but no fingerprint is stored (upgrade migration),
 * enables trust-all for HTTP so the cert can be fetched, and signals the UI
 * to show the TOFU dialog via the pending cert trust store.
 */
export async function bootstrapSSLTrust(
  profile: Profile
): Promise<void> {
  try {
    const { useSettingsStore } = await import('../stores/settings');
    const settings = useSettingsStore.getState().getProfileSettings(profile.id);
    const { applySSLTrustSetting, getServerCertFingerprint } = await import('../lib/ssl-trust');

    if (!settings.allowSelfSignedCerts) {
      await applySSLTrustSetting(false);
      return;
    }

    // Enable SSL trust (installs TrustManager for HTTP; WebView handler
    // is only installed when setTrustedFingerprint receives a non-null value)
    await applySSLTrustSetting(true, settings.trustedCertFingerprint);

    // Migration: self-signed certs enabled but no fingerprint stored.
    // Fetch the cert and signal the UI to show the TOFU dialog.
    if (!settings.trustedCertFingerprint && profile.portalUrl) {
      log.profileService('Self-signed certs enabled without fingerprint, triggering TOFU migration', LogLevel.INFO);
      const certInfo = await getServerCertFingerprint(profile.portalUrl);
      if (certInfo) {
        const { requestCertTrust } = await import('../lib/cert-trust-event');
        requestCertTrust(profile.id, certInfo);
      }
    }
  } catch (error) {
    log.profileService('Failed to apply SSL trust setting', LogLevel.WARN, { error });
  }
}

export async function performBootstrap(
  profile: Profile,
  context: BootstrapContext
): Promise<void> {
  const { clearServerMap } = await import('../lib/server-resolver');
  clearServerMap();
  // SSL trust must be configured before any API calls
  await bootstrapSSLTrust(profile);
  await bootstrapAuth(profile, context);
  await bootstrapServerMap();
  await bootstrapTimezone(profile, context);
  await bootstrapZmsPath(profile, context);
  await bootstrapGo2RTCPath(profile, context);
  await bootstrapMultiPortStreaming(profile, context);
}
