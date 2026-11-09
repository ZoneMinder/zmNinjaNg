/**
 * Server Resolver
 *
 * Maps ZoneMinder ServerId values to constructed URLs for multi-server
 * routing. Each monitor can be assigned to a different server; this
 * module builds the recording, portal, and API URLs for each server
 * so that streams and API calls reach the correct host.
 */

import type { Server } from '../../api/server';
import type { ProfileId } from '../../api/types';
import { log, LogLevel } from '../logger';

// ========== Types ==========

export interface ServerUrls {
  recordingUrl: string;   // Protocol://Hostname:Port/PathToZMS
  portalPath: string;     // Protocol://Hostname:Port/PathToIndex
  apiBaseUrl: string;     // Protocol://Hostname:Port/PathToApi
}

export interface ResolvedMonitorUrls extends ServerUrls {
  isMultiServer: boolean; // true when resolved to a different server
}

export type ServerUrlMap = Map<string, ServerUrls>;

// ========== Module-level cache ==========

/**
 * Per-profile server maps, keyed by the profile whose bootstrap populated
 * them. Was a single module-global map until refs #337: with one shared map,
 * bootstrapping profile B overwrote profile A's routes entirely, so an All
 * mode reader resolving one of A's ServerId monitors got B's host with A's
 * (or no) token attached - a real cross-profile bleed, not just a cosmetic
 * bug.
 */
const serverMapsByProfile = new Map<ProfileId, ServerUrlMap>();
const EMPTY_SERVER_MAP: ServerUrlMap = new Map();
/** Incremented on every setServerMap/clearServerMap so React hooks can react. */
let serverMapVersion = 0;
/** Listeners notified when any profile's server map changes. */
const listeners = new Set<() => void>();

export interface ServerResolverGate {
  getCurrentProfileId(): ProfileId | null;
}

let resolverGate: ServerResolverGate = {
  // Safe default before the store registers: no current profile, so an
  // omitted profileId resolves to nothing rather than guessing.
  getCurrentProfileId: () => null,
};

/** Registered by stores/profile.ts at app init (same gate pattern as
 *  services/sessions.ts) so an omitted profileId can default to "current"
 *  without this module statically importing the profile store. */
export function registerServerResolverGate(gate: ServerResolverGate): void {
  resolverGate = gate;
}

function effectiveProfileId(profileId?: ProfileId | null): ProfileId | null {
  return profileId ?? resolverGate.getCurrentProfileId();
}

export function setServerMap(map: ServerUrlMap, profileId?: ProfileId | null): void {
  const id = effectiveProfileId(profileId);
  if (!id) return;
  serverMapsByProfile.set(id, map);
  serverMapVersion++;
  listeners.forEach((fn) => fn());
}

/** Get one profile's server map (defaults to the current profile). */
export function getServerMap(profileId?: ProfileId | null): ServerUrlMap {
  const id = effectiveProfileId(profileId);
  if (!id) return EMPTY_SERVER_MAP;
  return serverMapsByProfile.get(id) ?? EMPTY_SERVER_MAP;
}

export function getServerMapVersion(): number {
  return serverMapVersion;
}

/** Subscribe to server map changes (any profile). Returns unsubscribe function. */
export function subscribeServerMap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clear one profile's server map (defaults to the current profile). Called
 *  at the start of that profile's own bootstrap, and on dropSession/profile
 *  delete - never clears another profile's map. */
export function clearServerMap(profileId?: ProfileId | null): void {
  const id = effectiveProfileId(profileId);
  if (id) serverMapsByProfile.delete(id);
  serverMapVersion++;
  listeners.forEach((fn) => fn());
}

/** Clear every profile's server map. Used on full logout/reset (test
 *  teardown, dropAllSessions) where no single profile is being targeted. */
export function clearAllServerMaps(): void {
  serverMapsByProfile.clear();
  serverMapVersion++;
  listeners.forEach((fn) => fn());
}

// ========== Functions ==========

// ZoneMinder installs often have a default/placeholder row in the Servers
// table that was never populated: typically Hostname=server.localdomain
// or localhost and Port=0. Treating those rows as valid routes breaks
// monitors whose ServerId points at them, because the resolver then
// overrides the user's working profile URL with the placeholder.
const PLACEHOLDER_HOSTNAMES = new Set(['localhost', 'server.localdomain']);

function isPlaceholderRow(server: Server): boolean {
  if (!server.Hostname) return true;
  const host = server.Hostname.toLowerCase();
  if (PLACEHOLDER_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localdomain')) return true;
  if (server.Port != null && Number(server.Port) <= 0) return true;
  return false;
}

/**
 * Build a map of ServerId to constructed URLs from a list of servers.
 * Rows with missing/placeholder Hostname or non-positive Port are skipped
 * so the resolver falls back to the user's configured profile URLs.
 */
export function buildServerMap(servers: Server[]): ServerUrlMap {
  const map: ServerUrlMap = new Map();

  for (const server of servers) {
    if (isPlaceholderRow(server)) {
      continue;
    }

    const protocol = server.Protocol || 'https';
    const port = server.Port ?? 443;
    const base = `${protocol}://${server.Hostname}:${port}`;

    const urls: ServerUrls = {
      recordingUrl: base + (server.PathToZMS || '/cgi-bin/nph-zms'),
      portalPath: base + (server.PathToIndex || '/index.php'),
      apiBaseUrl: base + (server.PathToApi || '/api'),
    };

    map.set(server.Id, urls);

    log.http(`Mapped server ${server.Name} (${server.Id})`, LogLevel.DEBUG, {
      base,
      recordingUrl: urls.recordingUrl,
      portalPath: urls.portalPath,
      apiBaseUrl: urls.apiBaseUrl,
    });
  }

  return map;
}

export interface ResolveDefaults {
  cgiUrl: string;
  portalUrl: string;
  apiUrl: string;
}

/**
 * Resolve URLs for a monitor based on its ServerId.
 * Falls back to profile defaults when the server is not mapped.
 */
export function resolveMonitorUrls(
  serverId: string | null | undefined,
  serverMap: ServerUrlMap,
  defaults: ResolveDefaults,
): ResolvedMonitorUrls {
  const fallback: ResolvedMonitorUrls = {
    recordingUrl: defaults.cgiUrl,
    portalPath: defaults.portalUrl + '/index.php',
    apiBaseUrl: defaults.apiUrl,
    isMultiServer: false,
  };

  if (!serverId || serverId === '0' || serverMap.size === 0) {
    return fallback;
  }

  const urls = serverMap.get(serverId);
  if (!urls) {
    return fallback;
  }

  return {
    ...urls,
    isMultiServer: true,
  };
}

/**
 * API base URL of a monitor's own server, for endpoints that act on that
 * monitor's shared memory (ZoneMinder runs zmu on whichever host gets the call,
 * and the memory map only exists on the monitor's server). Undefined means use
 * the session's own API URL.
 */
export function getApiUrlForMonitor(
  serverId: string | null | undefined,
  profileId?: ProfileId | null,
): string | undefined {
  if (!serverId || serverId === '0') return undefined;
  return getServerMap(profileId).get(serverId)?.apiBaseUrl;
}

/**
 * Get portal base URL for a monitor's server.
 * Uses profileId's server map (defaults to the current profile). Returns the
 * portal path with /index.php stripped. Falls back to profilePortalUrl when
 * the server is not found.
 */
export function getPortalUrlForMonitor(
  serverId: string | null | undefined,
  profilePortalUrl: string,
  profileId?: ProfileId | null,
): string {
  const map = getServerMap(profileId);
  if (!serverId || serverId === '0' || map.size === 0) {
    return profilePortalUrl;
  }

  const urls = map.get(serverId);
  if (!urls) {
    return profilePortalUrl;
  }

  return urls.portalPath.replace(/\/index\.php$/, '');
}

/**
 * Get portal base URL for an event by looking up its monitor's server.
 */
export function getPortalUrlForEvent(
  monitorId: string,
  monitors: Array<{ Monitor: { Id: string; ServerId: string | null } }>,
  profilePortalUrl: string,
  profileId?: ProfileId | null,
): string {
  const monitor = monitors.find((m) => m.Monitor.Id === monitorId);
  if (!monitor) {
    return profilePortalUrl;
  }

  return getPortalUrlForMonitor(monitor.Monitor.ServerId, profilePortalUrl, profileId);
}
