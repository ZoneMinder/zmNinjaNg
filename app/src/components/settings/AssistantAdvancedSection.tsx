/**
 * Advanced assistant dials (refs #246).
 *
 * Collapsed by default and deliberately small. Each of these three has a value
 * that depends on the user's own hardware or on a tradeoff only they can make,
 * which is why they are settings rather than constants. Everything else about
 * the assistant that could have been a dial (token budgets, parse attempts,
 * tool-result size, iteration caps) has a measured right answer and stays in
 * `ASSISTANT`, because a dial over a known optimum is a bug surface wearing a
 * settings label.
 *
 * Temperature is the exception that needs saying out loud: 0 measured best and
 * the note beside the field says so, because a user who raises it will see
 * wrong answers about their cameras rather than anything that looks like a
 * setting having been changed.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Input } from '../ui/input';
import { RowLabel } from './SettingsLayout';
import { useSettingsSearching } from './settings-search';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import type { ProfileSettings } from '../../stores/settings';

interface Props {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}

/** Keeps a typed value inside its bounds.
 *
 *  The non-finite branch is unreachable from a `type="number"` input, which
 *  hands back either a number or an empty string (`Number('')` is 0, i.e.
 *  clamped to the minimum). It is kept as a guard on the conversion itself, not
 *  as a behaviour the UI can produce. */
function clamp(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function AssistantAdvancedSection({ settings, update }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const searching = useSettingsSearching();

  return (
    <Collapsible open={open || searching} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center justify-between text-left group"
          data-testid="assistant-advanced-toggle"
        >
          <span className="text-sm font-medium">{t('settings.assistant.advanced')}</span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-3 space-y-4" data-testid="assistant-advanced-content">
          <div className="space-y-2">
            <RowLabel
              label={t('settings.assistant.temperature')}
              desc={t('settings.assistant.temperature_hint')}
            />
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={ASSISTANT.assistantTemperatureMax}
              value={settings.assistantTemperature}
              onChange={(e) =>
                update(
                  'assistantTemperature',
                  clamp(e.target.value, 0, ASSISTANT.assistantTemperatureMax, ASSISTANT.assistantTemperature),
                )
              }
              className="w-full sm:w-32"
              data-testid="assistant-temperature"
            />
          </div>

          <div className="space-y-2">
            <RowLabel
              label={t('settings.assistant.timeout')}
              desc={t('settings.assistant.timeout_hint')}
            />
            <Input
              type="number"
              inputMode="numeric"
              min={ASSISTANT.assistantTimeoutSecMin}
              max={ASSISTANT.assistantTimeoutSecMax}
              value={settings.assistantTimeoutSec}
              onChange={(e) =>
                update(
                  'assistantTimeoutSec',
                  clamp(
                    e.target.value,
                    ASSISTANT.assistantTimeoutSecMin,
                    ASSISTANT.assistantTimeoutSecMax,
                    Math.round(ASSISTANT.requestTimeoutMs / 1000),
                  ),
                )
              }
              className="w-full sm:w-32"
              data-testid="assistant-timeout"
            />
          </div>

          <div className="space-y-2">
            <RowLabel
              label={t('settings.assistant.history_turns')}
              desc={t('settings.assistant.history_turns_hint')}
            />
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={ASSISTANT.assistantHistoryTurnsMax}
              value={settings.assistantHistoryTurns}
              onChange={(e) =>
                update(
                  'assistantHistoryTurns',
                  clamp(e.target.value, 0, ASSISTANT.assistantHistoryTurnsMax, ASSISTANT.maxHistoryTurns),
                )
              }
              className="w-full sm:w-32"
              data-testid="assistant-history-turns"
            />
          </div>

          <p className="text-xs text-muted-foreground" data-testid="assistant-advanced-note">
            {t('settings.assistant.advanced_note')}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
