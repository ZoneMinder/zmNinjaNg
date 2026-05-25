/**
 * Hidden Monitors Section
 *
 * Per-profile control to exclude/restore monitors. Excluded monitors are
 * dropped from all views (monitor lists, events, etc.). A compact dropdown
 * trigger opens a popover with a checkbox list of every monitor (including
 * excluded ones, via getMonitors({ includeExcluded: true })). A checked box
 * means the monitor is hidden. Toggling invalidates the monitor and event
 * React Query caches so the rest of the app refetches.
 */

import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { getMonitors } from '../../api/monitors';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
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

  const triggerDisabled = isLoading || !!error || monitors.length === 0;

  return (
    <section>
      <SectionHeader label={t('settings.hidden_monitors.section')} />
      <SettingsCard>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground min-w-0">
            {t('settings.hidden_monitors.desc')}
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={triggerDisabled}
                className="shrink-0 min-w-0 max-w-[60%] justify-between gap-2"
                data-testid="hidden-monitors-dropdown"
              >
                <span
                  className="truncate min-w-0"
                  data-testid="hidden-monitors-count"
                >
                  {excludedIds.length > 0
                    ? t('settings.hidden_monitors.hidden_count', { count: excludedIds.length })
                    : t('settings.hidden_monitors.select')}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[calc(100vw-2rem)] sm:w-72 max-w-sm"
              data-testid="hidden-monitors-panel"
            >
              <div className="grid gap-3">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium leading-none">
                    {t('settings.hidden_monitors.section')}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.hidden_monitors.desc')}
                  </p>
                </div>
                <div
                  className="border rounded-md max-h-60 overflow-y-auto p-2 space-y-2"
                  data-testid="hidden-monitors-list"
                >
                  {monitors.map(({ Monitor }) => {
                    const hidden = excludedIds.includes(Monitor.Id);
                    return (
                      <div key={Monitor.Id} className="flex items-center gap-2">
                        <Checkbox
                          id={`hidden-monitor-${Monitor.Id}`}
                          checked={hidden}
                          onCheckedChange={(checked) =>
                            handleToggle(Monitor.Id, checked === true)
                          }
                          aria-label={Monitor.Name}
                          data-testid={`hidden-monitor-checkbox-${Monitor.Id}`}
                        />
                        <label
                          htmlFor={`hidden-monitor-${Monitor.Id}`}
                          className="text-sm flex-1 cursor-pointer truncate min-w-0"
                          title={Monitor.Name}
                        >
                          {Monitor.Name}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
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
      </SettingsCard>
    </section>
  );
}
