/**
 * Monitor Filtering Utilities
 *
 * Helper functions to filter and process monitor lists.
 * Primarily used to exclude deleted or disabled monitors from views,
 * and to filter by monitor groups.
 */

import type { MonitorData, GroupData, ProfileId } from '../../api/types';

/**
 * Filter monitors to only show non-deleted ones.
 * 
 * @param monitors - List of monitor data objects
 * @returns Filtered list of active monitors
 */
export function filterEnabledMonitors(monitors: MonitorData[]): MonitorData[] {
  return monitors.filter(
    ({ Monitor }) => Monitor.Deleted !== true
  );
}

/**
 * Filter out monitors whose Id is in the excluded list.
 *
 * @param monitors - List of monitor data objects
 * @param excludedIds - Monitor IDs marked as excluded for the current profile
 * @returns Filtered list with excluded monitors removed
 */
export function filterExcludedMonitors(
  monitors: MonitorData[],
  excludedIds: string[]
): MonitorData[] {
  if (excludedIds.length === 0) {
    return monitors;
  }
  const idSet = new Set(excludedIds);
  return monitors.filter(({ Monitor }) => !idSet.has(Monitor.Id));
}

/**
 * Get IDs of enabled monitors.
 * 
 * @param monitors - List of monitor data objects
 * @returns Array of monitor IDs
 */
export function getEnabledMonitorIds(monitors: MonitorData[]): string[] {
  return filterEnabledMonitors(monitors).map(({ Monitor }) => Monitor.Id);
}

/**
 * Check if a specific monitor ID corresponds to an enabled (non-deleted) monitor.
 * 
 * @param monitorId - The ID to check
 * @param monitors - The full list of monitors to check against
 * @returns True if the monitor exists and is not deleted
 */
export function isMonitorEnabled(monitorId: string, monitors: MonitorData[]): boolean {
  const monitor = monitors.find(({ Monitor }) => Monitor.Id === monitorId);
  return monitor ? monitor.Monitor.Deleted !== true : false;
}

/**
 * Filter monitors by group membership.
 *
 * @param monitors - List of monitor data objects
 * @param groupMonitorIds - Array of monitor IDs that belong to the selected group
 * @returns Filtered list of monitors in the group
 */
export function filterMonitorsByGroup(
  monitors: MonitorData[],
  groupMonitorIds: string[]
): MonitorData[] {
  if (groupMonitorIds.length === 0) {
    return monitors;
  }
  const idSet = new Set(groupMonitorIds);
  return monitors.filter(({ Monitor }) => idSet.has(Monitor.Id));
}

/**
 * Build the ZM "MonitorId" query value covering only the non-excluded monitors.
 *
 * Excluded monitors are normally dropped after fetching, but that leaves the
 * server's totalCount (and "Load More") counting events the user cannot see
 * (refs #205). When monitors are excluded, the events query sends the included
 * IDs instead so the count matches what is shown.
 *
 * Returns undefined to mean "no monitor filter, fetch all" when nothing is
 * excluded, when the monitor list has not loaded yet, or in the degenerate case
 * where every monitor is excluded (the post-fetch drop still empties the list).
 *
 * @param monitors - Full monitor list for the profile
 * @param excludedIds - Monitor IDs excluded for the current profile
 * @returns Comma-separated included IDs, or undefined
 */
export function includedMonitorIdParam(
  monitors: MonitorData[],
  excludedIds: string[]
): string | undefined {
  if (excludedIds.length === 0 || monitors.length === 0) {
    return undefined;
  }
  const excluded = new Set(excludedIds);
  const included = monitors
    .map(({ Monitor }) => Monitor.Id)
    .filter(id => !excluded.has(id));
  return included.length > 0 ? included.join(',') : undefined;
}

/**
 * Represents a group with its hierarchy level for display.
 */
export interface GroupHierarchyItem {
  group: GroupData;
  level: number;
  monitorCount: number;
}

/**
 * Build a flat list of groups with hierarchy levels for display.
 * Groups are sorted with parents before children, and children indented.
 *
 * @param groups - List of group data objects
 * @returns Flat list with hierarchy level for each group
 */
export function buildGroupHierarchy(groups: GroupData[]): GroupHierarchyItem[] {
  const result: GroupHierarchyItem[] = [];

  // Find root groups (no parent)
  const rootGroups = groups.filter((g) => !g.Group.ParentId);

  // Recursively add groups with their level
  function addGroupWithChildren(group: GroupData, level: number) {
    result.push({
      group,
      level,
      monitorCount: group.Monitor.length,
    });

    // Find and add children
    const children = groups.filter((g) => g.Group.ParentId === group.Group.Id);
    for (const child of children) {
      addGroupWithChildren(child, level + 1);
    }
  }

  // Sort root groups by name and process
  rootGroups
    .sort((a, b) => a.Group.Name.localeCompare(b.Group.Name))
    .forEach((root) => addGroupWithChildren(root, 0));

  return result;
}

/**
 * How many monitors each profile contributed, before any filter narrows the
 * view. Both the Monitors page and the montage decide whether to show a
 * profile's error strip from this: a profile whose tiles were all filtered
 * away still "has data" and needs no strip.
 */
export function countMonitorsByProfile<T>(
  scoped: Array<{ profileId: ProfileId; item: T }>,
): Map<ProfileId, number> {
  const counts = new Map<ProfileId, number>();
  for (const s of scoped) counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1);
  return counts;
}

/** How the monitor list is ordered after it arrives (refs #527). */
export type MonitorSortOrder = 'unsorted' | 'id' | 'name';

/**
 * Order a monitor list for display.
 *
 * "unsorted" is server order: ZoneMinder's Sequence, compared numerically,
 * because the API does not promise to return monitors in it. Monitors with no
 * usable Sequence follow, in the order they arrived (sort is stable). Ids sort
 * numerically, so monitor 10 follows monitor 2 instead of preceding it as a
 * string compare would have it, and names sort the way the user's locale does,
 * ignoring case.
 *
 * Applied once at the API boundary, so every view of the list agrees.
 */
export function sortMonitors(monitors: MonitorData[], order: MonitorSortOrder): MonitorData[] {
  const sorted = [...monitors];
  if (order === 'unsorted') {
    // Sequence is coerced to a string, so a missing field arrives as "undefined".
    const seq = (m: MonitorData) => {
      const n = m.Monitor.Sequence == null || m.Monitor.Sequence === '' ? NaN : Number(m.Monitor.Sequence);
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    sorted.sort((a, b) => seq(a) - seq(b));
  } else if (order === 'id') {
    sorted.sort((a, b) => Number(a.Monitor.Id) - Number(b.Monitor.Id));
  } else {
    sorted.sort((a, b) =>
      (a.Monitor.Name ?? '').localeCompare(b.Monitor.Name ?? '', undefined, { sensitivity: 'base' }),
    );
  }
  return sorted;
}
