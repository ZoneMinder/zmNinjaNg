/**
 * Pruning references to monitors ZoneMinder no longer has.
 *
 * Monitor ids are persisted in several places: the per-profile hidden list,
 * each montage group's hidden list and working layout, and dashboard widget
 * settings. Deleting a monitor in ZoneMinder removes it from the API but not
 * from any of those, so it lingers as a ghost: counted as hidden while absent
 * from the list that would let you un-hide it (refs #324), or listed as
 * "Monitor 12" in a widget's display order (refs #323).
 *
 * These functions are pure and report "nothing to do" rather than returning a
 * fresh copy, so a caller can write only when something actually changed.
 * Deciding *when* it is safe to prune belongs to the caller: an incomplete
 * monitor list would read as "everything was deleted" and take the user's
 * configuration with it.
 */

import type { Layout } from 'react-grid-layout';
import type { MontageGroupLayout, ProfileSettings } from '../../stores/settings';
import type { DashboardWidget } from '../../stores/dashboard';
import type { ProfileId } from '../../api/types';
import { widgetMonitorRefs, withMonitorRefs } from './widget-monitor-refs';

/** Decides whether one stored id still refers to a monitor that exists. */
type IdSurvives = (id: string) => boolean;

/** Same array back when every id survives, so callers can compare by identity. */
function keepKnown(ids: string[], survives: IdSurvives): string[] {
  const kept = ids.filter(survives);
  return kept.length === ids.length ? ids : kept;
}

function keepKnownLayout(layout: Layout[], survives: IdSurvives): Layout[] {
  const kept = layout.filter((item) => survives(item.i));
  return kept.length === layout.length ? layout : kept;
}

function pruneGroup(bucket: MontageGroupLayout, survives: IdSurvives): MontageGroupLayout | null {
  const hiddenMonitorIds = keepKnown(bucket.hiddenMonitorIds, survives);
  const workingLayout = keepKnownLayout(bucket.workingLayout, survives);
  if (hiddenMonitorIds === bucket.hiddenMonitorIds && workingLayout === bucket.workingLayout) {
    return null;
  }
  // savedLayouts stays as it is. Those are named arrangements the user made
  // and may reload later; an entry for a monitor that is gone renders nothing
  // and costs nothing, which is a better trade than editing saved work.
  return { ...bucket, hiddenMonitorIds, workingLayout };
}

/**
 * Build the settings patch that removes every reference to a monitor outside
 * `known`, or null when the settings hold no stale ids.
 */
export function pruneProfileSettingsMonitorIds(
  settings: Pick<Partial<ProfileSettings>, 'excludedMonitorIds' | 'montageByGroup'>,
  known: Set<string>
): Partial<ProfileSettings> | null {
  const survives: IdSurvives = (id) => known.has(id);
  const patch: Partial<ProfileSettings> = {};

  const excluded = settings.excludedMonitorIds ?? [];
  const keptExcluded = keepKnown(excluded, survives);
  if (keptExcluded !== excluded) patch.excludedMonitorIds = keptExcluded;

  const prunedGroups = pruneMontageGroups(settings.montageByGroup, survives);
  if (prunedGroups) patch.montageByGroup = prunedGroups;

  return Object.keys(patch).length > 0 ? patch : null;
}

function pruneMontageGroups(
  byGroup: ProfileSettings['montageByGroup'] | undefined,
  survives: IdSurvives
): Record<string, MontageGroupLayout> | null {
  if (!byGroup) return null;
  let changed = false;
  const next: Record<string, MontageGroupLayout> = {};
  for (const [groupKey, bucket] of Object.entries(byGroup)) {
    const pruned = pruneGroup(bucket, survives);
    next[groupKey] = pruned ?? bucket;
    if (pruned) changed = true;
  }
  return changed ? next : null;
}

/**
 * Build the patch that removes one profile's deleted monitors from the All
 * Servers montage bucket, whose ids are the composite `profileId:monitorId`
 * tile ids `tileIdFor` mints.
 *
 * Only ids that carry `profileId` are judged. Every other server's ids pass
 * through untouched, because the caller holds exactly one server's monitor
 * list: judging an id against a list that was never about that server is the
 * same "an incomplete list reads as everything was deleted" mistake the
 * module comment warns about, one profile at a time. Bare ids pass through
 * too - a bucket written before All mode existed holds those, and they belong
 * to whichever profile was current then, which is not recoverable here.
 *
 * Nothing prunes the All bucket wholesale, so a profile that is disabled or
 * has never been visited keeps its entries until it is fetched again.
 */
export function pruneAllBucketMonitorIds(
  settings: Pick<Partial<ProfileSettings>, 'montageByGroup'>,
  profileId: string,
  known: Set<string>
): Partial<ProfileSettings> | null {
  const prefix = `${profileId}:`;
  const survives: IdSurvives = (id) =>
    !id.startsWith(prefix) || known.has(id.slice(prefix.length));

  const prunedGroups = pruneMontageGroups(settings.montageByGroup, survives);
  return prunedGroups ? { montageByGroup: prunedGroups } : null;
}

/** A widget id with the settings it should be updated to. */
export interface WidgetSettingsUpdate {
  id: string;
  settings: DashboardWidget['settings'];
}

/**
 * Build the widget updates that remove every reference to a monitor outside
 * `known`. Widgets left with no monitor are kept, not deleted: an empty widget
 * is recoverable, a deleted one is not.
 */
export function pruneWidgetMonitorIds(
  widgets: DashboardWidget[],
  known: Set<string>
): WidgetSettingsUpdate[] {
  const updates: WidgetSettingsUpdate[] = [];

  for (const widget of widgets) {
    const { monitorIds, monitorId } = widget.settings;
    const keptIds = monitorIds ? keepKnown(monitorIds, (id) => known.has(id)) : undefined;
    const idIsStale = monitorId !== undefined && !known.has(monitorId);
    if (keptIds === monitorIds && !idIsStale) continue;

    const settings = { ...widget.settings };
    if (keptIds) settings.monitorIds = keptIds;
    if (idIsStale) delete settings.monitorId;
    updates.push({ id: widget.id, settings });
  }

  return updates;
}

/**
 * Build the updates that remove one profile's deleted monitors from an
 * aggregate dashboard's widgets, whose picks carry their owning profile
 * (refs #529). As with the montage bucket, only picks owned by `profileId`
 * are judged. A legacy widget converts through `widgetMonitorRefs` and is
 * written back in the new shape; one with no stored profile has no owner to
 * judge against and is left alone.
 */
export function pruneAggregateWidgetMonitorRefs(
  widgets: DashboardWidget[],
  profileId: ProfileId,
  known: Set<string>
): WidgetSettingsUpdate[] {
  const updates: WidgetSettingsUpdate[] = [];
  for (const widget of widgets) {
    const refs = widgetMonitorRefs(widget.settings);
    const kept = refs.filter((ref) => ref.profileId !== profileId || known.has(ref.monitorId));
    if (kept.length === refs.length) continue;
    updates.push({ id: widget.id, settings: withMonitorRefs(widget.settings, kept) });
  }
  return updates;
}
