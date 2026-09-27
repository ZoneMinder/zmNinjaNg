/**
 * Advanced streaming: go2rtc (WebRTC/HLS/MSE), its protocols, STUN, and the
 * protocol label. One card row in the server sub-card that folds; it and the
 * nested protocol list open while searching so their rows can match.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Zap } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { SettingsRow, RowLabel } from './SettingsLayout';
import { useSettingsSearching } from './settings-search';
import { cn } from '../../lib/utils';
import type { ProfileSettings, WebRTCProtocol } from '../../stores/settings';

const PROTOCOLS: { id: WebRTCProtocol; label: string; descKey: string }[] = [
  { id: 'webrtc', label: 'WebRTC', descKey: 'settings.protocol_webrtc_desc' },
  { id: 'mse', label: 'MSE', descKey: 'settings.protocol_mse_desc' },
  { id: 'hls', label: 'HLS', descKey: 'settings.protocol_hls_desc' },
];

export function AdvancedStreamingFold({
  settings,
  update,
}: {
  /** The server's bucket; every key here is server-scoped. */
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}) {
  const { t } = useTranslation();
  const searching = useSettingsSearching();
  const [open, setOpen] = useState(false);
  const [protocolsOpen, setProtocolsOpen] = useState(false);
  const go2rtc = settings.streamingMethod === 'auto';

  // At least one protocol stays on: go2rtc with none has nothing to try.
  const handleProtocolChange = (protocol: WebRTCProtocol, enabled: boolean) => {
    const current = settings.webrtcProtocols || ['webrtc', 'mse', 'hls'];
    const updated = enabled
      ? current.includes(protocol) ? current : [...current, protocol]
      : current.filter((p) => p !== protocol);
    if (updated.length > 0) update('webrtcProtocols', updated);
  };

  return (
    <Collapsible open={open || searching} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        data-testid="settings-advanced-streaming-trigger"
      >
        <RowLabel
          label={t('settings.advanced_streaming')}
          desc={t('settings.advanced_streaming_desc')}
        />
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2',
            (open || searching) && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SettingsRow>
          <RowLabel
            label={t('settings.enable_go2rtc')}
            desc={go2rtc ? t('settings.go2rtc_enabled_note') : t('settings.go2rtc_disabled_note')}
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Zap className="h-4 w-4 text-yellow-500" />
            <Switch
              id="go2rtc-mode"
              checked={go2rtc}
              onCheckedChange={(enabled) => update('streamingMethod', enabled ? 'auto' : 'mjpeg')}
              data-testid="settings-go2rtc-switch"
            />
          </div>
        </SettingsRow>

        {go2rtc && (
          <div className="px-4 py-2 bg-muted/40">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-full"
              onClick={() => setProtocolsOpen(!protocolsOpen)}
              aria-expanded={protocolsOpen || searching}
              data-testid="go2rtc-protocol-toggle"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !(protocolsOpen || searching) && '-rotate-90')} />
              {t('settings.webrtc_protocols')}
            </button>
            {(protocolsOpen || searching) && (
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

        {/* STUN only matters when go2rtc is on. */}
        {go2rtc && (
          <SettingsRow>
            <RowLabel label={t('settings.webrtc_use_stun')} desc={t('settings.webrtc_use_stun_desc')} />
            <Switch
              id="webrtc-use-stun"
              checked={settings.webrtcUseStun ?? false}
              onCheckedChange={(checked) => update('webrtcUseStun', checked)}
              data-testid="settings-webrtc-use-stun-switch"
            />
          </SettingsRow>
        )}

        <SettingsRow>
          <RowLabel label={t('settings.show_protocol_label')} desc={t('settings.show_protocol_label_desc')} />
          <Switch
            id="protocol-label"
            checked={settings.showProtocolLabel ?? true}
            onCheckedChange={(checked) => update('showProtocolLabel', checked)}
            data-testid="settings-protocol-label-switch"
          />
        </SettingsRow>
      </CollapsibleContent>
    </Collapsible>
  );
}
