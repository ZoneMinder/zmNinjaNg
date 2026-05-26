# Montage view kebab menu

Date: 2026-05-26
Status: approved (design phase)

## Summary

Add a vertical kebab (`MoreVertical`) menu to the right end of the Montage page toolbar. Move the existing standalone refresh action into this menu, and add a "Show monitors" submenu that lets the user hide or unhide individual monitors from the montage grid. Visibility is profile-scoped and persisted, applies only to the Montage page, and combines (AND) with the existing group filter. The grid recompacts when monitors are hidden.

## Motivation

The Montage toolbar is getting crowded. Pulling secondary actions into a kebab keeps the toolbar focused on layout controls. Per-monitor hiding is also useful as a transient view-tweak that doesn't require disabling a monitor or building a new group.

## UI changes

### Toolbar

File: `app/src/pages/Montage.tsx`, lines ~307-378.

- Remove the standalone `RefreshButton` (currently around line 332-339).
- Append a new kebab button after the fullscreen button and before `NotificationBadge`:
  - Icon: `MoreVertical` from `lucide-react`.
  - Size: `h-8 sm:h-9`, `size="sm"`, `variant="outline"`.
  - `data-testid="montage-kebab-menu"`, `aria-label={t('montage.menu_more')}`.

The empty-state branch (lines ~274-292) keeps its standalone `RefreshButton` since the kebab toolbar isn't rendered there.

### Menu contents

Use the existing `app/src/components/ui/dropdown-menu.tsx` primitives (Radix). Structure:

```
DropdownMenu
  DropdownMenuTrigger  (kebab button)
  DropdownMenuContent  align="end"
    DropdownMenuItem  (Refresh)
      icon: RefreshCw (spinning when isFetching)
    DropdownMenuSeparator
    DropdownMenuSub  (only rendered if enabledMonitors.length > 0)
      DropdownMenuSubTrigger  (Show monitors)
      DropdownMenuSubContent
        DropdownMenuCheckboxItem  x N  (one per enabled monitor)
```

Details:

- **Refresh entry**: calls `refetch()`. Disabled while `isFetching`. `data-testid="montage-kebab-refresh"`.
- **Show monitors submenu**: trigger `data-testid="montage-kebab-visibility"`.
- **Checkbox items**: ordered by `Monitor.Sequence` ascending, then `Monitor.Name` as a tiebreaker. Source list is `enabledMonitors` (before the group and hidden filters). Checked = visible, unchecked = hidden. Toggling does not close the menu (default Radix `CheckboxItem` behavior). Each item: `data-testid="montage-visibility-${Monitor.Id}"`, label is `Monitor.Name`.
- **Empty submenu guard**: if `enabledMonitors.length === 0` (rare, the page would already be in the empty state), omit the submenu and separator. This branch is defensive only.

## State

### New setting

`app/src/stores/settings.ts`:

```ts
montageHiddenMonitorIds: number[]; // monitor IDs hidden in the Montage view, profile-scoped
```

Default: `[]`. Add to the `ProfileSettings` interface and to `DEFAULT_PROFILE_SETTINGS`.

### Filter wiring

`app/src/pages/Montage.tsx`, the `monitors` memo (currently lines ~84-87):

```ts
const hiddenSet = useMemo(
  () => new Set(settings.montageHiddenMonitorIds ?? []),
  [settings.montageHiddenMonitorIds]
);

const monitors = useMemo(() => {
  let list = enabledMonitors;
  if (isFilterActive) list = filterMonitorsByGroup(list, filteredMonitorIds);
  if (hiddenSet.size > 0) list = list.filter((m) => !hiddenSet.has(m.Monitor.Id));
  return list;
}, [enabledMonitors, isFilterActive, filteredMonitorIds, hiddenSet]);
```

Group filter and hide filter are AND-combined as confirmed. `useMontageGrid` already handles a shrinking monitor list, so the grid recompacts automatically via `compactType='vertical'`.

### Toggle handler

```ts
const toggleMonitorVisibility = (id: number) => {
  if (!currentProfile) return;
  const current = settings.montageHiddenMonitorIds ?? [];
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  updateSettings(currentProfile.id, { montageHiddenMonitorIds: next });
};
```

Per rule 7, all reads and writes go through `getProfileSettings` / `updateProfileSettings`.

## i18n

Add to all five translation files (`en`, `de`, `es`, `fr`, `zh`) under the `montage` namespace:

| Key | EN | Notes |
|---|---|---|
| `montage.menu_more` | More | aria-label and tooltip for the kebab button |
| `montage.menu_refresh` | Refresh | menu entry label |
| `montage.menu_show_monitors` | Show monitors | submenu trigger label |

Per rule 23, keep labels short across all languages. Translator guidance: prefer single-word equivalents where possible (DE "Mehr"/"Aktualisieren"/"Monitore", ES "Más"/"Actualizar"/"Monitores", FR "Plus"/"Actualiser"/"Moniteurs", ZH "更多"/"刷新"/"显示监视器").

## Testing

### Unit (`app/src/pages/__tests__/Montage.test.tsx`)

Extend existing test file with:

1. Kebab button is present in the toolbar and opens the menu when clicked.
2. Clicking the refresh menu item invokes `refetch`.
3. Toggling a checkbox in the visibility submenu updates `montageHiddenMonitorIds` via the settings store mock.
4. A monitor whose ID is in `montageHiddenMonitorIds` is not rendered in the grid.
5. The hidden filter combines with the group filter (monitor must pass both to render).

### E2E

Add a scenario to an existing montage feature file in `app/tests/features/`:

```gherkin
@all
Scenario: Hide a monitor from the montage view
  Given I am logged into zmNinjaNg
  When I navigate to the "Montage" page
  And I open the montage kebab menu
  And I open the "Show monitors" submenu
  And I uncheck the visibility for the first monitor
  Then that monitor tile should not be present in the montage grid
  When I refresh the page
  Then that monitor tile should still not be present
  When I open the montage kebab menu
  And I open the "Show monitors" submenu
  And I re-check the visibility for that monitor
  Then that monitor tile should be present in the montage grid
```

Step definitions live in `app/tests/steps/montage.steps.ts` (existing). Use `TestActions` per rule.

Web-only run (per repo policy device e2e tests are manual-only): `npm run test:e2e -- montage.feature`.

## Out of scope

- No reorder controls in the submenu.
- No "hide all" / "show all" shortcuts.
- No effect on dashboard, monitor list, or monitor detail pages. Hidden monitors still load and function everywhere else.
- No new icon next to hidden monitors in other views.
- Saved layouts are not modified. When a monitor is later unhidden, `useMontageGrid` assigns it a fresh layout slot using its current behavior.

## Risks and mitigations

- **Stale layouts after toggling**: `useMontageGrid` already tolerates monitors appearing and disappearing. No migration needed.
- **Profile switch**: `montageHiddenMonitorIds` is profile-scoped, so switching profiles changes the list cleanly.
- **Persistence across upgrades**: new field defaults to `[]`. Older persisted state without the key reads as `undefined`, handled by the `?? []` fallback.

## Files touched

- `app/src/pages/Montage.tsx` (toolbar, menu, filter wiring)
- `app/src/stores/settings.ts` (interface + default)
- `app/src/locales/{en,de,es,fr,zh}/translation.json` (3 new keys)
- `app/src/pages/__tests__/Montage.test.tsx` (unit tests)
- `app/tests/features/<existing montage feature>.feature` (e2e scenario)
- `app/tests/steps/montage.steps.ts` (new step definitions if missing)

No new dependencies. No new shared components. The dropdown primitive already exists at `app/src/components/ui/dropdown-menu.tsx`.

## Issue

A GitHub issue will be created before implementation per rule 2, with this spec linked.
