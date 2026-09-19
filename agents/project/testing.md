# Testing playbook

Read before tests, UI work, navigation work, or platform checks.

## Test design

- Test outcomes a person sees: changed data, navigation, rendered real data, persistence after refresh, errors, and edge cases.
- Name the seams under test in the issue or brief before writing a test:
  the highest interface that reaches the behavior, ideally one. Code that
  touches a store is tested against the real store (seed with `getState()`),
  mocking only `api/*`, which is the system boundary. A `vi.mock` of the
  app's own `stores/`, `hooks/`, `services/`, or `components/` is counted by
  the quality ratchet (`app/.quality-baseline.json`) and may not multiply.
- Prove red before green: run the new test against the pre-change code and
  show it fail (`node scripts/proven-red.mjs <base> <head>` does this in a
  worktree; CI runs it on every PR). A bug fix starts with that red command,
  shown, before any code is read for a theory.
- That script skips e2e, which needs a server, so an e2e scenario is proven
  red by hand: `git stash push <source file>`, `npx bddgen`, `npx playwright
  test --grep "<scenario name>"`, then `git stash pop`. Skipping it hides a
  scenario that skips itself or asserts the wrong thing (refs #382).
- Route new tests by tier: pure logic in `lib/`, stores, and hooks gets unit tests; user-visible behavior or navigation gets a feature e2e scenario plus units for the logic beneath; native-only flows rely on manual device checks. E2e asserts the journey, units the edge cases; do not cover the same assertion in both tiers.
- Store-backed code is tested through `app/src/tests/profile-fixture.ts`:
  two hoisted one-liners mock `api/store-gates` and `lib/security/secureStorage`
  with their `tests/fake-*` stand-ins, `seedProfiles([...])` fills the real
  profile, settings and auth stores, and `installApiClient(id, fakeApiClient({
  '/monitors.json': body }))` scripts the HTTP boundary so the real session
  registry, hooks and components run. An unscripted request rejects. Reset
  with `resetProfileFixture()` and `resetFakeStoreGates()` in `afterEach`.
  The reference is `hooks/__tests__/useMonitors.test.tsx`. Never mock
  `zustand/react/shallow` as a passthrough: it hides the selector loop the
  real store exists to catch, and three files were doing it.
- A new gate assertion (anything under `app/src/tests/`) is proven red
  against a scratch violation, then the scratch is removed in the same
  commit; proven-red classifies that directory as gate work and does not
  demand a red run against the previous commit.
- `npm run test:mutation` flips one branch in auth, sessions, url-builder
  and schema-tolerance and expects each module's tests to go red. CI runs
  it on every PR (about seven seconds); locally, run it when touching those
  modules or their tests. It is not in `npm run gates` because it runs each
  suite once per mutation.
- The proven-red log says whether the changed tests went red by assertion
  or only by a missing symbol. A test for a new export can only give the
  second kind against the fork point, so it gets a warning, not a failure;
  the reviewer then checks the assertions by hand or adds the module to the
  mutation targets.
- Vitest does not type-check. Run `npx tsc -b` before pushing test changes;
  ten migrated files carried bare strings where a `ProfileId` was expected
  and passed at runtime.
- Hover-intent previews are unit-tested (`hover-preview.test.tsx`, fake
  timers) and not e2e-tested: `HoverPreview` opens on a 700ms timer and
  cancels on mouseleave, and a synthetic cursor over a polling list loses
  that race three runs in three. Do not add a hover scenario.
- Unit tests live beside source in `__tests__/`.
- Browser e2e uses `app/tests/features/*.feature` and screen-specific step files in `app/tests/steps/`. Do not add direct Playwright specs.
- Rename or add a step and the generated specs go stale: run `npx bddgen`
  (`npm run test:e2e` does it first). A stale `.features-gen` reports
  `Missing step`, which reads like a failing test and is not one.
- Test UI and navigation changes with relevant feature e2e.
- New interactive UI needs a kebab-case `data-testid`. Repeated elements suffix the entity id (`monitor-card-${monitor.Id}`); variants suffix kind or role (`assistant-message-${msg.role}`).
- Do not use fixed `waitForTimeout`. Use auto-retrying `expect`. The
  quality ratchet holds the count of sleeps in `app/tests/steps/` and lists
  the files when it grows.
- Capability-based e2e skips must derive from API or fixture data, never visibility of UI under test. When capability exists, assert the UI.
- Pages that stay mounted across a route param change (`/monitors/:id`,
  `/events/:id`) repaint their content either way, so a DOM property such as a
  transform is green with or without the fix. Assert the state that survives
  the repaint, such as a control that only renders while the hook holds the
  old value (refs #382).
- Every `Then` step asserts, through `expect` or an `assert*` helper, and every step definition is referenced by a feature. `app/src/tests/e2e-steps.test.ts` fails the unit suite otherwise, so a step that cannot fail and a step nothing runs both surface without an e2e run.

## Platforms

- Automated e2e is Chromium only: `npm run test:e2e`. Nothing runs it on a
  schedule: CI's job skips (no reachable ZoneMinder) and `make_release.sh`
  asks, reading `app/.e2e-full-pass` (the date `npm run test:e2e:full` writes
  after a full passing run) to say when the whole suite last passed here.
- Android, iPhone, and iPad suites are manual Appium screenshot checks.
- Native OS flows such as PiP, biometrics, push, downloads, sharing, and lifecycle require device verification.
- UI work considers Electron, iOS, Android, portrait, and landscape. Record unavailable manual checks in handoff.

## Commands

```bash
# Run from app/
npm test
npm run test:mutation
npx tsc -b
npm run build
npm run test:e2e -- <feature>.feature
npm run test:e2e
npm run test:e2e:android
npm run test:e2e:ios-phone
npm run test:e2e:ios-tablet
```

Never run two web e2e suites in one checkout. They share generated files and result paths.

The suite runs serially (`workers: 1`) everywhere, not only in CI. These
scenarios share one ZoneMinder and one app: they create and delete profiles,
archive events, and toggle per-profile settings, so concurrent workers fight
over the same state. A local parallel run produced six or seven phantom
failures that all passed serially, and chasing them cost a session. That is
#237, which was closed without changing the config. A full run is ~18 minutes;
`E2E_WORKERS=4` overrides it when the subset you are running is independent.


## Traps that have burned agents (each cost a fix round)

- Run `npx vitest` only from `app/`. From the repo root, npx resolves a
  cached install without the project's jsdom config and dozens of tests
  fail with `document is not defined`. Shell working directories drift
  after `git` commands; re-check before diagnosing "regressions".
- Test fixtures for settings objects must spread `DEFAULT_SETTINGS`
  (with `importOriginal` when the store module is mocked, or the spread
  is silently empty). A hand-listed fixture breaks on the next settings
  key addition — and the break can be silent (a cap that reads
  `undefined` disables itself).
- Per-commit scoped gates must include suites that CONSUME a changed
  settings shape, not just files importing the changed module. Two
  fixtures broke this way in one wave while the directly-scoped suites
  stayed green.
- `mockReturnValue` set inside one test outlives `vi.clearAllMocks()`,
  which clears recorded calls but not implementations. A store override
  that leaked this way made a timezone test pass in UTC-5 and fail in
  CI's UTC for weeks (75c89db3). Use `mockReturnValueOnce`, or reset the
  mock in `beforeEach`.
- A `vi.mock` of a third-party module replaces ALL of it, so a stub must
  carry every member the component reads on any branch, not just the
  branch today's fixture happens to take. Two files stubbed
  `react-i18next` with `t` alone; the components read `i18n.language`
  only when an event falls inside the relative-time window, and their
  fixtures were timestamped a few hours ahead of the clock. Both files
  passed for a day and broke, with no code change, the moment the clock
  passed the fixture (refs #494). Stub the whole surface, and date a
  fixture far enough from now that the branch it takes does not depend on
  when the suite runs.

## Regression tests for store-subscription bugs

Selector bugs (fresh objects minted inside a zustand selector) crash via
useSyncExternalStore loops in production but are invisible to tests that
mock the store as `(selector) => selector(state)`. Regression tests for
this class render against the REAL store (seed via `getState()`, assert
no "Maximum update depth exceeded"); `NotificationHistory.realstore.test.tsx`
is the template. Prove any such test red against the pre-fix code before
trusting it.
