# Development Guidelines

## Rules

These are non-negotiable. Every rule applies to all communication: responses, commits, docs, code comments.

1. **No superlatives** — never use "comprehensive", "critical", "major", "robust", "powerful", "extensively", "thoroughly", "excellent", "amazing", "significant", etc. Plain, factual language only.
2. **Issues first** — create a GitHub issue before implementing features or fixing bugs. Commit directly to main only for docs-only changes, refactors without behavior change, test additions for existing code, or dependency updates.
3. **Test first, verify before commit** — write tests first, run `npm test` + `tsc --noEmit` + `npm run build` + relevant e2e tests before every commit. Build passing is not proof code works. **Always run `npm run build` (not just `tsc --noEmit`) as the final check** — `tsc -b` used by the build catches stricter errors (unused variables, type narrowing) that `tsc --noEmit` misses. Never commit if the build fails.
4. **Update docs** — update `docs/developer-guide/` in the same session when adding new APIs, components, utilities, or hooks and/or `docs/user-gudie` for changed/updated or new functionality
5. **i18n all languages** — never hardcode user-facing strings. Update ALL translation files: en, de, es, fr, zh.
6. **Cross-platform** — test on iOS, Android, Desktop, phone portrait + landscape. Device e2e tests (`ios-phone`, `android`, etc.) are manual-invoke-only — only `npm run test:e2e` (web) runs in the automated workflow.
7. **Profile-scoped settings** — read/write via `getProfileSettings`/`updateProfileSettings`. Never use global singletons.
8. **Bandwidth settings** — all polling/refresh features must use `useBandwidthSettings()` (or `getBandwidthSettings()` outside React). Never hardcode polling intervals.
9. **Logging** — use `log.*` component helpers with explicit LogLevel, never `console.*`. See `lib/logger.ts` for available helpers.
10. **HTTP** — use `lib/http.ts` abstractions (`httpGet`, `httpPost`, etc.), never raw `fetch()` or `axios`.
11. **Text overflow** — use `truncate` + `min-w-0` in flex containers; add `title` for tooltips. Multi-line: `line-clamp-N`.
12. **Small files** — DRY, ~400 LOC max, extract complex logic to separate modules.
13. **`data-testid`** — add `data-testid="kebab-case-name"` to all interactive elements. Required for e2e tests.
14. **Capacitor plugins** — dynamic imports only with platform checks. Never static imports. Match `@capacitor/core` major version. Add mock to `tests/setup.ts`.
15. **Mobile downloads** — use CapacitorHttp base64 directly. Never convert to Blob on mobile (OOM risk).
16. **Tauri packages** — JS `@tauri-apps/*` and Rust `tauri-plugin-*` versions must match. Update `package.json` and `Cargo.toml` together.
17. **No plan files in git** — delete `.md` plan files once the feature is complete.
18. **Complete features fully** — don't leave features half-implemented.
19. **User approval before merge** — never merge to main without user approval.
20. **One logical change per commit** — use conventional format: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`. Reference issues with `refs #<id>` or `fixes #<id>`.
21. **Don't batch unrelated changes** — split into separate commits.
22. **Analyze test failures** — read error output and fix systematically. Don't retry blindly.
23. **Concise i18n labels** — button, tab, and action labels must be short across all languages. Prefer single-word synonyms (ES: "Ajustes" not "Configuración", DE: "Speichern" not "Änderungen speichern", FR: "Enregistrer" not "Enregistrer les modifications"). Test translations fit on a 320px-wide phone screen. Add `min-w-0` + `truncate` to flex containers with translated button text as a safety net.
24. **Date/time formatting** — all user-facing date/time display must use `useDateTimeFormat()` hook (or `formatAppDate`/`formatAppTime`/`formatAppDateTime` from `lib/format-date-time.ts` outside React). Never hardcode date-fns `format()` with literal patterns for user-visible output. This includes canvas rendering, tooltips, labels, and scrubber overlays.
25. **Self-updating rules** — when the user gives guidance that establishes a general pattern (e.g., "all X should use Y"), check whether it belongs as a persistent rule in this file. If so, add it here so future sessions follow it automatically.
26. **Centralized constants** — every named constant (timeouts, thresholds, storage keys, animation durations, magic numbers with semantic meaning) lives in `lib/zmninja-ng-constants.ts` (app-level) or `lib/zm-constants.ts` (ZoneMinder protocol-level). Import from there; do not redeclare per file. CSS pixel values inline in JSX/styles are fine; ad-hoc numbers used once with no semantic name are fine.

---

## Working Directory

All `npm` commands must be run from the `app/` directory.

Structure:
- `./` — workspace root (AGENTS.md, docs/, scripts/)
- `app/` — main application (run npm commands here)
- `app/src/` — source code
- `app/tests/` — e2e test features and helpers

---

## Testing

### Philosophy: Be a Human Tester
Every test must verify what a real human would verify: "Can I accomplish this task? Does this look right? Does the data make sense?"

- Verify outcomes (data changed, navigation happened, file downloaded) — not just element presence
- Fill forms and verify data persists after refresh or navigation
- Test error states, edge cases, and device-specific layout behavior
- Add `@visual` screenshots to catch layout regressions
- Never write "check heading is visible" as a test — that's not testing anything
- Never mock the thing you're testing

### Test-First Workflow
1. Understand the bug/feature requirement
2. Write a failing test that reproduces the issue
3. Implement the fix/feature
4. Run tests — verify they pass
5. Run full test suite to check for regressions
6. Commit

### Unit Tests
**Location**: Next to source in `__tests__/` subdirectory (e.g., `lib/crypto.ts` → `lib/__tests__/crypto.test.ts`)

**What to test**: Happy path, edge cases (empty/null/undefined), error cases, state changes

**Run**: `npm test`

### E2E Tests
**When required**: UI changes, navigation changes, interaction changes, new workflows

**Location**: `app/tests/features/*.feature` (Gherkin format, never .spec.ts directly)

**Step definitions**: `app/tests/steps/<screen>.steps.ts` (one file per screen, not one monolith)

**Run**: `npm run test:e2e -- <feature>.feature`

### Cross-Platform E2E Tests
Tests run on 5 platform profiles using two drivers. Playwright drives Chromium-based platforms (web, Android) via CDP. WebDriverIO + Appium drives WebKit-based platforms (iOS, Tauri) via native drivers. A shared `TestActions` abstraction keeps step definitions driver-agnostic.

| Profile | Device | Driver | Connection |
|---|---|---|---|
| `web-chromium` | Desktop browser | Playwright | Direct launch |
| `android-phone` | Pixel 7 Emulator | Playwright | ADB port-forward → CDP |
| `ios-phone` | iPhone 15 Simulator | WebDriverIO + Appium XCUITest | WebView context switch |
| `ios-tablet` | iPad Air Simulator | WebDriverIO + Appium XCUITest | WebView context switch |
| `desktop-tauri` | Tauri macOS app | WebDriverIO + tauri-driver | WebDriver protocol |

### Platform Tags
- `@all` — every platform | `@android` — Android only | `@ios` — iPhone + iPad
- `@ios-phone` / `@ios-tablet` — specific iOS form factor
- `@tauri` — Tauri desktop | `@web` — browser only
- `@visual` — comparison screenshots | `@native` — requires Appium

### Test Commands
```bash
# Unit tests
npm test                                # Unit tests
npm test -- --coverage                  # With coverage

# E2E tests (web browser only - fast)
npm run test:e2e                        # All web e2e tests
npm run test:e2e -- <feature>.feature   # Specific feature
npm run test:e2e -- --headed            # See browser

# Cross-platform e2e (requires simulators/emulators)
npm run test:e2e:android                # Android emulator
npm run test:e2e:ios-phone              # iPhone simulator
npm run test:e2e:ios-tablet             # iPad simulator
npm run test:e2e:tauri                  # Tauri desktop
npm run test:e2e:all-platforms          # All platforms sequentially

# Visual regression
npm run test:e2e:visual-update          # Regenerate all baselines
npm run test:e2e:android -- --update-snapshots  # Platform-specific

# Native-only (Appium) — PiP, biometrics, push, downloads
npm run test:native

# Setup verification
npm run test:platform:setup             # Check tools, simulators, ports
```

### Platform Test Configuration
Simulator names, ports, and timeouts are in `app/tests/platforms.config.defaults.ts`. To customize for your machine, copy to `platforms.config.local.ts` (gitignored) and edit.

Server credentials in `.env`:
```bash
ZM_HOST_1=http://your-server:port
ZM_USER_1=admin
ZM_PASSWORD_1=password
```

### Visual Regression
Scenarios tagged `@visual` capture screenshots and compare against per-platform baselines in `app/tests/screenshots/<platform>/`. Threshold: 0.2% pixel diff. First run on a new platform: use `--update-snapshots` to generate baselines.

### Writing Good E2E Tests

Ask: "If I were a human QA tester with this feature on 5 devices, what would I check?"

**Good** (tests a user goal with interaction + outcome verification):
```gherkin
@all @visual
Scenario: Create and verify a new widget
  Given I am logged into zmNinjaNg
  When I navigate to the "Dashboard" page
  And I open the Add Widget dialog
  And I select widget type "My New Widget"
  And I enter the title "Test Widget"
  And I save the widget
  Then the widget "Test Widget" should appear on the dashboard
  And the widget should display real data
  When I refresh the page
  Then the widget "Test Widget" should still be present
  And the page should match the visual baseline
```

- One scenario per user goal, not per element
- Add `@ios-phone @android` for phone layout, `@ios-tablet` for tablet, `@tauri` for desktop
- Step definitions in `app/tests/steps/<screen>.steps.ts` using `TestActions` (not raw Playwright/WebDriverIO)
- Run `--update-snapshots` on each platform for visual baselines

### Conditional Testing Pattern
For features depending on dynamic content:
```typescript
let actionPerformed = false;

When('I click download if exists', async ({ page }) => {
  const button = page.getByTestId('download-button');
  if (await button.isVisible({ timeout: 1000 })) {
    await button.click();
    actionPerformed = true;
  }
});

Then('I should see progress if started', async ({ page }) => {
  if (!actionPerformed) return;
  await expect(page.getByTestId('progress')).toBeVisible();
});
```

### Native-Only Tests (Appium)
For flows requiring native OS interaction (PiP, biometric auth, push, native file downloads, share sheet, app lifecycle): `app/tests/native/specs/<feature>.spec.ts`

---

## Verification & Commits

For every code change, execute in order:

1. `npm test` — must pass
2. `npx tsc --noEmit` — must pass
3. `npm run build` — must succeed
4. `npm run test:e2e -- <feature>.feature` (if UI/navigation changed)
5. Commit only after all pass

State which tests were run: "Tests verified: npm test ✓, tsc --noEmit ✓, build ✓, test:e2e -- dashboard.feature ✓"

**UI changes also require**: `data-testid` on new elements, e2e tests in `.feature` file with platform tags, visual baselines updated, all language files updated.

**Native plugin changes also require**: Appium test in `app/tests/native/specs/`.

**Never commit if**: tests are failing, tests don't exist for new functionality, you haven't actually run the tests, or you wrote a scenario that only checks element presence without interaction.

### Feature Workflow
1. Create GitHub issue: `gh issue create --title "feat: Description" --body "..." --label "enhancement"` (or `--label "bug"` for bugs)
2. Create branch: `git checkout -b feature/<short-description>` (no branch needed for bug fixes)
3. Implement with tests
4. Request user approval before merging
5. Tag commits: `refs #<id>`, use `fixes #<id>` in final commit only after user confirms the fix works

---

## Code Patterns

### Internationalization
```typescript
const { t } = useTranslation();
<Text>{t('setup.title')}</Text>
toast.error(t('montage.screen_too_small'));
```
Location: `app/src/locales/{lang}/translation.json` — update all 5 languages.

### Logging
```typescript
import { log, LogLevel } from '../lib/logger';
log.secureStorage('Value encrypted', LogLevel.DEBUG, { key });
log.profileForm('Testing connection', LogLevel.INFO, { portalUrl });
log.download('Failed to download', LogLevel.ERROR, { url }, error);
```
See `lib/logger.ts` for the full list of component-specific helpers (e.g., `log.auth`, `log.notifications`, `log.http`, etc.).

### HTTP Requests
```typescript
import { httpGet, httpPost, httpPut, httpDelete } from '../lib/http';
const data = await httpGet<MonitorData>('/api/monitors.json');
await httpPost('/api/states/change.json', { monitorId: '1', newState: 'Alert' });
```
Handles platform differences (Capacitor HTTP on mobile, fetch on web), logging, and authentication automatically.

### Date/Time Formatting
```typescript
// In React components
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';
const { fmtDate, fmtTime, fmtTimeShort, fmtDateTime, fmtDateTimeShort } = useDateTimeFormat();
<span>{fmtDateTime(new Date())}</span>

// Outside React (services, renderers, canvas)
import { formatAppDate, formatAppTimeShort, type FormatSettings } from '../lib/format-date-time';
formatAppTimeShort(date, settings);
```
Never use `format(date, 'HH:mm')` or similar hardcoded patterns for user-visible output.

### Text Overflow
```tsx
<div className="flex items-center gap-2">
  <span className="truncate min-w-0" title={text}>{text}</span>
</div>
```

### Capacitor Dynamic Imports
```typescript
// Good
if (Capacitor.isNativePlatform()) {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* not available */ }
}
// Bad — static import breaks on web
import { Haptics } from '@capacitor/haptics';
```

### Background Tasks & Downloads
```typescript
const taskStore = useBackgroundTasks.getState();
const taskId = taskStore.addTask({
  type: 'download',
  metadata: { title: 'Video.mp4', description: 'Event 12345' },
  cancelFn: () => abortController.abort(),
});
taskStore.updateProgress(taskId, percentage, bytesProcessed);
taskStore.completeTask(taskId);
```
On mobile, use CapacitorHttp base64 directly — never convert to Blob (OOM risk).

### Bandwidth Settings
Use `useBandwidthSettings()` in React components or `getBandwidthSettings(mode)` in services. See `BandwidthSettings` interface in `lib/zmninja-ng-constants.ts` for available properties.

```typescript
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
const bandwidth = useBandwidthSettings();

const { data } = useQuery({
  queryKey: ['monitors'],
  queryFn: getMonitors,
  refetchInterval: bandwidth.monitorStatusInterval,
});
```

To add a new polling property: add to the `BandwidthSettings` interface and both `normal`/`low` objects in `BANDWIDTH_SETTINGS` (low mode should be ~2x slower).

### Settings & Data Management
Settings must be profile-scoped via `getProfileSettings`/`updateProfileSettings`. Detect version/structure changes in stored data — if incompatible, prompt user to reset (don't crash).

### Adding Dependencies
1. Check compatibility: `npm info <package> peerDependencies`
2. For Capacitor plugins: match `@capacitor/core` major version
3. For Tauri plugins: match JS and Rust package versions
4. Update test mocks in `app/src/tests/setup.ts` if needed
5. Verify: `npm test && npm run build`

---

## Documentation

Update `docs/developer-guide/` when adding:
- API modules (`api/*.ts`) → `07-api-and-data-fetching.rst`
- Components (`components/*.tsx`) → `05-component-architecture.rst`
- Utilities (`lib/*.ts`) → `12-shared-services-and-components.rst`
- Hooks (`hooks/*.ts`) → `05-component-architecture.rst` or relevant chapter

Document purpose, usage examples, key functions/props, integration patterns, and platform-specific gotchas.

---

## Code Quality

- DRY, modular code. Three similar lines > premature abstraction.
- Target ~400 LOC max per file. Extract cohesive blocks to separate modules.
- Delete old code completely when replacing functionality. Don't leave unused files or commented code.
- For complex features with multiple approaches or UX changes: present options and get user approval before implementing.
