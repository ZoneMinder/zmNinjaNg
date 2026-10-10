/**
 * Events & Playback section.
 *
 * Selection-scoped rows (paging, auto-refresh, autoplay, fullscreen, the monitor page's
 * recent events, nearby-event defaults) save through the page's `update`.
 * The server sub-card holds Event thumbnails, which depends on what each
 * server can serve.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel, SettingsSubCard } from './SettingsLayout';
import { ThumbnailFallbackChainEditor } from './ThumbnailFallbackChainEditor';
import { EventContextControls } from '../events/context/EventContextControls';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';
import { EVENT_CONTEXT, EVENTS_AUTO_REFRESH, MONITOR_DETAIL_RECENT_EVENTS } from '../../lib/zmninja-ng-constants';
import { clampRecentEventsCount } from '../../lib/monitor/monitor-recent-events';
import { clampAutoRefreshSeconds } from '../../lib/event/auto-refresh';

type Update = <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;

export interface EventsPlaybackSectionProps {
  settings: ProfileSettings;
  update: Update;
  serverProfile: Profile | null;
  serverSettings: ProfileSettings;
  updateServer: Update;
}

export function EventsPlaybackSection({
  settings,
  update,
  serverProfile,
  serverSettings,
  updateServer,
}: EventsPlaybackSectionProps) {
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

  // Same buffer for auto-refresh: storage clamps 3 up to 10 on read, so a
  // controlled value would turn "30" into "100" while it is typed.
  const autoRefresh = settings.eventsAutoRefreshSeconds;
  const [autoRefreshText, setAutoRefreshText] = useState(String(autoRefresh));
  useEffect(() => {
    setAutoRefreshText((text) => (clampAutoRefreshSeconds(Number(text)) === autoRefresh ? text : String(autoRefresh)));
  }, [autoRefresh]);

  return (
    <CollapsibleSection id="events-playback" label={t('settings.section_events_playback')}>
      <div className="space-y-3">
        <SettingsCard>
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
                onChange={(e) => update('defaultEventLimit', Number(e.target.value))}
                className="w-24"
                data-testid="settings-event-limit"
              />
              <span className="text-xs text-muted-foreground">{t('settings.events_per_page_suffix')}</span>
              <div className="flex gap-1.5">
                {[100, 300, 500].map((val) => (
                  <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                    onClick={() => update('defaultEventLimit', val)}
                    data-testid={`events-per-page-preset-${val}`}>
                    {val}{val === 100 ? ` (${t('settings.default')})` : ''}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.event_limit_tip')}</p>
          </div>

          {/* Auto-refresh for Events and Timeline */}
          <div className="px-4 py-3 space-y-2">
            <RowLabel label={t('settings.auto_refresh')} desc={t('settings.auto_refresh_desc')} />
            <div className="flex flex-wrap items-center gap-3">
              <Input
                id="auto-refresh"
                type="number"
                min="0"
                max={EVENTS_AUTO_REFRESH.maxSeconds}
                value={autoRefreshText}
                onChange={(e) => {
                  setAutoRefreshText(e.target.value);
                  if (e.target.value !== '') update('eventsAutoRefreshSeconds', Number(e.target.value));
                }}
                onBlur={() => setAutoRefreshText(String(autoRefresh))}
                className="w-20"
                data-testid="settings-auto-refresh"
              />
              <span className="text-xs text-muted-foreground">{t('settings.seconds')}</span>
              <div className="flex gap-1.5">
                {EVENTS_AUTO_REFRESH.presets.map((val) => (
                  <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                    onClick={() => update('eventsAutoRefreshSeconds', val)}
                    data-testid={`settings-auto-refresh-preset-${val}`}>
                    {val === 0 ? t('common.off') : `${val}s`}
                  </Button>
                ))}
              </div>
            </div>
          </div>

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
                  const raw = e.target.value;
                  setRecentEventsText(raw);
                  if (raw === '') return;
                  update('monitorDetailRecentEventsCount', clampRecentEventsCount(Number(raw)));
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
                    onClick={() => update('monitorDetailRecentEventsCount', val)}
                    data-testid={`monitor-recent-events-count-preset-${val}`}>
                    {val}{val === 20 ? ` (${t('settings.default')})` : ''}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Nearby events: label and controls are one row, so a search for
              either keeps both. */}
          <div>
            <div className="px-4 py-3">
              <RowLabel
                label={t('settings.appearance.event_context.title')}
                desc={t('settings.appearance.event_context.desc')}
              />
            </div>
            <EventContextControls
              value={settings.eventContext}
              onChange={(next) => update('eventContext', next)}
              available={{ linked: true, group: true, filtered: true }}
            />
          </div>

          <SettingsRow>
            <RowLabel label={t('settings.appearance.event_context.replay_tiles')} desc={t('settings.appearance.event_context.replay_tiles_desc')} />
            <div className="flex gap-1.5">
              {EVENT_CONTEXT.replayTileChoices.map((n) => (
                <Button
                  key={n}
                  variant={settings.eventContextReplayTiles === n ? 'default' : 'outline'}
                  aria-pressed={settings.eventContextReplayTiles === n}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => update('eventContextReplayTiles', n)}
                  data-testid={`settings-replay-tiles-${n}`}
                >
                  {n}
                </Button>
              ))}
            </div>
          </SettingsRow>

          <SettingsSubCard name={serverProfile?.name ?? ''} testId="settings-server-subcard">
            <ThumbnailFallbackChainEditor
              chain={serverSettings.thumbnailFallbackChain}
              onChange={(next) => updateServer('thumbnailFallbackChain', next)}
            />
          </SettingsSubCard>
        </SettingsCard>
      </div>
    </CollapsibleSection>
  );
}
