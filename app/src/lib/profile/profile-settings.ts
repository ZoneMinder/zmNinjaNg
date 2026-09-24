/**
 * Non-React accessors for a profile's settings.
 *
 * API modules and other services run outside React and cannot use hooks.
 * These helpers used to read profile-scoped settings via useProfileStore and
 * useSettingsStore directly, but api/events.ts (and other api modules
 * downstream of stores/profile.ts) import this file, which formed a static
 * cycle back through stores/profile.ts. A gate is injected instead;
 * stores/profile.ts assembles the real implementation and registers it here
 * at module load. Refs #217.
 *
 * Callers pass the profileId they operate on rather than relying on the
 * current profile: a background poller or assistant tool can fetch
 * events/monitors for a non-current profile, and its exclusion list must
 * match that profile, not whichever one is active in the UI. Refs #337.
 */
import type { ProfileId } from '../../api/types';

export interface ProfileSettingsGate {
  getExcludedMonitorIds(profileId: ProfileId): string[];
}

let gate: ProfileSettingsGate = {
  // Safe default before the store registers: no monitors excluded.
  getExcludedMonitorIds: () => [],
};

export function setProfileSettingsGate(g: ProfileSettingsGate): void {
  gate = g;
}

/**
 * Get the excluded monitor IDs for the given profile.
 *
 * Returns an empty array if the stores are not yet initialized.
 */
export function getExcludedMonitorIds(profileId: ProfileId): string[] {
  try {
    return gate.getExcludedMonitorIds(profileId);
  } catch {
    // Ignore errors accessing the gate (e.g. during initialization)
  }
  return [];
}

/**
 * Get the excluded monitor IDs for the given profile as a Set, for O(1)
 * membership tests when filtering events/counts at the API boundary.
 */
export function getExcludedMonitorIdSet(profileId: ProfileId): Set<string> {
  return new Set(getExcludedMonitorIds(profileId));
}
