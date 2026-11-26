/**
 * Previews: which surfaces show an enlarged event preview on hover (long
 * press on touch devices), and its playback speed. A fold inside one card
 * row; it opens while searching so its rows can match.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RowLabel } from './SettingsLayout';
import { useSettingsSearching } from './settings-search';
import { cn } from '../../lib/utils';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';
import { Platform } from '../../lib/platform';
import type { HoverPreviewSettings, HoverPreviewPlaybackRate } from '../../stores/settings';
import {
  HOVER_PREVIEW_PLAYBACK_RATES, MIN_HOVER_PREVIEW_DELAY_MS, DEFAULT_HOVER_PREVIEW_DELAY_MS,
} from '../../stores/settings';
import { Input } from '../ui/input';

const HOVER_PREVIEW_RATE_LABELS: Record<HoverPreviewPlaybackRate, string> = {
  50: '0.5x',
  100: '1x',
  150: '1.5x',
  200: '2x',
  400: '4x',
};

interface HoverPreviewEditorProps {
  value: HoverPreviewSettings;
  onChange: (next: HoverPreviewSettings) => void;
  playbackRate: HoverPreviewPlaybackRate;
  onPlaybackRateChange: (rate: HoverPreviewPlaybackRate) => void;
  delayMs: number;
  onDelayChange: (ms: number) => void;
}

export function HoverPreviewEditor({
  value, onChange, playbackRate, onPlaybackRateChange, delayMs, onDelayChange,
}: HoverPreviewEditorProps) {
  const { t } = useTranslation();
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
    { key: 'assistant', labelKey: 'settings.appearance.hover_preview.assistant' },
    { key: 'liveActivity', labelKey: 'settings.appearance.hover_preview.live_activity' },
    { key: 'montage', labelKey: 'settings.appearance.hover_preview.montage' },
    { key: 'eventContext', labelKey: 'settings.appearance.hover_preview.event_context' },
    { key: 'replay', labelKey: 'settings.appearance.hover_preview.replay' },
  ];

  const searching = useSettingsSearching();

  // Committed on blur, so typing 1000 doesn't clamp the leading 1 to the minimum.
  const [delayDraft, setDelayDraft] = useState(String(delayMs));
  const commitDelay = () => {
    const v = Math.round(Number(delayDraft));
    const ms = delayDraft.trim() && Number.isFinite(v)
      ? Math.max(MIN_HOVER_PREVIEW_DELAY_MS, v)
      : DEFAULT_HOVER_PREVIEW_DELAY_MS;
    setDelayDraft(String(ms));
    if (ms !== delayMs) onDelayChange(ms);
  };

  return (
    <Collapsible open={open || searching} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        data-testid="settings-hover-preview-trigger"
      >
        <RowLabel
          label={t('settings.appearance.hover_preview.title')}
          desc={t('settings.appearance.hover_preview.desc')}
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
        {/* The iOS and Android builds open previews with a long press on its own timer. */}
        {Platform.isDesktopOrWeb && (
          <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <RowLabel
              label={t('settings.appearance.hover_preview.hover_delay')}
              desc={t('settings.appearance.hover_preview.hover_delay_desc')}
            />
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min={MIN_HOVER_PREVIEW_DELAY_MS}
                step={100}
                value={delayDraft}
                onChange={(e) => setDelayDraft(e.target.value)}
                onBlur={commitDelay}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-20"
                aria-label={t('settings.appearance.hover_preview.hover_delay')}
                data-testid="settings-hover-preview-delay"
              />
              <span className="text-xs text-muted-foreground">{t('settings.appearance.hover_preview.delay_unit')}</span>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
