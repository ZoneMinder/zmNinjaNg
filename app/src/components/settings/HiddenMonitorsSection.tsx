/**
 * Hidden Monitors Section
 *
 * Per-profile control to exclude/restore monitors. Excluded monitors are
 * dropped from all views (monitor lists, events, etc.). This section lists
 * every monitor (including excluded ones, via getMonitors({ includeExcluded:
 * true })) so excluded monitors can be restored here. Toggling invalidates the
 * monitor and event React Query caches so the rest of the app refetches.
 */

import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth';
import { getMonitors } from '../../api/monitors';
import { Switch } from '../ui/switch';
import { SectionHeader, SettingsCard } from './SettingsLayout';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

export interface HiddenMonitorsSectionProps {
  settings: ProfileSettings;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function HiddenMonitorsSection({
  settings,
  currentProfile,
  updateSettings,
}: HiddenMonitorsSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const excludedIds = settings.excludedMonitorIds ?? [];

  // Distinct query key so this full list (including excluded) never clobbers the
  // filtered ['monitors', ...] cache the rest of the app relies on.
  const { data, isLoading, error } = useQuery({
    queryKey: ['monitors', 'all-including-excluded', currentProfile?.id],
    queryFn: () => getMonitors({ includeExcluded: true }),
    enabled: !!currentProfile && isAuthenticated,
  });

  const monitors = data?.monitors ?? [];

  const handleToggle = (monitorId: string, hidden: boolean) => {
    if (!currentProfile) return;
    const current = settings.excludedMonitorIds ?? [];
    const next = hidden
      ? current.includes(monitorId)
        ? current
        : [...current, monitorId]
      : current.filter((id) => id !== monitorId);
    updateSettings(currentProfile.id, { excludedMonitorIds: next });
    // Refresh every view that derives from monitors or events. Partial keys
    // match all queries that start with them (e.g. ['monitors', profileId]).
    queryClient.invalidateQueries({ queryKey: ['monitors'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['consoleEvents'] });
    queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
    queryClient.invalidateQueries({ queryKey: ['event-montage'] });
  };

  return (
    <section>
      <SectionHeader label={t('settings.hidden_monitors.section')} />
      <SettingsCard>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground min-w-0">
            {t('settings.hidden_monitors.desc')}
          </p>
          <span
            className="text-xs font-medium text-muted-foreground shrink-0"
            data-testid="hidden-monitors-count"
          >
            {t('settings.hidden_monitors.hidden_count', { count: excludedIds.length })}
          </span>
        </div>

        {isLoading && (
          <div className="px-4 py-3 text-xs text-muted-foreground" data-testid="hidden-monitors-loading">
            {t('settings.hidden_monitors.loading')}
          </div>
        )}

        {!isLoading && error && (
          <div className="px-4 py-3 text-xs text-destructive" data-testid="hidden-monitors-error">
            {t('settings.hidden_monitors.error')}
          </div>
        )}

        {!isLoading && !error && monitors.length === 0 && (
          <div className="px-4 py-3 text-xs text-muted-foreground" data-testid="hidden-monitors-empty">
            {t('settings.hidden_monitors.empty')}
          </div>
        )}

        {!isLoading && !error && monitors.length > 0 && (
          <ul className="divide-y" data-testid="hidden-monitors-list">
            {monitors.map(({ Monitor }) => {
              const hidden = excludedIds.includes(Monitor.Id);
              return (
                <li
                  key={Monitor.Id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  data-testid={`hidden-monitor-row-${Monitor.Id}`}
                >
                  <span className="text-sm font-medium truncate min-w-0" title={Monitor.Name}>
                    {Monitor.Name}
                  </span>
                  <Switch
                    checked={hidden}
                    onCheckedChange={(checked) => handleToggle(Monitor.Id, checked)}
                    aria-label={Monitor.Name}
                    data-testid={`hidden-monitor-toggle-${Monitor.Id}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </section>
  );
}
