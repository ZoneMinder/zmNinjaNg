/**
 * An aggregate dashboard widget's monitor picks, each with its owning
 * profile (refs #529).
 *
 * A widget saved before this change pinned itself to one server with
 * `settings.profileId` plus bare `monitorIds` (or a lone `monitorId`). Those
 * convert here at read time, so the layout, the edit dialog and pruning all
 * see the same picks; the dialogs write the new shape back on save.
 */

import type { ProfileId } from '../../api/types';
import type { DashboardWidget, MonitorRef } from '../../stores/dashboard';

type WidgetSettings = DashboardWidget['settings'];

// Keyed by the persisted settings object, so a legacy widget converts to the
// same array on every render and memoized widgets do not re-render for it.
const converted = new WeakMap<WidgetSettings, { fallback?: ProfileId; refs: MonitorRef[] }>();

/**
 * The widget's picks. A legacy widget with no stored profile is pinned to
 * `fallbackProfileId`, the first profile in scope, which is the server its
 * monitors were rendered from and listed in the edit dialog before.
 */
export function widgetMonitorRefs(settings: WidgetSettings, fallbackProfileId?: ProfileId): MonitorRef[] {
  if (settings.monitorRefs) return settings.monitorRefs;
  const cached = converted.get(settings);
  if (cached && cached.fallback === fallbackProfileId) return cached.refs;

  const profileId = (settings.profileId as ProfileId | undefined) ?? fallbackProfileId;
  const ids: string[] = settings.monitorIds ?? (settings.monitorId ? [settings.monitorId] : []);
  const refs = profileId ? ids.map((monitorId) => ({ profileId, monitorId })) : [];
  converted.set(settings, { fallback: fallbackProfileId, refs });
  return refs;
}

/** Settings holding `refs` in the new shape, with the legacy keys dropped. */
export function withMonitorRefs(settings: WidgetSettings, refs: MonitorRef[]): WidgetSettings {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the legacy keys
  const { profileId, monitorIds, monitorId, ...rest } = settings;
  return { ...rest, monitorRefs: refs };
}
