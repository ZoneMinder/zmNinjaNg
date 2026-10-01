/**
 * Event filter presets (refs #544)
 *
 * A preset is a named copy of the Events filter (`eventsPageFilters`). Both
 * the list and the name of the loaded preset live in the same settings bucket
 * as the filter itself: the current selection, which is the aggregate's own
 * bucket in a profile group.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, type ProfileSettings } from '../stores/settings';

export function useEventFilterPresets(
  loadFilters: (saved: ProfileSettings['eventsPageFilters']) => void,
) {
  const { settings } = useCurrentProfile();
  const currentProfileId = useProfileStore((state) => state.currentProfileId);

  const update = useCallback((patch: Partial<ProfileSettings>) => {
    if (currentProfileId) useSettingsStore.getState().updateProfileSettings(currentProfileId, patch);
  }, [currentProfileId]);

  // Read at call time: a filter change and a save can land in one handler.
  const current = useCallback(
    () => (currentProfileId ? useSettingsStore.getState().getProfileSettings(currentProfileId) : undefined),
    [currentProfileId],
  );

  /** Saves the current filter under `name`, replacing a preset of that name. */
  const save = useCallback((name: string) => {
    const now = current();
    if (!now) return;
    const preset = { name, filters: now.eventsPageFilters };
    const index = now.eventFilterPresets.findIndex((p) => p.name === name);
    const eventFilterPresets = index === -1
      ? [...now.eventFilterPresets, preset]
      : now.eventFilterPresets.map((p, i) => (i === index ? preset : p));
    update({ eventFilterPresets, activeEventFilterPreset: name });
  }, [current, update]);

  const load = useCallback((name: string) => {
    const preset = current()?.eventFilterPresets.find((p) => p.name === name);
    if (!preset) return;
    loadFilters(preset.filters);
    update({ activeEventFilterPreset: name });
  }, [current, loadFilters, update]);

  /** Deletes the loaded preset. */
  const remove = useCallback(() => {
    const now = current();
    if (!now) return;
    update({
      eventFilterPresets: now.eventFilterPresets.filter((p) => p.name !== now.activeEventFilterPreset),
      activeEventFilterPreset: '',
    });
  }, [current, update]);

  const clearActive = useCallback(() => update({ activeEventFilterPreset: '' }), [update]);

  return {
    names: settings.eventFilterPresets.map((p) => p.name),
    activeName: settings.activeEventFilterPreset,
    save,
    load,
    remove,
    clearActive,
  };
}
