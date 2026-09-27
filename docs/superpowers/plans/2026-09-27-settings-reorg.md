# Settings reorganization plan

Spec: `docs/superpowers/specs/2026-09-27-settings-reorg-design.md`. Issue #536.
Worktree: `/Users/arjun/fiddle/zmNinjaNg-536`, branch `feat/536-settings-reorg`.

## Global constraints

- Read `AGENTS.md`, `AGENTS.project.md` and `agents/project/testing.md` before
  writing code. The Settings, Settings search, Stores, Localization and
  Aggregation contracts bind every task.
- Test first: write the failing test, run it and see it fail on an assertion,
  then implement.
- Run npm commands from `app/`. Never use the `rtk` wrapper for tests, tsc or
  build. Do not run e2e on devices.
- Every user-facing string goes into all 8 locales (de, en, es, fa, fr, it,
  ru, zh) in the same commit. Labels fit 320px.
- New interactive elements get `data-testid`. Icon-only buttons get `title`
  and `aria-label`.
- Before each commit run the vitest files you touched plus `npm run build`.
  Conventional commits that reference `#536` (use `refs #536`, never a closing
  keyword). End each commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `app/android/app/build.gradle` or
  `app/ios/App/App.xcodeproj/project.pbxproj` changes.

## Task 1: Scope classification and reader fixes

Create `app/src/stores/settings-scope.ts` with `SELECTION_SCOPED_SETTINGS` and
`SERVER_SCOPED_SETTINGS` exactly as the spec's "Key classification" lists
(leave out `landscapeFullscreen`; Task 2 adds it). Delete
`dashboardRefreshInterval` (key, default, row in `PlaybackSection.tsx`, locale
strings, test fixtures that set it).

Audit every non-test reader of every listed key and move each onto its scope's
read path, starting from the spec's "Readers known to be on the wrong side"
list. Writers outside the Settings page that write a listed key write the
matching bucket (for example `EventContextPanel` line 76 writes the current
selection). Do not move any Settings page rows in this task; the page's own
writers change in Task 4.

Add the contract gate described in the spec's "Contract change" to
`app/src/tests/agents-contracts.test.ts` (server-scoped key read off
`useCurrentProfile()` settings outside `components/settings/`), and add the
scope rule to the Settings contract in `AGENTS.project.md` naming both gates.

Tests: real-store tests with an aggregate selected proving at least hover
preview on `MonitorCard`, `eventContext` in `useEventsAround`,
`thumbnailFallbackChain` in `EventListView`, and `eventVideoAutoplay` in
`EventDetail` read the right bucket. Follow the testing playbook's real-store
guidance.

## Task 2: Fullscreen when turned sideways

Add `landscapeFullscreen` per the spec's "Fullscreen when turned sideways":
key and default `true` in `stores/settings.ts`, add it to
`SELECTION_SCOPED_SETTINGS`, a `landscape` option on `useAutoFullscreen`, and
`MonitorDetail` / `EventDetail` passing the current selection's value. Task 4 adds the Settings row. Tests: extend
`useAutoFullscreen` tests for `landscape: false`, and a page-level test that a
landscape touch device stays out of fullscreen when the setting is off.

## Task 3: Log settings move to the Logs page

Move the component log levels editor and Disable log redaction (with its
warning) from `AdvancedSection.tsx` to `pages/Logs.tsx`, next to the existing
log level picker, per the spec's "Log settings". They save to the current
selection's bucket. Remove them from Settings. Reuse the existing component
and strings; move the component into a domain folder if it needs its own file.
Tests: Logs page tests proving both controls save to the current selection
(aggregate selected: aggregate bucket; member unchanged). Update Settings
tests that asserted the removed rows.

## Task 4: Settings page layout

Rebuild the page into General, Live Streaming, Events & Playback, Network,
Ninjii and More settings exactly as the spec's "Layout" section, with the
server sub-card, the top-of-page picker only in an aggregate, the
aggregate-only sub-card, Theme and Keep screen awake rows, the sideways row,
and More settings links (`/notifications`, `/live-activity`, `/logs`).
Selection-scoped rows save through the view-level `update`; server-scoped rows
save to the picked (or current) profile. Rename labels "Previews" and "Event
thumbnails". Remove the Appearance, Playback and Advanced section components
and any strings left unused. Keep files under 400 lines by splitting sections
into their own files under `app/src/components/settings/`.

Tests: update `pages/__tests__/Settings.test.tsx`,
`Settings.allmode.test.tsx` and `settings-search.test.tsx` for the new
structure, plus the placement gate from the spec (every server-scoped row
inside the server sub-card, no selection-scoped row inside it), theme and
insomnia sync, and search finding rows in each folded part. Update the
Settings e2e feature (`app/tests/features/`) for the new sections and the
sideways toggle, with platform tags.

## Task 5: Docs

Update `docs/user-guide/settings.md` for the new layout (section by section,
including the sideways toggle, where log settings went, the deleted dashboard
refresh interval, and how server rows work with a virtual profile group), the
Logs user doc for the moved controls, `docs/user-guide/dashboard.md` if it
references the removed setting, and the developer docs where the settings
store is described, adding the scope rule. Follow
`agents/project/documentation.md` and write prose with the slop-mop skill.
