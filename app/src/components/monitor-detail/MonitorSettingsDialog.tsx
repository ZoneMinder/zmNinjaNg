/**
 * Monitor Settings Dialog
 *
 * Tabbed settings panel for monitor configuration.
 * Shows Capturing/Analysing/Recording on ZM 1.38+, legacy Function on older servers.
 * Editable fields use local state: changes are only sent when Save is pressed.
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Pencil } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { Monitor, ProfileId } from '../../api/types';
import type { MonitorFunction } from '../../pages/hooks/useModeControl';
import { isZmVersionAtLeast } from '../../lib/zm/zm-version';
import { maskUrlCredentials, restoreUrlCredentials } from '../../lib/security/url-credentials';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { SettingsRow } from './SettingsRow';
import { MonitorAppPreferences } from './MonitorAppPreferences';
import { MonitorRestrictedSettings, type RestrictedReason } from './MonitorRestrictedSettings';

interface MonitorSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: Monitor;
  /** ZM server version string for feature detection. */
  zmVersion: string | null;
  /** Called with only the fields that changed when Save is pressed. */
  onSave?: (changes: Record<string, string | undefined>) => Promise<void>;
  isSaving?: boolean;
  // Cycle settings (MonitorDetail only: local setting, not a ZM API field)
  cycleSeconds?: number;
  onCycleSecondsChange?: (value: string) => void;
  // Read-only display (MonitorDetail only)
  orientedResolution?: string;
  /** Map of monitor ID to name for resolving LinkedMonitors. */
  monitorNames?: Record<string, string>;
  /** Owning profile for an /all/ deep route or All-mode monitor grid; defaults to the current profile. */
  profileId?: ProfileId;
  /**
   * Why `onSave` is absent, when it is absent because ZoneMinder said no
   * rather than because the caller never offered saving (refs #344).
   */
  restrictedReason?: RestrictedReason;
}

export function MonitorSettingsDialog({
  open,
  onOpenChange,
  monitor,
  zmVersion,
  onSave,
  isSaving = false,
  cycleSeconds,
  onCycleSecondsChange,
  orientedResolution,
  monitorNames,
  profileId,
  restrictedReason = 'account',
}: MonitorSettingsDialogProps) {
  const { t } = useTranslation();
  const editable = !!onSave;
  const is138Plus = isZmVersionAtLeast(zmVersion, '1.38.0');
  // Log redaction is selection-scoped, so the current selection decides (refs #536).
  const { settings: selectionSettings } = useCurrentProfile();

  // A camera's password lives in the source URL as userinfo, and on pre-1.38
  // servers that is the only place it can live. While log redaction is on, the
  // password segment is masked here and the reveal toggle is dropped from the
  // Pass field, so a screenshot or a shoulder-surfer gets nothing (refs #307).
  // Both fields stay editable: the real password is restored on save whenever
  // the mask survives the edit.
  const maskCredentials = !selectionSettings.disableLogRedaction;
  const displayedPath = maskCredentials
    ? maskUrlCredentials(monitor.Path ?? '')
    : monitor.Path ?? '';

  // --- Capture tab local state ---
  const [localCapturing, setLocalCapturing] = useState<string>(monitor.Capturing ?? 'Always');
  const [localAnalysing, setLocalAnalysing] = useState<string>(monitor.Analysing ?? 'None');
  const [localRecording, setLocalRecording] = useState<string>(monitor.Recording ?? 'None');
  const [localFunction, setLocalFunction] = useState<string>(monitor.Function);
  const [localEnabled, setLocalEnabled] = useState(monitor.Enabled === '1' || monitor.Enabled === 'true');
  const [localSaveJPEGs, setLocalSaveJPEGs] = useState(monitor.SaveJPEGs ?? '0');
  const [localVideoWriter, setLocalVideoWriter] = useState(monitor.VideoWriter ?? '0');

  // --- Video tab local state ---
  const [localPath, setLocalPath] = useState(displayedPath);
  const [localUser, setLocalUser] = useState(monitor.User ?? '');
  const [localPass, setLocalPass] = useState(monitor.Pass ?? '');
  const [localMethod, setLocalMethod] = useState(monitor.Method ?? 'rtpRtsp');
  const [localMaxFPS, setLocalMaxFPS] = useState(monitor.MaxFPS ?? '');
  const [localAlarmMaxFPS, setLocalAlarmMaxFPS] = useState(monitor.AlarmMaxFPS ?? '');
  const [localOrientation, setLocalOrientation] = useState(monitor.Orientation ?? 'ROTATE_0');
  const [localEventStartCmd, setLocalEventStartCmd] = useState(monitor.EventStartCommand ?? '');
  const [localEventEndCmd, setLocalEventEndCmd] = useState(monitor.EventEndCommand ?? '');

  // Server-side value for each editable field, with the same defaults the
  // controls fall back to. Single source of truth for reset, change-detection,
  // and the save diff below. On ZM 1.38+, Enabled is vestigial (Capturing
  // controls activity), so it is normalized to '1'/'0' like the toggle.
  const serverValues = useMemo<Record<string, string>>(() => ({
    Capturing: monitor.Capturing ?? 'Always',
    Analysing: monitor.Analysing ?? 'None',
    Recording: monitor.Recording ?? 'None',
    Function: monitor.Function,
    Enabled: (monitor.Enabled === '1' || monitor.Enabled === 'true') ? '1' : '0',
    SaveJPEGs: monitor.SaveJPEGs ?? '0',
    VideoWriter: monitor.VideoWriter ?? '0',
    Path: displayedPath,
    User: monitor.User ?? '',
    Pass: monitor.Pass ?? '',
    Method: monitor.Method ?? 'rtpRtsp',
    MaxFPS: monitor.MaxFPS ?? '',
    AlarmMaxFPS: monitor.AlarmMaxFPS ?? '',
    Orientation: monitor.Orientation ?? 'ROTATE_0',
    EventStartCommand: monitor.EventStartCommand ?? '',
    EventEndCommand: monitor.EventEndCommand ?? '',
  }), [monitor, displayedPath]);

  // One descriptor per editable field. `key` is the ZM API field name sent in
  // the save payload, `applies` gates version-specific fields, `value` is the
  // current (normalized) local value, and `set` applies a value back to local
  // state. Capturing/Analysing/Recording and User/Pass are 1.38+ only;
  // Function/Enabled are legacy-only.
  const fields: Array<{ key: string; applies: boolean; value: string; set: (v: string) => void }> = [
    { key: 'Capturing', applies: is138Plus, value: localCapturing, set: setLocalCapturing },
    { key: 'Analysing', applies: is138Plus, value: localAnalysing, set: setLocalAnalysing },
    { key: 'Recording', applies: is138Plus, value: localRecording, set: setLocalRecording },
    { key: 'Function', applies: !is138Plus, value: localFunction, set: (v) => setLocalFunction(v) },
    { key: 'Enabled', applies: !is138Plus, value: localEnabled ? '1' : '0', set: (v) => setLocalEnabled(v === '1') },
    { key: 'SaveJPEGs', applies: true, value: localSaveJPEGs, set: setLocalSaveJPEGs },
    { key: 'VideoWriter', applies: true, value: localVideoWriter, set: setLocalVideoWriter },
    { key: 'Path', applies: true, value: localPath, set: setLocalPath },
    { key: 'User', applies: is138Plus, value: localUser, set: setLocalUser },
    { key: 'Pass', applies: is138Plus, value: localPass, set: setLocalPass },
    { key: 'Method', applies: true, value: localMethod, set: setLocalMethod },
    { key: 'MaxFPS', applies: true, value: localMaxFPS, set: setLocalMaxFPS },
    { key: 'AlarmMaxFPS', applies: true, value: localAlarmMaxFPS, set: setLocalAlarmMaxFPS },
    { key: 'Orientation', applies: true, value: localOrientation, set: setLocalOrientation },
    { key: 'EventStartCommand', applies: true, value: localEventStartCmd, set: setLocalEventStartCmd },
    { key: 'EventEndCommand', applies: true, value: localEventEndCmd, set: setLocalEventEndCmd },
  ];

  // Reset every field to its server value when monitor data changes (e.g. after
  // refetch). Field setters are stable, so iterating `fields` here is safe.
  useEffect(() => {
    fields.forEach((f) => f.set(serverValues[f.key]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverValues]);

  const hasChanges = fields.some((f) => f.applies && f.value !== serverValues[f.key]);

  const handleSave = async () => {
    if (!onSave) return;
    const changes: Record<string, string | undefined> = {};
    fields.forEach((f) => {
      if (f.applies && f.value !== serverValues[f.key]) changes[f.key] = f.value;
    });
    // The Path on screen may carry a mask where the password is. Put the real
    // one back, unless the user typed over it (refs #307).
    if (changes.Path !== undefined) {
      changes.Path = restoreUrlCredentials(changes.Path, monitor.Path ?? '');
    }
    await onSave(changes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg w-[calc(100%-1.5rem)] max-h-[90vh] flex flex-col"
        data-testid="monitor-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>{monitor.Name}</DialogTitle>
          <DialogDescription>
            {t('monitor_detail.settings_description', { id: monitor.Id, type: monitor.Type })}
          </DialogDescription>
        </DialogHeader>

        {!editable ? (
          <MonitorRestrictedSettings
            monitor={monitor}
            profileId={profileId}
            reason={restrictedReason}
            cycleSeconds={cycleSeconds}
            onCycleSecondsChange={onCycleSecondsChange}
            orientedResolution={orientedResolution}
            monitorNames={monitorNames}
          />
        ) : (
        <Tabs defaultValue="video" className="mt-2 flex flex-col min-h-0 flex-1">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="video" className="flex-1" data-testid="settings-tab-video">
              {t('monitor_detail.tab_video')}
            </TabsTrigger>
            <TabsTrigger value="capture" className="flex-1" data-testid="settings-tab-capture">
              {t('monitor_detail.tab_capture')}
            </TabsTrigger>
          </TabsList>

          {/* Tab: Capture & Recording */}
          <TabsContent value="capture" className="mt-4 space-y-0 overflow-y-auto px-1 -mx-1">
            {is138Plus ? (
              <>
                <SettingsRow label={t('monitor_detail.capturing_label')} testId="settings-capturing-row" editable>
                  <Select
                    value={localCapturing}
                    onValueChange={setLocalCapturing}
                    disabled={!editable || isSaving}
                  >
                    <SelectTrigger className="w-32 h-8" data-testid="settings-capturing-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">{t('monitor_detail.capturing_none')}</SelectItem>
                      <SelectItem value="Ondemand">{t('monitor_detail.capturing_ondemand')}</SelectItem>
                      <SelectItem value="Always">{t('monitor_detail.capturing_always')}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>

                <SettingsRow label={t('monitor_detail.analysing_label')} testId="settings-analysing-row" editable>
                  <Select
                    value={localAnalysing}
                    onValueChange={setLocalAnalysing}
                    disabled={!editable || isSaving}
                  >
                    <SelectTrigger className="w-32 h-8" data-testid="settings-analysing-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">{t('monitor_detail.analysing_none')}</SelectItem>
                      <SelectItem value="Always">{t('monitor_detail.analysing_always')}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>

                <SettingsRow label={t('monitor_detail.recording_label')} testId="settings-recording-row" editable>
                  <Select
                    value={localRecording}
                    onValueChange={setLocalRecording}
                    disabled={!editable || isSaving}
                  >
                    <SelectTrigger className="w-32 h-8" data-testid="settings-recording-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">{t('monitor_detail.recording_none')}</SelectItem>
                      <SelectItem value="OnMotion">{t('monitor_detail.recording_onmotion')}</SelectItem>
                      <SelectItem value="Always">{t('monitor_detail.recording_always')}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>

                {/* Decoding: read-only. Editing it restarts capture, so it stays in ZM's own UI. */}
                <SettingsRow label={t('monitors.decoding')} testId="settings-decoding-row">
                  {monitor.Decoding ?? '-'}
                </SettingsRow>
              </>
            ) : (
              <SettingsRow label={t('monitor_detail.function_label')} testId="settings-function-row" editable>
                <Select
                  value={localFunction}
                  onValueChange={(v) => setLocalFunction(v as MonitorFunction)}
                  disabled={!editable || isSaving}
                >
                  <SelectTrigger className="w-32 h-8" data-testid="settings-function-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monitor">{t('monitor_detail.mode_monitor')}</SelectItem>
                    <SelectItem value="Modect">{t('monitor_detail.mode_modect')}</SelectItem>
                    <SelectItem value="Record">{t('monitor_detail.mode_record')}</SelectItem>
                    <SelectItem value="Mocord">{t('monitor_detail.mode_mocord')}</SelectItem>
                    <SelectItem value="Nodect">{t('monitor_detail.mode_nodect')}</SelectItem>
                    <SelectItem value="None">{t('monitor_detail.mode_none')}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
            )}

            {/* Enabled toggle only for ZM < 1.38: on 1.38+ Capturing controls this */}
            {!is138Plus && (
              <SettingsRow label={t('monitor_detail.enabled_label')} testId="settings-enabled-row" editable>
                <Switch
                  checked={localEnabled}
                  onCheckedChange={setLocalEnabled}
                  disabled={!editable || isSaving}
                  data-testid="settings-enabled-toggle"
                />
              </SettingsRow>
            )}

            <SettingsRow label={t('monitor_detail.save_jpegs_label')} testId="settings-savejpegs-row" editable>
              <Select
                value={localSaveJPEGs}
                onValueChange={setLocalSaveJPEGs}
                disabled={!editable || isSaving}
              >
                <SelectTrigger className="w-40 h-8" data-testid="settings-savejpegs-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('monitor_detail.save_jpegs_disabled')}</SelectItem>
                  <SelectItem value="1">{t('monitor_detail.save_jpegs_frames')}</SelectItem>
                  <SelectItem value="2">{t('monitor_detail.save_jpegs_analysis')}</SelectItem>
                  <SelectItem value="3">{t('monitor_detail.save_jpegs_both')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            <SettingsRow label={t('monitor_detail.video_writer_label')} testId="settings-videowriter-row" editable>
              <Select
                value={localVideoWriter}
                onValueChange={setLocalVideoWriter}
                disabled={!editable || isSaving}
              >
                <SelectTrigger className="w-40 h-8" data-testid="settings-videowriter-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('monitor_detail.video_writer_disabled')}</SelectItem>
                  <SelectItem value="1">{t('monitor_detail.video_writer_encode')}</SelectItem>
                  <SelectItem value="2">{t('monitor_detail.video_writer_passthrough')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            {onCycleSecondsChange && cycleSeconds !== undefined && (
              <SettingsRow label={t('monitor_detail.cycle_label')} testId="settings-cycle-row" editable>
                <Select value={String(cycleSeconds)} onValueChange={onCycleSecondsChange}>
                  <SelectTrigger className="w-32 h-8" data-testid="monitor-detail-cycle-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('monitor_detail.cycle_off')}</SelectItem>
                    <SelectItem value="5">{t('monitor_detail.cycle_seconds', { seconds: 5 })}</SelectItem>
                    <SelectItem value="10">{t('monitor_detail.cycle_seconds', { seconds: 10 })}</SelectItem>
                    <SelectItem value="15">{t('monitor_detail.cycle_seconds', { seconds: 15 })}</SelectItem>
                    <SelectItem value="30">{t('monitor_detail.cycle_seconds', { seconds: 30 })}</SelectItem>
                    <SelectItem value="60">{t('monitor_detail.cycle_seconds', { seconds: 60 })}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
            )}

            {editable && (
              <div className="pt-4">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                  className="w-full"
                  data-testid="settings-save-button"
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Tab: Video */}
          <TabsContent value="video" className="mt-4 space-y-0 overflow-y-auto px-1 -mx-1">
            {/* App-local per-monitor preferences. Applied on toggle, never part
                of the ZM save payload below. */}
            <MonitorAppPreferences monitor={monitor} profileId={profileId} />

            {/* Source Path: stacked layout for long value */}
            <div className="py-2.5 border-b border-border/40 " data-testid="settings-source-row">
              <span className="text-sm text-muted-foreground flex items-center gap-1">{t('monitor_detail.source_path')}<Pencil className="h-2 w-2 shrink-0 opacity-50" /></span>
              <Input
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                disabled={!editable || isSaving}
                className="mt-1.5 text-xs h-8 font-mono"
                data-testid="settings-source-input"
              />
            </div>

            {/* Username & Password: ZM 1.38+ only (older versions embed creds in the source URL) */}
            {is138Plus && (
              <>
                <SettingsRow label={t('monitor_detail.username')} testId="settings-username-row" editable>
                  <Input
                    value={localUser}
                    onChange={(e) => setLocalUser(e.target.value)}
                    disabled={!editable || isSaving}
                    className="w-40 h-8 text-xs"
                    data-testid="settings-username-input"
                  />
                </SettingsRow>

                <SettingsRow label={t('monitor_detail.password')} testId="settings-password-row" editable>
                  <PasswordInput
                    value={localPass}
                    onChange={(e) => setLocalPass(e.target.value)}
                    disabled={!editable || isSaving}
                    showToggle={!maskCredentials}
                    className="w-40"
                    inputClassName="h-8 text-xs"
                    data-testid="settings-password-input"
                  />
                </SettingsRow>
              </>
            )}

            {/* Method */}
            <SettingsRow label={t('monitor_detail.method_label')} testId="settings-method-row" editable>
              <Select
                value={localMethod}
                onValueChange={setLocalMethod}
                disabled={!editable || isSaving}
              >
                <SelectTrigger className="w-40 h-8" data-testid="settings-method-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rtpRtsp">{t('monitor_detail.method_tcp')}</SelectItem>
                  <SelectItem value="rtpUni">{t('monitor_detail.method_udp')}</SelectItem>
                  <SelectItem value="rtpMulti">{t('monitor_detail.method_udp_multicast')}</SelectItem>
                  <SelectItem value="rtpRtspHttp">{t('monitor_detail.method_http_tunnel')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            {/* Resolution: read-only */}
            <SettingsRow label={t('monitors.resolution')}>
              {orientedResolution ?? `${monitor.Width}x${monitor.Height}`}
            </SettingsRow>

            {/* Colours: read-only */}
            <SettingsRow label={t('monitors.colours')}>
              {monitor.Colours}
            </SettingsRow>

            {/* Max FPS: editable */}
            <SettingsRow label={t('monitors.max_fps')} testId="settings-maxfps-row" editable>
              <Input
                type="number"
                step="any"
                min="0"
                value={localMaxFPS}
                onChange={(e) => setLocalMaxFPS(e.target.value)}
                disabled={!editable || isSaving}
                className="w-24 h-8 text-xs"
                data-testid="settings-maxfps-input"
              />
            </SettingsRow>

            {/* Alarm Max FPS: editable */}
            <SettingsRow label={t('monitors.alarm_max_fps')} testId="settings-alarmmaxfps-row" editable>
              <Input
                type="number"
                step="any"
                min="0"
                value={localAlarmMaxFPS}
                onChange={(e) => setLocalAlarmMaxFPS(e.target.value)}
                disabled={!editable || isSaving}
                className="w-24 h-8 text-xs"
                data-testid="settings-alarmmaxfps-input"
              />
            </SettingsRow>

            {/* Orientation */}
            <SettingsRow label={t('monitor_detail.orientation_label')} testId="monitor-orientation" editable>
              <Select
                value={localOrientation}
                onValueChange={setLocalOrientation}
                disabled={!editable || isSaving}
              >
                <SelectTrigger className="w-40 h-8" data-testid="settings-orientation-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROTATE_0">{t('monitor_detail.rotation_none')}</SelectItem>
                  <SelectItem value="ROTATE_90">{t('monitor_detail.orientation_90')}</SelectItem>
                  <SelectItem value="ROTATE_180">{t('monitor_detail.orientation_180')}</SelectItem>
                  <SelectItem value="ROTATE_270">{t('monitor_detail.orientation_270')}</SelectItem>
                  <SelectItem value="FLIP_HORI">{t('monitor_detail.rotation_flip_horizontal')}</SelectItem>
                  <SelectItem value="FLIP_VERT">{t('monitor_detail.rotation_flip_vertical')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            {/* Controllable: read-only badge */}
            <SettingsRow label={t('monitors.controllable')}>
              <Badge variant={monitor.Controllable === '1' || monitor.Controllable === 'true' ? 'secondary' : 'outline'}>
                {monitor.Controllable === '1' || monitor.Controllable === 'true' ? t('common.yes') : t('common.no')}
              </Badge>
            </SettingsRow>

            {/* Control Address: shown when controllable */}
            {(monitor.Controllable === '1' || monitor.Controllable === 'true') && monitor.ControlAddress && (
              <SettingsRow label={t('monitor_detail.control_address')} testId="settings-control-address">
                <span className="font-mono text-xs">{monitor.ControlAddress}</span>
              </SettingsRow>
            )}

            {/* Linked Monitors: read-only, shown only when defined */}
            {monitor.LinkedMonitors && (
              <SettingsRow label={t('monitor_detail.linked_monitors')} testId="settings-linked-monitors">
                <span className="text-xs">
                  {monitor.LinkedMonitors.split(',')
                    .map(id => monitorNames?.[id.trim()] ?? `#${id.trim()}`)
                    .join(', ')}
                </span>
              </SettingsRow>
            )}

            {/* Event Start Cmd: stacked layout */}
            <div className="py-2.5 border-b border-border/40 " data-testid="settings-event-start-cmd-row">
              <span className="text-sm text-muted-foreground flex items-center gap-1">{t('monitor_detail.event_start_cmd')}<Pencil className="h-2 w-2 shrink-0 opacity-50" /></span>
              <Input
                value={localEventStartCmd}
                onChange={(e) => setLocalEventStartCmd(e.target.value)}
                disabled={!editable || isSaving}
                className="mt-1.5 text-xs h-8 font-mono"
                data-testid="settings-event-start-cmd-input"
              />
            </div>

            {/* Event End Cmd: stacked layout */}
            <div className="py-2.5 border-b border-border/40 " data-testid="settings-event-end-cmd-row">
              <span className="text-sm text-muted-foreground flex items-center gap-1">{t('monitor_detail.event_end_cmd')}<Pencil className="h-2 w-2 shrink-0 opacity-50" /></span>
              <Input
                value={localEventEndCmd}
                onChange={(e) => setLocalEventEndCmd(e.target.value)}
                disabled={!editable || isSaving}
                className="mt-1.5 text-xs h-8 font-mono"
                data-testid="settings-event-end-cmd-input"
              />
            </div>

            {/* Save button for Video tab */}
            {editable && (
              <div className="pt-4">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                  className="w-full"
                  data-testid="settings-video-save-button"
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
