# Around This Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button on any event that opens a panel over the current view listing every event from the other cameras within a configurable window either side of it, with the anchor marked.

**Architecture:** Pure window/scope logic lives in `lib/event/event-context.ts`; one React Query hook (`useEventsAround`) turns an anchor plus the user's window and scope into a single `getEvents` call against the anchor's own profile session; one `<EventContextPanel />` mounted in `AppLayout` renders as a right sheet on desktop and a bottom sheet on mobile, opened from anywhere through a small Zustand store. Window and scope persist as a profile setting so the panel sets its own default.

**Tech Stack:** React 19, TypeScript, Zustand, TanStack Query v5, react-i18next, Tailwind, shadcn/ui primitives (`ui/sheet`, `ui/badge`, `ui/button`), Vitest + Testing Library, Playwright/Cucumber `.feature` files.

**Spec:** `docs/superpowers/specs/2026-09-17-around-this-event-design.md`
**Issue:** #494
**Branch:** `feat/494-around-this-event` (already created; the spec is already committed there)

## Global Constraints

- Run all npm commands from `app/`. Never run `npx vitest` from the repo root.
- Contract: all network requests go through `app/src/lib/http.ts` helpers or the API client. Never raw `fetch`/`axios`.
- Contract: all diagnostic output goes through `log.*` helpers with an explicit `LogLevel`. Never `console`.
- Contract: React Query keys come from `app/src/lib/query/query-keys.ts`, with profile ids wrapped by `asProfileId`. Never inline key arrays.
- Contract: all profile-scoped preferences go through `getProfileSettings` / `updateProfileSettings`, with every default and coercion declared in `mergeProfileSettings`.
- Contract: user-facing text lives in `app/src/locales/<lang>/translation.json` for all seven languages (de, en, es, fr, it, ru, zh), updated in the same commit. Never hardcode a string.
- Contract: semantic values live in `app/src/lib/zmninja-ng-constants.ts`. Never inline a magic number.
- Contract: sessions come from `getSession(profileId)`. Never construct an `ApiClient`.
- Contract: query loading and error states use `ErrorBanner` + `resolveQueryError` and the shared skeletons. Never ad-hoc error markup.
- Contract: pressed controls are `default` over `outline` with `aria-pressed`; icon-only buttons need `title` and `aria-label`.
- Every new interactive element needs a kebab-case `data-testid`.
- Labels must fit 320px. Every label added here is one word where possible, two at most.
- Files stay under 400 lines of code (blank lines and comments excluded).
- P2: every test is proven red against the pre-change code before its implementation lands. `node scripts/proven-red.mjs <base> <head>` does this for unit tests; e2e is proven red by hand.
- Commit per task, conventional commits, `refs #494` in the body.

## ZoneMinder facts that shape the code

- Repeating `MonitorId` params ORs them, so a multi-camera window is one request with several `MonitorId:` segments (`getEvents` splits a comma list into exactly that).
- Filter URLs cap near 8KB, so a scope resolving to a very long id list falls back to an unfiltered window rather than building a doomed URL.
- `LinkedMonitors` is a free-text column. Treat it as untrusted: extract ids, drop the rest.

## File structure

**New files**

| File | Responsibility |
|---|---|
| `app/src/lib/event/event-context.ts` | Pure logic: window bounds from an anchor, `LinkedMonitors` parsing, group-monitor resolution, scope availability. No React. |
| `app/src/lib/event/__tests__/event-context.test.ts` | Units for the above. |
| `app/src/hooks/useEventsAround.ts` | One query for the window; returns rows, truncation flag, error. |
| `app/src/hooks/__tests__/useEventsAround.test.tsx` | Hook test through the profile fixture. |
| `app/src/stores/eventContext.ts` | `{ anchor, profileId, open }` plus `openPanel` / `closePanel`. |
| `app/src/components/events/context/EventContextButton.tsx` | The trigger, used by all three surfaces. |
| `app/src/components/events/context/EventContextPanel.tsx` | Shell: desktop sheet / mobile sheet, dismissal, layout. |
| `app/src/components/events/context/EventContextControls.tsx` | Window chips and scope segments. |
| `app/src/components/events/context/EventContextList.tsx` | Rows, offsets, anchor row, empty and truncation states. |
| `app/src/components/events/context/EventContextRibbon.tsx` | Lanes and dots. |
| `app/src/components/events/context/__tests__/*.test.tsx` | Component tests per file above. |
| `app/tests/features/event-context.feature` | E2E scenarios. |
| `app/tests/steps/event-context.steps.ts` | Their steps. |

**Modified files**

| File | Change |
|---|---|
| `app/src/lib/zmninja-ng-constants.ts` | `EVENT_CONTEXT` constant block. |
| `app/src/stores/settings.ts` | `eventContext` field, default, coercion in `mergeProfileSettings`. |
| `app/src/lib/query/query-keys.ts` | `eventsAround` key. |
| `app/src/components/layout/AppLayout.tsx` | Mount `<EventContextPanel />` once. |
| `app/src/components/events/EventCard.tsx` | Trigger in the action cluster. |
| `app/src/components/events/EventMontageView.tsx` | Trigger in the tile overlay. |
| `app/src/pages/EventDetail.tsx` | Trigger in the Timing card. |
| `app/src/pages/Settings.tsx` | Default window and scope controls. |
| `app/src/locales/*/translation.json` | `events.around.*` keys, seven languages. |
| `docs/user-guide/` and `docs/developer-guide/` | User-facing description and a call flow. |

---

### Task 1: Window and scope logic

Pure functions with no React and no network. Everything later tasks compute
about "which events, from which cameras" is decided here.

**Files:**
- Create: `app/src/lib/event/event-context.ts`
- Create: `app/src/lib/event/__tests__/event-context.test.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (add `EVENT_CONTEXT`)

**Interfaces:**
- Consumes: `eventInstant` (`lib/event/event-instant.ts`), `formatForServerInTz` (`lib/time.ts`), `EventData`/`GroupsResponse` (`api/types.ts`).
- Produces:
  - `type EventContextScope = 'linked' | 'group' | 'all'`
  - `EVENT_CONTEXT_SCOPES: readonly EventContextScope[]`
  - `eventContextWindow(event: EventData, windowMinutes: number, timezone: string): { startDateTime: string; endDateTime: string; anchorMs: number }`
  - `parseLinkedMonitorIds(raw: string | null | undefined): string[]`
  - `groupMonitorIds(groups: GroupsResponse['groups'] | undefined, monitorId: string): string[]`
  - `resolveScopeMonitorIds(scope, { linked, group }): string[] | undefined`

- [ ] **Step 1: Add the constants**

In `app/src/lib/zmninja-ng-constants.ts`, beside the other event blocks:

```ts
/** "Around this event": the window either side of an anchor event, and the
 *  ceiling on how much of the answer one request may ask for. */
export const EVENT_CONTEXT = {
  /** Selectable windows, in minutes. Rendered as chips, so keep them few. */
  windowChoices: [5, 10, 15, 30, 60] as const,
  defaultWindowMinutes: 10,
  /** Rows one window may return before the list says it truncated. */
  maxResults: 200,
  /** Above this many monitor ids, the request drops the MonitorId filter and
   *  narrows client-side: ZoneMinder's filter URLs cap out near 8KB. */
  maxMonitorIds: 40,
} as const;
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/event/__tests__/event-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  eventContextWindow,
  parseLinkedMonitorIds,
  groupMonitorIds,
  resolveScopeMonitorIds,
} from '../event-context';
import type { EventData } from '../../../api/types';

const anchor = (over: Partial<EventData['Event']> = {}): EventData =>
  ({
    Event: {
      Id: '406',
      MonitorId: '3',
      StartDateTime: '2026-09-17 21:14:03',
      EndDateTime: '2026-09-17 21:14:41',
      Length: '38.00',
      ...over,
    },
  }) as EventData;

describe('eventContextWindow', () => {
  it('spans the anchor start minus N to the anchor end plus N', () => {
    const w = eventContextWindow(anchor(), 15, 'UTC');
    expect(w.startDateTime).toBe('2026-09-17 20:59:03');
    expect(w.endDateTime).toBe('2026-09-17 21:29:41');
  });

  it('measures the window in the profile timezone, not the browser one', () => {
    const utc = eventContextWindow(anchor(), 15, 'UTC');
    const ny = eventContextWindow(anchor(), 15, 'America/New_York');
    expect(ny.startDateTime).toBe(utc.startDateTime);
    expect(ny.anchorMs - utc.anchorMs).toBe(4 * 60 * 60 * 1000);
  });

  it('extends past a long anchor event instead of clipping its tail', () => {
    const long = anchor({ EndDateTime: '2026-09-17 21:44:03', Length: '1800.00' });
    expect(eventContextWindow(long, 5, 'UTC').endDateTime).toBe('2026-09-17 21:49:03');
  });

  it('falls back to start plus Length when the server reports no end', () => {
    const open = anchor({ EndDateTime: null });
    expect(eventContextWindow(open, 1, 'UTC').endDateTime).toBe('2026-09-17 21:15:41');
  });
});

describe('parseLinkedMonitorIds', () => {
  it('reads a comma separated id list', () => {
    expect(parseLinkedMonitorIds('2,5,9')).toEqual(['2', '5', '9']);
  });

  it('tolerates spacing and prefixed tokens ZoneMinder writes', () => {
    expect(parseLinkedMonitorIds(' 2 , Monitor:5 ,,9 ')).toEqual(['2', '5', '9']);
  });

  it('treats an empty, null or unreadable field as no links', () => {
    expect(parseLinkedMonitorIds('')).toEqual([]);
    expect(parseLinkedMonitorIds(null)).toEqual([]);
    expect(parseLinkedMonitorIds('none')).toEqual([]);
  });
});

describe('groupMonitorIds', () => {
  const groups = [
    { Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '3' }, { Id: '4' }] },
    { Group: { Id: '2', Name: 'Inside' }, Monitor: [{ Id: '7' }] },
    { Group: { Id: '3', Name: 'Front' }, Monitor: [{ Id: '3' }, { Id: '9' }] },
  ] as unknown as Parameters<typeof groupMonitorIds>[0];

  it('unions every group the monitor belongs to, including itself', () => {
    expect(groupMonitorIds(groups, '3')).toEqual(['3', '4', '9']);
  });

  it('returns nothing for a monitor in no group', () => {
    expect(groupMonitorIds(groups, '11')).toEqual([]);
  });

  it('returns nothing when groups have not loaded', () => {
    expect(groupMonitorIds(undefined, '3')).toEqual([]);
  });
});

describe('resolveScopeMonitorIds', () => {
  it('drops the monitor filter entirely for the all scope', () => {
    expect(resolveScopeMonitorIds('all', { linked: ['2'], group: ['3'] })).toBeUndefined();
  });

  it('includes the anchor monitor with its linked cameras', () => {
    expect(resolveScopeMonitorIds('linked', { linked: ['3', '2'], group: [] })).toEqual(['3', '2']);
  });

  it('falls back to every camera when the list would blow the URL cap', () => {
    const many = Array.from({ length: 41 }, (_, i) => String(i + 1));
    expect(resolveScopeMonitorIds('group', { linked: [], group: many })).toBeUndefined();
  });

  it('falls back to every camera when the scope resolves to nothing', () => {
    expect(resolveScopeMonitorIds('linked', { linked: [], group: [] })).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd app && npx vitest run src/lib/event/__tests__/event-context.test.ts
```

Expected: FAIL — `event-context` does not exist.

- [ ] **Step 4: Write the implementation**

Create `app/src/lib/event/event-context.ts`:

```ts
/**
 * "Around this event": which window, and which cameras.
 *
 * Pure and React-free so the panel, the hook and their tests all agree on the
 * same arithmetic. Every function here treats its input as untrusted: the
 * window comes from persisted settings and the monitor lists come from
 * ZoneMinder columns users hand-edit (I1).
 */

import { fromZonedTime } from 'date-fns-tz';
import { EVENT_CONTEXT } from '../zmninja-ng-constants';
import { formatForServerInTz } from '../time';
import { eventInstant } from './event-instant';
import type { EventData, GroupsResponse } from '../../api/types';

export type EventContextScope = 'linked' | 'group' | 'all';
export const EVENT_CONTEXT_SCOPES: readonly EventContextScope[] = ['linked', 'group', 'all'] as const;

export interface EventContextWindow {
  /** ZoneMinder wall-clock bounds, in the owning profile's timezone. */
  startDateTime: string;
  endDateTime: string;
  /** The anchor's own instant, for offsets the list and ribbon render. */
  anchorMs: number;
}

export function eventContextWindow(
  event: EventData,
  windowMinutes: number,
  timezone: string
): EventContextWindow {
  const anchorMs = eventInstant(event, timezone);
  const endRaw = event.Event.EndDateTime;
  const endMs = endRaw
    ? fromZonedTime(endRaw.replace(' ', 'T'), timezone).getTime()
    : anchorMs + (Number(event.Event.Length) || 0) * 1000;
  const padMs = windowMinutes * 60 * 1000;
  return {
    startDateTime: formatForServerInTz(new Date(anchorMs - padMs), timezone),
    endDateTime: formatForServerInTz(new Date(endMs + padMs), timezone),
    anchorMs,
  };
}

/** Ids out of ZoneMinder's free-text `LinkedMonitors` column, in order, once
 *  each. Anything that is not a run of digits is dropped rather than guessed. */
export function parseLinkedMonitorIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(',').map((part) => part.match(/\d+/)?.[0]).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** Every monitor sharing a group with `monitorId`, the monitor included. */
export function groupMonitorIds(
  groups: GroupsResponse['groups'] | undefined,
  monitorId: string
): string[] {
  if (!groups) return [];
  const ids = new Set<string>();
  for (const entry of groups) {
    const members = entry.Monitor?.map((m) => String(m.Id)) ?? [];
    if (!members.includes(monitorId)) continue;
    for (const id of members) ids.add(id);
  }
  return [...ids];
}

/**
 * The `monitorId` filter for a scope, or undefined to ask for every camera.
 *
 * Undefined is also the answer when a scope resolves to nothing (a server with
 * no links configured) or to more ids than one filter URL can carry: a window
 * over every camera is a worse answer than an error, but it is still an answer.
 */
export function resolveScopeMonitorIds(
  scope: EventContextScope,
  ids: { linked: string[]; group: string[] }
): string[] | undefined {
  if (scope === 'all') return undefined;
  const selected = scope === 'linked' ? ids.linked : ids.group;
  if (selected.length === 0 || selected.length > EVENT_CONTEXT.maxMonitorIds) return undefined;
  return selected;
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd app && npx vitest run src/lib/event/__tests__/event-context.test.ts && npx tsc -b
```

Expected: PASS, and a clean type build.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/event/event-context.ts app/src/lib/event/__tests__/event-context.test.ts app/src/lib/zmninja-ng-constants.ts
git commit -m "feat(events): window and camera-scope logic for event context

refs #494"
```

---

### Task 2: The `eventContext` profile setting

The window and scope the panel opens with. Persisted per profile, coerced on
every read, because persisted settings are a trust boundary (I1).

**Files:**
- Modify: `app/src/stores/settings.ts` (`ProfileSettings`, `DEFAULT_SETTINGS`, `mergeProfileSettings`)
- Modify: `app/src/stores/settings-coercion.ts` (the coercion itself)
- Modify: `app/src/stores/__tests__/settings.test.ts` (or the file holding merge tests)

**Interfaces:**
- Consumes: `EVENT_CONTEXT` and `EventContextScope` from Task 1.
- Produces: `ProfileSettings['eventContext']: { windowMinutes: number; scope: EventContextScope }`, always valid after `mergeProfileSettings`.

`settings-coercion.ts` may not import `settings.ts` (the module graph stays
acyclic), so the coercion takes its defaults as an argument, exactly as
`coerceAllModePerformance` does.

- [ ] **Step 1: Write the failing test**

Add to the settings store's merge tests:

```ts
import { mergeProfileSettings, DEFAULT_SETTINGS } from '../settings';

describe('mergeProfileSettings eventContext', () => {
  it('defaults to a ten minute window over every camera', () => {
    expect(mergeProfileSettings(undefined).eventContext).toEqual({
      windowMinutes: 10,
      scope: 'all',
    });
  });

  it('keeps a window the user chose', () => {
    const merged = mergeProfileSettings({
      eventContext: { windowMinutes: 30, scope: 'linked' },
    } as Partial<typeof DEFAULT_SETTINGS>);
    expect(merged.eventContext).toEqual({ windowMinutes: 30, scope: 'linked' });
  });

  it('replaces a window no chip offers with the default', () => {
    const merged = mergeProfileSettings({
      eventContext: { windowMinutes: 4000, scope: 'all' },
    } as Partial<typeof DEFAULT_SETTINGS>);
    expect(merged.eventContext.windowMinutes).toBe(10);
  });

  it('replaces a scope the app does not know with the default', () => {
    const merged = mergeProfileSettings({
      eventContext: { windowMinutes: 15, scope: 'neighbours' },
    } as unknown as Partial<typeof DEFAULT_SETTINGS>);
    expect(merged.eventContext).toEqual({ windowMinutes: 15, scope: 'all' });
  });

  it('survives a half-written blob', () => {
    const merged = mergeProfileSettings({
      eventContext: { scope: 'group' },
    } as unknown as Partial<typeof DEFAULT_SETTINGS>);
    expect(merged.eventContext).toEqual({ windowMinutes: 10, scope: 'group' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/stores/__tests__/settings.test.ts -t eventContext
```

Expected: FAIL — `eventContext` is undefined.

- [ ] **Step 3: Declare the field and its default**

In `app/src/stores/settings.ts`, in `ProfileSettings` beside the other event
preferences:

```ts
  /** "Around this event": the window either side of an anchor, and which
   *  cameras the window covers. Written by the panel's own controls, so the
   *  last answer becomes the next default (refs #494). */
  eventContext: EventContextSettings;
```

and in `DEFAULT_SETTINGS`:

```ts
  eventContext: DEFAULT_EVENT_CONTEXT,
```

- [ ] **Step 4: Write the coercion**

In `app/src/stores/settings-coercion.ts`:

```ts
import { EVENT_CONTEXT } from '../lib/zmninja-ng-constants';
import { EVENT_CONTEXT_SCOPES, type EventContextScope } from '../lib/event/event-context';

export interface EventContextSettings {
  windowMinutes: number;
  scope: EventContextScope;
}

export const DEFAULT_EVENT_CONTEXT: EventContextSettings = {
  windowMinutes: EVENT_CONTEXT.defaultWindowMinutes,
  scope: 'all',
};

/** Brings a persisted `eventContext` back inside what the UI can express: an
 *  offered window and a scope the panel has a segment for. */
export function coerceEventContext(
  merged: { eventContext: EventContextSettings },
  defaults: { eventContext: EventContextSettings }
): void {
  const raw = merged.eventContext ?? defaults.eventContext;
  const windowOffered = (EVENT_CONTEXT.windowChoices as readonly number[]).includes(raw.windowMinutes);
  merged.eventContext = {
    windowMinutes: windowOffered ? raw.windowMinutes : defaults.eventContext.windowMinutes,
    scope: EVENT_CONTEXT_SCOPES.includes(raw.scope) ? raw.scope : defaults.eventContext.scope,
  };
}
```

Re-export the type from `settings.ts` alongside `AllModeStreamTuning`, so
existing consumers keep importing settings types from one place:

```ts
export type { EventContextSettings };
export { DEFAULT_EVENT_CONTEXT };
```

- [ ] **Step 5: Call it from the merge**

In `mergeProfileSettings`, beside the existing call:

```ts
  coerceAllModePerformance(merged, DEFAULT_SETTINGS);
  coerceEventContext(merged, DEFAULT_SETTINGS);
  return merged;
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/stores/__tests__/settings.test.ts && npx tsc -b
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/stores/settings.ts app/src/stores/settings-coercion.ts app/src/stores/__tests__/settings.test.ts
git commit -m "feat(settings): persist the around-this-event window and scope

refs #494"
```

---

### Task 3: `useEventsAround`

One hook, three parented queries (monitors, groups, events), all keyed by the
anchor's OWN profile. It never reads the current profile: in All mode there
isn't one, and the anchor row already knows which server it came from
(Aggregation contract).

**Files:**
- Create: `app/src/hooks/useEventsAround.ts`
- Create: `app/src/hooks/__tests__/useEventsAround.test.tsx`
- Modify: `app/src/lib/query/query-keys.ts`

**Interfaces:**
- Consumes: Task 1's `eventContextWindow`, `parseLinkedMonitorIds`, `groupMonitorIds`, `resolveScopeMonitorIds`; Task 2's `EventContextSettings`; `getEvents` (`api/events.ts`), `getMonitors` (`api/monitors.ts`), `getGroups` (`api/groups.ts`), `getSession` (`services/sessions.ts`).
- Produces:

```ts
export interface EventAroundRow {
  event: Event;           // the `Event` payload, as EventCard receives it
  offsetMs: number;       // signed, relative to the anchor's start
  isAnchor: boolean;
}

export interface UseEventsAroundResult {
  rows: EventAroundRow[];
  anchorMs: number;
  isLoading: boolean;
  error: unknown;
  /** The server had more rows than `EVENT_CONTEXT.maxResults`. */
  truncated: boolean;
  /** Which scope segments this server can actually offer. */
  available: { linked: boolean; group: boolean };
  /** The resolved bounds, for the Timeline and Events escape hatches. */
  window: EventContextWindow;
  /** Monitor id -> name, for the ribbon's lane labels. */
  monitorNames: Map<string, string>;
}

export function useEventsAround(
  anchor: EventData | null,
  profileId: ProfileId | undefined,
  options: { windowMinutes: number; scope: EventContextScope; enabled: boolean }
): UseEventsAroundResult;
```

- [ ] **Step 1: Add the query key**

In `app/src/lib/query/query-keys.ts`, in the Events block:

```ts
  /** Events within a window either side of one anchor event. */
  eventsAround: (
    profileId: MaybeProfileId,
    anchorId: string,
    windowMinutes: number,
    scope: string,
  ) => ['events', profileId, 'around', anchorId, windowMinutes, scope] as const,
```

- [ ] **Step 2: Write the failing test**

Create `app/src/hooks/__tests__/useEventsAround.test.tsx`. It drives the real
stores through the profile fixture and scripts only the HTTP boundary, per the
testing playbook:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  seedProfiles,
  installApiClient,
  resetProfileFixture,
} from '../../tests/profile-fixture';
import { fakeApiClient } from '../../tests/fake-api-client';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { asProfileId } from '../../api/types';
import { useEventsAround } from '../useEventsAround';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const P = asProfileId('p1');

const anchor = {
  Event: {
    Id: '406',
    MonitorId: '3',
    Name: 'Front Door',
    StartDateTime: '2026-09-17 21:14:03',
    EndDateTime: '2026-09-17 21:14:41',
    Length: '38.00',
    Frames: '40',
    AlarmFrames: '4',
    Cause: 'Motion',
  },
} as never;

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('useEventsAround', () => {
  it('asks the anchor profile for the window and marks the anchor row', async () => {
    seedProfiles([{ id: P, name: 'Home', timezone: 'UTC' }]);
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '4' } }] },
      '/groups.json': { groups: [] },
      '/events/index': {
        events: [
          { Event: { ...anchor.Event } },
          { Event: { ...anchor.Event, Id: '407', MonitorId: '4', StartDateTime: '2026-09-17 21:10:03' } },
        ],
        pagination: { count: 2 },
      },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 15, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((r) => r.event.Id)).toEqual(['407', '406']);
    expect(result.current.rows[1].isAnchor).toBe(true);
    expect(result.current.rows[0].offsetMs).toBe(-240_000);
  });

  it('filters to the linked cameras when the scope asks for them', async () => {
    seedProfiles([{ id: P, name: 'Home', timezone: 'UTC' }]);
    const client = fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '4,7' } }] },
      '/groups.json': { groups: [] },
      '/events/index': { events: [], pagination: { count: 0 } },
    });
    installApiClient(P, client);

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'linked', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const requested = client.requests.map((r) => r.url).join(' ');
    expect(requested).toContain('MonitorId%3A3');
    expect(requested).toContain('MonitorId%3A4');
    expect(requested).toContain('MonitorId%3A7');
  });

  it('reports which scopes the server can offer', async () => {
    seedProfiles([{ id: P, name: 'Home', timezone: 'UTC' }]);
    installApiClient(
      P,
      fakeApiClient({
        '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Door', LinkedMonitors: '' } }] },
        '/groups.json': { groups: [{ Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '3' }, { Id: '9' }] }] },
        '/events/index': { events: [], pagination: { count: 0 } },
      })
    );

    const { result } = renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'all', enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.available).toEqual({ linked: false, group: true }));
  });

  it('asks for nothing while the panel is closed', async () => {
    seedProfiles([{ id: P, name: 'Home', timezone: 'UTC' }]);
    const client = fakeApiClient({});
    installApiClient(P, client);

    renderHook(
      () => useEventsAround(anchor, P, { windowMinutes: 5, scope: 'all', enabled: false }),
      { wrapper }
    );

    await waitFor(() => expect(client.requests).toHaveLength(0));
  });
});
```

Check `app/src/tests/fake-api-client.ts` for the exact path-matching and
`requests` recording API before writing these fixtures, and follow
`app/src/hooks/__tests__/useMonitors.test.tsx`, which is the reference.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd app && npx vitest run src/hooks/__tests__/useEventsAround.test.tsx
```

Expected: FAIL — `useEventsAround` does not exist.

- [ ] **Step 4: Write the hook**

Create `app/src/hooks/useEventsAround.ts`:

```ts
/**
 * Events within a window either side of one anchor event (refs #494).
 *
 * Everything here is keyed by the ANCHOR's profile, never the current one:
 * the panel opens from All-mode rows whose server is not the current profile,
 * and in All mode there is no current profile at all. Monitors and groups are
 * fetched under the same keys the parented hooks use, so an open Events page
 * has usually paid for them already.
 *
 * One request per window. The scopes resolve to a MonitorId list that
 * ZoneMinder ORs together; a list too long for one filter URL degrades to the
 * unfiltered window rather than failing.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getGroups } from '../api/groups';
import { getSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { EVENT_CONTEXT } from '../lib/zmninja-ng-constants';
import {
  eventContextWindow,
  groupMonitorIds,
  parseLinkedMonitorIds,
  resolveScopeMonitorIds,
  type EventContextScope,
  type EventContextWindow,
} from '../lib/event/event-context';
import { eventInstant } from '../lib/event/event-instant';
import { resolveProfileTimezone } from '../lib/time';
import { useProfileById } from './useCurrentProfile';
import type { Event, EventData, ProfileId } from '../api/types';

export interface EventAroundRow {
  event: Event;
  offsetMs: number;
  isAnchor: boolean;
}

export interface UseEventsAroundResult {
  rows: EventAroundRow[];
  anchorMs: number;
  isLoading: boolean;
  error: unknown;
  truncated: boolean;
  available: { linked: boolean; group: boolean };
  window: EventContextWindow;
}

export function useEventsAround(
  anchor: EventData | null,
  profileId: ProfileId | undefined,
  options: { windowMinutes: number; scope: EventContextScope; enabled: boolean }
): UseEventsAroundResult {
  const { profile } = useProfileById(profileId);
  const timezone = resolveProfileTimezone(profile?.timezone);
  const active = options.enabled && !!anchor && !!profileId;

  const monitorsQuery = useQuery({
    queryKey: queryKeys.monitors(profileId),
    queryFn: () => getMonitors(getSession(profileId!).client, profileId!),
    enabled: active,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups(profileId),
    queryFn: () => getGroups(getSession(profileId!).client),
    enabled: active,
  });

  const anchorMonitorId = anchor?.Event.MonitorId ?? '';
  const linked = useMemo(() => {
    const row = monitorsQuery.data?.monitors.find((m) => m.Monitor.Id === anchorMonitorId);
    const ids = parseLinkedMonitorIds(row?.Monitor.LinkedMonitors);
    return ids.length ? [anchorMonitorId, ...ids.filter((id) => id !== anchorMonitorId)] : [];
  }, [monitorsQuery.data, anchorMonitorId]);

  const group = useMemo(
    () => groupMonitorIds(groupsQuery.data?.groups, anchorMonitorId),
    [groupsQuery.data, anchorMonitorId]
  );

  const window = useMemo(
    () =>
      anchor
        ? eventContextWindow(anchor, options.windowMinutes, timezone)
        : { startDateTime: '', endDateTime: '', anchorMs: 0 },
    [anchor, options.windowMinutes, timezone]
  );

  const monitorIds = resolveScopeMonitorIds(options.scope, { linked, group });

  const eventsQuery = useQuery({
    queryKey: queryKeys.eventsAround(profileId, anchor?.Event.Id ?? '', options.windowMinutes, options.scope),
    queryFn: () =>
      getEvents(getSession(profileId!).client, profileId!, {
        startDateTime: window.startDateTime,
        endDateTime: window.endDateTime,
        monitorId: monitorIds?.join(','),
        sort: 'StartDateTime',
        direction: 'asc',
        limit: EVENT_CONTEXT.maxResults,
      }),
    enabled: active && !monitorsQuery.isLoading && !groupsQuery.isLoading,
  });

  const rows = useMemo<EventAroundRow[]>(() => {
    const events = eventsQuery.data?.events ?? [];
    return events
      .map((item) => ({
        event: item.Event,
        offsetMs: eventInstant(item, timezone) - window.anchorMs,
        isAnchor: item.Event.Id === anchor?.Event.Id,
      }))
      .sort((a, b) => a.offsetMs - b.offsetMs);
  }, [eventsQuery.data, timezone, window.anchorMs, anchor]);

  const monitorNames = useMemo(
    () => new Map((monitorsQuery.data?.monitors ?? []).map((m) => [m.Monitor.Id, m.Monitor.Name])),
    [monitorsQuery.data]
  );

  return {
    rows,
    monitorNames,
    anchorMs: window.anchorMs,
    isLoading: eventsQuery.isLoading || monitorsQuery.isLoading,
    error: eventsQuery.error,
    truncated: (eventsQuery.data?.pagination?.count ?? rows.length) > EVENT_CONTEXT.maxResults,
    available: { linked: linked.length > 0, group: group.length > 1 },
    window,
  };
}
```

Confirm the `EventsResponse` total-count field name in `app/src/api/events.ts`
before writing the `truncated` line; use whatever that response actually
exposes rather than the name above if they differ.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/hooks/__tests__/useEventsAround.test.tsx && npx tsc -b
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useEventsAround.ts app/src/hooks/__tests__/useEventsAround.test.tsx app/src/lib/query/query-keys.ts
git commit -m "feat(events): query events around an anchor event

refs #494"
```

---

### Task 4: The panel store, shell and trigger

A single panel mounted once, opened from anywhere. This task ends with a
working (if plain) panel reachable from the event list: list rows, controls
and ribbon arrive in Tasks 5 to 7.

`ui/sheet` is Radix, so its content carries `role="dialog"` with
`data-state="open"`. `lib/overlay.ts`'s `hasOpenOverlay` already matches that,
which means Escape and the Android hardware back button close this panel with
no extra wiring. Do not add a back-button handler.

**Files:**
- Create: `app/src/stores/eventContext.ts`
- Create: `app/src/components/events/context/EventContextPanel.tsx`
- Create: `app/src/components/events/context/EventContextButton.tsx`
- Create: `app/src/components/events/context/__tests__/EventContextPanel.test.tsx`
- Modify: `app/src/components/layout/AppLayout.tsx`
- Modify: `app/src/components/events/EventCard.tsx`
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

**Interfaces:**
- Consumes: Task 3's `useEventsAround`; `Platform` (`lib/platform.ts`); `useCurrentProfile`/`useProfileById`; `useDeniedControl`; `canViewEvents`.
- Produces:
  - `useEventContextStore` with `{ anchor: EventData | null; profileId: ProfileId | undefined; open: boolean; openPanel(anchor, profileId): void; closePanel(): void }`
  - `<EventContextButton event={Event} profileId={ProfileId | undefined} />`
  - `<EventContextPanel />` (no props; reads the store)

- [ ] **Step 1: Write the failing test**

Create `app/src/components/events/context/__tests__/EventContextPanel.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEventContextStore } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';

// Stub the data hook: this task tests the shell, Task 5 tests the rows.
vi.mock('../../../../hooks/useEventsAround', () => ({
  useEventsAround: () => ({
    rows: [],
    monitorNames: new Map(),
    anchorMs: 0,
    isLoading: false,
    error: null,
    truncated: false,
    available: { linked: false, group: false },
    window: { startDateTime: '', endDateTime: '', anchorMs: 0 },
  }),
}));

const event = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
} as never;

afterEach(() => useEventContextStore.getState().closePanel());

describe('EventContextPanel', () => {
  it('stays closed until something opens it', () => {
    render(<EventContextPanel />);
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
  });

  it('opens on the trigger and names the anchor event', () => {
    render(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(screen.getByTestId('event-context-panel')).toBeInTheDocument();
    expect(screen.getByTestId('event-context-anchor')).toHaveTextContent('Front Door');
  });

  it('closes again and leaves the page it opened over alone', () => {
    render(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    fireEvent.click(screen.getByTestId('event-context-close'));
    expect(screen.queryByTestId('event-context-panel')).not.toBeInTheDocument();
    expect(useEventContextStore.getState().anchor).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/events/context/__tests__/EventContextPanel.test.tsx
```

Expected: FAIL — the store and components do not exist.

- [ ] **Step 3: Write the store**

Create `app/src/stores/eventContext.ts`:

```ts
/**
 * Which event the "around this event" panel is anchored to, if any (refs #494).
 *
 * One store rather than per-card state: the panel is mounted once in the app
 * shell, so a list of two hundred cards costs two hundred buttons and one
 * sheet. The anchor carries its own profileId because an All-mode row's server
 * is not the current profile.
 */

import { create } from 'zustand';
import type { EventData, ProfileId } from '../api/types';

interface EventContextState {
  anchor: EventData | null;
  profileId: ProfileId | undefined;
  open: boolean;
  openPanel: (anchor: EventData, profileId: ProfileId | undefined) => void;
  closePanel: () => void;
}

export const useEventContextStore = create<EventContextState>((set) => ({
  anchor: null,
  profileId: undefined,
  open: false,
  openPanel: (anchor, profileId) => set({ anchor, profileId, open: true }),
  closePanel: () => set({ anchor: null, profileId: undefined, open: false }),
}));
```

- [ ] **Step 4: Write the trigger**

Create `app/src/components/events/context/EventContextButton.tsx`. It wraps the
row's `Event` into the `EventData` shape the hook expects, stops the click from
reaching the card underneath, and greys itself when the profile may not read
events, the way the archive button does:

```tsx
export function EventContextButton({ event, profileId, className }: EventContextButtonProps) {
  const { t } = useTranslation();
  const openPanel = useEventContextStore((s) => s.openPanel);
  const { currentProfile } = useCurrentProfile();
  const ownerProfileId = profileId ?? currentProfile?.id;
  const { permissions } = usePermissions(ownerProfileId);

  const props = useDeniedControl({
    denied: canViewEvents(permissions) === 'denied',
    message: t('events.around.permission_denied'),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      openPanel({ Event: event } as EventData, ownerProfileId);
    },
    title: t('events.around.open'),
    className: cn('p-1 rounded-full hover:bg-accent transition-colors', className),
  });

  return (
    <HintButton {...props} aria-label={t('events.around.open')} data-testid="event-context-open">
      <Link2 className="h-4 w-4 sm:h-5 sm:w-5 stroke-muted-foreground hover:stroke-primary" />
    </HintButton>
  );
}
```

- [ ] **Step 5: Write the shell**

Create `app/src/components/events/context/EventContextPanel.tsx`. Radix handles
the backdrop, Escape and focus trapping; `Platform`/a `sm:` breakpoint decides
which edge it comes from. Render nothing at all when closed, so a closed panel
costs no queries:

```tsx
export function EventContextPanel() {
  const { t } = useTranslation();
  const { anchor, profileId, open } = useEventContextStore(
    useShallow((s) => ({ anchor: s.anchor, profileId: s.profileId, open: s.open }))
  );
  const closePanel = useEventContextStore((s) => s.closePanel);
  const isMobile = useIsMobile();          // existing hook if present; else a Tailwind-only split
  const { settings } = useProfileById(profileId);

  if (!open || !anchor) return null;

  return (
    <Sheet open onOpenChange={(next) => { if (!next) closePanel(); }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn('flex flex-col gap-0 p-0', isMobile ? 'h-[85vh] rounded-t-2xl' : 'w-[440px] sm:max-w-[440px]')}
        data-testid="event-context-panel"
      >
        <SheetHeader className="px-4 pt-4 pb-3 text-left">
          <SheetTitle className="text-base">{t('events.around.title')}</SheetTitle>
          <div className="text-sm text-muted-foreground" data-testid="event-context-anchor">
            {anchor.Event.Name}
          </div>
        </SheetHeader>
        {/* Task 5 mounts <EventContextControls/>, Task 6 <EventContextList/>,
            Task 7 <EventContextRibbon/>, Task 8 the footer. */}
        <SheetClose asChild>
          <Button variant="outline" size="sm" className="m-4" data-testid="event-context-close">
            {t('common.close')}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
```

Check whether a viewport hook already exists (`useIsMobile`, `useMediaQuery` or
similar) before adding one; if none does, branch on `Platform.isNative` plus a
Tailwind `sm:` class set rather than introducing a new hook.

- [ ] **Step 6: Mount it once and wire the first trigger**

In `app/src/components/layout/AppLayout.tsx`, render `<EventContextPanel />`
beside the other app-level overlays. In `EventCard.tsx`, add
`<EventContextButton event={event} profileId={ownerProfileId} />` to the action
cluster, immediately before `<EventDeleteButton .../>`.

- [ ] **Step 7: Add the locale keys**

`events.around` in all seven `translation.json` files. One or two words each:

```json
"around": {
  "title": "Around this",
  "open": "Around this event",
  "permission_denied": "This account cannot read events.",
  "empty": "Nothing else in this window",
  "close": "Close"
}
```

- [ ] **Step 8: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/components/events/context src/locales && npx tsc -b
```

Expected: PASS, including the locale parity test.

- [ ] **Step 9: Commit**

```bash
git add app/src/stores/eventContext.ts app/src/components/events/context app/src/components/layout/AppLayout.tsx app/src/components/events/EventCard.tsx app/src/locales
git commit -m "feat(events): panel shell and trigger for events around an event

refs #494"
```

---

### Task 5: Window and scope controls

**Files:**
- Create: `app/src/components/events/context/EventContextControls.tsx`
- Create: `app/src/components/events/context/__tests__/EventContextControls.test.tsx`
- Modify: `app/src/components/events/context/EventContextPanel.tsx`
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

**Interfaces:**
- Consumes: `EVENT_CONTEXT.windowChoices`, `EVENT_CONTEXT_SCOPES`, Task 2's setting, Task 3's `available`.
- Produces:

```tsx
export interface EventContextControlsProps {
  value: EventContextSettings;
  onChange: (next: EventContextSettings) => void;
  available: { linked: boolean; group: boolean };
}
export function EventContextControls(props: EventContextControlsProps): JSX.Element;
```

Pressed chips and segments are `default` over `outline` with `aria-pressed`
(Controls contract). A scope the server cannot offer stays visible and greyed
through `useDeniedControl`, so it can say why.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventContextControls } from '../EventContextControls';

const value = { windowMinutes: 10, scope: 'all' as const };

describe('EventContextControls', () => {
  it('marks the chosen window pressed and the others not', () => {
    render(<EventContextControls value={value} onChange={vi.fn()} available={{ linked: true, group: true }} />);
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the window the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true }} />);
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 30, scope: 'all' });
  });

  it('reports the scope the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true }} />);
    fireEvent.click(screen.getByTestId('event-context-scope-linked'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 10, scope: 'linked' });
  });

  it('greys a scope this server cannot offer and does not switch to it', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: false, group: true }} />);
    const linked = screen.getByTestId('event-context-scope-linked');
    expect(linked).toHaveClass('opacity-50');
    fireEvent.click(linked);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/events/context/__tests__/EventContextControls.test.tsx
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

```tsx
export function EventContextControls({ value, onChange, available }: EventContextControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 pb-3">
      <div className="flex items-center gap-1" role="group" aria-label={t('events.around.window')}>
        {EVENT_CONTEXT.windowChoices.map((minutes) => (
          <Button
            key={minutes}
            size="sm"
            variant={value.windowMinutes === minutes ? 'default' : 'outline'}
            aria-pressed={value.windowMinutes === minutes}
            onClick={() => onChange({ ...value, windowMinutes: minutes })}
            data-testid={`event-context-window-${minutes}`}
          >
            {t('events.around.minutes', { count: minutes })}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="group" aria-label={t('events.around.scope')}>
        {EVENT_CONTEXT_SCOPES.map((scope) => (
          <ScopeSegment
            key={scope}
            scope={scope}
            active={value.scope === scope}
            enabled={scope === 'all' || available[scope]}
            onSelect={() => onChange({ ...value, scope })}
          />
        ))}
      </div>
    </div>
  );
}
```

`ScopeSegment` is a local component in the same file: a `Button` whose props
come from `useDeniedControl` with `denied: !enabled` and the message
`t('events.around.scope_unavailable_' + scope)`, `variant` `default` when
active and `outline` otherwise, `aria-pressed={active}`, and
`data-testid={'event-context-scope-' + scope}`.

- [ ] **Step 4: Wire it into the panel**

The panel holds the live value in `useState`, seeded from
`settings.eventContext`, and writes every change back through
`updateProfileSettings` for the anchor's profile, so the next open starts where
the last one ended:

```tsx
const [context, setContext] = useState(settings.eventContext);
const applyContext = useCallback((next: EventContextSettings) => {
  setContext(next);
  if (profileId) useSettingsStore.getState().updateProfileSettings(profileId, { eventContext: next });
}, [profileId]);
```

- [ ] **Step 5: Add the locale keys**

```json
"window": "Window",
"scope": "Cameras",
"minutes": "±{{count}}m",
"scope_linked": "Linked",
"scope_group": "Group",
"scope_all": "All",
"scope_unavailable_linked": "This camera has no linked cameras.",
"scope_unavailable_group": "This camera is in no group."
```

Seven locales, same keys. `minutes` keeps its plural forms per language.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/components/events/context src/locales && npx tsc -b
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/events/context app/src/locales
git commit -m "feat(events): window and camera-scope controls in the event context panel

refs #494"
```

---

### Task 6: The list

**Files:**
- Create: `app/src/components/events/context/EventContextList.tsx`
- Create: `app/src/components/events/context/__tests__/EventContextList.test.tsx`
- Modify: `app/src/components/events/context/EventContextPanel.tsx`
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

**Interfaces:**
- Consumes: Task 3's `EventAroundRow[]`, `CompactEventRow` (`components/events/CompactEventRow.tsx`), `buildThumbnailChainForEvent` (`lib/event/thumbnail-chain.ts`), `formatElapsedShort` (`lib/format-date-time.ts`), `EmptyState`, `ErrorBanner` + `resolveQueryError`.
- Produces:

```tsx
export interface EventContextListProps {
  rows: EventAroundRow[];
  profileId: ProfileId | undefined;
  isLoading: boolean;
  error: unknown;
  truncated: boolean;
  onWiden: (() => void) | undefined;   // undefined at the widest window
}
export function EventContextList(props: EventContextListProps): JSX.Element;
/** "−4:12" / "+0:38" / "0:00" — digits and a sign, no translation needed. */
export function offsetLabel(offsetMs: number): string;
```

`offsetLabel` wraps `formatElapsedShort`, which already renders `m:ss` narrow
enough for 320px; the sign is prepended with a real minus (U+2212) so it does
not read as a hyphen in the middle of a row.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventContextList, offsetLabel } from '../EventContextList';

const row = (id: string, offsetMs: number, isAnchor = false) => ({
  event: {
    Id: id,
    MonitorId: '3',
    Name: `Event ${id}`,
    StartDateTime: '2026-09-17 21:14:03',
    Length: '38.00',
    Frames: '40',
    AlarmFrames: '4',
    Cause: 'Motion',
  } as never,
  offsetMs,
  isAnchor,
});

describe('offsetLabel', () => {
  it('signs a row before the anchor', () => {
    expect(offsetLabel(-252_000)).toBe('−4:12');
  });

  it('signs a row after it', () => {
    expect(offsetLabel(38_000)).toBe('+0:38');
  });

  it('gives the anchor itself no sign', () => {
    expect(offsetLabel(0)).toBe('0:00');
  });
});

describe('EventContextList', () => {
  const props = { profileId: undefined, isLoading: false, error: null, truncated: false, onWiden: undefined };

  it('renders every row with its offset', () => {
    render(<EventContextList {...props} rows={[row('405', -252_000), row('406', 0, true)]} />);
    expect(screen.getByTestId('event-context-row-405')).toHaveTextContent('−4:12');
    expect(screen.getByTestId('event-context-row-406')).toHaveTextContent('0:00');
  });

  it('marks the anchor row so it reads as where you came from', () => {
    render(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    expect(screen.getByTestId('event-context-row-406')).toHaveAttribute('aria-current', 'true');
  });

  it('offers a wider window when nothing else is in this one', () => {
    const onWiden = vi.fn();
    render(<EventContextList {...props} rows={[]} onWiden={onWiden} />);
    expect(screen.getByTestId('event-context-empty')).toBeInTheDocument();
    screen.getByTestId('event-context-widen').click();
    expect(onWiden).toHaveBeenCalled();
  });

  it('says so when the server had more than one window can show', () => {
    render(<EventContextList {...props} rows={[row('406', 0, true)]} truncated />);
    expect(screen.getByTestId('event-context-truncated')).toBeInTheDocument();
  });

  it('shows the error banner instead of an empty list when the query failed', () => {
    render(<EventContextList {...props} rows={[]} error={new Error('nope')} />);
    expect(screen.queryByTestId('event-context-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('event-context-error')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/events/context/__tests__/EventContextList.test.tsx
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

Rows reuse `CompactEventRow` for the thumbnail, detection text, time and
duration; the offset badge and the anchor marking are this list's own. Build
each row's thumbnail chain with `buildThumbnailChainForEvent`, passing the
panel's `profileId` so an All-mode anchor resolves its own server's portal.
Loading renders the shared query-state skeleton, never a spinner of its own.
Error renders `<ErrorBanner message={resolveQueryError(error, t)} />` inside a
`<div data-testid="event-context-error">`, and the empty state renders
`<EmptyState icon={Link2} title={t('events.around.empty')} .../>` inside a
`<div data-testid="event-context-empty">`: neither primitive forwards a
`data-testid` of its own.

- [ ] **Step 4: Wire it into the panel, below the header**

- [ ] **Step 5: Add the locale keys**

```json
"empty_desc": "No events from other cameras in this window.",
"widen": "Wider",
"truncated": "Showing the first {{count}}. Open in Events for the rest."
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/components/events/context src/locales && npx tsc -b
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/events/context app/src/locales
git commit -m "feat(events): event rows and offsets in the event context panel

refs #494"
```

---

### Task 7: The ribbon

One lane per camera in the window, one dot per event, a line at the anchor.
Pure layout maths over the rows Task 3 already produced, so it needs no new
query and no canvas.

**Files:**
- Create: `app/src/components/events/context/EventContextRibbon.tsx`
- Create: `app/src/components/events/context/__tests__/EventContextRibbon.test.tsx`
- Modify: `app/src/components/events/context/EventContextPanel.tsx`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (ribbon geometry)
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

**Interfaces:**
- Consumes: Task 3's `rows` and `monitorNames`, Task 6's `offsetLabel`.
- Produces:

```tsx
export interface RibbonLane {
  monitorId: string;
  monitorName: string;
  dots: Array<{ eventId: string; leftPercent: number; isAnchor: boolean }>;
}
/** Lanes in first-seen order, each dot positioned 0-100% across the window. */
export function buildRibbonLanes(
  rows: EventAroundRow[],
  monitorNames: Map<string, string>,
  windowMs: number
): RibbonLane[];

export interface EventContextRibbonProps {
  lanes: RibbonLane[];
  onSelect: (eventId: string) => void;
}
export function EventContextRibbon(props: EventContextRibbonProps): JSX.Element | null;
```

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildRibbonLanes, EventContextRibbon } from '../EventContextRibbon';

const rows = [
  { event: { Id: '405', MonitorId: '4' } as never, offsetMs: -300_000, isAnchor: false },
  { event: { Id: '406', MonitorId: '3' } as never, offsetMs: 0, isAnchor: true },
  { event: { Id: '407', MonitorId: '4' } as never, offsetMs: 300_000, isAnchor: false },
];
const names = new Map([['3', 'Door'], ['4', 'Drive']]);

describe('buildRibbonLanes', () => {
  it('gives each camera one lane holding its own events', () => {
    const lanes = buildRibbonLanes(rows, names, 600_000);
    expect(lanes.map((l) => l.monitorId)).toEqual(['4', '3']);
    expect(lanes[0].dots.map((d) => d.eventId)).toEqual(['405', '407']);
  });

  it('places the anchor in the middle and the edges at the ends', () => {
    const [drive, door] = buildRibbonLanes(rows, names, 600_000);
    expect(door.dots[0].leftPercent).toBe(50);
    expect(drive.dots[0].leftPercent).toBe(0);
    expect(drive.dots[1].leftPercent).toBe(100);
  });

  it('names a camera it has no name for by its id', () => {
    const lanes = buildRibbonLanes(rows, new Map(), 600_000);
    expect(lanes[0].monitorName).toBe('4');
  });
});

describe('EventContextRibbon', () => {
  it('renders nothing when one camera has everything', () => {
    const lanes = buildRibbonLanes([rows[1]], names, 600_000);
    const { container } = render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the event behind a dot the user pressed', () => {
    const onSelect = vi.fn();
    render(<EventContextRibbon lanes={buildRibbonLanes(rows, names, 600_000)} onSelect={onSelect} />);
    screen.getByTestId('event-context-dot-407').click();
    expect(onSelect).toHaveBeenCalledWith('407');
  });

  it('labels each dot with its camera and offset for a screen reader', () => {
    render(<EventContextRibbon lanes={buildRibbonLanes(rows, names, 600_000)} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-dot-405')).toHaveAccessibleName(/Drive/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/events/context/__tests__/EventContextRibbon.test.tsx
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

`leftPercent` is `((offsetMs + windowMs / 2) / windowMs) * 100`, clamped to
0-100. Lanes render as rows of `EVENT_CONTEXT.ribbonLaneHeight`, each dot an
absolutely positioned `<button>` with `aria-label` built from the camera name
and `offsetLabel(offsetMs)`; the anchor's own dot gets a vertical rule behind
it. The whole ribbon returns `null` when fewer than two lanes exist, because a
single lane says nothing the list does not.

Add to `EVENT_CONTEXT`:

```ts
  ribbonLaneHeight: 14,
  ribbonMaxLanes: 8,
```

Above `ribbonMaxLanes`, the ribbon scrolls inside its own box rather than
pushing the list off screen.

- [ ] **Step 4: Wire it into the panel**

`onSelect` scrolls the matching row into view (`scrollIntoView({ block: 'nearest' })`)
and flashes it through the existing return-highlight store.

- [ ] **Step 5: Add the locale key**

```json
"dot_label": "{{camera}}, {{offset}}"
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/components/events/context src/locales && npx tsc -b
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/events/context app/src/lib/zmninja-ng-constants.ts app/src/locales
git commit -m "feat(events): camera ribbon in the event context panel

refs #494"
```

---

### Task 8: The escape hatches

**Files:**
- Modify: `app/src/components/events/context/EventContextPanel.tsx`
- Create: `app/src/components/events/context/__tests__/EventContextFooter.test.tsx`
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

Timeline reads its range from `settings.timelinePageFilters`
(`hooks/useTimelineFilters.ts`), so "Open in Timeline" writes the window there
through `updateProfileSettings` and navigates to `/timeline`. Events reads
`location.state.eventFilters` (`pages/Events.tsx`), so "Show in Events"
navigates with the window and resolved monitor ids in nav state. Both close the
panel first.

- [ ] **Step 1: Write the failing test**

```tsx
it('sends the window to the timeline filters and navigates', () => {
  // render the panel with a known window, click event-context-open-timeline
  expect(navigate).toHaveBeenCalledWith('/timeline');
  expect(getProfileSettings(P).timelinePageFilters).toMatchObject({
    startDateTime: '2026-09-17 20:59:03',
    endDateTime: '2026-09-17 21:29:41',
  });
});

it('sends the window to the events page as nav state', () => {
  // click event-context-open-events
  expect(navigate).toHaveBeenCalledWith('/events', {
    state: { eventFilters: { startDateTime: '2026-09-17 20:59:03', endDateTime: '2026-09-17 21:29:41', monitorId: undefined } },
  });
});

it('closes itself on the way out', () => {
  expect(useEventContextStore.getState().open).toBe(false);
});
```

Fill these in against the panel's real render helper from Task 4's test file
(same mock of `useEventsAround`, plus `vi.mock('react-router-dom')` for
`useNavigate`, following `EventCard.test.tsx`'s navigate mock).

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/events/context/__tests__/EventContextFooter.test.tsx
```

- [ ] **Step 3: Write the footer**

```tsx
<SheetFooter className="flex-row gap-2 border-t p-3">
  <Button variant="outline" size="sm" className="flex-1" onClick={openInTimeline} data-testid="event-context-open-timeline">
    {t('events.around.timeline')}
  </Button>
  <Button variant="outline" size="sm" className="flex-1" onClick={openInEvents} data-testid="event-context-open-events">
    {t('events.around.events')}
  </Button>
</SheetFooter>
```

- [ ] **Step 4: Add the locale keys**

```json
"timeline": "Timeline",
"events": "Events"
```

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Commit**

```bash
git add app/src/components/events/context app/src/locales
git commit -m "feat(events): open the context window in timeline or events

refs #494"
```

---

### Task 9: The other two triggers

**Files:**
- Modify: `app/src/components/events/EventMontageView.tsx` (tile overlay, beside the download button)
- Modify: `app/src/pages/EventDetail.tsx` (Timing card, under the duration row)
- Modify: `app/src/components/events/__tests__/EventMontageView.test.tsx`
- Modify: `app/src/pages/__tests__/EventDetail.test.tsx` (or the closest existing detail test)

In the montage tile the trigger goes inside the existing
`absolute top-2 right-2` cluster, before the download button. In EventDetail it
goes at the end of the Timing `Card`, as a full-width `outline` button rather
than an icon, because that card has room for a label and the issue asked for it
there:

```tsx
<EventContextButton
  event={event.Event}
  profileId={routeProfileId}
  className="w-full justify-center gap-2 border rounded-md py-2"
/>
```

- [ ] **Step 1: Write the failing tests**

One per surface, asserting the trigger renders and opens the store:

```tsx
it('offers the around-this-event button on a montage tile', () => {
  renderMontage();
  fireEvent.click(screen.getAllByTestId('event-context-open')[0]);
  expect(useEventContextStore.getState().open).toBe(true);
});
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Add the triggers**

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd app && npx vitest run src/components/events src/pages && npx tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/events app/src/pages/EventDetail.tsx
git commit -m "feat(events): around-this-event from the montage tile and event detail

refs #494"
```

---

### Task 10: The settings mirror

**Files:**
- Modify: `app/src/components/settings/AppearanceSection.tsx`
- Modify: `app/src/components/settings/__tests__/AppearanceSection.test.tsx`
- Modify: `app/src/locales/{de,en,es,fr,it,ru,zh}/translation.json`

The same two controls, as the default a panel opens with. `AppearanceSection`
already takes `settings` and `update`, so this is one `SettingsCard` reusing
`EventContextControls` with `available={{ linked: true, group: true }}` — the
settings page is setting a default, not describing one server.

- [ ] **Step 1: Write the failing test**

```tsx
it('writes the default window the user picked', () => {
  const update = vi.fn();
  render(<AppearanceSection settings={settings} update={update} />);
  fireEvent.click(screen.getByTestId('event-context-window-30'));
  expect(update).toHaveBeenCalledWith('eventContext', { windowMinutes: 30, scope: 'all' });
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Add the card**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit**

```bash
git add app/src/components/settings app/src/locales
git commit -m "feat(settings): default window and cameras for the event context panel

refs #494"
```

---

### Task 11: E2E, docs and the full gates

**Files:**
- Create: `app/tests/features/event-context.feature`
- Create: `app/tests/steps/event-context.steps.ts`
- Modify: `docs/user-guide/` (the events page chapter)
- Modify: `docs/developer-guide/call-flows.rst`

**Scenarios** (outcome-based, `@all` tagged):

```gherkin
Feature: Events around an event

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Events" page

  @all
  Scenario: Open the context panel from an event and dismiss it
    When I open the around-this-event panel on the first event
    Then I should see the event context panel
    When I press Escape
    Then I should not see the event context panel
    And I should be on the "Events" page

  @all
  Scenario: Widening the window asks the server for more
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    Then the event context list should reflect the 60 minute window
```

The second scenario asserts a fetched outcome (row count changes, or the empty
state gives way to rows), never element existence (C6).

- [ ] **Step 1: Write the feature and steps, then prove them red by hand**

```bash
cd app
git stash push src/components/events/context/EventContextPanel.tsx
npx bddgen && npx playwright test --grep "Open the context panel"
git stash pop
```

Expected: FAIL while stashed.

- [ ] **Step 2: Run them green**

```bash
cd app && npm run test:e2e -- event-context.feature
```

- [ ] **Step 3: Write the docs**

User guide: what the button does, what the window and the three camera scopes
mean, and that the panel remembers the last choice. Developer guide: a call
flow from the trigger through the store, the hook's three queries, and back to
the panel's rows, in the narrative style `call-flows.rst` already uses.

- [ ] **Step 4: Run every gate**

```bash
cd app && npm run gates && npm run test:mutation
node scripts/proven-red.mjs main HEAD
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add app/tests docs
git commit -m "test(events): e2e and docs for events around an event

refs #494"
git push -u origin feat/494-around-this-event
gh pr create --fill
gh pr merge --auto --squash
```

The PR body needs `## Acceptance` quoting #494's ask and `## Spec` pointing at
`docs/superpowers/specs/2026-09-17-around-this-event-design.md`, or CI's
`pr-acceptance` job fails.

---

## Self-review notes

- Spec coverage: entry points (Tasks 4, 9), shell and dismissal (4), controls
  and persistence (2, 5, 10), data and scopes (1, 3), ribbon (7), list and
  offsets (6), escape hatches (8), errors (3, 6), localization (every task),
  testing (every task plus 11).
- Deliberate deviation from the spec: the mobile sheet does not drag-resize or
  swipe-to-dismiss. Radix's sheet gives backdrop, Escape and Android back for
  free, and the assistant's hand-rolled drag sheet is 200 lines this feature
  does not need. Backdrop, close button and back all dismiss. Revisit if the
  fixed 85vh reads as cramped on a phone.
- `EventCard.tsx` is at 388 raw lines. The trigger is an import plus one
  element, so it stays under the 400 LOC lint (blank lines and comments do not
  count), but check `npm run lint:ratchet` after Task 4 rather than at push.
