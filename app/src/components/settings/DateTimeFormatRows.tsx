/**
 * Date format and Time format: two card rows, each with a custom pattern
 * field when "Custom" is picked. Returned as a fragment so each stays a
 * direct child of the surrounding SettingsCard, which search relies on.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RowLabel } from './SettingsLayout';
import { validateFormatString } from '../../lib/format-date-time';
import type { ProfileSettings, DateFormatPreset, TimeFormatPreset } from '../../stores/settings';

// ---- Date/time preset config ----
// Format pattern labels (e.g. 'MMM D, YYYY') are kept as-is since they are
// locale-neutral format tokens, not user-facing prose. Only 'custom' / hour
// mode labels are translated.
const DATE_FORMAT_VALUES: { value: DateFormatPreset; labelKey: string | null }[] = [
  { value: 'MMM d, yyyy', labelKey: null },
  { value: 'MMM d', labelKey: null },
  { value: 'dd/MM/yyyy', labelKey: null },
  { value: 'dd/MM', labelKey: null },
  { value: 'custom', labelKey: 'settings.appearance.custom' },
];

const TIME_FORMAT_VALUES: { value: TimeFormatPreset; labelKey: string | null }[] = [
  { value: '12h', labelKey: 'settings.appearance.twelve_hour' },
  { value: '24h', labelKey: 'settings.appearance.twenty_four_hour' },
  { value: 'custom', labelKey: 'settings.appearance.custom' },
];

// Display labels for format values that have no translation key (raw format tokens)
const DATE_FORMAT_DISPLAY: Record<string, string> = {
  'MMM d, yyyy': 'MMM D, YYYY',
  'MMM d': 'MMM D',
  'dd/MM/yyyy': 'DD/MM/YYYY',
  'dd/MM': 'DD/MM',
};

const FORMAT_TOKENS =
  'yyyy=year, MM=month, dd=day, MMM=abbr month, EEE=weekday, HH=24h, hh=12h, mm=min, ss=sec, a=AM/PM';

function getDateExample(preset: DateFormatPreset, custom: string): string {
  if (preset === 'custom') return validateFormatString(custom) || 'Invalid';
  return validateFormatString(preset) || '';
}

function getTimeExample(preset: TimeFormatPreset, custom: string): string {
  if (preset === 'custom') return validateFormatString(custom) || 'Invalid';
  if (preset === '12h') return validateFormatString('h:mm:ss a') || '';
  return validateFormatString('HH:mm:ss') || '';
}

export function DateTimeFormatRows({
  settings,
  update,
}: {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}) {
  const { t } = useTranslation();
  const [customDateDraft, setCustomDateDraft] = useState(settings.customDateFormat);
  const [customTimeDraft, setCustomTimeDraft] = useState(settings.customTimeFormat);

  const customDatePreview = validateFormatString(customDateDraft);
  const customTimePreview = validateFormatString(customTimeDraft);

  return (
    <>
      {/* Date Format */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <RowLabel label={t('settings.date_format')} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {getDateExample(settings.dateFormat, settings.customDateFormat)}
            </span>
            <Select
              value={settings.dateFormat}
              onValueChange={(v) => update('dateFormat', v as DateFormatPreset)}
            >
              <SelectTrigger className="w-36" data-testid="settings-date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMAT_VALUES.map(({ value, labelKey }) => (
                  <SelectItem key={value} value={value} data-testid={`settings-date-format-option-${value}`}>
                    {labelKey ? t(labelKey) : DATE_FORMAT_DISPLAY[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {settings.dateFormat === 'custom' && (
          <div className="space-y-1 pl-1">
            <div className="flex items-center gap-3">
              <Input
                value={customDateDraft}
                onChange={(e) => setCustomDateDraft(e.target.value)}
                onBlur={() => {
                  if (customDatePreview) update('customDateFormat', customDateDraft);
                }}
                placeholder="EEE, MMM d yyyy"
                className="w-44 font-mono text-sm"
                data-testid="settings-custom-date-format"
              />
              <span className={customDatePreview ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                {customDatePreview || t('settings.invalid_format')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{FORMAT_TOKENS}</p>
          </div>
        )}
      </div>

      {/* Time Format */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <RowLabel label={t('settings.time_format')} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {getTimeExample(settings.timeFormat, settings.customTimeFormat)}
            </span>
            <Select
              value={settings.timeFormat}
              onValueChange={(v) => update('timeFormat', v as TimeFormatPreset)}
            >
              <SelectTrigger className="w-36" data-testid="settings-time-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_FORMAT_VALUES.map(({ value, labelKey }) => (
                  <SelectItem key={value} value={value} data-testid={`settings-time-format-option-${value}`}>
                    {labelKey ? t(labelKey) : value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {settings.timeFormat === 'custom' && (
          <div className="space-y-1 pl-1">
            <div className="flex items-center gap-3">
              <Input
                value={customTimeDraft}
                onChange={(e) => setCustomTimeDraft(e.target.value)}
                onBlur={() => {
                  if (customTimePreview) update('customTimeFormat', customTimeDraft);
                }}
                placeholder="h:mm:ss a"
                className="w-44 font-mono text-sm"
                data-testid="settings-custom-time-format"
              />
              <span className={customTimePreview ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                {customTimePreview || t('settings.invalid_format')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{FORMAT_TOKENS}</p>
          </div>
        )}
      </div>
    </>
  );
}
