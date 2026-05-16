/**
 * Appearance Section
 *
 * Language selection and date/time format settings.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { cn } from '../../lib/utils';
import { validateFormatString } from '../../lib/format-date-time';
import { Platform } from '../../lib/platform';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';
import type {
  ProfileSettings,
  DateFormatPreset,
  TimeFormatPreset,
  ThumbnailFallbackEntry,
  ThumbnailFallbackType,
  HoverPreviewSettings,
  HoverPreviewPlaybackRate,
} from '../../stores/settings';
import { HOVER_PREVIEW_PLAYBACK_RATES } from '../../stores/settings';

const HOVER_PREVIEW_RATE_LABELS: Record<HoverPreviewPlaybackRate, string> = {
  50: '0.5x',
  100: '1x',
  150: '1.5x',
  200: '2x',
  400: '4x',
};

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

export interface AppearanceSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}

export function AppearanceSection({ settings, update }: AppearanceSectionProps) {
  const { t, i18n } = useTranslation();

  const [customDateDraft, setCustomDateDraft] = useState(settings.customDateFormat);
  const [customTimeDraft, setCustomTimeDraft] = useState(settings.customTimeFormat);

  const customDatePreview = validateFormatString(customDateDraft);
  const customTimePreview = validateFormatString(customTimeDraft);

  return (
    <section>
      <SectionHeader label={t('settings.section_appearance', 'Appearance')} />
      <SettingsCard>
        {/* Language */}
        <SettingsRow>
          <RowLabel label={t('settings.language')} desc={t('settings.select_language')} />
          <Select
            value={i18n.language}
            onValueChange={(value) => i18n.changeLanguage(value)}
          >
            <SelectTrigger className="w-36" data-testid="settings-language-select">
              <SelectValue placeholder={t('settings.select_language')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en" data-testid="settings-language-option-en">{t('languages.en')}</SelectItem>
              <SelectItem value="es" data-testid="settings-language-option-es">{t('languages.es')}</SelectItem>
              <SelectItem value="fr" data-testid="settings-language-option-fr">{t('languages.fr')}</SelectItem>
              <SelectItem value="de" data-testid="settings-language-option-de">{t('languages.de')}</SelectItem>
              <SelectItem value="zh" data-testid="settings-language-option-zh">{t('languages.zh')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

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
                    <SelectItem key={value} value={value}>
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
                    <SelectItem key={value} value={value}>
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
      </SettingsCard>
      <SettingsCard>
        <SettingsRow>
          <RowLabel label={t('settings.appearance.tv_mode')} desc={t('settings.appearance.tv_mode_desc')} />
          <Switch
            checked={settings.tvMode}
            onCheckedChange={(checked) => update('tvMode', checked)}
            data-testid="settings-tv-mode"
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard>
        <ThumbnailFallbackChainEditor
          chain={settings.thumbnailFallbackChain}
          onChange={(next) => update('thumbnailFallbackChain', next)}
        />
        <HoverPreviewEditor
          value={settings.hoverPreview}
          onChange={(next) => update('hoverPreview', next)}
          playbackRate={settings.hoverPreviewPlaybackRate}
          onPlaybackRateChange={(rate) => update('hoverPreviewPlaybackRate', rate)}
        />
      </SettingsCard>
    </section>
  );
}

interface HoverPreviewEditorProps {
  value: HoverPreviewSettings;
  onChange: (next: HoverPreviewSettings) => void;
  playbackRate: HoverPreviewPlaybackRate;
  onPlaybackRateChange: (rate: HoverPreviewPlaybackRate) => void;
}

function HoverPreviewEditor({ value, onChange, playbackRate, onPlaybackRateChange }: HoverPreviewEditorProps) {
  const { t } = useTranslation();
  const isNative = Platform.isNative;
  const titleKey = isNative
    ? 'settings.appearance.hover_preview.title_long_press'
    : 'settings.appearance.hover_preview.title';
  const descKey = isNative
    ? 'settings.appearance.hover_preview.desc_long_press'
    : 'settings.appearance.hover_preview.desc';
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.hoverPreviewOpen) === 'true';
    } catch { return false; }
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(STORAGE_KEYS.hoverPreviewOpen, String(next)); } catch { /* ignore */ }
  };

  const toggle = (key: keyof HoverPreviewSettings, checked: boolean) => {
    onChange({ ...value, [key]: checked });
  };

  const rows: { key: keyof HoverPreviewSettings; labelKey: string }[] = [
    { key: 'eventsList', labelKey: 'settings.appearance.hover_preview.events_list' },
    { key: 'eventsGrid', labelKey: 'settings.appearance.hover_preview.events_grid' },
    { key: 'monitorsList', labelKey: 'settings.appearance.hover_preview.monitors_list' },
    { key: 'monitorsGrid', labelKey: 'settings.appearance.hover_preview.monitors_grid' },
    { key: 'dashboard', labelKey: 'settings.appearance.hover_preview.dashboard' },
    { key: 'timeline', labelKey: 'settings.appearance.hover_preview.timeline' },
    { key: 'notifications', labelKey: 'settings.appearance.hover_preview.notifications' },
  ];

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        data-testid="settings-hover-preview-trigger"
      >
        <RowLabel
          label={t(titleKey)}
          desc={t(descKey)}
        />
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="px-4 pb-3 space-y-1" data-testid="settings-hover-preview">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5"
              data-testid={`settings-hover-preview-row-${row.key}`}
            >
              <Checkbox
                checked={value[row.key]}
                onCheckedChange={(checked) => toggle(row.key, checked === true)}
                data-testid={`settings-hover-preview-${row.key}-toggle`}
                aria-label={t(row.labelKey)}
              />
              <span className="text-xs font-medium truncate">{t(row.labelKey)}</span>
            </li>
          ))}
        </ul>
        <div
          className="flex items-center justify-between gap-3 px-4 pb-3"
          data-testid="settings-hover-preview-playback-rate-row"
        >
          <RowLabel
            label={t('settings.appearance.hover_preview.playback_speed')}
            desc={t('settings.appearance.hover_preview.playback_speed_desc')}
          />
          <Select
            value={String(playbackRate)}
            onValueChange={(v) => onPlaybackRateChange(Number(v) as HoverPreviewPlaybackRate)}
          >
            <SelectTrigger
              className="w-24 min-w-0"
              data-testid="settings-hover-preview-playback-rate"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOVER_PREVIEW_PLAYBACK_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {HOVER_PREVIEW_RATE_LABELS[rate]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ThumbnailFallbackChainEditorProps {
  chain: ThumbnailFallbackEntry[];
  onChange: (next: ThumbnailFallbackEntry[]) => void;
}

function ThumbnailFallbackChainEditor({ chain, onChange }: ThumbnailFallbackChainEditorProps) {
  const { t } = useTranslation();
  const safeChain = Array.isArray(chain) ? chain : [];
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.thumbnailChainOpen) === 'true';
    } catch { return false; }
  });

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    try { localStorage.setItem(STORAGE_KEYS.thumbnailChainOpen, String(value)); } catch { /* ignore */ }
  };

  const getLabel = (type: ThumbnailFallbackType): string => {
    switch (type) {
      case 'alarm':
        return t('settings.appearance.thumbnail_chain.alarm');
      case 'snapshot':
        return t('settings.appearance.thumbnail_chain.snapshot');
      case 'objdetect':
        return t('settings.appearance.thumbnail_chain.objdetect');
      case 'custom':
        return t('settings.appearance.thumbnail_chain.custom');
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= safeChain.length) return;
    const next = [...safeChain];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggle = (index: number, enabled: boolean) => {
    const next = safeChain.map((entry, i) => (i === index ? { ...entry, enabled } : entry));
    onChange(next);
  };

  const setCustomFid = (index: number, customFid: string) => {
    const next = safeChain.map((entry, i) => (i === index ? { ...entry, customFid } : entry));
    onChange(next);
  };

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        data-testid="settings-thumbnail-chain-trigger"
      >
        <RowLabel
          label={t('settings.appearance.thumbnail_chain.title')}
          desc={t('settings.appearance.thumbnail_chain.desc')}
        />
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="px-4 pb-3 space-y-1" data-testid="settings-thumbnail-chain">
          {safeChain.map((entry, index) => (
            <li
              key={entry.type}
              className="flex items-center gap-1.5 rounded border border-border/40 bg-background/40 px-1.5 py-1"
              data-testid={`settings-thumbnail-chain-row-${entry.type}`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={t('settings.appearance.thumbnail_chain.move_up')}
                data-testid={`settings-thumbnail-chain-${entry.type}-up`}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === safeChain.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t('settings.appearance.thumbnail_chain.move_down')}
                data-testid={`settings-thumbnail-chain-${entry.type}-down`}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Checkbox
                checked={entry.enabled}
                onCheckedChange={(checked) => toggle(index, checked === true)}
                data-testid={`settings-thumbnail-chain-${entry.type}-toggle`}
                aria-label={getLabel(entry.type)}
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-xs font-medium truncate">{getLabel(entry.type)}</span>
                {entry.type === 'custom' && (
                  <Input
                    value={entry.customFid ?? ''}
                    onChange={(e) => setCustomFid(index, e.target.value)}
                    placeholder={t('settings.appearance.thumbnail_chain.custom_placeholder')}
                    className="h-6 w-28 font-mono text-xs"
                    data-testid="settings-thumbnail-chain-custom-fid"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
