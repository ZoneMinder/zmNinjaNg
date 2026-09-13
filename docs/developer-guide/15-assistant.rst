Assistant Internals
===================

Everything under ``lib/assistant/`` is the store-free core behind the "Ask"
panel. The component side is in :doc:`16-platform-surfaces`, and
:doc:`call-flows`'s "Asking the assistant a question" traces one send end to
end. Nothing here imports React or Zustand: ``agent.ts`` takes an
``AssistantHost`` interface instead, so the same loop runs against the real
app and against tests without a DOM.

Pre-turn interrogations and the plan
------------------------------------

Before the loop runs, the question is decomposed by three small constrained
calls (one question per judgment, because consolidated prompts measurably
dilute each one; see ``llm-models.md`` for the scores behind every claim
here), and code composes the tool calls their slots determine:

- ``triage.ts`` is the ROUTING PARSE: ``continues`` (may any context flow),
  ``kind``, ``subject``, ``objects``. Context is structured previous-turn
  facts (``parse-context.ts``), never answer prose.
- ``monitor-stage.ts`` owns place: a deterministic name scan (substring and
  token-subset), the focused coverage call returning PLACE GROUPS, the
  per-group derivation guards, and ``contextForTimeCall``: a multi-group
  place comparison withholds the previous period from the time call.
- ``timeframe-stage.ts`` owns time: the whole-question windows
  interrogation (``window-interpreter.ts`` supplies the prompt, branch
  schema, and ``parseFields``), range-deduped and cache-seeded, with the
  regex scan as recall floor and fallback.
- ``plan.ts`` turns the slots into planned ``list_events`` calls per
  window x group x monitor and merges same-window results per group, so the
  answer model quotes code-built summaries and never does cross-result
  arithmetic.

The free tool loop below remains the fallback for anything the slots do not
determine (drill-downs, follow-up references to earlier rows, null plans);
:doc:`call-flows`'s "Asking the assistant a question" traces the whole
pipeline in order.

Turn loop (``agent.ts``)
------------------------

``runAssistantTurn`` is a bounded loop (``ASSISTANT.maxToolIterations``, 6)
that calls ``provider.chat(history, tools, system, signal)`` with the turn's
own tool list (``opts.tools``, defaulting to ``TOOLS``) and executes each
returned ``ToolCall`` against a definition found in that same list. The list
is the execution authority: a turn triage routed here with no tools must
treat an invented call as unavailable, so the registry's ``getToolByName``
and ``isWithheldToolName`` (``tools.ts``) are consulted only to phrase the
refusal, distinguishing a withheld action from a known tool on a tool-less
turn and from a plain typo.

The loop resolves with only the messages that turn produced, never the
history it was handed. What it sends the model is a trimmed view of the
caller's thread (the boundary slice below, then
``ASSISTANT.maxHistoryMessages``), so returning a "history" would hand the
caller an array of a different length than its own and invite off-by-N
arithmetic against it.

Keeping a long conversation inside a finite window
--------------------------------------------------

``sliceAfterContextBoundary`` drops everything up to and including the last
message flagged ``contextBoundary`` before the loop runs, so an auto-clear
(decided in ``AskPanel``, see :doc:`call-flows`'s "Asking the assistant a
question") hides history from the model while the thread in
``stores/assistant.ts`` keeps rendering it for the user.

``isContextNearlyFull`` is the decision itself: it compares the
``promptTokens`` a backend reported against that backend's
``contextWindow``, and returns false whenever either is unknown. Both
numbers come from the backend, never from a formula the app invents over the
prompt it built.

Token accounting per backend
----------------------------

``contextWindow`` is learned rather than assumed on every backend, and
``promptTokens`` is read off the response wherever the backend reports one:

- **WebLLM** knows its window exactly, because ``chatOptsFor``
  (``model-download.ts``) is what passed ``contextWindowSize`` to
  ``CreateMLCEngine`` in the first place. Usage arrives as the OpenAI-shaped
  ``usage`` block and goes through ``toTokenUsage`` (``providers/usage.ts``).
- **Ollama** (``OpenAiProvider``) learns the window after a chat turn by
  asking Ollama's native ``/api/ps`` what window the loaded model actually
  runs with (``refreshContextWindow``, cached per ``baseUrl::model`` in
  ``CONTEXT_WINDOWS``), because the OpenAI-compatible API never reports
  ``num_ctx``. Auto-clear therefore works on that backend from the next turn
  on. A server without the endpoint records 0 and is never asked again.
  Usage also goes through ``toTokenUsage``.
- **llama.cpp on iOS** (``NativeLlmProvider``) adopts the window the plugin
  reports from ``isSupported().contextSize``, which is the device tier
  ``LlamaPlugin`` picked, not the nominal
  ``ASSISTANT.nativeLlmModel.contextSize`` the app asked for. The bridge
  returns ``promptTokens`` and ``completionTokens`` as required numbers, so
  the provider builds ``turn.usage`` directly and never consults
  ``providers/usage.ts``.
- **Apple Intelligence** and **Gemini Nano** also adopt
  ``isSupported().contextSize`` and build ``turn.usage`` themselves, but
  their token counts are optional on the wire. When the OS reports none,
  both estimate at ``chars / 3.5`` (English runs about four characters per
  token, so the estimate deliberately over-counts). Over-counting errs
  toward clearing the context early rather than overflowing a small window
  and failing the turn.

Tools and the gates in front of them
------------------------------------

``TOOLS`` is the registry, and it holds only ``readOnlyTools``
(``tools-readonly.ts``: monitor/event lookups, server health, navigation).
There are no destructive tools and no confirmation gate: the actions the
assistant used to offer behind a confirm dialog (arm/disarm, run state,
monitor function, alarms, deleting or archiving an event) were removed
outright, so nothing in ``lib/assistant/`` imports a mutating API and
``ToolDefinition`` (``types.ts``) cannot express one. ``WITHHELD_TOOL_NAMES``
(``tools.ts``) keeps those old names only as strings, so the loop can explain
why such a call will not run instead of reporting an unknown tool, which
reads to a model like a typo worth retrying.

Before a call executes, the loop runs its gates in order: availability in the
turn's tool list, a duplicate-signature check (``toolCallSignature`` over
``stripOmittedArgs``-normalized input, so a repeat spelled with placeholder
arguments is still refused), ``objectQuestionMismatch`` (``count_events``
cannot answer an object-type question), and ``validateToolInput`` against the
tool's own schema. Each failure returns as an ordinary error tool result the
model corrects from within the same turn; what passes runs through
``captureApiCalls`` so the transcript records the ZoneMinder requests the
tool made.

Answering about a group of servers (``server-scope.ts``)
--------------------------------------------------------

Every tool in ``tools-readonly.ts`` is written against one server: it calls
``getSession(ctx.profileId)`` and builds card thumbnails from the single
``portalUrl``/``accessToken`` pair on the context. A virtual profile combines
several servers, so something has to decide which of them a call runs against.
That decision does not live in the tools. It lives one level up, at the single
line in ``agent.ts`` where a call executes, which calls ``executeScoped``
instead of ``def.execute``.

``ToolContext.servers`` carries the roster (``ScopedServer``: profile id, name,
portal URL, token, streaming port, thumbnail chain, timezone), built once per
question by ``buildScopedServers`` (``scoped-servers.ts``) from the profiles in
scope. Fewer than two entries means no group, and ``executeScoped`` hands the
tool the context untouched: a single-profile install runs the path it always
ran, byte for byte.

With a group, three things change together, and all three must agree:

- The system prompt gains a roster (``serverLines`` in ``system-prompt.ts``)
  naming the servers, so "warehouse" is a server name to the model rather than an
  unknown noun.
- The registry gains a ``server`` argument whose ``enum`` is those same names
  (``withServerArg`` in ``tools.ts``), which makes an invented server name
  undecodable on a guided-decoding backend rather than merely correctable
  afterwards. Same mechanism as ``specializeToolSchemas`` for object labels.
- ``executeScoped`` strips ``server`` from the input (tools declare
  ``additionalProperties: false`` and know nothing about groups), resolves it
  through ``resolveServerArg``, and runs the tool once against
  ``contextForServer``. With no ``server`` it runs once per server in parallel
  and merges.

The roster also reaches the classifier. ``classifyRequest``
(``triage.ts``) decides whether a turn gets tools at all, and it ran before
anything knew what "warehouse" was: "compare warehouse and cabin" classified CHAT and
the tool-less turn answered it with a greeting. The names go into the existing
ZONEMINDER list rather than an appended block, for the reason that file's own
comment gives (an appended block measured worse), and drop out entirely below
two servers.

The merged payload is ``{summary, servers: [{server, result | error}]}``.
``summary`` is a top-level string on purpose: ``fallbackAnswerFromData``
(``grounding.ts``) reads exactly that field when a model fails to write an
answer, and a group turn must not lose that safety net. A server that fails
rides in the payload next to the ones that answered; only an all-failed call is
an error, because "the other three servers saw nothing" is still an answer.

Result cards from a group carry ``server`` and ``profileId``
(``DisplayEntity``), which ``AssistantResultCards`` renders as a label and uses
to route to ``/all/events/:profileId/:id``. The cache key becomes
``profileId:id`` for the reason the aggregation contract gives: raw ZoneMinder
ids collide across servers. The same rule is why a monitor card from another
server gets no live preview: ``useMonitors`` is the pinned profile's query,
and monitor 3 is a different camera on each server.

The pinned profile still decides the backend, its settings and the thread; the
profiles in scope decide which servers get asked.

Picking the backend (``providers/provider.ts``)
-----------------------------------------------

``getAssistantProvider`` decides which model answers, in this order: the
deterministic ``sharedMockProvider`` (``providers/mock.ts``) in
non-production e2e mode behind ``isAssistantTestMode()``, ``OpenAiProvider``
when the profile's backend is Ollama, ``NativeLlmProvider`` when it is
``'native'``, ``AppleIntelligenceProvider`` when it is ``'apple'``,
``GeminiNanoProvider`` when it is ``'gemini-nano'`` (all three refs #270),
and ``WebLlmProvider`` otherwise.

On either on-device path no message and no tool result is ever sent to a
server other than the ZoneMinder server the tool call itself targets.

The five backend values do not map one-to-one onto the four labels
the picker shows. ``'on-device'`` and ``'native'`` share a single label,
``settings.assistant.backend_download_model`` ("On-device (Download model)"),
because the difference between them is which engine the platform happens to
have (WebGPU on desktop and web, llama.cpp on Metal on iOS) and not anything
a user chooses. ``AssistantSection`` therefore emits the same label from two
branches with two different ``value`` attributes. The labels name who supplies the
model, since that is the choice the user makes: the OS already has one
(``'apple'`` -> Apple Intelligence, ``'gemini-nano'`` -> AICore), the app
downloads one, or your own server runs one. Do not "fix" the duplicate label
by splitting it back into two options; the engine is not a user-facing
choice. ``settings.assistant.backend_on_device`` is a separate string and is
not a picker label: ``assistantBackendLabel`` uses it as the generic mode
suffix in the chat header ("Qwen3 4B · On-device") for all four on-device
backends, which is why repurposing it for the picker would have mislabelled
Apple Intelligence and AICore.

Each adapter constrains generation where its backend can enforce it.
``WebLlmProvider`` compiles its two-shape JSON envelope (``ENVELOPE_SCHEMA``)
through the engine's grammar via ``response_format``, falling back to
prompt-plus-parser for the session if the engine rejects it.
``OpenAiProvider`` maps ``complete``'s ``jsonSchema`` to ``response_format:
json_schema``. ``NativeLlmProvider`` has no grammar-constrained decoding to
reach for, so it always runs the prompt-plus-parser path WebLLM falls back
to, reusing ``buildWebLlmMessages``/``parseWebLlmTurn`` from
``providers/webllm.ts`` directly rather than a native-specific copy. Every
adapter also retries an unparseable reply up to
``ASSISTANT.maxParseAttempts`` as a self-repair: the failed reply plus a
correction naming the fault are appended, and the temperature is raised only
on the final attempt.

llama.cpp on device (``providers/native-llm.ts``)
-------------------------------------------------

The ``'native'`` backend runs a llama.cpp model in-process through the
Capacitor ``NativeLlm`` bridge instead of a browser engine. It is iPhone and
iPad only: ``useNativeLlmSupported`` resolves straight to false off iOS
because the bridge is an iOS build artifact, and on iOS ``LlamaPlugin``
still gates it on a 5.5 GiB physical-memory floor. Android dropped this
backend in issue #270 and uses Gemini Nano instead. iOS runs the model on
Metal through ``LlamaEngine`` (Swift).

The model is fixed, not user-chosen: ``ASSISTANT.nativeLlmModel``
(``lib/zmninja-ng-constants.ts``) is the source of truth, naming
Qwen3-4B-Instruct-2507 at a Q4_K_M GGUF quantization pulled from unsloth's
HuggingFace repo rather than Qwen's own, since Qwen publishes no official
GGUF conversion of this model. Its ``contextSize`` of 8192 is a nominal
maximum; the plugin derives the real window from device RAM (8 GB and above
get 8192, smaller devices that still clear the floor get 6144) and reports
the adopted value back through ``isSupported``.

Build pins
~~~~~~~~~~

The llama.cpp build is pinned rather than floating. ``binaryTarget`` in
``app/ios/App/LlamaKit/Package.swift`` fetches release ``b10087``'s prebuilt
XCFramework by URL and SHA-256 checksum, so an upstream retag cannot change
what ships. The pin lives only on the iOS side. No ``CMakeLists.txt`` or
``llama_jni.cpp`` remains in ``app/android/``, and nothing there fetches
llama.cpp at build time (issue #270 removed the Android JNI engine).

Apple Intelligence (``providers/apple-intelligence.ts``)
--------------------------------------------------------

The ``'apple'`` backend (refs #270) runs Apple's OS-hosted Foundation Models
system model over the Capacitor ``AppleIntelligence`` bridge, iOS only. It
reuses ``buildWebLlmMessages``/``parseWebLlmTurn``/``SELF_REPAIR_PROMPT``
from the WebLLM stack, so the turn shape and the self-repair loop are the
same ones the other on-device backends run.

What it drops relative to ``NativeLlmProvider`` follows from the OS owning
the model: there is no download, no model file, and no KV-cache slot. Its
``contextWindow`` is not passed in at load time, because there is no load.
The provider learns it from the plugin's ``isSupported().contextSize`` on
the first native call of a turn and caches it per instance, so
``isContextNearlyFull`` can auto-clear from the next turn on.
``AppleIntelligencePlugin`` reports a 4096-token window minus a 1024-token
reply reserve, since constrained generation truncates at the window edge
without that headroom.

Unlike llama.cpp, this backend does have grammar-constrained decoding.
``buildTurnSchema`` builds a JSON Schema per turn and the plugin converts it
into a Foundation Models ``GenerationSchema``, so the decoder itself removes
the answer branch until a tool result exists rather than trusting the prompt
to say so. The schema is fed to the decoder, which is why it counts against
the window alongside the messages. If the schema fails to build, the plugin
falls back to unconstrained generation and ``parseWebLlmTurn`` still has to
cope.

It maps the plugin's stable rejection ``code`` the way ``NativeLlmProvider``
does: ``CHAT_BUSY`` becomes ``__i18n:assistant.native_busy`` and everything
else ``__i18n:assistant.native_engine_failed``. Both strings are shared with
the native backend, since both are on-device engines, and neither path ever
surfaces the native side's untranslated ``localizedDescription``, which is
only logged.

The bridge itself (``ios/App/App/AppleIntelligencePlugin.swift``, jsName
``AppleIntelligence``, TS wrapper ``app/src/plugins/apple-intelligence/``)
exposes only ``isSupported``/``chat``/``cancelChat``. ``isSupported``
returns ``supported: false`` with a ``reason`` of ``platform`` (ineligible
device or pre-iOS-26), ``disabled`` (Apple Intelligence switched off), or
``notReady`` (still provisioning), which ``useAppleIntelligenceSupported``
(``hooks/useAppleIntelligenceSupported.ts``, mirroring
``useNativeLlmSupported``) surfaces so ``AssistantSection`` shows the
**On-device (Apple Intelligence)** option only when supported, and a "turn
it on in iOS Settings" hint only for ``disabled``. ``chat`` drives one
``LanguageModelSession.respond`` per call with no streaming, and
``cancelChat`` cancels the in-flight ``Task``. The two on-device gates
(``'apple'`` and ``'native'``) are independent probes, so a phone can offer
one without the other.

Gemini Nano on Android (``providers/gemini-nano.ts``)
-----------------------------------------------------

The ``'gemini-nano'`` backend (refs #270) is the Android system model,
Gemini Nano over AICore, reached through the ML Kit GenAI Prompt API. It is
a trimmed ``NativeLlmProvider``, not a port of
``AppleIntelligenceProvider``, even though both back a model the OS owns.

The difference is what the decoder can be told. Foundation Models takes a
``GenerationSchema`` built per turn, which is how the Apple provider
constrains the reply to the turn contract. ML Kit's structured output is
compile-time Kotlin codegen (a ``@Generable`` data class processed by KSP)
with no union type, so no per-tool schema can be built at runtime and no
branch can be removed. This backend therefore runs the same
prompt-plus-parser, self-repair loop llama.cpp does, and leans on the
code-level grounding checks in ``agent.ts`` rather than a decoder
constraint.

The bridge measures two capabilities at runtime rather than trusting the ML
Kit documentation, because on a real device the documentation is wrong about
both. The Prompt API is documented with an input limit under 4000 tokens;
a Pixel 10 running ``nano-v3`` reports 8192 from ``getTokenLimit()``, so
``isSupported`` reads the real number and advertises it minus a 1024-token
reply reserve, the same reserve the Apple plugin applies for the same
reason. And ``isSystemPromptAvailable()`` returns ``false`` on that model,
so a ``SystemInstruction`` would be accepted and ignored, silently dropping
the tool catalog and the install-specific facts; the plugin probes that
capability once and folds the system text into the prompt when it is
unsupported.

The bridge
(``android/app/src/main/java/com/zoneminder/zmNinjaNG/GeminiNanoPlugin.java``,
jsName ``GeminiNano``, TS wrapper ``app/src/plugins/gemini-nano/``) exposes
``isSupported``/``download``/``chat``/``cancelChat``. ``download`` is the
surface Apple's bridge has no need for: AICore fetches the weights on
request rather than shipping them with the OS, so ``isSupported`` reports
``reason: 'notReady'`` on a supported phone that has not downloaded them,
and ``useGeminiNanoSupported`` (``hooks/useGeminiNanoSupported.ts``) turns
that into the download row in ``AssistantGeminiNanoSection`` rather than a
dead end. That hook carries a ``refresh`` the other two do not, so a
completed download makes the backend selectable without an app restart.

``BACKGROUND_BLOCKED`` (AICore refuses to infer for an app that is not in
the foreground) and ``QUOTA_EXCEEDED`` (each app is metered per day) are
specific to AICore, and neither may collapse into the generic engine
failure, because "try again" is wrong advice for both. ``chat`` also takes a
``utility`` flag rather than the native provider's ``cacheSlot``: ML Kit
exposes no KV cache, but the second slot is still needed for the same
reason, since the window interpreter nests a one-shot completion inside a
tool call and would otherwise collide with the tool-loop chat.

One more Android-only wrinkle sits in the manifest. ML Kit GenAI declares
``minSdk 26`` while the app ships to 24, so ``AndroidManifest.xml`` carries
a ``tools:overrideLibrary`` for it rather than raising the app's floor,
which would drop Android 7 users for a backend they could never run (AICore
does not exist below Android 14). ``GeminiNanoPlugin`` guards every entry
point on ``SDK_INT >= O`` so no ML Kit class is loaded where the runtime
could not verify it.

WebLLM models and their context windows
---------------------------------------

Each entry in ``ASSISTANT.webllmModels`` (``lib/zmninja-ng-constants.ts``)
carries its id, its approximate download size, and its own
``contextWindowSize``, which ``chatOptsFor`` (``model-download.ts``) passes
to ``CreateMLCEngine``. The window is per model rather than one global value
for two reasons. web-llm's prebuilt registry caps every model it ships at
4096, below what any of them were trained for, and our prompt (system rules,
tool schemas, monitor table, history, tool results) overflows that, so each
entry has to raise it. But raising it is not free and not uniform: the KV
cache is allocated up front and grows linearly with the window, on top of
the weights, so Llama 3.2's native 128K would need gigabytes by itself. Each
value is therefore ``min(the model's native window,
ASSISTANT.contextWindowCap)``, which is why the Llama 3.2 3B entry sits at
the 16384 cap rather than its native 128K. A model id absent from the list
gets no override at all rather than a guessed window.

``chatOptsFor`` always sends ``sliding_window_size: -1`` alongside the
window, and that pairing is load-bearing. web-llm throws
``WindowSizeConfigurationError`` when both windows resolve positive, and
``sliding_window_size`` does not come from the bundled registry at all: it
comes from each model's ``mlc-chat-config.json``, fetched from HuggingFace,
which the registry's overrides merge over. Llama 3.2 already ships -1, so
the pin is a no-op for it and a guard against the next sliding-window model.
Pinning -1 selects full KV-cache mode, matching what the registry's own
Mistral entries do. Reading the bundled registry alone will not show you any
of this (the data-integrity playbook, ``agents/project/data-integrity.md``).

That same merge is why ``gemma3-1b-it-q4f16_1-MLC`` is not in the list. Its
stock registry entry cannot load on web-llm 0.2.84 at all: the override sets
``context_window_size: 4096`` while its fetched config supplies
``sliding_window_size: 512``, so both resolve positive and the load throws
before a token is generated. The ``-1`` pin loads it, but then forces
full-KV attention on a wasm compiled for sliding-window attention, and it
answers with corrupted output (empty at 16384, token soup at 8192). Its
native 512-token window is the only untried mode and is smaller than this
app's system prompt, so the model would never see the tool contract.

Why the picker lists two models
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``webllmModels`` lists ``Llama-3.2-3B-Instruct-q4f16_1-MLC`` and
``Qwen3-4B-q4f16_1-MLC``, with Qwen3 4B as ``ASSISTANT.defaultModelId`` for
fresh installs after it beat the llama class across the eval suite. The
picker used to offer six, and the six differed in whether the model calls a
tool at all rather than answering from
nothing. The short list keeps every entry measured against the same question
suite. Qwen3 is a reasoning model, so ``WebLlmProvider`` sends web-llm's
``extra_body: { enable_thinking: false }`` for Qwen3 model ids: the engine
pre-closes an empty think block so the model cannot reason, unlike the
``/no_think`` text directive, which only hides the tag. This list only ever
serves desktop and web, since the on-device backend is not offered on phones
or tablets at all. ``ASSISTANT.retiredModelIds`` maps every id the list used
to carry onto Llama 3.2 3B, and ``SETTINGS_VERSION`` moves with it so the
rewrite reaches installs already persisted at the previous version.

**Used by:** ``components/assistant/AskPanel.tsx`` (drives one turn per
send), ``components/assistant/useAssistantHost.ts`` (implements the
``AssistantHost`` the loop calls into).
