/**
 * Per-profile session registry.
 *
 * A ServerSession bundles the pieces every request against one profile's
 * server needs: its API client and its timezone. Building for the current
 * profile only (today's single-profile model), this behaves identically to
 * the existing singleton apiClient; later tasks (All Profiles) build
 * sessions for non-current profiles too, and Task 6 upgrades
 * createStoreApiClient's gates to be per-profile.
 *
 * This module cannot import the profile store directly: stores/profile.ts
 * (and api modules it pulls in) would form a static import cycle back here.
 * A gate is injected instead; stores/profile.ts assembles the real
 * implementation and registers it at module load, next to its existing
 * setProfileSettingsGate registration. Refs #337.
 */

import { ALL_PROFILES_ID, PROBE_PROFILE_ID, isAggregateProfileId, type Profile, type ProfileId } from '../api/types';
import type { ApiClient } from '../api/client';
import { createStoreApiClient, resetAuthGates } from '../api/store-gates';
import { markSessionActive, markSessionInactive, markAllSessionsInactive } from './session-flags';
import { clearServerMap, clearAllServerMaps, getServerMap, setServerMap, buildServerMap } from '../lib/zm/server-resolver';
import { getServers } from '../api/server';
import { log, LogLevel } from '../lib/logger';

// Re-exported so consumers of the session registry (this module's real
// surface) don't need a separate import of the sentinel from api/types.ts
// just to compare a ProfileId against it.
export { ALL_PROFILES_ID };

export interface ServerSession {
  profileId: ProfileId;
  client: ApiClient;
  timezone: string;
}

export interface SessionsGate {
  getProfile(id: ProfileId): Profile | undefined;
  getCurrentProfileId(): ProfileId | null;
  reLoginFor(id: ProfileId): () => Promise<boolean>;
}

let gate: SessionsGate = {
  // Safe defaults before the store registers: no profiles, no current profile.
  getProfile: () => undefined,
  getCurrentProfileId: () => null,
  reLoginFor: () => async () => false,
};

export function registerSessionsGate(g: SessionsGate): void {
  gate = g;
}

const sessions = new Map<ProfileId, ServerSession>();

/** Profiles with a server-map populate currently in flight, so a burst of
 *  getSession calls for the same freshly-created session doesn't fire the
 *  fetch more than once. */
const serverMapFetchesInFlight = new Set<ProfileId>();

/**
 * Fire-and-forget population of a profile's multi-server map right after its
 * session is created. Without this, sessions built for a non-current profile
 * (All mode) never go through the login-time bootstrapServerMap flow, so
 * that profile's map stays empty forever and its multi-server
 * thumbnails/streams silently fall back to (usually wrong) single-server
 * URLs. Only fires when the map is still empty and no fetch for this
 * profile is already running; errors are swallowed - the empty-map fallback
 * already handles that case (refs #337 I3).
 */
function bootstrapServerMapFor(session: ServerSession, profileApiUrl: string): void {
  const { profileId, client } = session;
  if (getServerMap(profileId).size > 0 || serverMapFetchesInFlight.has(profileId)) return;
  serverMapFetchesInFlight.add(profileId);
  getServers(client)
    .then((servers) => setServerMap(buildServerMap(servers, profileApiUrl), profileId))
    .catch((error) => {
      log.profileService('Failed to bootstrap server map for session', LogLevel.WARN, { profileId, error });
    })
    .finally(() => serverMapFetchesInFlight.delete(profileId));
}

/**
 * Get (lazily building and caching) the session for a profile.
 *
 * An aggregate id (the ALL_PROFILES_ID sentinel or a virtual profile) names a
 * set of servers rather than one, and PROBE_PROFILE_ID is the anonymous
 * pre-profile discovery id - none is ever a real server, so none has a
 * session (probe flows build their own client directly via
 * createStoreApiClient instead). An id with no matching profile is also
 * rejected rather than silently building a broken client.
 */
export function getSession(profileId: ProfileId): ServerSession {
  if (isAggregateProfileId(profileId)) {
    throw new Error(`getSession: aggregate profile ${profileId} has no session`);
  }
  if (profileId === PROBE_PROFILE_ID) {
    throw new Error('getSession: PROBE_PROFILE_ID has no session');
  }

  const cached = sessions.get(profileId);
  if (cached) return cached;

  const profile = gate.getProfile(profileId);
  if (!profile) {
    throw new Error(`getSession: unknown profile ${profileId}`);
  }

  const session: ServerSession = {
    profileId,
    client: createStoreApiClient(profile.apiUrl, gate.reLoginFor(profileId), profileId),
    timezone: profile.timezone ?? 'UTC',
  };
  sessions.set(profileId, session);
  markSessionActive(profileId);
  log.profileService('Session created', LogLevel.DEBUG, { profileId });
  bootstrapServerMapFor(session, profile.apiUrl);
  return session;
}

/** Get the session for the current profile. Throws if there is none. */
export function getCurrentSession(): ServerSession {
  const currentProfileId = gate.getCurrentProfileId();
  if (!currentProfileId) {
    throw new Error('getCurrentSession: no current profile');
  }
  return getSession(currentProfileId);
}

/**
 * Get the session for the current profile, or null instead of throwing.
 *
 * For UI-layer code that can render while an aggregate is active (the current
 * id is the ALL_PROFILES_ID sentinel or a virtual profile, so there is no
 * single "current" session) - e.g. a detail page reached without an
 * owning-profile route param. Never throws: getCurrentSession stays the
 * throwing form for non-UI callers that can assume a real current profile.
 */
export function tryGetCurrentSession(): ServerSession | null {
  const currentProfileId = gate.getCurrentProfileId();
  if (!currentProfileId || isAggregateProfileId(currentProfileId) || currentProfileId === PROBE_PROFILE_ID) {
    return null;
  }
  try {
    return getSession(currentProfileId);
  } catch {
    return null;
  }
}

export function hasSession(profileId: ProfileId): boolean {
  return sessions.has(profileId);
}

/**
 * Evict a profile's cached session so the next getSession rebuilds it. Must
 * be called whenever a profile's apiUrl or credentials change (wired in
 * Task 8's updateProfile). Also clears the profile's pending auth
 * single-flight gates (login/refresh/recovery) so a stale in-flight
 * operation for the dropped session's client never resolves into the next
 * one built for this profile.
 */
export function dropSession(profileId: ProfileId): void {
  sessions.delete(profileId);
  markSessionInactive(profileId);
  resetAuthGates(profileId);
  clearServerMap(profileId);
  log.profileService('Session dropped', LogLevel.DEBUG, { profileId });
}

export function dropAllSessions(): void {
  sessions.clear();
  markAllSessionsInactive();
  resetAuthGates();
  clearAllServerMaps();
}
