/**
 * Profile Bootstrap Helpers
 *
 * Shared bootstrap logic used by both switchProfile and onRehydrateStorage
 * to avoid code duplication.
 */

import type { Profile } from '../api/types';
import { getServerTimeZone } from '../api/time';
import { fetchGo2RTCPath, fetchZmsPath, getVersion } from '../api/auth';
import { getSession } from './sessions';
import { log, LogLevel } from '../lib/logger';
import { Platform } from '../lib/platform';

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
    useAuthStore.getState().setTokens(profile.id, {});
    // Login is where the server version normally arrives, and this path never
    // logs in. Without it every version-gated branch (the frames=1 snapshot
    // shape for on-demand monitors, run-state detection, the Server page)
    // took its legacy arm on public servers (refs #461). setTokens with no
    // tokens keeps the no-auth state and merges the version in.
    try {
      const { version, apiversion } = await getVersion(getSession(profile.id).client);
      useAuthStore.getState().setTokens(profile.id, { version, apiversion });
      log.profileService('Server version fetched for public server', LogLevel.INFO, { version });
    } catch (versionError) {
      log.profileService('Failed to fetch server version for public server', LogLevel.WARN, {
        error: versionError,
      });
    }
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
    await useAuthStore.getState().login(profile.id, profile.username, decryptedPassword);
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
    const { getAuthSlice } = await import('../stores/auth');
    const { accessToken } = getAuthSlice(profile.id);
    const timezone = await getServerTimeZone(getSession(profile.id).client, accessToken || undefined);

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
    const zmsPath = await fetchZmsPath(getSession(profile.id).client);

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
    const go2rtcPath = await fetchGo2RTCPath(getSession(profile.id).client);

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
): Promise<number | null> {
  try {
    log.profileService('Fetching server configuration for multi-port streaming', LogLevel.INFO);
    const { fetchMinStreamingPort } = await import('../api/server');
    const minPort = await fetchMinStreamingPort(getSession(profile.id).client);

    if (minPort === null) {
      log.profileService('Multi-port streaming not configured on server', LogLevel.DEBUG);
      return null;
    }

    // Multi-port is published by the server; the per-profile
    // forceDisableMultiPort setting is a client-side override applied later
    // when building stream URLs (resolveMinStreamingPort). Reflect that override
    // here so the log matches what streams actually use.
    const { useSettingsStore } = await import('../stores/settings');
    const settingsStore = useSettingsStore.getState();
    const forceDisabled = settingsStore.profileSettings[profile.id]?.forceDisableMultiPort === true;
    if (forceDisabled) {
      log.profileService(
        'Multi-port streaming available on server, force-disabled by profile setting',
        LogLevel.INFO,
        { minPort },
      );
    } else {
      log.profileService('Multi-port streaming enabled', LogLevel.INFO, { minPort });
    }

    // Update profile with minStreamingPort if changed
    if (profile.minStreamingPort !== minPort) {
      await context.updateProfile(profile.id, { minStreamingPort: minPort });
    }

    return minPort;
  } catch (configError) {
    log.profileService(
      'Failed to fetch MIN_STREAMING_PORT - multi-port may be unavailable',
      LogLevel.WARN,
      { error: configError }
    );
    return null;
  }
}

/**
 * Pick the Streaming Mode a new profile starts in.
 *
 * Decided only while the profile's viewModeChosen flag is unset. Neither the
 * bucket nor viewMode itself is the signal: lastRoute, theme, or the
 * self-signed certificate flag can land in the bucket before the first
 * bootstrap ever runs, and every write copies DEFAULT_SETTINGS.viewMode in
 * with it. An earlier version gated on the bucket and so never fired for the
 * first profile or for self-signed ones. Once chosen, the mode belongs to the
 * user, whether they set it or an earlier bootstrap did.
 *
 * When the monitor count cannot be fetched and multi-port is off there is
 * nothing to decide from, so nothing is written: the merge default applies
 * for now and the next bootstrap tries again. The recommendation itself
 * lives in lib/monitor/view-mode-recommendation.ts, which Settings also shows
 * as a hint.
 *
 * @param minStreamingPort The multi-port base bootstrapMultiPortStreaming just
 *   fetched, since the passed profile still carries the pre-update value.
 */
export async function bootstrapViewMode(
  profile: Profile,
  minStreamingPort: number | null,
): Promise<void> {
  try {
    const { useSettingsStore } = await import('../stores/settings');
    const settingsStore = useSettingsStore.getState();
    const bucket = settingsStore.profileSettings[profile.id];

    if (bucket?.viewModeChosen) {
      log.profileService('Existing profile: preserving current viewMode setting', LogLevel.DEBUG);
      return;
    }

    let monitorCount: number | null = null;
    try {
      const { getMonitors } = await import('../api/monitors');
      const { monitors } = await getMonitors(getSession(profile.id).client, profile.id);
      monitorCount = monitors.length;
    } catch (monitorError) {
      log.profileService('Failed to count monitors for Streaming Mode default', LogLevel.WARN, {
        error: monitorError,
      });
    }

    const { resolveMinStreamingPort } = await import('../lib/monitor/multiport');
    const effectivePort = resolveMinStreamingPort(minStreamingPort, bucket?.forceDisableMultiPort);

    const hostLiftsLimit = Platform.isNative || Platform.isElectron;
    if (monitorCount === null && effectivePort === undefined && !hostLiftsLimit) {
      log.profileService('Streaming Mode left undecided until the monitor count is known', LogLevel.INFO);
      return;
    }

    const { recommendViewMode } = await import('../lib/monitor/view-mode-recommendation');
    const { mode, reason } = recommendViewMode(monitorCount, effectivePort, hostLiftsLimit);

    log.profileService('New profile: choosing Streaming Mode', LogLevel.INFO, {
      mode,
      reason,
      monitorCount,
      minStreamingPort: effectivePort ?? null,
    });
    settingsStore.updateProfileSettings(profile.id, { viewMode: mode, viewModeChosen: true });
  } catch (settingsError) {
    log.profileService('Failed to configure view mode', LogLevel.WARN, {
      error: settingsError,
    });
  }
}

/**
 * Bootstrap multi-server map from /servers.json
 */
export async function bootstrapServerMap(profile: Profile): Promise<void> {
  try {
    const { getServers } = await import('../api/server');
    const { buildServerMap, setServerMap } = await import('../lib/zm/server-resolver');

    log.profileService('Fetching server list for multi-server routing', LogLevel.INFO);
    const servers = await getServers(getSession(profile.id).client);

    if (servers.length === 0) {
      log.profileService('No servers returned, single-server mode', LogLevel.DEBUG);
      return;
    }

    const serverMap = buildServerMap(servers);
    setServerMap(serverMap, profile.id);

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
    const { applyTrustedCertificates, getServerCertFingerprint } = await import('../lib/security/ssl-trust');

    log.sslTrust(
      `Profile "${profile.name}" allowSelfSignedCerts=${settings.allowSelfSignedCerts}; setting SSL trust override to ${settings.allowSelfSignedCerts}`,
      settings.allowSelfSignedCerts ? LogLevel.INFO : LogLevel.DEBUG,
    );

    if (!settings.allowSelfSignedCerts) {
      await applyTrustedCertificates();
      return;
    }

    // Enable SSL trust (installs TrustManager for HTTP; WebView handler
    // is only installed when a fingerprint has been pinned for this host)
    await applyTrustedCertificates();

    // Migration: self-signed certs enabled but no fingerprint stored.
    // Fetch the cert and signal the UI to show the TOFU dialog.
    if (!settings.trustedCertFingerprint && profile.portalUrl) {
      log.profileService('Self-signed certs enabled without fingerprint, triggering TOFU migration', LogLevel.INFO);
      const certInfo = await getServerCertFingerprint(profile.portalUrl);
      if (certInfo) {
        const { requestCertTrust } = await import('../lib/security/cert-trust-event');
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
  const { clearServerMap } = await import('../lib/zm/server-resolver');
  // Clears only THIS profile's entry - refs #337. Clearing the whole map
  // here (the old behavior) wiped every other profile's routes on every
  // single bootstrap, which is exactly the cross-profile bleed this fix
  // removes: bootstrapping B would erase A's map moments before an All mode
  // reader resolved one of A's ServerId monitors.
  clearServerMap(profile.id);
  // SSL trust must be configured before any API calls
  await bootstrapSSLTrust(profile);
  await bootstrapAuth(profile, context);
  await bootstrapServerMap(profile);
  await bootstrapTimezone(profile, context);
  await bootstrapZmsPath(profile, context);
  await bootstrapGo2RTCPath(profile, context);
  const minStreamingPort = await bootstrapMultiPortStreaming(profile, context);
  await bootstrapViewMode(profile, minStreamingPort);
}
