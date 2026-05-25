/**
 * Non-React accessors for the current profile's settings.
 *
 * API modules and other services run outside React and cannot use hooks.
 * These helpers read profile-scoped settings via the store getState() pattern,
 * matching how lib/log-sanitizer.ts reads disableLogRedaction.
 */

import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';

/**
 * Get the excluded monitor IDs for the current profile.
 *
 * Returns an empty array if there is no current profile or if the stores are
 * not yet initialized.
 */
export function getExcludedMonitorIds(): string[] {
  try {
    const currentProfileId = useProfileStore.getState().currentProfileId;
    if (currentProfileId) {
      return useSettingsStore.getState().getProfileSettings(currentProfileId).excludedMonitorIds;
    }
  } catch {
    // Ignore errors accessing stores (e.g. during initialization)
  }
  return [];
}
