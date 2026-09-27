/**
 * Shared assistant window chrome (refs #246).
 *
 * The desktop card and the mobile sheet are different shells but share the same
 * controls: which backend label to show, and clear / minimize / close. This
 * keeps that logic in one place so the two shells only differ in layout, not
 * behavior.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useAssistantEnabled } from '../../hooks/useAssistantEnabled';
import { useAssistantStore } from '../../stores/assistant';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { assistantBackendLabel } from '../../lib/assistant/providers/provider';
import { Platform } from '../../lib/platform';

/** Marks the point the model can no longer see (agent.ts's
 *  sliceAfterContextBoundary), and is rendered as a divider by AskPanel. The
 *  on-device variant tells the user memory was freed; the remote (Ollama)
 *  variant must not, since no local model was ever loaded to unload. */
const CONTEXT_CLEARED_MANUAL_KEY = 'assistant.context_cleared_manual';
const CONTEXT_CLEARED_MANUAL_REMOTE_KEY = 'assistant.context_cleared_manual_remote';

export interface AssistantChrome {
  /** Model + where it runs, e.g. "Qwen3 1.7B · On-device". Empty when nothing
   *  is configured yet. */
  backendLabel: string;
  /** Wipe the current profile's conversation and live activity, and release
   *  the on-device model's memory. */
  clear: () => void;
  minimize: () => void;
  close: () => void;
  running: boolean;
  /** Clear is a no-op with an empty thread or a turn in flight. */
  canClear: boolean;
}

export function useAssistantChrome(): AssistantChrome {
  const { t } = useTranslation();
  const { currentProfile } = useCurrentProfile();
  const profileId = currentProfile?.id;
  // Backend settings are server-scoped: read the profile that carries the
  // assistant configuration, the one AskPanel pins to by default (refs #536).
  const { settings } = useProfileById(useAssistantEnabled().profileId);

  const running = useAssistantStore((s) => s.running);
  const threadLength = useAssistantStore((s) => (profileId ? (s.threads[profileId]?.length ?? 0) : 0));
  const reset = useAssistantStore((s) => s.reset);
  const append = useAssistantStore((s) => s.append);
  const clearActivities = useAssistantStore((s) => s.clearActivities);
  const minimize = useAssistantPanelStore((s) => s.minimize);
  const close = useAssistantPanelStore((s) => s.close);

  const backendLabel = useMemo(
    () => assistantBackendLabel(settings, t),
    [settings.assistantBackend, settings.assistantModelId, settings.assistantOllamaModel, t],
  );

  return {
    backendLabel,
    clear: () => {
      if (!profileId) return;
      reset(profileId);
      clearActivities();
      // A note rather than an empty panel: a conversation vanishing with no
      // explanation reads as a bug, and this is also the boundary the model
      // cannot see past (agent.ts slices the history here).
      const clearedKey =
        settings.assistantBackend === 'on-device'
          ? CONTEXT_CLEARED_MANUAL_KEY
          : CONTEXT_CLEARED_MANUAL_REMOTE_KEY;
      append(profileId, { role: 'assistant', text: `__i18n:${clearedKey}`, contextBoundary: true });
    },
    minimize,
    close,
    running,
    // Enabled with an empty thread too: with nothing to clear there may still
    // be a loaded model to release.
    canClear: !running && (threadLength > 0 || Platform.isNative),
  };
}
