/**
 * Whether the assistant (Ninjii) can be invoked in the active scope, and which
 * profile carries its configuration.
 *
 * The assistant's settings are server-scoped: Settings renders its Assistant
 * section under the aggregate's profile picker, so enabling it inside a group
 * writes the picked MEMBER's bucket. The entry points used to read
 * `scope.settings.assistantEnabled`, which for an aggregate is the group's own
 * bucket - a bucket nothing ever writes that key into - so Ninjii was
 * unreachable from every virtual profile (refs #337).
 *
 * Resolving over `scope.profiles` covers both modes with no branch: single
 * mode is the one-element scope, so it still reads the current profile's own
 * setting. `profileId` is the first member with the assistant on, falling back
 * to the first member, and is what AskPanel pins to in an aggregate - pinning
 * to a member that has no assistant configuration would open the panel against
 * an unconfigured backend.
 *
 * Off on App Store storefronts where the assistant is not allowed (see
 * useAssistantAllowedHere).
 *
 * Selector discipline (see useProfileScope): the raw settings map is the
 * subscription, and the per-profile merge happens in useMemo. Merging inside
 * the selector would mint objects on every call and loop the render.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileScope } from './useProfileScope';
import { useAssistantAllowedHere } from './useAssistantAllowedHere';
import { useSettingsStore, mergeProfileSettings } from '../stores/settings';
import type { ProfileId } from '../api/types';

export function useAssistantEnabled(): { enabled: boolean; profileId: ProfileId | undefined } {
  const scope = useProfileScope();
  const profileSettings = useSettingsStore(useShallow((state) => state.profileSettings));

  const profiles = scope?.profiles;
  const allowedHere = useAssistantAllowedHere() === true;

  return useMemo(() => {
    const configured = profiles?.find(
      (p) => mergeProfileSettings(profileSettings?.[p.id]).assistantEnabled
    );
    return { enabled: allowedHere && Boolean(configured), profileId: configured?.id ?? profiles?.[0]?.id };
  }, [profiles, profileSettings, allowedHere]);
}
