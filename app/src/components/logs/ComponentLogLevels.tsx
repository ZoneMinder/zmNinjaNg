/**
 * Component Log Levels
 *
 * Per-component log level overrides, shown on the Logs page next to the
 * level picker, which is the page's one global-level control (refs #536
 * fix round 1: this used to duplicate that control with different
 * override-clearing behavior). Selection-scoped: reads and writes the
 * bucket named by `profileId` - the current selection's bucket, which is an
 * aggregate's own bucket when an aggregate is selected.
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { SettingsCard } from '../settings/SettingsLayout';
import { LogLevel } from '../../lib/logger';
import type { ProfileId } from '../../api/types';
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
  profileId: ProfileId | null;
  updateSettings: (profileId: ProfileId, updates: Partial<ProfileSettings>) => void;
}

/** Collapsible section for per-component log level overrides. */
export function ComponentLogLevels({ settings, profileId, updateSettings }: ComponentLogLevelsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

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

  // Change a single component's level
  const handleComponentChange = useCallback(
    (component: string, value: number) => {
      if (!profileId) return;
      const next = { ...overrides };
      if (value === globalLevel) {
        // Same as global: remove override
        delete next[component];
      } else {
        next[component] = value;
      }
      updateSettings(profileId, { componentLogLevels: next });
    },
    [profileId, overrides, globalLevel, updateSettings],
  );

  // Reset all overrides to global
  const handleReset = useCallback(() => {
    if (!profileId) return;
    updateSettings(profileId, { componentLogLevels: {} });
  }, [profileId, updateSettings]);

  const levelLabel = (level: number) =>
    LOG_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? 'INFO';

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-semibold text-primary uppercase tracking-wide mb-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="component-log-levels-toggle"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('settings.component_log_levels')}
        <span className="text-xs font-normal text-muted-foreground">
          ({levelLabel(globalLevel)}{overrideCount > 0 ? `, ${overrideCount} custom` : ''})
        </span>
      </button>

      {expanded && (
        <SettingsCard>
          <div className="px-4 py-3">
            {/* Per-component overrides */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                {t('settings.component_log_levels_desc')}
              </p>
              {overrideCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive"
                  onClick={handleReset}
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
        </SettingsCard>
      )}
    </div>
  );
}
