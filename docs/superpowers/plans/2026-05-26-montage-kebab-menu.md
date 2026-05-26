# Montage View Kebab Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a kebab (`...`) menu to the Montage page toolbar containing Refresh and a per-monitor visibility checkbox submenu. Visibility is profile-scoped and montage-only.

**Architecture:** New `MontageKebabMenu` component using existing Radix `DropdownMenu` primitives. New `montageHiddenMonitorIds: number[]` profile setting. `Montage.tsx` filters its `monitors` list by both the existing group filter and the new hidden-set; grid recompacts automatically. Standalone toolbar refresh is removed (kebab is the only entry point).

**Tech Stack:** React, Zustand persist (`useSettingsStore`), Radix `DropdownMenu` (already wrapped in `app/src/components/ui/dropdown-menu.tsx`), `react-i18next`, Vitest + React Testing Library for unit tests, Cucumber/Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-05-26-montage-kebab-menu-design.md`

**Working directory:** All `npm` commands run from `app/`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/src/stores/settings.ts` | Modify | Add `montageHiddenMonitorIds: number[]` field + default |
| `app/src/components/montage/MontageKebabMenu.tsx` | Create | Self-contained kebab with refresh + visibility submenu |
| `app/src/components/montage/index.ts` | Modify | Export `MontageKebabMenu` |
| `app/src/components/montage/__tests__/MontageKebabMenu.test.tsx` | Create | Unit tests for the menu |
| `app/src/pages/Montage.tsx` | Modify | Remove standalone `RefreshButton`, mount kebab, apply hidden filter |
| `app/src/locales/{en,de,es,fr,zh}/translation.json` | Modify | Add 3 keys under `montage` |
| `app/tests/features/montage.feature` | Modify | Add visibility scenario |
| `app/tests/steps/montage.steps.ts` | Modify | Step definitions for the new scenario |

No new dependencies. The component is ~120 LOC, well under the 400 LOC target (rule 12).

---

## Task 1: Create the GitHub issue

Rule 2 requires an issue before implementation.

- [ ] **Step 1: Create the issue**

Run from repo root:

```bash
gh issue create \
  --title "feat(montage): add kebab menu with refresh and per-monitor visibility" \
  --label "enhancement" \
  --body "$(cat <<'EOF'
Add a vertical kebab (...) menu to the right end of the Montage toolbar.

- Move the existing standalone Refresh action into the menu.
- Add a "Show monitors" checkbox submenu that lets the user hide or unhide individual monitors from the montage grid only.
- Visibility is profile-scoped and persisted.
- Combines (AND) with the existing group filter.
- The grid recompacts when monitors are hidden.

Spec: docs/superpowers/specs/2026-05-26-montage-kebab-menu-design.md
EOF
)"
```

Note the issue number (e.g. `#172`) printed by `gh`. Use it as `refs #<id>` in subsequent commits, and `fixes #<id>` only in the final commit after the user confirms the feature works.

- [ ] **Step 2: Record the issue number**

In your scratch notes for this plan, record the issue number. Every commit message in tasks 2 through 6 must end with `(refs #<id>)`. The final commit in Task 7 uses `(fixes #<id>)`.

---

## Task 2: Add `montageHiddenMonitorIds` profile setting

**Files:**
- Modify: `app/src/stores/settings.ts` (interface around line 130, default around line 280)
- Test: `app/src/stores/__tests__/settings.test.ts` (extend if it exists; otherwise create)

- [ ] **Step 1: Check whether a settings test file exists**

Run from `app/`:

```bash
ls src/stores/__tests__/
```

If `settings.test.ts` exists, extend it. If not, create it with the test below.

- [ ] **Step 2: Write the failing test**

In `app/src/stores/__tests__/settings.test.ts`, add (or create the file with) this test block:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings';

describe('montageHiddenMonitorIds setting', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('defaults to an empty array', () => {
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageHiddenMonitorIds).toEqual([]);
  });

  it('persists updates via updateProfileSettings', () => {
    const store = useSettingsStore.getState();
    store.updateProfileSettings('profile-a', { montageHiddenMonitorIds: [3, 7] });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageHiddenMonitorIds).toEqual([3, 7]);
  });

  it('is profile-scoped (does not leak across profiles)', () => {
    const store = useSettingsStore.getState();
    store.updateProfileSettings('profile-a', { montageHiddenMonitorIds: [1] });
    store.updateProfileSettings('profile-b', { montageHiddenMonitorIds: [2] });
    expect(
      useSettingsStore.getState().getProfileSettings('profile-a').montageHiddenMonitorIds
    ).toEqual([1]);
    expect(
      useSettingsStore.getState().getProfileSettings('profile-b').montageHiddenMonitorIds
    ).toEqual([2]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

From `app/`:

```bash
npm test -- src/stores/__tests__/settings.test.ts
```

Expected: failures because `montageHiddenMonitorIds` is `undefined`.

- [ ] **Step 4: Add the field to `ProfileSettings`**

In `app/src/stores/settings.ts`, add this line in the `ProfileSettings` interface immediately after the existing `excludedMonitorIds` declaration (around line 123):

```typescript
  // Monitor IDs hidden from the Montage view only. Profile-scoped. AND-combined
  // with the group filter on the Montage page. Does not affect dashboard,
  // monitor list, or monitor detail.
  montageHiddenMonitorIds: number[];
```

- [ ] **Step 5: Add the default value**

In the same file, in `DEFAULT_SETTINGS` (around line 259, right after `excludedMonitorIds: []`), add:

```typescript
  montageHiddenMonitorIds: [],
```

- [ ] **Step 6: Re-run the test to verify it passes**

```bash
npm test -- src/stores/__tests__/settings.test.ts
```

Expected: 3 passing.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

From repo root:

```bash
git add app/src/stores/settings.ts app/src/stores/__tests__/settings.test.ts
git commit -m "$(cat <<'EOF'
feat(montage): add montageHiddenMonitorIds profile setting (refs #<id>)

Profile-scoped list of monitor IDs to hide in the Montage view only.
Defaults to []. Will be filtered alongside the existing group filter
on the Montage page; other pages are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<id>` with the issue number from Task 1.

---

## Task 3: Add i18n keys (all 5 languages)

**Files:**
- Modify: `app/src/locales/en/translation.json`
- Modify: `app/src/locales/de/translation.json`
- Modify: `app/src/locales/es/translation.json`
- Modify: `app/src/locales/fr/translation.json`
- Modify: `app/src/locales/zh/translation.json`

The `montage` namespace already exists in each file (see `app/src/locales/en/translation.json:606`). Append the three new keys just before the closing `}` of the namespace.

- [ ] **Step 1: Add the three keys to each file**

For each language file, locate the `"montage": {` namespace and add these three keys at the end of that object (after the existing last key like `"fit_flex"`). Pay attention to trailing-comma rules: add a comma after the previous last key, then add these three.

EN: `app/src/locales/en/translation.json`:

```json
    "menu_more": "More",
    "menu_refresh": "Refresh",
    "menu_show_monitors": "Show monitors"
```

DE: `app/src/locales/de/translation.json`:

```json
    "menu_more": "Mehr",
    "menu_refresh": "Aktualisieren",
    "menu_show_monitors": "Monitore"
```

ES: `app/src/locales/es/translation.json`:

```json
    "menu_more": "Más",
    "menu_refresh": "Actualizar",
    "menu_show_monitors": "Monitores"
```

FR: `app/src/locales/fr/translation.json`:

```json
    "menu_more": "Plus",
    "menu_refresh": "Actualiser",
    "menu_show_monitors": "Moniteurs"
```

ZH: `app/src/locales/zh/translation.json`:

```json
    "menu_more": "更多",
    "menu_refresh": "刷新",
    "menu_show_monitors": "显示监视器"
```

- [ ] **Step 2: Verify JSON syntax of each file**

From `app/`:

```bash
for f in src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
done
```

Expected: all 5 print `OK`. If any prints an error, fix the trailing comma/quotes.

- [ ] **Step 3: Commit**

```bash
git add app/src/locales/*/translation.json
git commit -m "$(cat <<'EOF'
i18n(montage): add kebab menu keys in all 5 languages (refs #<id>)

Adds montage.menu_more, montage.menu_refresh, montage.menu_show_monitors
across en, de, es, fr, zh. Labels kept single-word per the project's
short-label rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `MontageKebabMenu` component

**Files:**
- Create: `app/src/components/montage/MontageKebabMenu.tsx`
- Modify: `app/src/components/montage/index.ts`
- Test: `app/src/components/montage/__tests__/MontageKebabMenu.test.tsx`

Rationale for a standalone component: `Montage.tsx` is already near the 400 LOC target (rule 12). Extracting keeps it focused and lets us unit-test the menu in isolation, matching the `GroupFilterSelect` pattern at `app/src/components/filters/GroupFilterSelect.tsx`.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/montage/__tests__/MontageKebabMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MontageKebabMenu } from '../MontageKebabMenu';
import type { Monitor } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const monitors: Monitor[] = [
  { Id: '1', Name: 'Front Door', Sequence: '1' } as Monitor,
  { Id: '2', Name: 'Backyard', Sequence: '2' } as Monitor,
  { Id: '3', Name: 'Garage', Sequence: '3' } as Monitor,
];

describe('MontageKebabMenu', () => {
  const onRefresh = vi.fn();
  const onToggleVisibility = vi.fn();

  beforeEach(() => {
    onRefresh.mockClear();
    onToggleVisibility.mockClear();
  });

  it('renders the kebab trigger button', () => {
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    expect(screen.getByTestId('montage-kebab-menu')).toBeInTheDocument();
  });

  it('opens menu and shows refresh + visibility entries', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.getByTestId('montage-kebab-refresh')).toBeInTheDocument();
    expect(screen.getByTestId('montage-kebab-visibility')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh entry is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.click(screen.getByTestId('montage-kebab-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refresh entry is disabled while refreshing', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={true}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    const refreshItem = screen.getByTestId('montage-kebab-refresh');
    expect(refreshItem).toHaveAttribute('data-disabled');
  });

  it('shows a checkbox per monitor, checked when visible, unchecked when hidden', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[2]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const cb1 = await screen.findByTestId('montage-visibility-1');
    const cb2 = await screen.findByTestId('montage-visibility-2');
    const cb3 = await screen.findByTestId('montage-visibility-3');

    expect(cb1).toHaveAttribute('data-state', 'checked');
    expect(cb2).toHaveAttribute('data-state', 'unchecked');
    expect(cb3).toHaveAttribute('data-state', 'checked');
  });

  it('calls onToggleVisibility with the monitor id when a checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));
    const cb2 = await screen.findByTestId('montage-visibility-2');
    await user.click(cb2);
    expect(onToggleVisibility).toHaveBeenCalledWith(2);
  });

  it('hides the visibility submenu when there are zero monitors', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={[]}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.queryByTestId('montage-kebab-visibility')).not.toBeInTheDocument();
  });

  it('sorts monitors by Sequence ascending', async () => {
    const user = userEvent.setup();
    const unordered: Monitor[] = [
      { Id: '10', Name: 'Z-Last', Sequence: '3' } as Monitor,
      { Id: '11', Name: 'A-First', Sequence: '1' } as Monitor,
      { Id: '12', Name: 'B-Middle', Sequence: '2' } as Monitor,
    ];
    render(
      <MontageKebabMenu
        monitors={unordered}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const items = await screen.findAllByTestId(/^montage-visibility-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual([
      'montage-visibility-11',
      'montage-visibility-12',
      'montage-visibility-10',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `app/`:

```bash
npm test -- src/components/montage/__tests__/MontageKebabMenu.test.tsx
```

Expected: module not found / import error for `../MontageKebabMenu`.

- [ ] **Step 3: Create the component**

Create `app/src/components/montage/MontageKebabMenu.tsx`:

```tsx
import { MoreVertical, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';
import type { Monitor } from '../../api/types';

interface MontageKebabMenuProps {
  monitors: Monitor[];
  hiddenMonitorIds: number[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onToggleVisibility: (monitorId: number) => void;
}

export function MontageKebabMenu({
  monitors,
  hiddenMonitorIds,
  isRefreshing,
  onRefresh,
  onToggleVisibility,
}: MontageKebabMenuProps) {
  const { t } = useTranslation();

  const hiddenSet = useMemo(() => new Set(hiddenMonitorIds), [hiddenMonitorIds]);

  const sortedMonitors = useMemo(() => {
    return [...monitors].sort((a, b) => {
      const sa = Number(a.Sequence ?? 0);
      const sb = Number(b.Sequence ?? 0);
      if (sa !== sb) return sa - sb;
      return (a.Name ?? '').localeCompare(b.Name ?? '');
    });
  }, [monitors]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 sm:h-9 px-2"
          aria-label={t('montage.menu_more')}
          title={t('montage.menu_more')}
          data-testid="montage-kebab-menu"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={onRefresh}
          disabled={isRefreshing}
          data-testid="montage-kebab-refresh"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
          {t('montage.menu_refresh')}
        </DropdownMenuItem>
        {sortedMonitors.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="montage-kebab-visibility">
                {t('montage.menu_show_monitors')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
                {sortedMonitors.map((m) => {
                  const id = Number(m.Id);
                  const visible = !hiddenSet.has(id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={m.Id}
                      checked={visible}
                      onCheckedChange={() => onToggleVisibility(id)}
                      onSelect={(e) => e.preventDefault()}
                      data-testid={`montage-visibility-${m.Id}`}
                    >
                      {m.Name}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Export from the barrel**

Open `app/src/components/montage/index.ts` and add the export. The file currently re-exports `GridLayoutControls`, `FullscreenControls`, `useMontageGrid`, `useContainerResize`, `useFullscreenMode`. Append:

```typescript
export { MontageKebabMenu } from './MontageKebabMenu';
```

- [ ] **Step 5: Run the test to verify it passes**

From `app/`:

```bash
npm test -- src/components/montage/__tests__/MontageKebabMenu.test.tsx
```

Expected: all 8 tests pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/montage/MontageKebabMenu.tsx \
        app/src/components/montage/__tests__/MontageKebabMenu.test.tsx \
        app/src/components/montage/index.ts
git commit -m "$(cat <<'EOF'
feat(montage): add MontageKebabMenu component (refs #<id>)

Self-contained kebab menu with a Refresh entry and a Show monitors
checkbox submenu. Caller owns state; the component is pure UI. Hides
the submenu when there are no monitors, sorts monitors by Sequence,
and keeps the menu open while toggling checkboxes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire kebab into `Montage.tsx` and remove standalone refresh

**Files:**
- Modify: `app/src/pages/Montage.tsx`

This task does three things:
1. Apply the `montageHiddenMonitorIds` filter to the `monitors` memo.
2. Remove the standalone `RefreshButton` from the main toolbar (line ~332-339).
3. Mount `MontageKebabMenu` just before `NotificationBadge` (line ~377).

The empty-state branch (lines ~273-292) keeps its standalone `RefreshButton`. The kebab toolbar isn't rendered when there are zero monitors.

- [ ] **Step 1: Update the `monitors` memo to apply the hidden filter**

In `app/src/pages/Montage.tsx`, replace the existing block (lines ~84-87):

```tsx
  const monitors = useMemo(() => {
    if (!isFilterActive) return enabledMonitors;
    return filterMonitorsByGroup(enabledMonitors, filteredMonitorIds);
  }, [enabledMonitors, isFilterActive, filteredMonitorIds]);
```

with:

```tsx
  const hiddenSet = useMemo(
    () => new Set(settings.montageHiddenMonitorIds ?? []),
    [settings.montageHiddenMonitorIds]
  );

  const monitors = useMemo(() => {
    let list = enabledMonitors;
    if (isFilterActive) list = filterMonitorsByGroup(list, filteredMonitorIds);
    if (hiddenSet.size > 0) list = list.filter((m) => !hiddenSet.has(Number(m.Monitor.Id)));
    return list;
  }, [enabledMonitors, isFilterActive, filteredMonitorIds, hiddenSet]);
```

- [ ] **Step 2: Add the visibility toggle handler**

Add this function near the other handlers (e.g., right above `handleEditModeToggle` around line 240):

```tsx
  const handleToggleMonitorVisibility = useCallback(
    (id: number) => {
      if (!currentProfile) return;
      const current = settings.montageHiddenMonitorIds ?? [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateSettings(currentProfile.id, { montageHiddenMonitorIds: next });
    },
    [currentProfile, settings.montageHiddenMonitorIds, updateSettings]
  );
```

- [ ] **Step 3: Update the montage component import**

In the import block around lines 38-45 that pulls from `'../components/montage'`, add `MontageKebabMenu`:

```tsx
import {
  GridLayoutControls,
  FullscreenControls,
  MontageKebabMenu,
  useMontageGrid,
  useContainerResize,
  useFullscreenMode,
} from '../components/montage';
```

- [ ] **Step 4: Remove the standalone RefreshButton from the main toolbar**

Delete this block (around lines 332-339):

```tsx
              <RefreshButton
                size="sm"
                onRefresh={() => refetch()}
                isLoading={isFetching}
                showLabel="sm-and-up"
                className="h-8 sm:h-9"
                data-testid="montage-refresh-button"
              />
```

Leave the `RefreshButton` import in place: it's still used by the empty-state branch (around line 279).

- [ ] **Step 5: Mount the kebab before NotificationBadge**

In the same toolbar block, immediately before the `<NotificationBadge />` line (around line 377), insert:

```tsx
              <MontageKebabMenu
                monitors={enabledMonitors.map((m) => m.Monitor)}
                hiddenMonitorIds={settings.montageHiddenMonitorIds ?? []}
                isRefreshing={isFetching}
                onRefresh={() => refetch()}
                onToggleVisibility={handleToggleMonitorVisibility}
              />
```

The list passed in is `enabledMonitors` (pre-filter), so users can always unhide what they previously hid even when the group filter would otherwise exclude it.

- [ ] **Step 6: Typecheck**

From `app/`:

```bash
npx tsc --noEmit
```

Expected: no errors. If `Monitor.Sequence` is typed differently than the test assumed, adjust the component's sort or the test's monitor shape.

- [ ] **Step 7: Run unit tests**

```bash
npm test
```

Expected: all tests pass, including the new ones from Tasks 2 and 4.

- [ ] **Step 8: Run the production build**

Rule 3 requires `npm run build` (not just `tsc --noEmit`):

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/Montage.tsx
git commit -m "$(cat <<'EOF'
feat(montage): wire kebab menu and hide-monitor filter into Montage page (refs #<id>)

Removes the standalone toolbar refresh in favor of the kebab entry.
Applies montageHiddenMonitorIds as an additional AND filter alongside
the group filter. The grid recompacts automatically because
useMontageGrid already handles a shrinking monitor list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add e2e scenario

**Files:**
- Modify: `app/tests/features/montage.feature`
- Modify: `app/tests/steps/montage.steps.ts`

- [ ] **Step 1: Add the scenario**

Append to `app/tests/features/montage.feature`:

```gherkin
  @all
  Scenario: Hide a monitor from the montage view via the kebab menu
    Then I should see at least 1 monitor in montage grid
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I uncheck the visibility for the first monitor
    Then the first monitor tile should not be present in the montage grid
    When I reload the page
    Then the first monitor tile should still not be present
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I check the visibility for the first monitor
    Then the first monitor tile should be present in the montage grid
```

`@all` matches the file's existing convention. Device-tagged variants are not added. Device e2e runs are manual-only per memory.

- [ ] **Step 2: Add the step definitions**

Replace the contents of `app/tests/steps/montage.steps.ts` with:

```typescript
import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { ZmWorld } from './common.steps';

let firstMonitorTestId: string | null = null;

async function captureFirstMonitor(world: ZmWorld): Promise<string> {
  const page = world.actions.page;
  const tile = page.locator('[data-testid^="montage-monitor-"]').first();
  await expect(tile).toBeVisible();
  const id = await tile.getAttribute('data-testid');
  if (!id) throw new Error('First montage tile has no data-testid');
  firstMonitorTestId = id;
  return id;
}

When('I open the montage kebab menu', async function (this: ZmWorld) {
  await this.actions.page.getByTestId('montage-kebab-menu').click();
});

When('I open the montage show-monitors submenu', async function (this: ZmWorld) {
  await this.actions.page.getByTestId('montage-kebab-visibility').hover();
});

When('I uncheck the visibility for the first monitor', async function (this: ZmWorld) {
  const id = await captureFirstMonitor(this);
  const monitorId = id.replace('montage-monitor-', '');
  const cb = this.actions.page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'checked');
  await cb.click();
  await expect(cb).toHaveAttribute('data-state', 'unchecked');
});

When('I check the visibility for the first monitor', async function (this: ZmWorld) {
  if (!firstMonitorTestId) throw new Error('No first monitor captured');
  const monitorId = firstMonitorTestId.replace('montage-monitor-', '');
  const cb = this.actions.page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'unchecked');
  await cb.click();
  await expect(cb).toHaveAttribute('data-state', 'checked');
});

Then('the first monitor tile should not be present in the montage grid', async function (this: ZmWorld) {
  if (!firstMonitorTestId) throw new Error('No first monitor captured');
  await expect(this.actions.page.getByTestId(firstMonitorTestId)).toHaveCount(0);
});

Then('the first monitor tile should still not be present', async function (this: ZmWorld) {
  if (!firstMonitorTestId) throw new Error('No first monitor captured');
  await expect(this.actions.page.getByTestId(firstMonitorTestId)).toHaveCount(0);
});

Then('the first monitor tile should be present in the montage grid', async function (this: ZmWorld) {
  if (!firstMonitorTestId) throw new Error('No first monitor captured');
  await expect(this.actions.page.getByTestId(firstMonitorTestId)).toBeVisible();
});

When('I reload the page', async function (this: ZmWorld) {
  await this.actions.page.reload();
});
```

Note: confirm the `ZmWorld` type path matches what `common.steps.ts` exports. If it's `from './world'` or similar, adjust the import. Likewise check whether `reload` is already defined elsewhere; if so, remove the local definition to avoid duplicate Cucumber registration.

- [ ] **Step 3: Sanity-check the step world type**

From `app/`:

```bash
grep -n "ZmWorld\|export.*World" tests/steps/common.steps.ts tests/steps/world.ts 2>/dev/null | head
```

If the actual export name differs (e.g. `CustomWorld`), update the imports in `montage.steps.ts` accordingly before continuing.

- [ ] **Step 4: Run the e2e scenario (web only)**

Memory rule: do not run iOS/Android/Tauri e2e from agent. Web only.

```bash
npm run test:e2e -- montage.feature
```

Expected: all montage scenarios pass, including the new visibility scenario. If the scenario fails because reload nukes the persisted store, verify `persist` in `stores/settings.ts` covers `montageHiddenMonitorIds` (it persists the whole store, so it should).

- [ ] **Step 5: Commit**

```bash
git add app/tests/features/montage.feature app/tests/steps/montage.steps.ts
git commit -m "$(cat <<'EOF'
test(montage): e2e for hiding monitors via kebab menu (refs #<id>)

Adds a web-tagged scenario that hides a monitor, reloads, and asserts
persistence, then unhides and asserts the tile returns. Step
definitions for the kebab menu, submenu, and per-monitor checkboxes
live in tests/steps/montage.steps.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification and user-confirmation gate

- [ ] **Step 1: Run the full verification chain (rule 3 / "Verification & Commits")**

From `app/`:

```bash
npm test
npx tsc --noEmit
npm run build
npm run test:e2e -- montage.feature
```

All four must pass. Do not proceed if any fail.

- [ ] **Step 2: Report to user**

Print:

> Tests verified: npm test ✓, tsc --noEmit ✓, build ✓, test:e2e -- montage.feature ✓
> Branch ready for review against #<id>. Please run the app and confirm:
> - Kebab menu appears at the right of the montage toolbar
> - Refresh entry inside the menu reloads the monitor list
> - Show monitors submenu lists every enabled monitor with a checkbox
> - Unchecking a monitor removes it from the grid; rechecking restores it
> - Visibility persists across reloads
> - Group filter still works and AND-combines with the hide list

Wait for the user to confirm. Per rules 19 and 22, do not merge or push without approval.

- [ ] **Step 3: Final commit only if the user requests changes**

If the user requests fixes, address them in additional `refs #<id>` commits. Only after the user confirms the feature works on their device, amend the last meaningful change (or add a no-op `chore:` commit if nothing else is changing) so the final commit message uses `fixes #<id>`. Per rule 20, keep one logical change per commit.

If the user prefers PR-based merge:

```bash
git push -u origin <branch>
gh pr create --title "feat(montage): kebab menu with refresh and per-monitor visibility" \
  --body "$(cat <<'EOF'
## Summary
- Adds a kebab (`...`) menu to the Montage page toolbar
- Moves Refresh into the kebab; removes the standalone toolbar button
- Adds a Show monitors checkbox submenu (montage-only visibility, profile-scoped, AND-combined with group filter)

## Test plan
- [x] npm test
- [x] tsc --noEmit
- [x] npm run build
- [x] npm run test:e2e -- montage.feature
- [ ] Manual: kebab opens, refresh works, hide/unhide persists across reload

Closes #<id>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- The Radix `DropdownMenuCheckboxItem` already supports `data-state="checked"|"unchecked"`. Tests rely on this attribute rather than `aria-checked`.
- `onSelect={(e) => e.preventDefault()}` on the checkbox is what keeps the menu open while toggling.
- `Monitor.Sequence` is typed as `string | undefined` in the API types; the component coerces with `Number(...)` and falls back to `0`. Don't tighten that without checking other call sites.
- If the kebab feels visually crowded on the smallest phones, the toolbar's `flex-wrap` already wraps the row. No extra responsive work needed.
- The component does not subscribe to any store directly. All state flows in via props. This makes the unit test fully isolated.
