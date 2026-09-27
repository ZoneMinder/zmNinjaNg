/**
 * Playback Section
 *
 * Event autoplay, events per page, and dashboard refresh interval settings.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';
import { MONITOR_DETAIL_RECENT_EVENTS } from '../../lib/zmninja-ng-constants';
import { clampRecentEventsCount } from '../../lib/monitor/monitor-recent-events';

export interface PlaybackSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function PlaybackSection({
  settings,
  update,
  currentProfile,
  updateSettings,
}: PlaybackSectionProps) {
  const { t } = useTranslation();

  // Local text buffer for the recent-events count so the field can be cleared
  // to empty while typing (a controlled numeric value would snap back and block
  // deleting the last digit). Non-empty input is clamped and committed live;
  // blur restores the stored value if left empty/invalid.
  const recentEventsCount = settings.monitorDetailRecentEventsCount ?? MONITOR_DETAIL_RECENT_EVENTS.defaultCount;
  const [recentEventsText, setRecentEventsText] = useState(String(recentEventsCount));
  useEffect(() => {
    setRecentEventsText(String(recentEventsCount));
  }, [recentEventsCount]);

  return (
    <CollapsibleSection id="playback" label={t('settings.section_playback', 'Playback')}>
      <SettingsCard>
        {/* Event Autoplay */}
        <SettingsRow>
          <RowLabel
            label={t('settings.event_autoplay')}
            desc={t('settings.event_autoplay_desc')}
          />
          <Switch
            id="event-autoplay"
            checked={settings.eventVideoAutoplay}
            onCheckedChange={(checked) => update('eventVideoAutoplay', checked)}
            data-testid="settings-event-autoplay-switch"
          />
        </SettingsRow>

        {/* Open events in fullscreen */}
        <SettingsRow>
          <RowLabel
            label={t('settings.event_fullscreen')}
            desc={t('settings.event_fullscreen_desc')}
          />
          <Switch
            id="event-fullscreen"
            checked={settings.eventPlaybackFullscreen}
            onCheckedChange={(checked) => update('eventPlaybackFullscreen', checked)}
            data-testid="settings-event-fullscreen-switch"
          />
        </SettingsRow>

        {/* Events Per Page */}
        <div className="px-4 py-3 space-y-2">
          <RowLabel
            label={t('settings.events_per_page')}
            desc={t('settings.events_per_page_desc')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="event-limit"
              type="number"
              min="10"
              max="1000"
              step="10"
              value={settings.defaultEventLimit || 100}
              onChange={(e) =>
                currentProfile &&
                updateSettings(currentProfile.id, { defaultEventLimit: Number(e.target.value) })
              }
              className="w-24"
              data-testid="settings-event-limit"
            />
            <span className="text-xs text-muted-foreground">{t('settings.events_per_page_suffix')}</span>
            <div className="flex gap-1.5">
              {[100, 300, 500].map((val) => (
                <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                  onClick={() =>
                    currentProfile &&
                    updateSettings(currentProfile.id, { defaultEventLimit: val })
                  }
                  data-testid={`events-per-page-preset-${val}`}>
                  {val}{val === 100 ? ` (${t('settings.default')})` : ''}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.event_limit_tip')}</p>
        </div>

        {/* Recent events on monitor detail */}
        <div className="px-4 py-3 space-y-2">
          <RowLabel
            label={t('settings.monitor_recent_events_count')}
            desc={t('settings.monitor_recent_events_count_desc')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="monitor-recent-events-count"
              type="number"
              min={MONITOR_DETAIL_RECENT_EVENTS.minCount}
              max={MONITOR_DETAIL_RECENT_EVENTS.maxCount}
              step="1"
              value={recentEventsText}
              onChange={(e) => {
                if (!currentProfile) return;
                const raw = e.target.value;
                setRecentEventsText(raw);
                if (raw === '') return;
                updateSettings(currentProfile.id, {
                  monitorDetailRecentEventsCount: clampRecentEventsCount(Number(raw)),
                });
              }}
              onBlur={() => {
                if (recentEventsText === '' || Number.isNaN(Number(recentEventsText))) {
                  setRecentEventsText(String(recentEventsCount));
                }
              }}
              className="w-24"
              data-testid="settings-monitor-recent-events-count"
            />
            <span className="text-xs text-muted-foreground">{t('settings.events_per_page_suffix')}</span>
            <div className="flex gap-1.5">
              {[10, 20, 50].map((val) => (
                <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                  onClick={() =>
                    currentProfile &&
                    updateSettings(currentProfile.id, { monitorDetailRecentEventsCount: val })
                  }
                  data-testid={`monitor-recent-events-count-preset-${val}`}>
                  {val}{val === 20 ? ` (${t('settings.default')})` : ''}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </CollapsibleSection>
  );
}
