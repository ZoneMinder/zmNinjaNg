/**
 * General section: how the app looks and behaves on this device, plus the
 * server's hidden-monitor list in its server sub-card.
 *
 * Every row above the sub-card is selection-scoped and saves through the
 * page's `update`. Theme goes through useTheme, the same state as the header
 * theme toggle; Kiosk PIN and developer notices keep their own storage. The
 * log rows set the same keys as the Logs page's level dropdown.
 */

import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel, SettingsSubCard } from './SettingsLayout';
import { DateTimeFormatRows } from './DateTimeFormatRows';
import { HoverPreviewEditor } from './HoverPreviewEditor';
import { KioskPinRow } from './KioskPinRow';
import { HiddenMonitorsSection } from './HiddenMonitorsSection';
import { ComponentLogLevels } from './ComponentLogLevels';
import { useTheme } from '../theme-provider';
import { useLanguageOptions } from '../../hooks/useLanguageOptions';
import { useDeveloperNoticeStore } from '../../stores/developerNotices';
import { START_SCREENS, START_SCREEN_LAST_USED } from '../../lib/navigation';
import { LogLevel } from '../../lib/logger';
import type { Profile } from '../../api/types';
import type { ProfileSettings, ThemePreference } from '../../stores/settings';

// Same choices, in the same order, as the header theme toggle (mode-toggle.tsx).
const THEMES: ThemePreference[] = ['light', 'cream', 'dark', 'slate', 'amber', 'system'];

// Same choices and labels as the Logs page's level dropdown.
const LOG_LEVELS = [
  { level: LogLevel.DEBUG, name: 'DEBUG', labelKey: 'logs.level_debug' },
  { level: LogLevel.INFO, name: 'INFO', labelKey: 'logs.level_info' },
  { level: LogLevel.WARN, name: 'WARN', labelKey: 'logs.level_warn' },
  { level: LogLevel.ERROR, name: 'ERROR', labelKey: 'logs.level_error' },
] as const;

export interface GeneralSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  serverProfile: Profile | null;
  serverSettings: ProfileSettings;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function GeneralSection({
  settings,
  update,
  serverProfile,
  serverSettings,
  updateSettings,
}: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const languages = useLanguageOptions();
  const { theme, setTheme } = useTheme();
  // Developer notices visibility is device-global, so it reads/writes the
  // developer notice store directly rather than the profile settings helper.
  const showDeveloperNotices = useDeveloperNoticeStore((s) => s.showNotices);
  const setShowDeveloperNotices = useDeveloperNoticeStore((s) => s.setShowNotices);

  return (
    <CollapsibleSection id="general" label={t('settings.section_general')}>
      <div className="space-y-3">
        <SettingsCard>
          <SettingsRow>
            <RowLabel label={t('settings.language')} desc={t('settings.select_language')} />
            <Select value={i18n.language} onValueChange={(value) => i18n.changeLanguage(value)}>
              <SelectTrigger className="w-36" data-testid="settings-language-select">
                <SelectValue placeholder={t('settings.select_language')} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((language) => (
                  <SelectItem
                    key={language.code}
                    value={language.code}
                    data-testid={`settings-language-option-${language.code}`}
                  >
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow>
            <RowLabel label={t('settings.theme')} desc={t('settings.display_mode_desc')} />
            <Select value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
              <SelectTrigger className="w-36" data-testid="settings-theme-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((value) => (
                  <SelectItem key={value} value={value} data-testid={`settings-theme-option-${value}`}>
                    {t(`settings.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow>
            <RowLabel label={t('settings.start_screen')} desc={t('settings.start_screen_desc')} />
            <Select value={settings.startScreen} onValueChange={(value) => update('startScreen', value)}>
              <SelectTrigger className="w-36" data-testid="settings-start-screen-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={START_SCREEN_LAST_USED} data-testid="settings-start-screen-option-last-used">
                  {t('settings.start_screen_last_used')}
                </SelectItem>
                {START_SCREENS.map((screen) => (
                  <SelectItem
                    key={screen.path}
                    value={screen.path}
                    data-testid={`settings-start-screen-option${screen.path.replace(/\//g, '-')}`}
                  >
                    {t(screen.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <DateTimeFormatRows settings={settings} update={update} />

          <HoverPreviewEditor
            value={settings.hoverPreview}
            onChange={(next) => update('hoverPreview', next)}
            playbackRate={settings.hoverPreviewPlaybackRate}
            onPlaybackRateChange={(rate) => update('hoverPreviewPlaybackRate', rate)}
          />

          {/* Same key and bucket as the sidebar's Insomnia toggle. */}
          <SettingsRow>
            <RowLabel label={t('monitor_detail.insomnia_label')} desc={t('monitor_detail.insomnia_help')} />
            <Switch
              checked={settings.insomnia}
              onCheckedChange={(checked) => update('insomnia', checked)}
              data-testid="settings-insomnia-switch"
            />
          </SettingsRow>

          <SettingsRow>
            <RowLabel
              label={t('settings.landscape_fullscreen')}
              desc={t('settings.landscape_fullscreen_desc')}
            />
            <Switch
              checked={settings.landscapeFullscreen}
              onCheckedChange={(checked) => update('landscapeFullscreen', checked)}
              data-testid="settings-landscape-fullscreen-switch"
            />
          </SettingsRow>

          <SettingsRow>
            <RowLabel label={t('settings.appearance.tv_mode')} desc={t('settings.appearance.tv_mode_desc')} />
            <Switch
              checked={settings.tvMode}
              onCheckedChange={(checked) => update('tvMode', checked)}
              data-testid="settings-tv-mode"
            />
          </SettingsRow>

          <KioskPinRow />

          <SettingsRow>
            <RowLabel
              label={t('settings.show_developer_notices')}
              desc={t('settings.show_developer_notices_desc')}
            />
            <Switch
              id="show-developer-notices"
              checked={showDeveloperNotices}
              onCheckedChange={setShowDeveloperNotices}
              data-testid="settings-show-developer-notices"
            />
          </SettingsRow>

          {/* A new level clears component overrides, as the Logs page dropdown does,
              so no component stays pinned relative to the old level. */}
          <SettingsRow>
            <RowLabel label={t('settings.global_log_level')} desc={t('settings.global_log_level_desc')} />
            <Select
              value={settings.logLevel.toString()}
              onValueChange={(value) => {
                update('logLevel', parseInt(value, 10) as LogLevel);
                update('componentLogLevels', {});
              }}
            >
              <SelectTrigger className="w-36" data-testid="settings-log-level-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map(({ level, name, labelKey }) => (
                  <SelectItem
                    key={name}
                    value={level.toString()}
                    data-testid={`settings-log-level-option-${name}`}
                  >
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <ComponentLogLevels settings={settings} update={update} />

          <SettingsRow>
            <div className="min-w-0 flex-1">
              <RowLabel label={t('settings.disable_log_redaction')} desc={t('settings.disable_log_redaction_desc')} />
              {settings.disableLogRedaction && (
                <p
                  className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-medium"
                  data-testid="settings-log-redaction-warning"
                >
                  {t('settings.disable_log_redaction_warning')}
                </p>
              )}
            </div>
            <Switch
              id="log-redaction"
              checked={settings.disableLogRedaction}
              onCheckedChange={(checked) => update('disableLogRedaction', checked)}
              data-testid="settings-log-redaction-switch"
            />
          </SettingsRow>

          <SettingsSubCard name={serverProfile?.name ?? ''} testId="settings-server-subcard">
            <HiddenMonitorsSection
              settings={serverSettings}
              currentProfile={serverProfile}
              updateSettings={updateSettings}
            />
          </SettingsSubCard>
        </SettingsCard>
      </div>
    </CollapsibleSection>
  );
}
