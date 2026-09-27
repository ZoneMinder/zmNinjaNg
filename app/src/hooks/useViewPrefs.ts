/**
 * useViewPrefs / usePageViewMode
 *
 * Resolves the view-level preferences a rendered stream must honor.
 *
 * Preferences are two-tier (refs #337): every aggregate - All Servers or a
 * named group - keeps its own settings bucket, separate from every individual
 * profile's and from every other aggregate's. Page-level controls get that for
 * free: they read `useCurrentProfile().settings`, which already resolves to
 * the active aggregate's bucket through the current profile id.
 * The stream path does not: a montage tile owned by profile B resolves its
 * URLs, ports and token against profile B, so reading its view preferences
 * from the same place would leave the All Servers settings governing nothing.
 *
 * So the owning profile answers "where does this stream come from" and these
 * hooks answer "which settings is the user actually looking at". In single
 * mode they are the same profile and behavior is unchanged.
 *
 * Streaming Mode is a TRI-state while aggregating, because two states cannot
 * say "leave each server alone". It lives in its own aggregate-bucket setting,
 * `allModeViewMode`, whose 'per-server' default sends each tile back to its
 * owning profile - so entering an aggregate never changes how anything streams
 * until the user asks. Reusing `viewMode` in the aggregate bucket and treating
 * "unset" as per-server does not work: the first write of any key to a bucket
 * materializes the whole defaults shape, so unset is not a state that bucket
 * can stay in. Analysis frames stay two-state: off is a coherent default.
 *
 * Only preferences that describe the view belong here. Connection-level
 * settings (timeouts, multi-port) stay with the owning profile, since they
 * describe that server rather than what the user is looking at. Bandwidth
 * mode follows the current selection (stores/settings-scope.ts).
 */

import { useProfileById } from './useCurrentProfile';
import { useProfileScope } from './useProfileScope';
import { useProfileStore } from '../stores/profile';

import { isAggregateProfileId } from '../api/types';
import type { ProfileId } from '../api/types';
import { useSettingsStore } from '../stores/settings';
import type { ProfileSettings, ViewMode } from '../stores/settings';

export type ViewPrefs = Pick<ProfileSettings, 'viewMode' | 'showAnalysisFrames'>;

/**
 * View preferences for one rendered monitor.
 *
 * @param owningProfileId - Profile that owns the monitor being rendered.
 *   Defaults to the current profile.
 */
export function useViewPrefs(owningProfileId?: ProfileId | null): ViewPrefs {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const isAllMode = isAggregateProfileId(currentProfileId);

  const { settings: owningSettings } = useProfileById(owningProfileId);
  // The active aggregate's own bucket. Defaulting to the current profile id is
  // the whole resolution: every aggregate's bucket lives under its own id, so
  // this is the ALL bucket under the sentinel and the group's bucket under a
  // group. Read unconditionally to keep the hook order fixed; unused in
  // single mode, where the owning profile answers everything.
  const aggregateSettings = useProfileById().settings;

  if (!isAllMode) {
    return {
      viewMode: owningSettings.viewMode,
      showAnalysisFrames: owningSettings.showAnalysisFrames,
    };
  }

  const imposed = aggregateSettings.allModeViewMode;
  return {
    viewMode: imposed === 'per-server' ? owningSettings.viewMode : imposed,
    showAnalysisFrames: aggregateSettings.showAnalysisFrames,
  };
}

/**
 * The Streaming Mode a page-level control should describe, where there is no
 * single owning monitor to ask.
 *
 * In All mode under "Per server" the answer differs per tile, so this reports
 * streaming when ANY server in scope streams: a control that would still
 * affect some tiles has to stay live. It reads each profile's merged settings
 * through the store's own getter, so the defaults stay in one place.
 */
export function usePageViewMode(): ViewMode {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const isAllMode = isAggregateProfileId(currentProfileId);

  const scope = useProfileScope();
  // The current profile's bucket in single mode, the active aggregate's own
  // bucket while aggregating - the same id keys both.
  const { settings } = useProfileById();
  // Returns a boolean, so no fresh object reaches the subscription.
  const anyServerStreams = useSettingsStore((state) =>
    (scope?.profiles ?? []).some(
      (profile) => state.getProfileSettings(profile.id).viewMode === 'streaming'
    )
  );

  if (!isAllMode) return settings.viewMode;
  const imposed = settings.allModeViewMode;
  if (imposed !== 'per-server') return imposed;
  return anyServerStreams ? 'streaming' : 'snapshot';
}
