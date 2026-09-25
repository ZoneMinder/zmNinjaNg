/**
 * useGroupByServerScope
 *
 * The active aggregate's id while one of its group-by-server settings is on,
 * else undefined: the `scopeId` a surface hands ProfileSectionList, and the
 * signal to section at all. The setting is read from the aggregate's own
 * bucket, where GroupByServerToggle writes it (refs #501, #529).
 */

import { useCurrentProfile } from './useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import type { ProfileId } from '../api/types';

export function useGroupByServerScope(
  setting: 'monitorsGroupByServer' | 'eventsGroupByServer'
): ProfileId | undefined {
  const { settings, isAllMode } = useCurrentProfile();
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  return isAllMode && settings[setting] ? currentProfileId ?? undefined : undefined;
}
