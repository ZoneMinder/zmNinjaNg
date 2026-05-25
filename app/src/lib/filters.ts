/**
 * Monitor Filtering Utilities
 *
 * Helper functions to filter and process monitor lists.
 * Primarily used to exclude deleted or disabled monitors from views,
 * and to filter by monitor groups.
 */

import type { MonitorData, GroupData } from '../api/types';

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
