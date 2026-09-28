/**
 * Component log levels: per-component overrides of the Log level row above
 * it in General. One card row that folds; it opens while searching so a
 * search can match a component name. Selection-scoped: it saves through the
 * page's `update`, which writes the current selection's bucket (an
 * aggregate's own bucket when one is selected).
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { RowLabel } from './SettingsLayout';
import { useSettingsSearching } from './settings-search';
import { LogLevel } from '../../lib/logger';
import { cn } from '../../lib/utils';
import type { ProfileSettings } from '../../stores/settings';

/** All component logger names, matching Logger's component loggers. */
const COMPONENT_NAMES = [
  'API', 'App', 'Auth', 'Crypto', 'Dashboard', 'Discovery', 'Download',
  'ErrorBoundary', 'EventCard', 'EventDetail', 'HTTP',
  'ImageError', 'Kiosk', 'Monitor', 'MonitorCard', 'MonitorDetail',
  'MontageMonitor', 'Navigation', 'NotificationHandler', 'Notifications',
  'NotificationSettings', 'Profile', 'ProfileForm', 'ProfileService',
  'ProfileSwitcher', 'Push', 'QueryCache', 'SecureImage', 'SecureStorage',
  'Server', 'SSLTrust', 'Time', 'VideoMarkers', 'VideoPlayer', 'ZmsEventPlayer',
] as const;

const LOG_LEVEL_OPTIONS = [
  { value: LogLevel.DEBUG, label: 'DEBUG' },
  { value: LogLevel.INFO, label: 'INFO' },
  { value: LogLevel.WARN, label: 'WARN' },
  { value: LogLevel.ERROR, label: 'ERROR' },
  { value: LogLevel.NONE, label: 'NONE' },
] as const;

export interface ComponentLogLevelsProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}

/** Folding card row for per-component log level overrides. */
export function ComponentLogLevels({ settings, update }: ComponentLogLevelsProps) {
  const { t } = useTranslation();
  const searching = useSettingsSearching();
  const [expanded, setExpanded] = useState(false);
  const open = expanded || searching;

  const overrides = settings.componentLogLevels || {};
  const globalLevel = settings.logLevel;
  const overrideCount = useMemo(
    () => Object.values(overrides).filter((v) => v !== globalLevel).length,
    [overrides, globalLevel],
  );

  // Get effective level for a component (override or global)
  const getEffective = useCallback(
    (component: string) => overrides[component] ?? globalLevel,
    [overrides, globalLevel],
  );

  // Change a single component's level; the global level removes the override.
  const handleComponentChange = (component: string, value: number) => {
    const next = { ...overrides };
    if (value === globalLevel) {
      delete next[component];
    } else {
      next[component] = value;
    }
    update('componentLogLevels', next);
  };

  const levelLabel = (level: number) =>
    LOG_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? 'INFO';

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={open}
        data-testid="component-log-levels-toggle"
      >
        <RowLabel
          label={t('settings.component_log_levels')}
          desc={`${levelLabel(globalLevel)}${overrideCount > 0 ? `, ${overrideCount} custom` : ''}`}
        />
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              {t('settings.component_log_levels_desc')}
            </p>
            {overrideCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-destructive hover:text-destructive"
                onClick={() => update('componentLogLevels', {})}
                data-testid="component-log-levels-reset"
              >
                {t('settings.component_log_reset')}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            {COMPONENT_NAMES.map((name) => {
              const effective = getEffective(name);
              const isOverridden = overrides[name] !== undefined && overrides[name] !== globalLevel;
              return (
                <div key={name} className="flex items-center justify-between gap-1 min-w-0">
                  <span
                    className={`text-xs truncate min-w-0 ${isOverridden ? 'font-medium text-primary' : ''}`}
                    title={name}
                  >
                    {name}
                  </span>
                  <select
                    className={`text-xs bg-background border rounded px-1 py-0.5 min-w-[5rem] ${isOverridden ? 'border-primary' : ''}`}
                    value={effective}
                    onChange={(e) => handleComponentChange(name, parseInt(e.target.value, 10))}
                    data-testid={`component-log-level-${name}`}
                  >
                    {LOG_LEVEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
