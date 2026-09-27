/**
 * Assistant Section (refs #246)
 *
 * Master toggle, backend picker, and per-backend config for the in-app
 * assistant (Ask). Two backends: the on-device WebLLM model
 * (`@mlc-ai/web-llm`, requires WebGPU) or a remote OpenAI-compatible server
 * such as Ollama (`AssistantOllamaSection.tsx`, no WebGPU needed, works on
 * iOS/low-end devices). The master toggle is NOT gated on WebGPU: Ollama
 * works without it, so only the on-device sub-section below disables itself
 * (and explains why) when `useWebGpuAvailable`'s real
 * `navigator.gpu.requestAdapter()` probe reports no usable adapter.
 * Download/Delete wire directly into `lib/assistant/model-download.ts`:
 * `downloadModel` creates a `backgroundTasks` task itself (the existing
 * background-tasks drawer shows the progress bar and a cancel button), so
 * this component only tracks whether the selected model is downloaded and
 * whether a download/delete is in flight, to enable/disable the two buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { CollapsibleSection, SettingsRow, RowLabel, SettingsSubCard } from './SettingsLayout';
import { AssistantOllamaSection } from './AssistantOllamaSection';
import { AssistantNativeSection } from './AssistantNativeSection';
import { AssistantAdvancedSection } from './AssistantAdvancedSection';
import { AssistantSystemModelEvalRow } from './AssistantSystemModelEvalRow';
import { AppleIntelligenceProvider } from '../../lib/assistant/providers/apple-intelligence';
import { GeminiNanoProvider } from '../../lib/assistant/providers/gemini-nano';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { NINJII_LOGO_URL } from '../../lib/assistant/ninjii-logo';
import { Platform } from '../../lib/platform';
import { useWebGpuAvailable } from '../../hooks/useWebGpuAvailable';
import { useNativeLlmSupported } from '../../hooks/useNativeLlmSupported';
import { useAppleIntelligenceSupported } from '../../hooks/useAppleIntelligenceSupported';
import { useGeminiNanoSupported } from '../../hooks/useGeminiNanoSupported';
import { AssistantGeminiNanoSection } from './AssistantGeminiNanoSection';
import { useToast } from '../../hooks/use-toast';
import { deleteModel, downloadModel, isModelDownloaded } from '../../lib/assistant/model-download';
import { getModelStorageInfo, formatStorageBytes, type ModelStorageInfo } from '../../lib/assistant/model-storage';
import { useBackgroundTasks, type BackgroundTask } from '../../stores/backgroundTasks';
import { log, LogLevel } from '../../lib/logger';
import type { Profile } from '../../api/types';
import type { AssistantBackend } from '../../lib/assistant/types';
import type { ProfileSettings } from '../../stores/settings';

/** 'checking': the `isModelDownloaded` probe for the currently selected model
 *  is in flight (e.g. right after mount or after switching models). Both
 *  buttons stay disabled in this state so neither can fire against a model
 *  whose real cache state isn't known yet. */
type DownloadStatus = 'checking' | 'not-downloaded' | 'downloaded';

export interface AssistantSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function AssistantSection({
  settings,
  update,
  currentProfile,
  updateSettings,
}: AssistantSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // undefined while the requestAdapter() probe is in flight, then the real
  // result. Until it resolves the toggle stays disabled (same as "no
  // WebGPU") but without claiming the device lacks WebGPU.
  const hasWebGPU = useWebGpuAvailable();
  const webGpuUnavailable = hasWebGPU === false;
  // Same undefined-while-probing/boolean-once-resolved shape as hasWebGPU
  // above, but for the native (llama.cpp bridge) backend: only meaningful on
  // a native platform, where the plugin actually exists.
  const {
    supported: nativeSupported,
    reason: nativeUnsupportedReason,
    minimumOs: nativeMinimumOs,
  } = useNativeLlmSupported();
  // Same shape again, for the OS-hosted Apple Foundation Models backend
  // (iOS 26 Apple-Intelligence iPhones). Independent of the native
  // (llama.cpp) gate: a phone can have Apple Intelligence while failing the
  // native memory gate, so both options are offered on their own probes.
  const { supported: appleSupported, reason: appleUnsupportedReason } = useAppleIntelligenceSupported();
  // And again for Android's system model (Gemini Nano over AICore). Its 'notReady' is not
  // a dead end the way Apple's is: the weights download on request, so that reason gets a
  // download row below and `refresh` re-probes once they land.
  const {
    supported: geminiSupported,
    reason: geminiUnsupportedReason,
    refresh: refreshGemini,
  } = useGeminiNanoSupported();
  // The accuracy ranking differs per platform because the backends do: iOS offers
  // three (Ollama, llama.cpp on Metal, Apple Intelligence), Android two since
  // llama.cpp was removed from that build (issue #270), and web two. Each string
  // names the model its tier actually runs, because "on-device" alone does not tell
  // anyone what is answering them.
  const accuracyHintKey = Platform.isIOS
    ? 'settings.assistant.backend_accuracy_hint_ios'
    : Platform.isAndroid
      ? 'settings.assistant.backend_accuracy_hint_android'
      : 'settings.assistant.backend_accuracy_hint_web';
  const availableModels = useMemo(
    () => ASSISTANT.webllmModels,
    [],
  );

  const selectedModel =
    availableModels.find((m) => m.id === settings.assistantModelId) ?? availableModels[0];
  const modelId = selectedModel.id;

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('checking');
  const [deleting, setDeleting] = useState(false);
  const [storageInfo, setStorageInfo] = useState<ModelStorageInfo | undefined>(undefined);
  // Native models live on the filesystem, not in a browser storage partition,
  // so `getModelStorageInfo` cannot see them; the plugin reports the directory
  // size instead.
  // Set by the Cancel button so the resulting download rejection is reported as
  // a user action rather than a failure toast.

  // The backgroundTasks store is the authoritative source for download
  // progress: `downloadModel` reports into it directly, so deriving
  // `downloading` from the store (instead of a local flag set/cleared around
  // the `handleDownload` promise chain) means a stalled follow-up await in
  // this component can never strand the button in "Downloading...". Selects
  // the raw `tasks` array (rule 30 field selector) and derives the match
  // locally rather than subscribing with an inline `.find()` selector, which
  // would return a new reference every render and defeat memoization.
  const tasks = useBackgroundTasks((s) => s.tasks);

  const downloadTask = useMemo<BackgroundTask | undefined>(() => {
    let match: BackgroundTask | undefined;
    for (const task of tasks) {
      if (task.type === 'download' && task.metadata?.modelId === modelId) match = task;
    }
    return match;
  }, [tasks, modelId]);

  const downloading = downloadTask?.status === 'pending' || downloadTask?.status === 'in_progress';


  // Latest selected model id, read *after* the awaits below resolve. The
  // select is disabled while downloading/deleting (primary guard), but a
  // parent could still push a different `assistantModelId` mid-operation
  // (e.g. profile switch), so a stale download/delete resolving must not
  // clobber the status of whatever model is displayed by then.
  const selectedModelIdRef = useRef(modelId);
  useEffect(() => {
    selectedModelIdRef.current = modelId;
  }, [modelId]);

  // Guards post-await setState from running after unmount. Re-set on every
  // mount: StrictMode's mount/unmount/remount would otherwise leave it false
  // for the remounted component's whole life, dropping every guarded update.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDownloadStatus('checking');
    isModelDownloaded(modelId)
      .then((downloaded) => {
        if (!cancelled) setDownloadStatus(downloaded ? 'downloaded' : 'not-downloaded');
      })
      .catch((error) => {
        log.assistant('isModelDownloaded check failed', LogLevel.ERROR, { modelId, error });
        if (!cancelled) setDownloadStatus('not-downloaded');
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  // Re-checks the cache the moment this model's download task reaches a
  // terminal state, instead of waiting on `handleDownload`'s own promise
  // chain to resolve (which is what used to strand the button in
  // "Downloading..." if that chain stalled after the task had already
  // completed). Keyed on the task's id+status rather than the task object
  // itself so it only re-runs on an actual transition, not on every
  // `updateProgress` tick (those keep `status` at 'in_progress').
  useEffect(() => {
    if (!downloadTask) return;
    const taskModelId = downloadTask.metadata?.modelId;
    if (!taskModelId) return;

    if (downloadTask.status === 'completed') {
      let cancelled = false;
      isModelDownloaded(taskModelId)
        .then((downloaded) => {
          if (cancelled) return;
          setDownloadStatus(downloaded ? 'downloaded' : 'not-downloaded');
          if (!downloaded) {
            toast({
              title: t('common.error'),
              description: t('settings.assistant.download_failed'),
              variant: 'destructive',
            });
          }
        })
        .catch((error) => {
          log.assistant('isModelDownloaded re-check failed', LogLevel.ERROR, { modelId: taskModelId, error });
          if (!cancelled) setDownloadStatus('not-downloaded');
        });
      return () => {
        cancelled = true;
      };
    }

    if (downloadTask.status === 'failed') {
      setDownloadStatus('not-downloaded');
      toast({
        title: t('common.error'),
        description: t('settings.assistant.download_failed'),
        variant: 'destructive',
      });
    }
  }, [downloadTask?.id, downloadTask?.status, downloadTask?.metadata?.modelId, t, toast]);

  // Storage info (backend/usage/persisted/OS path) is only meaningful once
  // there's something on disk to describe, and re-probed whenever a
  // download/delete flips `downloadStatus`, so a Download right after this
  // panel first renders picks up fresh numbers instead of stale "not
  // downloaded" state.
  useEffect(() => {
    if (downloadStatus !== 'downloaded') {
      setStorageInfo(undefined);
      return;
    }
    let cancelled = false;
    getModelStorageInfo()
      .then((info) => {
        if (!cancelled) setStorageInfo(info);
      })
      .catch((error) => {
        log.assistant('getModelStorageInfo failed', LogLevel.ERROR, { error });
      });
    return () => {
      cancelled = true;
    };
  }, [downloadStatus, modelId]);

  // Only starts the download; `downloadModel` reports progress/completion/
  // failure onto its background task itself (the effect above reacts to
  // that), so this no longer owns a local "in flight" flag or gates button
  // state on its own promise settling.
  const handleDownload = useCallback(() => {
    downloadModel(modelId).catch((error) => {
      // `downloadModel` normally reports failures onto its background task
      // rather than rejecting; this only catches an unexpected throw before
      // that task bookkeeping runs.
      log.assistant('downloadModel threw', LogLevel.ERROR, { modelId, error });
    });
  }, [modelId]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteModel(modelId);
      if (mountedRef.current && selectedModelIdRef.current === modelId) {
        setDownloadStatus('not-downloaded');
      }
    } catch (error) {
      log.assistant('deleteModel failed', LogLevel.ERROR, { modelId, error });
      if (mountedRef.current && selectedModelIdRef.current === modelId) {
        toast({
          title: t('common.error'),
          description: t('settings.assistant.delete_failed'),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }, [modelId, t, toast]);

  return (
    <CollapsibleSection id="assistant" label={t('settings.assistant.title')}>
      <SettingsSubCard name={currentProfile?.name ?? ''} testId="settings-server-subcard">
        <SettingsRow>
          <RowLabel label={t('settings.assistant.enable')} desc={t('settings.assistant.subtitle')} />
          {/* Decorative: the label in this row already names Ninjii. Sized to
              the two-line row it sits in, which is what gives it room to read
              at a glance. */}
          <img src={NINJII_LOGO_URL} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
          <Switch
            id="assistant-enabled"
            checked={settings.assistantEnabled}
            onCheckedChange={(checked) => update('assistantEnabled', checked)}
            data-testid="assistant-enabled-toggle"
          />
        </SettingsRow>

        {settings.assistantEnabled && (
          <>
            <SettingsRow>
              <RowLabel
                label={t('settings.assistant.in_toolbar')}
                desc={t('settings.assistant.in_toolbar_desc')}
              />
              <Switch
                id="assistant-in-toolbar"
                checked={settings.assistantInToolbar}
                onCheckedChange={(checked) => update('assistantInToolbar', checked)}
                data-testid="assistant-in-toolbar-toggle"
              />
            </SettingsRow>

            {/* On-device WebGPU was removed on a phone or tablet: the picker
                would offer one dead-end option. The native (llama.cpp
                bridge) backend takes its place there once the device passes
                `NativeLlm.isSupported()`; until then (or if it never does)
                the note says why rather than leaving the absence
                unexplained, which is what makes a missing feature read as a
                bug. */}
            {/* `nativeSupported === true` is checked first (not
                `Platform.isNative`) so the e2e test seam in
                `useNativeLlmSupported` (which can only flip `nativeSupported`,
                never the real `Platform.isNative`) reaches this branch.
                Equivalent to the old `Platform.isNative &&` gate in
                production, since the hook itself only ever resolves `true`
                on a native platform there. */}
            {/* The picker shows on a native platform as soon as ANY on-device
                backend passes its own probe: the llama.cpp bridge
                (`nativeSupported`), Apple Foundation Models (`appleSupported`)
                or Gemini Nano over AICore (`geminiSupported`). Options are
                ordered ollama → native → apple → gemini-nano, each gated on its
                own probe; Ollama is always present. When no on-device backend
                is supported the note branch below replaces the picker. */}
            {nativeSupported === true || appleSupported === true || geminiSupported === true ? (
              <div className="px-4 py-3 space-y-2">
                <RowLabel label={t('settings.assistant.backend')} />
                <select
                  className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                  value={settings.assistantBackend}
                  onChange={(e) => update('assistantBackend', e.target.value as AssistantBackend)}
                  data-testid="assistant-backend-select"
                >
                  <option value="ollama">{t('settings.assistant.backend_ollama')}</option>
                  {geminiSupported === true && (
                    <option value="gemini-nano">{t('settings.assistant.backend_gemini_nano')}</option>
                  )}
                  {appleSupported === true && (
                    <option value="apple">{t('settings.assistant.backend_apple')}</option>
                  )}
                  {/* One user-facing "download a model" option across every
                      platform, even though two backends implement it: WebGPU
                      weights on web/desktop ('on-device'), llama.cpp on Metal
                      here ('native'). The engine is a platform fact, not a
                      choice, so the picker names what the user decides (whether
                      to download a model) and the platform picks how. Android
                      reaches neither: llama.cpp was removed from that build
                      (issue #270) and WebLLM is gated off on mobile, so
                      `nativeSupported` is false there and this option is
                      absent. */}
                  {nativeSupported === true && (
                    <option value="native">{t('settings.assistant.backend_download_model')}</option>
                  )}
                </select>
                <p className="text-xs text-muted-foreground" data-testid="assistant-backend-accuracy-hint">
                  {t(accuracyHintKey, { ollama: ASSISTANT.recommendedOllamaModel, native: ASSISTANT.nativeLlmModel.label })}
                </p>
              </div>
            ) : Platform.isNative ? (
              <div className="px-4 py-3 space-y-1" data-testid="assistant-on-device-unavailable">
                {/* Device-specific when the plugin gave a reason ('memory':
                    this device failed the RAM gate; 'os': the system is older
                    than the engine's build floor); the generic mobile note
                    otherwise (probe still running, plugin missing, or probe
                    rejected). */}
                <p className="text-xs text-muted-foreground">
                  {nativeUnsupportedReason === 'memory'
                    ? t('settings.assistant.native_unsupported_memory')
                    : nativeUnsupportedReason === 'os'
                      ? t('settings.assistant.native_unsupported_os', { version: nativeMinimumOs })
                      : t('settings.assistant.on_device_mobile_disabled')}
                </p>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-2">
                <RowLabel label={t('settings.assistant.backend')} />
                <select
                  className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                  value={settings.assistantBackend}
                  onChange={(e) => update('assistantBackend', e.target.value as AssistantBackend)}
                  data-testid="assistant-backend-select"
                >
                  <option value="ollama">{t('settings.assistant.backend_ollama')}</option>
                  {/* Same label as the native branch above; here it is WebGPU
                      weights rather than llama.cpp. See that comment. */}
                  <option value="on-device">{t('settings.assistant.backend_download_model')}</option>
                </select>
                <p className="text-xs text-muted-foreground" data-testid="assistant-backend-accuracy-hint">
                  {t(accuracyHintKey, { ollama: ASSISTANT.recommendedOllamaModel })}
                </p>
              </div>
            )}

            {/* Apple Intelligence is present but the user has it switched off in
                iOS Settings: the picker can't offer the option, so name the one
                thing that unlocks it. Only for reason 'disabled': 'platform'
                (device/OS can't run it) and 'notReady' (still provisioning) are
                not user-actionable here, and undefined means no probe result. */}
            {appleUnsupportedReason === 'disabled' && (
              <div className="px-4 py-3 space-y-1" data-testid="assistant-apple-disabled">
                <p className="text-xs text-muted-foreground">{t('settings.assistant.apple_disabled_hint')}</p>
              </div>
            )}

            {/* The Android mirror of the block above, and the one case where the reason is
                fixable right here: Gemini Nano exists on this device but AICore has not
                downloaded the weights, so the option cannot be offered yet. 'platform'
                (no Gemini Nano at all) is not actionable and gets nothing. */}
            {geminiUnsupportedReason === 'notReady' && <AssistantGeminiNanoSection onDownloaded={refreshGemini} />}

            {nativeSupported === true && settings.assistantBackend === 'native' ? (
              <AssistantNativeSection />
            ) : settings.assistantBackend === 'apple' ? (
              // Apple Foundation Models is OS-hosted: no download/delete surface,
              // no KV-cache slot, no token counts. The only control here is the
              // developer on-device eval, shown when this supported backend is
              // the selected one (refs #270).
              appleSupported === true ? (
                <AssistantSystemModelEvalRow
                  createProvider={() => new AppleIntelligenceProvider(0)}
                  backend="apple"
                  modelLabel="Apple Intelligence"
                />
              ) : null
            ) : settings.assistantBackend === 'gemini-nano' ? (
              // AICore-hosted, and by this point already downloaded: no model to select and no
              // delete (the weights are the system's, shared with every app that uses them).
              // The eval row is the one control it does get, and for the reason it exists at
              // all: the prompt-eval harness reaches a backend over HTTP, and neither system
              // model has an HTTP surface, so this is the only way either gets a score.
              geminiSupported === true ? (
                <AssistantSystemModelEvalRow
                  createProvider={() => new GeminiNanoProvider(0)}
                  backend="gemini-nano"
                  modelLabel="Gemini Nano"
                />
              ) : null
            ) : settings.assistantBackend === 'ollama' || Platform.isNative ? (
              <AssistantOllamaSection settings={settings} update={update} currentProfile={currentProfile} />
            ) : (
              webGpuUnavailable && (
                <div className="px-4 py-3 space-y-1" data-testid="assistant-no-webgpu">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.no_webgpu')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.no_webgpu_hint')}</p>
                </div>
              )
            )}

            {!Platform.isNative && settings.assistantBackend === 'on-device' && hasWebGPU === true && (
              <>
                <div className="px-4 py-3 space-y-2">
                  <RowLabel label={t('settings.assistant.model')} />
                  <select
                    className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                    value={settings.assistantModelId}
                    onChange={(e) =>
                      currentProfile && updateSettings(currentProfile.id, { assistantModelId: e.target.value })
                    }
                    disabled={downloading || deleting}
                    data-testid="assistant-model-select"
                  >
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t('settings.assistant.on_device_ollama_hint', {
              model: ASSISTANT.recommendedOllamaModel,
            })}
          </p>
        </div>

                <div className="px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadStatus !== 'not-downloaded' || downloading || deleting}
                      onClick={handleDownload}
                      data-testid="assistant-model-download"
                    >
                      {downloading ? t('settings.assistant.downloading') : t('settings.assistant.download')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadStatus !== 'downloaded' || downloading || deleting}
                      onClick={handleDelete}
                      data-testid="assistant-model-delete"
                    >
                      {t('settings.assistant.delete')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {t('settings.assistant.download_size', { size: selectedModel.approxSizeMb })}
                    </span>
                    {downloadStatus === 'downloaded' && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid="assistant-model-downloaded-status"
                      >
                        {t('settings.assistant.downloaded')}
                      </span>
                    )}
                  </div>
                </div>

                {/* An on-device model that loads at all is usually fine; the
                    failure mode is the model's weights plus its KV cache not
                    fitting in VRAM, which surfaces as a crash or a failed load
                    rather than a clean error we can catch and explain in place
                    (refs #246). Naming it here, next to the picker where the
                    size tradeoff is made, is what turns an unexplained crash
                    into a next step. */}
                <div className="px-4 py-3" data-testid="assistant-model-memory-note">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.oom_note')}</p>
                </div>

                {downloadStatus === 'downloaded' && storageInfo && (
                  <div
                    className="px-4 py-3 space-y-1 min-w-0"
                    data-testid="assistant-model-storage"
                  >
                    <p
                      className="text-xs text-muted-foreground truncate min-w-0"
                      title={storageInfo.osPath}
                    >
                      {storageInfo.osPath
                        ? t('settings.assistant.storage_path', { path: storageInfo.osPath })
                        : t(`settings.assistant.storage_browser_${storageInfo.backend}`)}
                    </p>
                    {storageInfo.usageBytes !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.assistant.storage_used', { size: formatStorageBytes(storageInfo.usageBytes) })}
                      </p>
                    )}
                    {storageInfo.persisted !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {storageInfo.persisted
                          ? t('settings.assistant.storage_persistent_yes')
                          : t('settings.assistant.storage_persistent_no')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{t('settings.assistant.storage_note')}</p>
                  </div>
                )}

                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.privacy')}</p>
                </div>
              </>
            )}

            {/* Last, and collapsed: these apply to whichever backend is
                selected, and none of them is part of normal setup. */}
            <AssistantAdvancedSection settings={settings} update={update} />
          </>
        )}
      </SettingsSubCard>
    </CollapsibleSection>
  );
}
