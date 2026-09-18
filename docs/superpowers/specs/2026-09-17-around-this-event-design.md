# Nearby

A button on an event that answers "what did my other cameras see at that
moment". It opens a panel over the current view showing every event within a
window either side of the anchor event, ordered by time, with the anchor marked.
Refs #494.

The reporter's workflow today is to read the anchor event's time, go to the
Events page, and hand-build a filter for a few minutes either side across all
cameras. The filter survives one question and then has to be rebuilt for the
next event.

## Why a panel and not a page

Three surfaces were considered.

- A route (Events or Timeline preset to the window) is the cheapest to build and
  the worst fit: the anchor disappears, and dismissing the answer becomes a back
  navigation that also unwinds whatever filter state the user had.
- An inline strip under the event card keeps the anchor but has nowhere to put
  the window and scope controls, and on a phone it competes with the card it
  belongs to.
- A panel over the current view keeps the anchor visible, holds its own
  controls, and dismisses without touching the route. That is the one specified
  here.

The panel is a peek. Everything it shows is reachable from Events, and it
links there rather than growing into it.

## Entry points

One trigger component, three placements, all opening the same panel:

- the EventCard action cluster, beside favourite and archive;
- the montage tile overlay, beside the download button;
- the Timing card in EventDetail, which is where #494 suggested it.

Icon `Link2`, with `title`/`aria-label` from `events.around.open`. Without
Events: View the trigger stays visible and greyed through `useDeniedControl`,
the way the archive button already handles a refusal, so the control that stopped
working is the thing that explains itself.

## Panel shell

One `<EventContextPanel />` mounted in `AppLayout`, opened through a small
Zustand store (`stores/eventContext.ts`) holding `{ anchor, profileId, open }`.
A single mounted panel, rather than one per card, keeps dismissal logic in one
place and stops a long event list from carrying a sheet per row.

The shell follows the assistant's split: `AssistantDesktopPanel` and
`AssistantMobileSheet` are two shells over one chrome hook, and this reuses that
shape.

- Desktop: `ui/sheet` on the right, 440px, page visible behind it.
- Mobile: the same sheet with `side="bottom"`, roughly 85vh.
- Dismissal: Esc, backdrop tap, the close button, and the Android hardware back
  button, which reaches the sheet through `hasOpenOverlay` matching the open
  dialog Radix renders. None of these change the route.

The mobile sheet ships with no drag handle and no swipe-to-dismiss, which an
earlier draft of this section promised. Radix's sheet gives the four dismissal
routes above for free, and a drag gesture on top of them is a second way to do
what the backdrop already does. It is a deliberate deviation, not outstanding
work.

## Controls

A single control bar under the anchor header, labels one word each so they fit
320px:

- Window: chips for ±1, 5, 10, 15, 30, 60 minutes, values from
  `EVENT_CONTEXT.windowChoices` in `lib/zmninja-ng-constants.ts`. The default
  window is 10 minutes and a default the user cannot select back is a trap, so
  10 is a chip. ±1 answers "what else was happening at that exact moment",
  which is the question the issue opens with. Six chips do not fit 320px on
  one line, so the control bar wraps them.
- Scope: segmented `Linked | Group | All`. Linked is disabled with a hint when
  the anchor monitor's `LinkedMonitors` is empty; Group is disabled when the
  anchor monitor belongs to no group. A disabled segment states why on press
  rather than vanishing, so the setting is discoverable on a server that has not
  configured it.

Both controls write back to profile settings, so the panel sets its own default
for next time. Settings > Events mirrors them for people who would rather set it
there.

## Settings

`eventContext: { windowMinutes: number; scope: 'linked' | 'group' | 'all' }`,
defaulting to `{ windowMinutes: 10, scope: 'all' }`, coerced in
`mergeProfileSettings` like every other profile-scoped preference. `hoverPreview`
is the precedent for a nested object here. Ten minutes is the issue's own
suggestion.

## Data

A `useEventsAround(anchor, { windowMinutes, scope, enabled })` hook.

- The window runs from `anchorStart − N` to `anchorEnd + N`, where `anchorEnd`
  is the anchor's start plus its `Length`. Using the end, not the start, keeps a
  long anchor event from clipping its own tail out of the window.
- Both bounds are computed in the owning profile's timezone through
  `eventInstant` and `formatForServerInTz`, the same path the timeline uses.
- Monitor resolution by scope: `linked` parses the anchor monitor's
  `LinkedMonitors`; `group` takes the monitor ids of every group containing the
  anchor monitor, from the existing `useGroups`; `all` omits `monitorId`
  entirely.
- One `getEvents` call against the anchor's own profile session. In All mode the
  anchor row already carries its `profileId`, so the panel scopes to that
  server. It does not fan out across profiles: two servers' clocks can differ by
  more than the window, which would make the offsets lie.
- Key: `queryKeys.eventsAround(profileId, anchorId, windowMinutes, scope)`,
  profile id wrapped with `asProfileId`.
- `limit: EVENT_CONTEXT.maxResults`. When the server reports more than that, the
  list ends with a line naming the count and the "Show in Events" link, rather
  than silently truncating.
- The query is enabled only while the panel is open.

`LinkedMonitors` is a free-text ZoneMinder field. The parser extracts numeric
ids from a comma-separated list and tolerates both bare ids and prefixed tokens,
dropping anything it cannot read; an unparsable field behaves as an empty one,
which disables the Linked segment.

## Ribbon

A slim strip above the list: one lane per camera present in the result, a dot
per event placed by its offset from the anchor, and a vertical line at the
anchor's own time. Lane height 14px, capped around 120px, scrolling with the
panel body.

With fewer than two events the ribbon renders nothing: a single event is its
own answer. One camera with several events still earns the strip, because
where those events sit inside the window is what the list's offsets say least
directly.

It reuses the timeline layout maths, not `TimelineCanvas`: pan and zoom are the
wrong affordance in a fixed window, and the canvas carries filters and live mode
this panel has no use for.

Each dot is a button labelled with its camera and offset ("Driveway, 4 minutes
before"), and pressing one scrolls its row into view and flashes it. The list
below is the accessible source of truth; the ribbon is a shortcut into it, never
the only way to reach an event.

## List

`CompactEventRow` per event, ascending by start time so the window reads
top-down, each row prefixed with a signed offset badge (`−4m 12s`, `+38s`) and
the camera name. The anchor appears inline in its own position, highlighted and
marked, rather than being hidden — its place in the sequence is part of the
answer.

Opening a row navigates to that event and closes the panel. The existing return
highlight then flashes the row the user came back to.

Empty result: `EmptyState` with a shortcut to widen the window one step. It does
not repeat the window and scope in its copy: the control bar sits directly above
it with both already showing, and a translated sentence naming them in seven
locales buys nothing the chips do not.

## Errors

`ErrorBanner` with `resolveQueryError`, as everywhere else, including for a
refusal from the server. The panel does not write to the permission store: a
`PermissionSurface` is documented as one per surface that writes, so recording
the refusal would mean adding a surface kind, and the trigger is already greyed
from the profile's own `canViewEvents` verdict before the panel opens.

## Escape hatches

A footer with one action, closing the panel: Events, with `eventFilters`
prefilled from the window and the resolved monitor ids.

## Localization

New `events.around.*` keys in all seven locales, each label one or two words to
hold the 320px rule.

## Testing

- Units: window computation across timezones and around a long anchor event;
  `LinkedMonitors` parsing for empty, null, whitespace, prefixed and malformed
  values; group resolution for a monitor in several groups.
- Panel: switching scope refetches with the right monitor ids; the anchor is
  highlighted in place; truncation and empty states render; a disabled scope
  segment explains itself.
- E2E: open from the event list, change the window, dismiss with Esc, with
  `data-testid` on the trigger, panel, rows and ribbon dots.
- Each test proven red against the pre-change code, per P2.

## Out of scope

Cross-server windows, saved or named windows, playing video inside the panel,
and live updates while the panel is open. Each is a separate ask, and none is
needed to answer "what else happened around then".
