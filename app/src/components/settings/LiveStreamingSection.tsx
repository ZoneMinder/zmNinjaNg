/**
 * Live Streaming section.
 *
 * Selection-scoped rows first (paging, offline skipping, fullscreen), saved
 * through the page's `update`. Then the server sub-card: how this server
 * sends live video (Streaming Mode with its recommendation, refresh, FPS,
 * scale, and the Advanced streaming fold). While aggregating, a last sub-card
 * headed by the aggregate's name holds the aggregate-only knobs, saved to the
 * aggregate's own bucket.
 */

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Image, Video as VideoIcon } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel, SettingsSubCard } from './SettingsLayout';
import { MonitorsPerPageRow } from './MonitorsPerPageRow';
import { AdvancedStreamingFold } from './AdvancedStreamingFold';
import { AllServersStreamingSection } from './AllServersStreamingSection';
import { AllServersPerformanceSection } from './AllServersPerformanceSection';
import { getMonitors } from '../../api/monitors';
import { getSession } from '../../services/sessions';
import { queryKeys } from '../../lib/query/query-keys';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { recommendViewMode } from '../../lib/monitor/view-mode-recommendation';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

// Streaming Mode hint text, one key per reason recommendViewMode can give.
const VIEW_MODE_REASON_KEYS = {
  'few-monitors': 'settings.view_mode_reason_few_monitors',
  'multi-port': 'settings.view_mode_reason_multi_port',
  'many-monitors': 'settings.view_mode_reason_many_monitors',
} as const;

type Update = <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;

export interface LiveStreamingSectionProps {
  /** The current selection's bucket (the aggregate's own while aggregating). */
  settings: ProfileSettings;
  update: Update;
  serverProfile: Profile | null;
  serverSettings: ProfileSettings;
  updateServer: Update;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
  /** The aggregate's name while aggregating; null with one profile selected. */
  aggregateName: string | null;
}

export function LiveStreamingSection({
  settings,
  update,
  serverProfile,
  serverSettings,
  updateServer,
  updateSettings,
  aggregateName,
}: LiveStreamingSectionProps) {
  const { t } = useTranslation();

  // Streaming Mode hint: how many monitors compete for this server's live
  // connections. Same query key the monitor views use, so this reuses their
  // cache rather than adding a fetch of its own.
  const { data: monitorData } = useQuery({
    queryKey: queryKeys.monitors(serverProfile?.id),
    queryFn: () => getMonitors(getSession(serverProfile!.id).client, serverProfile!.id),
    enabled: !!serverProfile,
  });
  const recommendation = recommendViewMode(
    monitorData ? monitorData.monitors.length : null,
    resolveMinStreamingPort(serverProfile?.minStreamingPort, serverSettings.forceDisableMultiPort),
  );

  return (
    <CollapsibleSection id="live-streaming" label={t('settings.section_live_streaming')}>
      <div className="space-y-3">
        <SettingsCard>
          <MonitorsPerPageRow
            value={settings.monitorsPerPage}
            onChange={(next) => update('monitorsPerPage', next)}
          />

          {/* Skip offline monitors when stepping through live view (refs #527) */}
          <SettingsRow>
            <RowLabel
              label={t('settings.skip_offline_monitors')}
              desc={t('settings.skip_offline_monitors_desc')}
            />
            <Switch
              id="skip-offline-monitors"
              checked={settings.skipOfflineMonitors}
              onCheckedChange={(checked) => update('skipOfflineMonitors', checked)}
              data-testid="settings-skip-offline-monitors-switch"
            />
          </SettingsRow>

          {/* Open live view in fullscreen */}
          <SettingsRow>
            <RowLabel
              label={t('settings.live_fullscreen')}
              desc={t('settings.live_fullscreen_desc')}
            />
            <Switch
              id="live-fullscreen"
              checked={settings.monitorDetailFullscreen}
              onCheckedChange={(checked) => update('monitorDetailFullscreen', checked)}
              data-testid="settings-live-fullscreen-switch"
            />
          </SettingsRow>
        </SettingsCard>

        <SettingsSubCard name={serverProfile?.name ?? ''} testId="settings-server-subcard">
          <SettingsCard>
            {/* Streaming Mode, with its reason line: one card row, so search and
                the card dividers treat them as one setting. */}
            <div>
              <SettingsRow>
                <RowLabel
                  label={t('settings.streaming_mode')}
                  desc={
                    serverSettings.viewMode === 'streaming'
                      ? t('settings.streaming_mode_desc')
                      : t('settings.snapshot_mode_desc')
                  }
                />
                <div className="flex items-center gap-2 flex-shrink-0">
                  {recommendation.mode === 'snapshot' && (
                    <Badge
                      variant="secondary"
                      className="text-xs"
                      data-testid="settings-view-mode-recommended-snapshot"
                    >
                      {t('settings.recommended')}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Image className="h-3.5 w-3.5" />
                    <span>{t('settings.snapshot')}</span>
                  </div>
                  <Switch
                    id="view-mode"
                    checked={serverSettings.viewMode === 'streaming'}
                    onCheckedChange={(checked) =>
                      serverProfile &&
                      updateSettings(serverProfile.id, {
                        viewMode: checked ? 'streaming' : 'snapshot',
                        viewModeChosen: true,
                      })
                    }
                    data-testid="settings-view-mode-switch"
                  />
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <VideoIcon className="h-3.5 w-3.5" />
                    <span>{t('settings.streaming')}</span>
                  </div>
                  {recommendation.mode === 'streaming' && (
                    <Badge
                      variant="secondary"
                      className="text-xs"
                      data-testid="settings-view-mode-recommended-streaming"
                    >
                      {t('settings.recommended')}
                    </Badge>
                  )}
                </div>
              </SettingsRow>

              {/* Why that mode is recommended. The toggle above still wins; this only
                  explains what this server's size and multi-port support imply. */}
              {monitorData && (
                <p
                  className="px-4 pb-3 -mt-2 text-xs text-muted-foreground"
                  data-testid="settings-view-mode-reason"
                >
                  {t(VIEW_MODE_REASON_KEYS[recommendation.reason], {
                    monitorCount: monitorData.monitors.length,
                  })}
                </p>
              )}
            </div>

            {/* Snapshot Refresh Interval (only in snapshot mode: child of Streaming Mode) */}
            {serverSettings.viewMode === 'snapshot' && (
              <div className="px-4 py-3 space-y-2">
                <RowLabel
                  label={t('settings.refresh_interval')}
                  desc={t('settings.refresh_interval_desc')}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    id="refresh-interval"
                    type="number"
                    min="1"
                    max="30"
                    value={serverSettings.snapshotRefreshInterval}
                    onChange={(e) => updateServer('snapshotRefreshInterval', Number(e.target.value))}
                    className="w-20"
                    data-testid="settings-refresh-interval"
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.seconds')}</span>
                  <div className="flex gap-1.5">
                    {[1, 3, 5].map((val) => (
                      <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                        onClick={() => updateServer('snapshotRefreshInterval', val)}>
                        {val}s{val === 3 ? ` (${t('settings.default')})` : ''}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Stream FPS */}
            <div className="px-4 py-3 space-y-2">
              <RowLabel
                label={t('settings.stream_fps')}
                desc={t('settings.stream_fps_desc')}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="stream-fps"
                  type="number"
                  min="1"
                  max="30"
                  value={serverSettings.streamMaxFps}
                  onChange={(e) => updateServer('streamMaxFps', Number(e.target.value))}
                  className="w-20"
                  data-testid="stream-fps-input"
                />
                <span className="text-xs text-muted-foreground">{t('settings.fps_label')}</span>
                <div className="flex gap-1.5">
                  {[5, 10, 15, 30].map((val) => (
                    <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                      onClick={() => updateServer('streamMaxFps', val)}
                      data-testid={`stream-fps-${val}`}>
                      {val === 10
                        ? t('settings.fps_option_default', { value: val })
                        : t('settings.fps_option', { value: val })}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Stream Scale */}
            <div className="px-4 py-3 space-y-2">
              <RowLabel
                label={t('settings.stream_scale')}
                desc={t('settings.stream_scale_desc')}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="stream-scale"
                  type="number"
                  min="10"
                  max="100"
                  step="10"
                  value={serverSettings.streamScale}
                  onChange={(e) => updateServer('streamScale', Number(e.target.value))}
                  className="w-20"
                  data-testid="stream-scale-input"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <div className="flex gap-1.5">
                  {[25, 50, 75, 100].map((val) => (
                    <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                      onClick={() => updateServer('streamScale', val)}
                      data-testid={`stream-scale-preset-${val}`}>
                      {val}%{val === 50 ? ` (${t('settings.default')})` : ''}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <AdvancedStreamingFold settings={serverSettings} update={updateServer} />
          </SettingsCard>
        </SettingsSubCard>

        {aggregateName !== null && (
          <SettingsSubCard name={aggregateName} testId="settings-aggregate-subcard">
            <AllServersStreamingSection
              value={settings.allModeViewMode}
              onChange={(value) => update('allModeViewMode', value)}
              name={aggregateName}
            />
            <AllServersPerformanceSection settings={settings} update={update} name={aggregateName} />
          </SettingsSubCard>
        )}
      </div>
    </CollapsibleSection>
  );
}
