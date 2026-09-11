# zmNinjaNg Project Instructions

Read `AGENTS.md` first. Contracts, project rules, verification, playbooks.
The sanctioned path is the only path; a bypass is a bug even when it works.

## Architecture contracts

### Settings
Owns: all profile-scoped user preferences.
Path: `getProfileSettings` / `updateProfileSettings` (`app/src/stores/settings.ts`); every coercion or default lives in `mergeProfileSettings`.
Never: reaching storage directly for a profile-scoped preference; non-profile-scoped preference keys; coercions outside the merge (reactive readers such as `useCurrentProfile` bypass per-getter fixes). Per-device UI state belongs in `localStorage` under `STORAGE_KEYS`.
Gate: review.

### Polling
Owns: every recurring refresh interval.
Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
Never: literal interval values; users tune bandwidth globally.
Gate: review.

### HTTP
Owns: all network requests, including native TLS handling.
Path: helpers in `app/src/lib/http.ts`.
Never: raw `fetch` or `axios`.
Gate: `app/src/tests/agents-contracts.test.ts` (no raw `fetch`/`axios`).

### Logging
Owns: all diagnostic output.
Path: `log` helpers with explicit `LogLevel` (`app/src/lib/logger.ts`).
Never: `console` calls in app code; credentials or tokens in log output or URLs.
Gate: `app/src/tests/agents-contracts.test.ts` (no `console.`); review for credentials.

### Auth tokens
Owns: token storage, refresh, and login concurrency.
Path: `getFreshAccessToken` / `login` on the auth store (`app/src/stores/auth.ts`), deduped through one in-flight promise; refresh tokens in platform secure storage.
Never: refresh calls bypassing the dedup entry points; refresh tokens in URL query strings; plaintext fallback when secure storage fails (drop and re-auth instead).
Gate: `app/src/stores/__tests__/auth.test.ts`.

### Sessions
Owns: per-profile server connections.
Path: `getSession` (`app/src/services/sessions.ts`), lazily built and cached per profile; wired to the store via `createStoreApiClient` (`app/src/api/store-gates.ts`), the sole caller of `createApiClient` (`app/src/api/client.ts`); pre-save probe flows in `app/src/services/discovery.ts` and `app/src/pages/ProfileForm.tsx` build clients directly for un-saved profiles.
Never: constructing `ApiClient` outside the session registry, its gate factory, or the pre-save probe flows; per-profile token state outside the auth store; a session for `ALL_PROFILES_ID` or `PROBE_PROFILE_ID`; the auth store statically importing the session registry (would cycle back through the gate it injects).
Gate: `app/src/tests/agents-contracts.test.ts`.

### Assistant tool loop
Owns: whether a turn may answer a data question, and which server answers.
Path: the turn schema blocks the answer branch until a real tool result exists; execution authority is the turn's own `opts.tools`, not the registry; multi-server turns route through `executeScoped` (`app/src/lib/assistant/server-scope.ts`), so tools stay single-server.
Never: prompt-only grounding guards; raw tool-error text to the model; unparsed tool-call markup as an answer; a tool reaching a second server; server names without a schema enum.
Gate: `app/src/lib/assistant/__tests__/agent.test.ts`; `app/src/lib/assistant/__tests__/grounding.test.ts`; `app/src/lib/assistant/__tests__/server-scope.test.ts`.

### Server queries
Owns: React Query keys, invalidation, and caching.
Path: keys and invalidations from `app/src/lib/query/query-keys.ts`; profile-scoped keys wrap ids with `asProfileId`.
Never: inline key arrays; unwrapped profile ids in keys.
Gate: `app/src/tests/agents-contracts.test.ts` (no inline query keys); review for unwrapped ids.

### Stores
Owns: client state via Zustand.
Path: subscriptions select every reactive field they read, with `useShallow` for multi-field selects (`app/src/stores/`); selectors return raw slices or primitives, deriving shapes in `useMemo` outside the subscription.
Never: mutating objects returned by `getState`; whole-store subscriptions; minting objects inside a selector - `useShallow` never stabilizes them and the render loops.
Gate: review; subscription changes need a real-store regression test (testing playbook).

### Aggregation (virtual profile groups)
Owns: surfaces fanning out over multiple profiles.
Path: scope from `useProfileScope` only (filters disabled profiles; single mode is a one-element array); an aggregate id is a virtual profile id, tested with `isAggregateProfileId`; fan out via `useQueries` with `combine` (`useScopedMonitors` is the template); aggregate-keyed state uses `monitorCacheKey` composites, raw ZM ids collide across servers; stagger via `staggeredRefetchInterval`.
Never: bare monitor/event ids as aggregate keys; new `ALL_PROFILES_ID` references beyond the rehydrate migration and existing legacy arms; any unparented current-profile read (`getCurrentSession`, `useFreshAccessToken()`, `useProfileScope().settings`) where an aggregate can be current; server-scoped prefs read from an aggregate bucket.
Gate: review; mechanizing these is a tracked follow-up.

### Notifications
Owns: live notification connections and attribution.
Path: per-profile registries (`app/src/services/notifications.ts`, `app/src/services/eventPoller.ts`); connect/disconnect by profileId through the store (`app/src/stores/notifications.ts`), which closure-binds each connection's profileId into `addEvent`; display honors the owning profile's settings and `allModeNotifications`.
Never: shared "current connection" state on event paths; events stored under the ALL sentinel; reconnects outside the service's own backoff.
Gate: `app/src/stores/__tests__/notifications.test.ts`; review.

### Service boundary
Owns: the dependency direction between services and stores.
Path: services reach stores only through gates; the module graph stays acyclic.
Never: a service statically importing a store.
Gate: `app/src/tests/no-circular-deps.test.ts`; `app/src/tests/agents-contracts.test.ts` (no static store import).

### Query UI states
Owns: what users see while data loads or fails.
Path: `ErrorBanner` (`app/src/components/ui/query-state.tsx`) with `resolveQueryError` (`app/src/lib/query/query-error.ts`); shared query-state skeletons for loading.
Never: ad-hoc error markup or raw error strings.
Gate: review.

### Controls
Owns: pressable control state.
Path: pressed is `default` over `outline`, with `aria-pressed`; icon-only buttons need `title`/`aria-label`.
Never: `secondary`/`ghost` pressed pairs; colour-only state.
Gate: `app/src/tests/control-consistency.test.ts`.

### Date and time
Owns: user-facing date and time rendering.
Path: `useDateTimeFormat` (`app/src/hooks/useDateTimeFormat.ts`) or `formatAppDate` helpers (`app/src/lib/format-date-time.ts`).
Never: literal date-fns pattern strings in components.
Gate: review.

### Localization
Owns: all user-facing text.
Path: locale files under `app/src/locales/` (de, en, es, fr, it, ru, zh); every locale updates together; both pickers read `useLanguageOptions`, which lists the codes in `app/src/locales/resources.ts` with English first.
Never: hardcoded user-facing strings; hand-written locale lists in a picker.
Gate: `app/src/locales/__tests__/translation-keys.test.ts`; `app/src/components/layout/__tests__/LanguageSwitcher.test.tsx` (picker order); review for hardcoded strings.

### Native
Owns: everything touching Capacitor or platform APIs.
Path: Capacitor plugins import dynamically behind a platform check, with a test mock; mobile downloads use Capacitor HTTP base64; native TLS trust-on-first-use accepts any certificate when no fingerprint is stored, and trust is global once any profile enables self-signed (deliberate; see the all-profiles design spec).
Never: static plugin imports; Blob conversion for mobile downloads; fail-closed TLS without stored fingerprint (breaks self-signed onboarding).
Gate: `app/src/tests/agents-contracts.test.ts` (no static plugin imports); device pass.

### Constants
Owns: semantic values shared across modules.
Path: app-level values in `app/src/lib/zmninja-ng-constants.ts`; ZoneMinder protocol values in `app/src/lib/zm/zm-constants.ts`.
Never: magic numbers or strings inline where a named constant exists or belongs.
Gate: review.

## Project rules

- Run npm commands from `app/`. Run root `npm install` once so hooks exist.
- UI changes that alter behavior or navigation need an outcome-based e2e test with platform tags and `data-testid` on new interactive elements. Cosmetic changes (spacing, styling, label wording) rely on existing gates.
- Only one `npm run test:e2e` per working tree.
- Device e2e (iOS, Android, Tauri) is manual-only; agents never auto-run it.
- Labels must fit 320px; prefer concise translations.
- Flex text uses `min-w-0`, `truncate`, and a `title`; multi-line text uses `line-clamp-N`.
- Do not commit incidental native build-number bumps. Commit intended bumps alone as `chore:`.
- GitHub comments end with `Posted by Claude, assisting @<login>.`, where `<login>` comes from `gh api user --jq .login`. Never hardcode a username. Commits carry no such line.
- Test builds use a matching GitHub workflow; add one only when none fits.
- Developer docs teach React where they first rely on it.

## Verification

```
npm run gates            # vitest run, build (includes tsc -b), three lints
npm run test:e2e -- <feature>.feature
```

Per commit, run what the change touches; `npm run gates` before push or PR. Blocking lints: `lint:a11y`, `lint:correctness`,
`lint:ratchet`. Baselines `app/.lint-baseline.json`
and `app/.quality-baseline.json` lower with `npm run lint:ratchet -- --update`
and `node scripts/quality-ratchet.mjs --update`. CI also runs
`scripts/proven-red.mjs` (P2), `npm run test:scripts`, and `pr-acceptance`
(PR body needs `## Acceptance` content). State completed checks in handoff.

## Playbooks

Read each listed playbook before work in that area.

| Work | Read first |
|---|---|
| Naming, briefs, docs, proposing work | `agents/project/glossary.md`, `agents/project/out-of-scope.md` |
| Tests, UI, navigation, or platform checks | `agents/project/testing.md` |
| Developer or user documentation | `agents/project/documentation.md` |
| Capacitor, TLS, Electron, downloads, or native paths | `agents/project/native.md` |
| Assistant tools, WebLLM, or ZoneMinder schemas | `agents/project/data-integrity.md` |
| Prompts, providers, or LLM model choices | `agents/project/llm-models.md` |
| ZoneMinder APIs, streaming, or platform quirks | `agents/project/domain-context.md` |

Portable playbooks live in `agents/generic/`; project ones in
`agents/project/`.
