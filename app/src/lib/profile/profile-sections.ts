/**
 * Profile Sections
 *
 * Sectioning a list of aggregated items by the profile that owns them, for
 * the surfaces that offer a "group by server" toggle: the Monitors grid, the
 * Montage, and both Events views (refs #501). Every surface renders the same
 * shape - profile name as a heading, that profile's items below it - so the
 * reduce lives here instead of once per page.
 */

import type { ProfileId } from '../../api/types';

/** An item tagged with its owning profile, as the scoped hooks return it:
 *  profileChip carries the profile's display name. */
export interface OwnedByProfile {
  profileId?: ProfileId;
  profileChip?: string;
}

export type ProfileSections<T> = Array<[ProfileId, { profileName: string; items: T[] }]>;

/**
 * Section items by owning profile, in the order each profile is first seen
 * and each profile's items in the order they arrived.
 *
 * Only called in an aggregate, where every item carries a profileId.
 */
export function groupByOwningProfile<T extends OwnedByProfile>(items: T[]): ProfileSections<T> {
  const byProfile = new Map<ProfileId, { profileName: string; items: T[] }>();
  for (const item of items) {
    const key = item.profileId as ProfileId;
    const section = byProfile.get(key);
    if (section) {
      section.items.push(item);
    } else {
      byProfile.set(key, { profileName: item.profileChip ?? '', items: [item] });
    }
  }
  return Array.from(byProfile);
}
