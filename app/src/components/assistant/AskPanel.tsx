/**
 * AskPanel: the in-app assistant conversation UI (refs #246).
 *
 * Renders the per-profile thread from `stores/assistant.ts` and drives one
 * `runAssistantTurn` per send. Two forward contracts from the agent loop
 * (lib/assistant/agent.ts) land here:
 *
 * - A leading `__i18n:<key>` on an assistant message's `text` is a sentinel
 *   (currently only the iteration-cap message) that must be localized with
 *   `t(key)` instead of rendered as literal/markdown text.
 * - Aborting (or unmounting mid-turn) must abort the in-flight
 *   `AbortController`, so the loop's `signal.aborted` checks unwind it
 *   instead of leaving it hung.
 *
 * Test seam: in test mode (`isAssistantTestMode()`), before running a turn
 * this reads `window.__assistantMockScript` (seeded by e2e steps) and loads
 * it into `sharedMockProvider`. This is the only production-visible test
 * seam the assistant adds; `isAssistantTestMode()` is false in production
 * builds, so the branch never runs there.
 */
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Send, Square } from 'lucide-react';
import { getVersion } from '../../api/auth';
import type { ProfileId } from '../../api/types';
import { getSession } from '../../services/sessions';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useAssistantEnabled } from '../../hooks/useAssistantEnabled';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { runAssistantTurn, isContextNearlyFull } from '../../lib/assistant/agent';
import {
  assistantBackendLabel,
  getAssistantProvider,
  isAssistantTestMode,
  PROVIDER_NOT_AVAILABLE_MESSAGE,
} from '../../lib/assistant/providers/provider';
import { sharedMockProvider } from '../../lib/assistant/providers/mock';
import { buildSystemPrompt } from '../../lib/assistant/system-prompt';
import { getObjectLabels } from '../../lib/assistant/object-labels';
import { TOOLS, specializeToolSchemas, withServerArg } from '../../lib/assistant/tools';
import { buildScopedServers } from '../../lib/assistant/scoped-servers';
import { interpretWhen } from '../../lib/assistant/window-interpreter';
import { resolveTimeframesFromQuestion, buildTimeframeSystemLine } from '../../lib/assistant/timeframe-stage';
import { getMonitorRoster, scanMonitorMentions, resolveMonitorMention, resolveCoverage, buildMonitorSystemLine, contextForTimeCall } from '../../lib/assistant/monitor-stage';
import { planToolCalls, type PlannedToolCall } from '../../lib/assistant/plan';
import { suggestOllamaBaseUrl, warmOllamaModel } from '../../lib/assistant/providers/openai';
import { classifyRequest, buildNoToolPrompt, prevTurnFromThread, type PrevTurn, type RequestKind } from '../../lib/assistant/triage';
import type { AssistantBackend, AssistantMessage, AssistantTurn, ProviderConfig, ToolActivity, ToolContext, TraceEntry } from '../../lib/assistant/types';
import { log, LogLevel } from '../../lib/logger';
import { getSecureValue } from '../../lib/security/secureStorage';
import { Markdown } from '../../lib/markdown';
import { Platform } from '../../lib/platform';
import { resolveQueryError } from '../../lib/query/query-error';
import { cn } from '../../lib/utils';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { AssistantIntro } from './AssistantIntro';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../ui/button';
import { ProfilePicker } from '../profile-picker';
import { ErrorBanner } from '../ui/query-state';
import { AssistantResultCards } from './AssistantResultCards';
import { useAssistantHost } from './useAssistantHost';
import { isAbortError } from '../../lib/is-abort-error';

declare global {
  interface Window {
    /** e2e-only: a script for `sharedMockProvider`, read once per turn when
     *  `isAssistantTestMode()` is true. Never set outside tests/steps. */
    __assistantMockScript?: AssistantTurn[];
    /** e2e-only: the context window `sharedMockProvider` should claim, so a
     *  test can drive the auto-clear threshold without a real model. Read
     *  under the same `isAssistantTestMode()` gate as the script above. */
    __assistantMockContextWindow?: number;
  }
}

/** The agent loop never renders text itself; it only ever emits this prefix
 *  (see agent.ts's ITERATION_CAP_KEY) to hand the localization job to us. */
const I18N_SENTINEL = '__i18n:';

/** Backends whose model is an OS/system service the user did not choose and
 *  cannot swap (least accurate of the offered backends). Joining the nudge is a
 *  matter of being added here, not a new conditional scattered through the
 *  panel: 'gemini-nano' (Android's system model, via AICore) did exactly that. */
const SYSTEM_MODEL_BACKENDS: AssistantBackend[] = ['apple', 'gemini-nano'];

/** Matches `providers/webllm.ts`'s `PARSE_ERROR_TEXT` sentinel key (with the
 *  `__i18n:` prefix already stripped): only this turn ever carries `raw`. */
const PARSE_ERROR_KEY = 'assistant.parse_error';

/** Text of the auto-clear notice this panel appends once a turn's prompt
 *  crosses `ASSISTANT.contextClearThreshold`; the message carrying it is the
 *  `contextBoundary` the next turn's history is sliced at. */
const CONTEXT_CLEARED_KEY = 'assistant.context_cleared';

// Stable reference for the "no thread yet" case. Without it, the `thread`
// selector below would return a fresh `[]` literal every render whenever
// `threads[profileId]` is undefined (i.e. before the first message), which
// makes useSyncExternalStore see a new snapshot on every call and crashes
// the app with "Maximum update depth exceeded" the moment AskPanel mounts.
const EMPTY_THREAD: AssistantMessage[] = [];

/** One plain-text transcript of a whole turn, headed by round.
 *
 *  Deliberately ONE `<pre>` and not a component per round: the point of this
 *  is to be copied out of the app and pasted into a bug report, and a stack of
 *  separate scroll boxes cannot be selected in one gesture. Headers separate
 *  the rounds instead.
 *
 *  Tool steps carry the ZoneMinder requests they actually made, because the
 *  gap between "what the model was told" and "what was asked of the server" is
 *  where the real bugs have been: a `when: "today"` query that reported no time
 *  filter, and a zero-row object query whose answer never mentioned the filter. */
function formatTrace(trace: TraceEntry[]): string {
  const blocks = trace.map((entry, index) => {
    const n = index + 1;
    if (entry.kind === 'question') {
      return `=== QUESTION ===\n${entry.text}`;
    }
    if (entry.kind === 'exchange') {
      const { backend, model, ms, sent, received } = entry.exchange;
      return [
        `=== ${n}. MODEL ROUND (${backend} · ${model} · ${ms} ms) ===`,
        '--- sent ---',
        sent,
        '--- received ---',
        received,
      ].join('\n');
    }
    return [
      `=== ${n}. TOOL ${entry.name}${entry.isError ? ' (error)' : ''} ===`,
      '--- input ---',
      JSON.stringify(entry.input, null, 2),
      ...(entry.apiCalls?.length ? ['--- zoneminder requests ---', entry.apiCalls.join('\n')] : []),
      '--- output ---',
      entry.output,
    ].join('\n');
  });
  return blocks.join('\n\n');
}

function ModelTranscript({ trace, t, live }: { trace: TraceEntry[]; t: TFunction; live?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatTrace(trace));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Clipboard access can be denied (permissions, insecure origin). The
      // text is selectable in the block below either way, so this is a
      // convenience that must never throw into the panel.
      log.assistant('Could not copy the transcript', LogLevel.WARN, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <details
      className="mt-1 text-xs text-muted-foreground"
      data-testid={live ? 'assistant-live-transcript' : 'assistant-model-transcript'}
    >
      <summary className="cursor-pointer select-none">
        {t('assistant.show_transcript', { count: trace.length })}
      </summary>
      <div className="mt-1 flex justify-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => void handleCopy()}
          aria-label={t(copied ? 'assistant.transcript_copied' : 'assistant.copy_transcript')}
          title={t(copied ? 'assistant.transcript_copied' : 'assistant.copy_transcript')}
          data-testid="assistant-transcript-copy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre
        className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2"
        data-testid="assistant-transcript-text"
      >
        {formatTrace(trace)}
      </pre>
    </details>
  );
}

/** Renders one assistant turn's text, resolving the `__i18n:` sentinel. When
 *  the turn is the parse-error fallback and carried the model's raw output
 *  (see providers/webllm.ts's `parseWebLlmTurn` and agent.ts's `raw` copy),
 *  a collapsed `<details>` offers it so the user (or the person debugging
 *  their report) can see why the turn failed instead of just the apology. */
function renderAssistantText(msg: AssistantMessage, t: TFunction) {
  const { text, raw } = msg;
  if (!text) return null;
  if (text.startsWith(I18N_SENTINEL)) {
    const key = text.slice(I18N_SENTINEL.length);
    return (
      <>
        <p className="text-sm">{t(key)}</p>
        {key === PARSE_ERROR_KEY && raw && (
          <details className="mt-1 text-xs text-muted-foreground" data-testid="assistant-raw-output">
            <summary className="cursor-pointer select-none">{t('assistant.show_raw_output')}</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2">
              {raw}
            </pre>
          </details>
        )}
      </>
    );
  }
  return <Markdown source={text} />;
}

/** Compact, truncated (rule 11) JSON preview of a tool call's input for the
 *  activity step list, e.g. `{"interval":"24 hour"}`. `undefined` for a tool
 *  called with no input, so the step shows just the tool name. */
function formatActivityInput(input: Record<string, unknown>): string | undefined {
  if (!input || Object.keys(input).length === 0) return undefined;
  const json = JSON.stringify(input);
  return json.length > ASSISTANT.activityInputPreviewChars
    ? `${json.slice(0, ASSISTANT.activityInputPreviewChars)}…`
    : json;
}

/** Renders the assistant's intermediate work as ONE muted line rather than a
 *  growing list.
 *
 *  A turn can spend several round trips deciding and calling tools before it
 *  answers, and showing each one stacked pushed the actual answer off screen and
 *  read like a transcript of the model talking to itself. Live, the line is
 *  replaced by whatever step is current; once the turn is done, it collapses to
 *  the tools that ran. Either way it stays one line, subordinate to the answer.
 *
 *  `title` carries the full detail for anyone who wants it, so nothing is lost
 *  by not rendering every step (rule 11: truncate, keep a title). */
function ActivityLine({ steps, live }: { steps: ToolActivity[]; live?: boolean }) {
  const { t } = useTranslation();
  if (steps.length === 0) return null;

  if (!live && steps.every((a) => a.kind === 'model' || !a.toolName)) return null;

  const latest = steps[steps.length - 1];
  const compactInput = latest.kind === 'model' ? undefined : formatActivityInput(latest.input);

  // Live: say what is happening right now, including the model's own reasoning
  // between tool calls (collapsed to one line, newlines flattened, so a long
  // chain of thought cannot push the conversation around). Finished: name the
  // distinct tools used, since the last step alone loses the earlier ones.
  const label = live
    ? latest.kind === 'model'
      ? latest.detail!.replace(/\s+/g, ' ')
      : latest.status === 'running'
        ? t('assistant.activity.running', { tool: latest.toolName })
        : latest.status === 'done'
          ? t('assistant.activity.done', { tool: latest.toolName })
          : t('assistant.activity.error', { tool: latest.toolName })
    : t('assistant.activity.used', {
        tools: [...new Set(steps.filter((a) => a.kind !== 'model' && a.toolName).map((a) => a.toolName))].join(', '),
      });

  // Never coloured as a failure, however many steps errored. A rejected tool
  // call is a normal step of a working turn: the loop hands the model a
  // correction (an object label this install does not record, a time phrase it
  // invented, a repeat of a call it already made) and the next round fixes it.
  // "Used count_events, list_events" in red reported a problem to the user
  // about a turn that had already solved itself and answered correctly.
  return (
    <p
      data-testid="assistant-activities"
      title={steps
        .map((a) =>
          a.kind === 'model'
            ? a.detail
            : `${a.toolName}${a.input && Object.keys(a.input).length > 0 ? ` ${JSON.stringify(a.input)}` : ''}`,
        )
        .join('\n')}
      className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
    >
      <span className="truncate" data-testid="assistant-activity-step">{label}</span>
      {live && compactInput && <span className="truncate opacity-70">{compactInput}</span>}
    </p>
  );
}

export function AskPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { currentProfile: singleProfile, settings: singleSettings } = useCurrentProfile();
  // All mode has no single "current profile" (useCurrentProfile returns null
  // there), so the assistant pins itself to one profile from the scope
  // instead - every ToolContext/objectLabels/system-prompt read below then
  // reads that pinned profile's id, same pattern as Task 4's server-scoped
  // page pickers (refs #337).
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  const [pinnedProfileId, setPinnedProfileId] = useState<ProfileId | undefined>(undefined);
  // The member that actually carries assistant configuration, falling back to
  // the first in scope. Pinning blindly to profiles[0] opened the panel
  // against an unconfigured backend whenever the user enabled the assistant on
  // some other member of the group (refs #337).
  const { profileId: configuredProfileId } = useAssistantEnabled();
  // A group of two or more is what turns the tool layer multi-server; a
  // one-member group answers about that one server, exactly like single mode.
  const coversAllServers = isAllMode && (scope?.profiles.length ?? 0) > 1;
  const defaultPinnedId = isAllMode ? (pinnedProfileId ?? configuredProfileId) : undefined;
  const { profile: pinnedProfile, settings: pinnedSettings } = useProfileById(defaultPinnedId);
  // Single mode: the page's own current profile/settings, byte-identical to
  // before. All mode: the pinned profile (defaults to the first in scope).
  const currentProfile = isAllMode ? pinnedProfile : singleProfile;
  const settings = isAllMode ? pinnedSettings : singleSettings;
  const profileId = currentProfile?.id;
  // defaultPinnedId (undefined in single mode) so the token follows the
  // pinned profile in All mode, same as every other All-mode call site -
  // an unparented call here resolves to the no-current-profile sentinel and
  // never refreshes, 401ing authenticated result-card thumbnails (refs #337).
  const { token: accessToken, isFresh: accessTokenFresh } = useFreshAccessToken(defaultPinnedId);

  const { host } = useAssistantHost();

  const thread = useAssistantStore((s) => (profileId ? (s.threads[profileId] ?? EMPTY_THREAD) : EMPTY_THREAD));
  const running = useAssistantStore((s) => s.running);
  const activities = useAssistantStore((s) => s.activities);
  const liveTrace = useAssistantStore((s) => s.liveTrace);
  const phase = useAssistantStore((s) => s.phase);
  const append = useAssistantStore((s) => s.append);
  const setRunning = useAssistantStore((s) => s.setRunning);
  const clearActivities = useAssistantStore((s) => s.clearActivities);

  // Every backend, not just on-device. The remaining English surface is the
  // triage prompt and the grounding regexes; time interpretation and tool
  // routing are language-neutral since refs #265 (the model interprets, the
  // loop fails open).
  // `startsWith`, not equality: i18next reports regional variants like "en-GB".
  const assistantInNonEnglish = !i18n.language.toLowerCase().startsWith('en');

  // The active backend runs an OS/system model the user cannot pick or swap,
  // and it is the least accurate option; a persistent note points at the
  // llama.cpp on-device backend. `assistantBackendLabel` names the backend so
  // the string never hardcodes one (refs #270).
  const usingSystemModel = SYSTEM_MODEL_BACKENDS.includes(settings.assistantBackend);
  // Where to send them instead. iOS still has llama.cpp on Metal, which outranks
  // Apple Intelligence; Android no longer has it at all, so there the better
  // backend is the user's own Ollama server.
  const systemModelSuggestion = Platform.isIOS
    ? t('settings.assistant.backend_download_model')
    : t('settings.assistant.backend_ollama');

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  /** The model a warmup is loading right now, for the status line below the
   *  thread; null when no warmup is in flight (refs #261). */
  const [warmingModel, setWarmingModel] = useState<string | null>(null);
  /** Ticks elapsed seconds while the Ollama server-slow note shows: no protocol progress
   *  exists there, so elapsed time is the only honest metric. Interval cleared on phase
   *  change and unmount (no timer leak). */
  const [serverSlowSec, setServerSlowSec] = useState(0);
  useEffect(() => {
    if (phase?.phase !== 'server_slow') {
      setServerSlowSec(0);
      return;
    }
    const started = Date.now();
    setServerSlowSec(0);
    const id = setInterval(() => setServerSlowSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase?.phase]);

  // Localized, explicit-number status for a slow-but-not-every-time phase (refs #270). The UI
  // owns wording, percent/elapsed formatting and the show-nothing threshold; providers only
  // report raw phases. null renders nothing (fast prefill below the threshold, or no phase).
  const statusLabel: string | null = (() => {
    if (!phase) return null;
    const percent = Math.round((phase.progress ?? 0) * 100);
    switch (phase.phase) {
      case 'loading_model':
        return t('assistant.status.loading_model', { percent });
      case 'prefill': {
        // At 100% the fill is done but the (silent) decode still runs; showing a frozen
        // "…100%" through it reads as stuck, so fall back to the plain running indicator.
        if ((phase.progress ?? 0) >= 1) return null;
        if ((phase.tokens ?? 0) < ASSISTANT.assistantPrefillNoteMinTokens) return null;
        const batch = { chunk: phase.chunk ?? 1, chunks: phase.chunks ?? 1, percent };
        // Wording by purpose: triage (slot 1) is understanding the question; a first-turn chat
        // (no prior assistant reply) is reading the system instructions, not the conversation.
        if (phase.slot === 1) return t('assistant.status.understanding', batch);
        const hasHistory = thread.some((m) => m.role === 'assistant');
        return t(hasHistory ? 'assistant.status.prefill' : 'assistant.status.preparing', batch);
      }
      case 'retry':
        return t('assistant.status.retry');
      case 'server_slow':
        return t('assistant.status.server_slow', { seconds: serverSlowSec });
      default:
        return null;
    }
  })();
  const abortControllerRef = useRef<AbortController | null>(null);
  /** The slots the previous turn resolved (refs #446), merged into the
   *  thread-derived question/offer to form the structured context a
   *  declared follow-up may inherit. Session-local by design. */
  const prevTurnSlotsRef = useRef<{ profileId: string; monitors?: string[]; periods?: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevThreadLengthRef = useRef(thread.length);

  // Focus the message input on mount so a keyboard user who just opened the
  // assistant (e.g. via the `?` key) can start typing immediately (refs #246).
  // A plain `ref` + effect is used instead of the `autoFocus` JSX attribute,
  // which jsx-a11y/no-autofocus (rule 35) blocks.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Abort any in-flight turn and decline any pending confirm on unmount, so a
  // closed panel never leaves the agent loop (or a stuck confirm Promise) alive.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Warm the Ollama model as soon as the panel opens, instead of letting the
  // FIRST question pay for it: measured live, a cold first question cost ~36s
  // (VRAM load plus one full thinking chain, since reasoning is only disabled
  // once the server is confirmed) while every later one took ~2s (refs #261).
  // warmOllamaModel de-dupes per session, so reopening the panel is free, and
  // it never throws; a server that is down surfaces on the real turn instead.
  // Not in test mode: the mock backend has no server to warm, and a stray
  // request would fail noisily in e2e logs.
  useEffect(() => {
    if (settings.assistantBackend !== 'ollama' || !profileId || isAssistantTestMode()) return;
    const model = settings.assistantOllamaModel;
    if (!model) return;
    let cancelled = false;
    void (async () => {
      const apiKey = await getSecureValue(`${ASSISTANT.apiKeyStoragePrefix}${profileId}`);
      const baseUrl =
        settings.assistantOllamaBaseUrl ||
        suggestOllamaBaseUrl(currentProfile?.apiUrl) ||
        ASSISTANT.defaultOllamaBaseUrl;
      if (cancelled) return;
      setWarmingModel(model);
      await warmOllamaModel({ baseUrl, model, apiKey: apiKey ?? undefined });
      if (!cancelled) setWarmingModel(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.assistantBackend, settings.assistantOllamaModel, settings.assistantOllamaBaseUrl, profileId, currentProfile?.apiUrl]);

  // The Clear button now lives in AssistantWidget.tsx, which resets the
  // shared store (`reset(profileId)` + `clearActivities()`). This component
  // still owns ephemeral, non-persisted UI state (a stale error banner, the
  // "not configured" CTA, unsent input text) that a Clear should also wipe.
  // Detecting the store's thread going from non-empty to empty is simpler
  // than plumbing an imperative ref between the two components (refs #246).
  useEffect(() => {
    if (thread.length === 0 && prevThreadLengthRef.current > 0) {
      setError(null);
      setNotConfigured(false);
      setInput('');
    }
    prevThreadLengthRef.current = thread.length;
  }, [thread.length]);

  const handleAbort = () => {
    abortControllerRef.current?.abort();
  };

  // An intro example chip fills the input instead of sending immediately
  // (refs #246), so the user can edit it before it becomes a real turn; the
  // focus() lets them hit Enter right away if they don't want to edit it.
  const handleExampleClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !profileId || running) return;

    setInput('');
    setError(null);
    setNotConfigured(false);
    append(profileId, { role: 'user', text });
    setRunning(true);
    clearActivities();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // The optional Bearer key for the Ollama/OpenAI-compatible backend
      // never lives in profile settings (rule 7 settings are plaintext), so
      // it's read from secureStorage here, right before building the
      // provider (see AssistantOllamaSection.tsx for where it's saved).
      const apiKey = await getSecureValue(`${ASSISTANT.apiKeyStoragePrefix}${profileId}`);
      const providerConfig: ProviderConfig = {
        backend: settings.assistantBackend,
        modelId: settings.assistantModelId,
        // An unset URL resolves to the profile's own ZoneMinder host, which is
        // a far better guess than localhost (on a phone, localhost is the
        // phone). Settings shows the same value as the placeholder.
        ollamaBaseUrl:
          settings.assistantOllamaBaseUrl ||
          suggestOllamaBaseUrl(currentProfile?.apiUrl) ||
          ASSISTANT.defaultOllamaBaseUrl,
        ollamaModel: settings.assistantOllamaModel,
        apiKey: apiKey ?? undefined,
        temperature: settings.assistantTemperature,
        timeoutMs: settings.assistantTimeoutSec * 1000,
      };
      const provider = getAssistantProvider(providerConfig);

      if (isAssistantTestMode() && window.__assistantMockScript) {
        sharedMockProvider.setScript(window.__assistantMockScript);
        sharedMockProvider.contextWindow = window.__assistantMockContextWindow;
      }

      const timezone = currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Four independent context reads, fetched together: none depends on
      // another, all are cached or cheap, and sequential awaits cost a full
      // round trip each on a cold cache.
      const [zmVersion, objectLabels, monitorRoster, servers] = await Promise.all([
        // getSession(profileId), not getCurrentSession(): an aggregate id
        // names no server, so there is no session for it and
        // getCurrentSession() throws (swallowed below, silently
        // dropping the version from the system prompt every turn). profileId
        // here is the resolved pinned/current profile, matching every other
        // read in this block (refs #337).
        (async () => {
          if (!profileId) return '';
          try {
            return (await getVersion(getSession(profileId).client)).version;
          } catch (e) {
            log.assistant('Failed to fetch ZM version for the assistant system prompt', LogLevel.WARN, { error: e });
            return '';
          }
        })(),
        // The install's own label vocabulary, so the model can map "vehicles"
        // onto the labels this detector actually writes instead of the app
        // guessing at a taxonomy. Cached per profile; never throws.
        getObjectLabels(profileId),
        // The camera the question refers to is resolved BEFORE any model round
        // (refs #427): a deterministic scan for monitor names the question
        // states verbatim; anything it cannot decide (a place word like "front
        // door") goes to the triage round below, constrained to this roster.
        // Skipped inside a group: monitor names collide across servers, and the
        // aggregate id has no session (getMonitorRoster returns [] then anyway).
        // Cached per profile; never throws.
        isAllMode || isAssistantTestMode() ? [] : getMonitorRoster(profileId),
        // Every server this view combines, or an empty list outside a group
        // (refs #337). It drives three things that must agree: the roster in the
        // prompt, the `server` argument's enum, and which sessions the tool
        // wrapper may reach. Pinned-profile behavior is unchanged when the group
        // holds one server, since `buildScopedServers` returns nothing then.
        isAllMode ? buildScopedServers(scope?.profiles ?? []) : [],
      ]);
      const monitorScanHits = scanMonitorMentions(text, monitorRoster);
      const serverNames = servers.map((s) => s.name);

      const system = buildSystemPrompt({
        objectLabels,
        now: new Date(),
        timezone: currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: i18n.language,
        zmVersion,
        servers: serverNames,
      });

      // Image-building inputs for event result cards (refs #246), mirroring
      // MonitorRecentEvents.tsx's buildRow: only actually used when a tool
      // returns event rows (list_events/get_event via lib/assistant/display.ts).
      const ctx: ToolContext = {
        profileId,
        servers,
        queryClient,
        host,
        portalUrl: currentProfile?.portalUrl,
        accessToken: accessTokenFresh ? accessToken : null,
        minStreamingPort: resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort),
        thumbnailFallbackChain: settings.thumbnailFallbackChain,
        // Date and time formats are selection-scoped: the current selection's,
        // even when an aggregate pins the panel to one member (refs #536).
        dateTimeFormat: {
          dateFormat: singleSettings.dateFormat,
          timeFormat: singleSettings.timeFormat,
          customDateFormat: singleSettings.customDateFormat,
          customTimeFormat: singleSettings.customTimeFormat,
        },
        // Same expression as `system`'s `timezone` above (refs #246): list_events'
        // `range` input must resolve "today"/"yesterday" against the identical
        // zone the system prompt already told the model "today" means.
        timezone: currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        question: text,
        locale: i18n.language,
        objectLabels,
        // The `when` phrase interpreter (refs #265): the session's own model
        // maps the user's time words to structured fields under a constrained
        // schema, so no app-side phrase grammar exists.
        interpretWhen: (phrase: string) =>
          interpretWhen(
            phrase,
            provider,
            new Date(),
            currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            controller.signal,
          ),
      };
      const history = useAssistantStore.getState().getThread(profileId);
      // The previous turn's STRUCTURED facts (refs #446): the thread gives
      // the question and any closing offer; the slots the last run resolved
      // ride the ref below. Never answer prose - the model mined "truck",
      // "Front Yard", and "today" out of it across three live transcripts.
      const prevTurn: PrevTurn | undefined = (() => {
        const base = prevTurnFromThread(history);
        if (!base) return undefined;
        const slots = prevTurnSlotsRef.current;
        return slots && slots.profileId === profileId ? { ...base, monitors: slots.monitors, periods: slots.periods } : base;
      })();

      // Classify BEFORE the tool loop sees the request (refs #246). A small
      // model handed nine tools uses one whether or not the question calls for
      // it: "hello" produced a navigate call and "arm the backyard camera" a
      // get_monitor call, 3 runs out of 3 each. A request that is not a
      // question about this installation runs with NO tools, which is the only
      // reliable way to stop that.
      // Skipped in test mode: `sharedMockProvider` replays a fixed script, so
      // a classification call would consume the turn the scenario meant for
      // the answer and shift every following one. e2e scenarios drive the loop
      // directly and assert on it; triage is covered by its own unit tests.
      // Seeded with the question so a pasted transcript opens with what was
      // asked, then the triage round, then the loop's own entries.
      const initialTrace: TraceEntry[] = [{ kind: 'question', text }];
      const collectTrace = (entry: TraceEntry) => {
        initialTrace.push(entry);
        host.onTrace?.(entry);
      };
      // Triage is ADVISORY (refs #265): a misclassified data question is no
      // longer refused, because the loop fails open: a tool-less turn whose
      // model calls a real registry read tool flips to the full registry and
      // runs it. That made the old English keyword overrule (requiresLiveData)
      // deletable: it was a hardcoded vocabulary in front of exactly the
      // language interpretation the model does better.
      const verdict = isAssistantTestMode()
        ? { kind: 'zoneminder' as const }
        : // serverNames too: a question that names a server ("compare warehouse and
          // cabin") is about this system, and without the roster the classifier
          // read those as unrelated words and routed the turn to chat (refs #337).
          // The roster and label vocabulary ride the same round (refs #427,
          // #432): this is the parse that fills every slot (cameras as a set,
          // subject, objects), so it runs whenever a roster exists; the
          // deterministic scan below still outvotes its camera slots. A
          // roster-less install keeps the prompt the eval harness scores.
          await classifyRequest(
            provider,
            text,
            controller.signal,
            collectTrace,
            (s) => host.onStatus?.(s),
            serverNames,
            monitorRoster.map((m) => m.name),
            monitorRoster.length > 0 ? objectLabels : [],
            // The previous turn, so "yes" and "how today looking?" classify
            // with their topic - and so `continues` can be judged (refs #446).
            prevTurn,
          );
      const kind: RequestKind = verdict.kind;
      // The relatedness gate (refs #446): only a declared follow-up lets ANY
      // context reach the coverage and time calls. A standalone question
      // cannot inherit stale slots, structurally.
      const followUp = verdict.continues === true ? prevTurn : undefined;
      log.assistant('Request classified', LogLevel.DEBUG, {
        kind,
        continues: verdict.continues,
        subject: verdict.subject,
        objects: verdict.objects,
      });

      // Every timeframe the question names is extracted and resolved BEFORE the
      // tool round (refs #270, pipeline-v2): the native tool loops cannot nest
      // the interpreter call inside a tool call, and resolving up front warms
      // interpretWhen's per-day cache so the later tool call never has to. A
      // question that states a period nothing can resolve abstains here and the
      // turn ends, instead of answering a wrong window with real data. Skipped
      // in test mode for the same reason triage is: the mock provider replays a
      // fixed script, and an extra call would consume the turn the scenario
      // meant for the answer.
      let turnSystem = kind === 'zoneminder' ? system : buildNoToolPrompt(system, kind);
      let plannedCalls: PlannedToolCall[] | undefined;
      let turnPeriods: string[] | undefined;
      let turnMonitors: string[] | undefined;
      if (kind === 'zoneminder' && !isAssistantTestMode()) {
        // Coverage is its own focused model call (refs #438): judged inside
        // the consolidated parse it failed live and every rewording rotated
        // the failures; this call measures 8/8 on the same cases. It runs
        // only when the deterministic scan found nothing, and a failure
        // degrades to an unpinned turn. The slots become one system line,
        // exactly like the timeframe line: resolved monitors pin their
        // monitorIds, a no-coverage place gets the do-not-attribute guard,
        // no place adds nothing.
        const coverageSlots =
          monitorScanHits.length === 0 && monitorRoster.length > 0
            ? await resolveCoverage(text, monitorRoster, provider, controller.signal, collectTrace, followUp)
            : {};
        const resolution = resolveMonitorMention(monitorScanHits, coverageSlots, monitorRoster);
        turnMonitors = resolution.kind === 'resolved' ? resolution.groups.flatMap((g) => g.monitors.map((m) => m.name)) : [];
        const monitorLine = buildMonitorSystemLine(resolution);


        // The whole-question windows interrogation (refs #444), the same
        // path on every backend: each period the question means arrives as a
        // structured window, resolved in code and cache-seeded, so the tool
        // round never re-interprets. Falls back to the deterministic scan
        // floor inside the stage on any failure.
        // Coverage runs FIRST (refs #446): a place comparison (two or more
        // groups) proves the comparison is spatial, and contextForTimeCall
        // then withholds the previous turn's period - measured 2/2, the
        // windows call otherwise splits "front vs back" across time.
        const { phrases, resolved, abstained } = await resolveTimeframesFromQuestion(
          text,
          provider,
          new Date(),
          timezone,
          controller.signal,
          contextForTimeCall(followUp, resolution),
          resolution.kind === 'resolved' && resolution.groups.length >= 2,
        );
        if (abstained) {
          append(profileId, { role: 'assistant', text: `${I18N_SENTINEL}assistant.timeframe_unclear` });
          return;
        }
        ctx.allowedWhenPhrases = phrases;
        ctx.resolvedTimeframes = resolved;
        turnPeriods = phrases;
        turnSystem = `${system}\n${buildTimeframeSystemLine(phrases)}`;
        if (monitorLine) turnSystem = `${turnSystem}\n${monitorLine}`;

        // The parse determines the tool calls where it can (refs #432): they
        // run inside runAssistantTurn before the first model round, so the
        // model opens on the data and only writes the answer. A null plan is
        // today's free loop, unchanged. Labels the parse grounded also lift
        // the English-side objectType drop for this turn's tools.
        if (verdict.objects?.length) ctx.plannedObjectTypes = verdict.objects;
        plannedCalls =
          planToolCalls({
            kind,
            subject: verdict.subject,
            groups: resolution.kind === 'resolved' ? resolution.groups : [],
            objects: verdict.objects ?? [],
            phrases,
          }) ?? undefined;
        if (plannedCalls) log.assistant('Planned tool calls from the parse', LogLevel.DEBUG, { plannedCalls });
      }

      // Already only this turn's new messages (see runAssistantTurn): the
      // thread in the store keeps everything else.
      const newMessages = await runAssistantTurn({
        provider,
        host,
        ctx,
        history,
        system: turnSystem,
        signal: controller.signal,
        plannedCalls,
        // Specialized, then scoped: objectType pinned to this install's labels,
        // and `server` pinned to the servers this view combines so a model on a
        // guided-decoding backend cannot name a server that is not there
        // (refs #270, #337).
        tools: kind === 'zoneminder' ? withServerArg(specializeToolSchemas(TOOLS, objectLabels), serverNames) : [],
        objectLabels,
        initialTrace,
        historyTurns: settings.assistantHistoryTurns,
      });

      // Attach this turn's tool-activity steps to the assistant message
      // carrying the final answer (the last `role: 'assistant'` message: every
      // earlier one in a multi-iteration turn only carries `toolCalls`), so
      // the step trace renders above that answer and survives in history
      // (refs #246). `useAssistantStore`'s `activities` accumulated across the
      // whole turn (every iteration's `host.onActivity` call), not just the
      // last one, since `clearActivities` below only runs once the turn ends.
      const turnActivities = useAssistantStore.getState().activities;
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].role === 'assistant') {
          newMessages[i] = {
            ...newMessages[i],
            ...(turnActivities.length > 0 ? { steps: turnActivities } : {}),
            // The relatedness verdict, surfaced (refs #446): a subdued
            // status renders above a continuation answer; its absence marks
            // a fresh topic.
            ...(verdict.continues === true ? { continued: true } : {}),
          };
          break;
        }
      }
      // What the NEXT turn may inherit, if it declares itself a follow-up.
      prevTurnSlotsRef.current = { profileId, monitors: turnMonitors, periods: turnPeriods };

      newMessages.forEach((m) => append(profileId, m));
      // Clear the live activity trace now that it has been captured onto the
      // message above: without this, it would still render below the thread
      // (see the `activities.length > 0` block below) duplicating the steps
      // now attached to the message that just landed.
      clearActivities();

      // Appended AFTER this turn's answer, never before: the notice explains
      // what happens to the NEXT turn, and the answer the user just waited for
      // stays on screen above it (the boundary only hides history from the
      // model, see sliceAfterContextBoundary).
      if (isContextNearlyFull(provider.contextWindow, newMessages[newMessages.length - 1]?.usage)) {
        append(profileId, {
          role: 'assistant',
          text: `__i18n:${CONTEXT_CLEARED_KEY}`,
          contextBoundary: true,
        });
      }
    } catch (e) {
      if (isAbortError(e)) {
        // User-initiated abort: not an error to surface.
      } else if (e instanceof Error && e.message === PROVIDER_NOT_AVAILABLE_MESSAGE) {
        setNotConfigured(true);
      } else if (e instanceof Error && e.message.startsWith(I18N_SENTINEL)) {
        // A thrown `__i18n:` sentinel (e.g. the native provider rejecting an
        // unsupported model) is a localized message, not a raw error string.
        log.assistant('Assistant turn failed', LogLevel.ERROR, { error: e });
        setError(t(e.message.slice(I18N_SENTINEL.length)));
      } else {
        log.assistant('Assistant turn failed', LogLevel.ERROR, { error: e });
        setError(resolveQueryError(e, t, { fallbackKey: 'assistant.error_generic' }));
      }
    } finally {
      setRunning(false);
      // Also on error/abort paths: a surviving `server_slow` phase would keep
      // its elapsed-seconds interval ticking invisibly until the next send
      // (the status line itself is hidden by `running`, but the effect keys
      // on the phase).
      useAssistantStore.getState().setPhase(null);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="ask-panel">
      {/* All mode only: persistent, so the pinned profile never scrolls out of
          view with the thread - a stray answer about "the front door" is
          meaningless without knowing which server it came from. */}
      {isAllMode && (
        <div
          className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5"
          data-testid="assistant-pinned-banner"
        >
          {/* What the pin actually decides once a group can hold several
              servers (refs #337): the model, its settings and the thread come
              from this profile, while the lookups cover every server in the
              group. Saying "pinned to warehouse" there would read as a limit on
              the answers, which it no longer is. */}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t(coversAllServers ? 'assistant.covers_all_servers' : 'assistant.pinned_to', {
              profile: currentProfile?.name ?? '',
            })}
          </span>
          <ProfilePicker
            profiles={scope?.profiles ?? []}
            value={defaultPinnedId}
            onChange={setPinnedProfileId}
            className="h-7 w-32 text-xs"
          />
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {/* Empty-thread self-introduction (refs #246): a UI-only empty state,
            never part of the thread sent to the model. Swaps out for the real
            thread the moment the first message lands (handleSend's `append`
            below), and reappears after Clear resets the store. `every` rather
            than a length check: Clear leaves a context-boundary notice behind,
            and a lone notice is still an empty conversation. */}
        {thread.every((m) => m.contextBoundary) && <AssistantIntro onExampleClick={handleExampleClick} />}

        {/* Honest, not alarmist (refs #265): time interpretation and tool
            routing are language-neutral now (the model interprets, the loop
            fails open), but the grounding safeguards only recognize English
            replies and English is the measured path, so a non-English app
            language still gets a note saying English works best. */}
        {assistantInNonEnglish && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="assistant-english-notice">
            {t('assistant.english_only_notice')}
          </p>
        )}

        {/* The active backend is an OS/system model, the least accurate of the
            offered backends, so nudge toward the better one ON THIS PLATFORM.
            Both names are interpolated, never hardcoded: the note used to send
            everyone to llama.cpp, which stopped being an option at all once the
            Android build dropped it (issue #270). */}
        {usingSystemModel && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="assistant-system-model-note">
            {t('assistant.system_model_note', {
              backend: assistantBackendLabel(settings, t),
              target: systemModelSuggestion,
            })}
          </p>
        )}

        {thread.map((msg, i) => {
          // `role: 'tool'` messages carry only `toolResults`, never `display`
          // (agent.ts attaches cards to the final `role: 'assistant'` message
          // instead, refs #246), so there is nothing here to render.
          if (msg.role === 'tool') return null;
          // The auto-clear notice is a divider, not a turn: it's the app
          // talking, not the model, and everything above it is out of the
          // model's view from here on (see agent.ts's sliceAfterContextBoundary).
          // Styling it as an assistant bubble would claim the model said it.
          // An intermediate tool-calling turn carries only `toolCalls`, never
          // text, and used to render as an empty grey bubble: one per round
          // trip, so a multi-step answer arrived behind a stack of blank
          // bubbles. The work those turns did is shown by the activity line
          // instead, which is what the user actually wants to see.
          if (msg.role === 'assistant' && !msg.text && !msg.steps?.length && !msg.display?.length) return null;

          if (msg.contextBoundary) {
            return (
              <div
                key={i}
                className="border-t pt-2 text-center text-xs text-muted-foreground"
                data-testid="assistant-context-cleared"
              >
                {renderAssistantText(msg, t)}
              </div>
            );
          }
          return (
            <div key={i} className="space-y-1">
              {/* This turn's tool work, collapsed to one muted line above its
                  answer (refs #246): user question -> "Used count_events,
                  list_events" -> answer -> supporting cards. */}
              {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && <ActivityLine steps={msg.steps} />}
              <div
                data-testid={`assistant-message-${msg.role}`}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted',
                )}
              >
                {msg.role === 'assistant' && msg.continued && (
                  <p className="mb-1 text-xs italic text-muted-foreground" data-testid="assistant-continued">
                    {t('assistant.continued_from_previous')}
                  </p>
                )}
                {msg.role === 'user' ? <p>{msg.text}</p> : renderAssistantText(msg, t)}
                {msg.role === 'assistant' && msg.trace && msg.trace.length > 0 && (
                  <ModelTranscript trace={msg.trace} t={t} />
                )}
              </div>
              {msg.role === 'assistant' && msg.display && msg.display.length > 0 && (
                <AssistantResultCards entities={msg.display} host={host} />
              )}
            </div>
          );
        })}

        {/* The turn still in flight, as ONE line each new step replaces, so a
            multi-step answer ("which monitor was most active") shows what it is
            doing without stacking a row per round trip. Rendered above the
            "thinking" indicator, where the answer will land once the turn
            resolves; `handleSend` then moves these steps onto that answer's
            message (`steps`, above) and clears them, so this never lingers to
            duplicate what now renders inside the thread. */}
        {/* TWO lines, not one: the model's thought and the tool step are
            different channels, and sharing a slot meant every reasoning line
            was overwritten by the tool call it had just decided on, milliseconds
            later. The long wait (the next model call, ~7s on device) then sat
            on stale tool text. Each line now replaces only its own kind, so the
            latest thought stays readable while the next step runs. */}
        {activities.some((a) => a.kind === 'model') && (
          <ActivityLine steps={activities.filter((a) => a.kind === 'model')} live />
        )}
        {activities.some((a) => a.kind !== 'model') && (
          <ActivityLine steps={activities.filter((a) => a.kind !== 'model')} live />
        )}

        {/* The transcript DURING the turn, not only after it. A turn can spend
            a minute across several round trips, and waiting until the answer
            lands to reveal what was sent is exactly backwards for the case this
            exists to serve: watching a turn go wrong. */}
        {running && liveTrace.length > 0 && <ModelTranscript trace={liveTrace} t={t} live />}

        {running && (
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-testid="assistant-status">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            {/* A slow-phase note (model load %, first-fill %, retry, server elapsed) replaces
                the generic "Thinking" while that phase runs, then clears back to it. */}
            <span className="truncate" title={statusLabel ?? undefined}>{statusLabel ?? t('assistant.thinking')}</span>
          </p>
        )}

        {/* The warmup started when the panel opened (refs #261). Shown even
            while a turn runs on a cold server: the "Thinking" line above would
            otherwise claim progress while the real wait is the model load. */}
        {warmingModel && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="assistant-model-loading">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('assistant.loading_model', { model: warmingModel })}
          </p>
        )}

        {notConfigured && <ErrorBanner message={t('assistant.not_configured_cta')} />}
        {error && !notConfigured && <ErrorBanner message={error} />}

      </div>

      <div className="flex items-center gap-2 border-t p-2">
        <input
          ref={inputRef}
          data-testid="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t('assistant.placeholder')}
          disabled={running || !profileId}
          className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAbort}
            title={t('assistant.abort')}
            aria-label={t('assistant.abort')}
            data-testid="assistant-abort"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
            disabled={!input.trim() || !profileId}
            title={t('assistant.send')}
            aria-label={t('assistant.send')}
            data-testid="assistant-send"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
