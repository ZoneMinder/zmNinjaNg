/**
 * Live Streaming Section
 *
 * Bandwidth mode, streaming mode, Go2RTC protocol selection,
 * snapshot refresh, FPS, and scale settings.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Video as VideoIcon, Zap, Gauge, Leaf, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { getBandwidthSettings, type BandwidthMode } from '../../lib/zmninja-ng-constants';
import type { Profile } from '../../api/types';
import type { ProfileSettings, WebRTCProtocol } from '../../stores/settings';

// ---- Protocol config ----
const PROTOCOLS: { id: WebRTCProtocol; label: string; descKey: string }[] = [
  { id: 'webrtc', label: 'WebRTC', descKey: 'settings.protocol_webrtc_desc' },
  { id: 'mse', label: 'MSE', descKey: 'settings.protocol_mse_desc' },
  { id: 'hls', label: 'HLS', descKey: 'settings.protocol_hls_desc' },
];

export interface LiveStreamingSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function LiveStreamingSection({
  settings,
  update,
  currentProfile,
  updateSettings,
}: LiveStreamingSectionProps) {
  const { t } = useTranslation();
  const [protocolsExpanded, setProtocolsExpanded] = useState(false);

  // Bandwidth mode changes also reset related settings to defaults
  const handleBandwidthModeChange = (isLow: boolean) => {
    if (!currentProfile) return;
    const mode: BandwidthMode = isLow ? 'low' : 'normal';
    const bandwidthDefaults = getBandwidthSettings(mode);
    updateSettings(currentProfile.id, {
      bandwidthMode: mode,
      streamScale: bandwidthDefaults.imageScale,
      streamMaxFps: bandwidthDefaults.streamMaxFps,
      snapshotRefreshInterval: bandwidthDefaults.snapshotRefreshInterval,
    });
  };

  // Protocol checkboxes for Go2RTC
  const handleProtocolChange = (protocol: WebRTCProtocol, enabled: boolean) => {
    if (!currentProfile) return;
    const current = settings.webrtcProtocols || ['webrtc', 'mse', 'hls'];
    const updated = enabled
      ? current.includes(protocol) ? current : [...current, protocol]
      : current.filter((p) => p !== protocol);
    if (updated.length > 0) {
      updateSettings(currentProfile.id, { webrtcProtocols: updated });
    }
  };

  return (
    <section>
      <SectionHeader label={t('settings.section_live_streaming', 'Live Streaming')} />
      <SettingsCard>
        {/* Bandwidth Mode */}
        <SettingsRow>
          <RowLabel
            label={t('settings.bandwidth_mode')}
            desc={
              settings.bandwidthMode === 'low'
                ? t('settings.bandwidth_low_desc')
                : t('settings.bandwidth_normal_desc')
            }
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            {settings.bandwidthMode === 'low' && (
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                {t('settings.bandwidth_saving')}
              </Badge>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              <span>{t('settings.bandwidth_normal')}</span>
            </div>
            <Switch
              id="bandwidth-mode"
              checked={settings.bandwidthMode === 'low'}
              onCheckedChange={handleBandwidthModeChange}
              data-testid="settings-bandwidth-mode-switch"
            />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Leaf className="h-3.5 w-3.5 text-green-600" />
              <span>{t('settings.bandwidth_low')}</span>
            </div>
          </div>
        </SettingsRow>

        {/* Streaming Mode */}
        <SettingsRow>
          <RowLabel
            label={t('settings.streaming_mode')}
            desc={
              settings.viewMode === 'streaming'
                ? t('settings.streaming_mode_desc')
                : t('settings.snapshot_mode_desc')
            }
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            {settings.viewMode === 'snapshot' && (
              <Badge variant="secondary" className="text-xs">
                {t('settings.recommended')}
              </Badge>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Image className="h-3.5 w-3.5" />
              <span>{t('settings.snapshot')}</span>
            </div>
            <Switch
              id="view-mode"
              checked={settings.viewMode === 'streaming'}
              onCheckedChange={(checked) => update('viewMode', checked ? 'streaming' : 'snapshot')}
              data-testid="settings-view-mode-switch"
            />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <VideoIcon className="h-3.5 w-3.5" />
              <span>{t('settings.streaming')}</span>
            </div>
          </div>
        </SettingsRow>

        {/* Snapshot Refresh Interval (only in snapshot mode — child of Streaming Mode) */}
        {settings.viewMode === 'snapshot' && (
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
                value={settings.snapshotRefreshInterval}
                onChange={(e) => update('snapshotRefreshInterval', Number(e.target.value))}
                className="w-20"
                data-testid="settings-refresh-interval"
              />
              <span className="text-xs text-muted-foreground">{t('settings.seconds')}</span>
              <div className="flex gap-1.5">
                {[1, 3, 5].map((val) => (
                  <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                    onClick={() => update('snapshotRefreshInterval', val)}>
                    {val}s{val === 3 ? ` (${t('settings.default')})` : ''}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Go2RTC */}
        <SettingsRow>
          <RowLabel
            label={t('settings.enable_go2rtc')}
            desc={
              settings.streamingMethod === 'auto'
                ? t('settings.go2rtc_enabled_note')
                : t('settings.go2rtc_disabled_note')
            }
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Zap className="h-4 w-4 text-yellow-500" />
            <Switch
              id="go2rtc-mode"
              checked={settings.streamingMethod === 'auto'}
              onCheckedChange={(enabled) => update('streamingMethod', enabled ? 'auto' : 'mjpeg')}
              data-testid="settings-go2rtc-switch"
            />
          </div>
        </SettingsRow>

        {/* Go2RTC protocols (collapsible with chevron) */}
        {settings.streamingMethod === 'auto' && (
          <div className="px-4 py-2 bg-muted/40">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-full"
              onClick={() => setProtocolsExpanded(!protocolsExpanded)}
              data-testid="go2rtc-protocol-toggle"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", !protocolsExpanded && "-rotate-90")} />
              {t('settings.webrtc_protocols')}
            </button>
            {protocolsExpanded && (
              <div className="space-y-2 mt-2">
                {PROTOCOLS.map(({ id, label, descKey }) => (
                  <div key={id} className="flex items-start gap-3">
                    <Checkbox
                      id={`protocol-${id}`}
                      checked={settings.webrtcProtocols?.includes(id) ?? true}
                      onCheckedChange={(checked) => handleProtocolChange(id, checked === true)}
                      data-testid={`protocol-${id}-checkbox`}
                    />
                    <div>
                      <Label htmlFor={`protocol-${id}`} className="text-sm font-medium cursor-pointer">
                        {label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{t(descKey)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Protocol Label */}
        <SettingsRow>
          <RowLabel
            label={t('settings.show_protocol_label')}
            desc={t('settings.show_protocol_label_desc')}
          />
          <Switch
            id="protocol-label"
            checked={settings.showProtocolLabel ?? true}
            onCheckedChange={(checked) => update('showProtocolLabel', checked)}
            data-testid="settings-protocol-label-switch"
          />
        </SettingsRow>

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
              value={settings.streamMaxFps}
              onChange={(e) => update('streamMaxFps', Number(e.target.value))}
              className="w-20"
              data-testid="stream-fps-input"
            />
            <span className="text-xs text-muted-foreground">{t('settings.fps_label')}</span>
            <div className="flex gap-1.5">
              {[5, 10, 15, 30].map((val) => (
                <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                  onClick={() => update('streamMaxFps', val)}
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
              value={settings.streamScale}
              onChange={(e) => update('streamScale', Number(e.target.value))}
              className="w-20"
              data-testid="stream-scale-input"
            />
            <span className="text-xs text-muted-foreground">%</span>
            <div className="flex gap-1.5">
              {[25, 50, 75, 100].map((val) => (
                <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                  onClick={() => update('streamScale', val)}
                  data-testid={`stream-scale-preset-${val}`}>
                  {val}%{val === 50 ? ` (${t('settings.default')})` : ''}
                </Button>
              ))}
            </div>
          </div>
        </div>

      </SettingsCard>
    </section>
  );
}
