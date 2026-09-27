# Settings reorganization

Refs #536.

The Settings page grew one section at a time. With a virtual profile group
(an aggregate) selected, several rows save to one settings bucket while the
screens that use them read another, so the row appears to do nothing. This
spec regroups the page by topic and gives every setting one scope that its
writer and all its readers agree on.

## Scopes

Every setting on the page has one of two scopes.

- **Selection scope.** How the user likes to use the app. Saved to the current
  selection's bucket: the profile when one profile is selected, the aggregate's
  own bucket when an aggregate is selected. Every reader uses
  `useCurrentProfile().settings` (or `getProfileSettings(currentProfileId)`
  outside React). Editing one never changes a member server's bucket.
- **Server scope.** How one server sends video and data. Saved to that
  server's bucket. Every reader uses the bucket of the profile that owns the
  monitor or event (`useProfileById(ownerProfileId)`, or
  `getProfileSettings(ownerProfileId)`).

Aggregate-only settings (`allModeViewMode`, the `allMode*` performance knobs)
stay in the aggregate's bucket as today.

### Key classification

Selection scope: `startScreen`, `dateFormat`, `timeFormat`, `customDateFormat`,
`customTimeFormat`, `theme`, `hoverPreview`, `hoverPreviewPlaybackRate`,
`insomnia`, `landscapeFullscreen` (new), `tvMode`, `monitorsPerPage`,
`skipOfflineMonitors`, `monitorDetailFullscreen`, `defaultEventLimit`,
`eventVideoAutoplay`, `eventPlaybackFullscreen`,
`monitorDetailRecentEventsCount`, `eventContext`, `bandwidthMode`, `logLevel`,
`componentLogLevels`, `disableLogRedaction`.

Server scope: `excludedMonitorIds`, `viewMode`, `snapshotRefreshInterval`,
`streamMaxFps`, `streamScale`, `streamingMethod`, `webrtcProtocols`,
`webrtcUseStun`, `showProtocolLabel`, `thumbnailFallbackChain`,
`allowSelfSignedCerts`, `trustedCertFingerprint`, `apiTimeoutSeconds`,
`forceDisableMultiPort`, and the `assistant*` keys.

`viewMode` keeps its existing aggregate override: with an aggregate selected,
tiles follow `allModeViewMode`, whose `per-server` value means each tile uses
its owning server's `viewMode`.

The two lists live in `app/src/stores/settings-scope.ts` as
`SELECTION_SCOPED_SETTINGS` and `SERVER_SCOPED_SETTINGS`, so tests and the
contract gate can use them.

### Readers known to be on the wrong side today

Selection-scoped keys read from the owning server, which change to the current
selection:

- `hoverPreview`: `MonitorCard`, `MonitorWidget`, `EventPreviewPopover`,
  `TimelineScrubber`, `NotificationHistoryItem`, `EventContextList`,
  `MontageMonitor` (reads `getProfileSettings(currentProfile?.id || '')`,
  which is the empty bucket in an aggregate).
- `hoverPreviewPlaybackRate`: `EventThumbnailHoverPreview`,
  `EventContextSequence`.
- `eventContext`: `useEventsAround`, `EventContextList`,
  `EventContextSequence`, `EventContextPanel` (read and its write at line 76,
  which must write the current selection's bucket).
- `eventVideoAutoplay`, `eventPlaybackFullscreen`: `EventDetail`.
- `monitorDetailFullscreen`: `MonitorDetail`.
- `monitorDetailRecentEventsCount`: `useMonitorRecentEvents`.
- `skipOfflineMonitors`: `useMonitorNavigation` (`getProfileSettings(effectiveProfileId)`).
- `bandwidthMode`: `stores/notifications.ts` per-profile reads.

Server-scoped keys read from the current selection, which change to the owning
server:

- `thumbnailFallbackChain`: `EventListView`, `EventMontageView`,
  `NotificationHandler` (uses the notification's profile), `AskPanel` (uses the
  profile the tool context targets).
- `showProtocolLabel`: `MontageMonitor`.

This list is the audit starting point, not its limit: every reader of every
listed key is checked against its scope.

With one profile selected, both reads resolve to the same bucket, so
single-profile users see no change. In an aggregate, a selection-scoped
setting now takes the aggregate's value, which starts at the default. No
migration.

## Layout

The page has six sections. Server-scoped rows sit in a sub-card inside their
section, headed by the server's name. With an aggregate selected, one Profile
picker at the top of the page, above the first section, chooses the server
every sub-card edits. It keeps `data-settings-search-keep`. With one profile
selected there is no picker and the sub-card headers show that profile's name.

```
General
  Language · Theme · Start screen · Date format · Time format · › Previews
  Keep screen awake · Fullscreen when turned sideways · TV mode · Kiosk PIN ·
  Show developer notices
  [server] › Hidden monitors

Live Streaming
  Monitors per page · Skip offline monitors · Open in fullscreen
  [server] Streaming mode · Snapshot refresh interval · Stream FPS ·
           Stream scale · › Advanced streaming (go2rtc, WebRTC protocols,
           STUN, Show protocol label)
  [aggregate only] Streaming mode override · › Performance

Events & Playback
  Events per page · Autoplay · Open in fullscreen ·
  Recent events on monitor page · Nearby events
  [server] › Event thumbnails

Network
  Bandwidth mode
  [server] Allow self-signed certificates · API timeout ·
           Disable multi-port streaming

Ninjii (Beta) - AI chatbot   (server scope, unchanged content)

More settings
  Notifications › · Live Activity › · Logs ›
  Per-monitor settings: open a monitor, then its settings.
```

"Previews" is the existing hover preview editor. "Event thumbnails" is the
existing thumbnail fallback chain editor. Only their labels change. The
aggregate-only sub-card is headed by the aggregate's name and holds the
existing `AllServersStreamingSection` and `AllServersPerformanceSection`
content.

Folded parts (Previews, Advanced streaming, Event thumbnails, Hidden
monitors, Performance, WebRTC protocols) follow the Settings search contract:
they open while searching and set `aria-expanded`.

### Theme and keep screen awake

The Theme row uses `useTheme()` from `components/theme-provider.tsx`, the same
state the header toggle uses, with System, Light and Dark. Keep screen awake
writes `insomnia` through `updateProfileSettings` on the current selection, the
same key and bucket the sidebar toggle writes (`SidebarContent.tsx:96`).

### Fullscreen when turned sideways

New selection-scoped key `landscapeFullscreen: boolean`, default `true`, added
to `ProfileSettings` and `DEFAULT_SETTINGS`. `useAutoFullscreen` takes a
`landscape` option; when false, a touch device in landscape no longer adds
fullscreen, and `startFullscreen` plus the page's own buttons behave as today.
`MonitorDetail` and `EventDetail` pass the current selection's value. Desktop
behavior does not change. Description: phones and tablets only, applies to live
view and event playback.

### Log settings

The Logs page already sets `logLevel`. Component log levels and Disable log
redaction move there, next to the level picker, and leave Settings. They are
selection-scoped: the Logs page writes them to the current selection's bucket,
and `App.tsx` and `isRedactionDisabled` already read the current selection.
The Logs page's own server picker (for ZoneMinder server logs) is unrelated and
unchanged.

### Removed

- `dashboardRefreshInterval`: the key, its default, the row and the
  `settings.dashboard_refresh_interval*` strings. Nothing ever read it. Old
  persisted values are ignored by the merge.
- Section keys `section_appearance`, `section_playback`, `section_advanced`
  and any strings left unused by the move.

## Strings

New or renamed strings go into every locale in `app/src/locales/`
(de, en, es, fa, fr, it, ru, zh) in the same change. Labels fit 320px.

## Contract change

The Settings contract in `AGENTS.project.md` gains the scope rule: every
profile-scoped key is listed in `settings-scope.ts` as selection or server
scope; selection-scoped keys are written to and read from the current
selection; server-scoped keys are written to and read from the owning
profile. Gate: `app/src/tests/agents-contracts.test.ts` fails when a file
outside `components/settings/` reads a server-scoped key off
`useCurrentProfile()` settings, and a Settings page test asserts every
server-scoped row renders inside the server sub-card and no selection-scoped
row does.

## Tests

- Real-store regression tests with an aggregate selected: a selection-scoped
  row saves to the aggregate's bucket and leaves the member's bucket unchanged;
  a reader of a changed key (hover preview on `MonitorCard`, `eventContext` in
  `useEventsAround`, `thumbnailFallbackChain` in `EventListView`) renders from
  the right bucket.
- `useAutoFullscreen` with `landscape: false` stays out of fullscreen on a
  landscape touch device.
- Settings page: section order, the server sub-card placement, the picker only
  in an aggregate, theme and keep-screen-awake rows sync with their other
  controls, search finds rows in folded parts, More settings links route.
- Logs page: component levels and redaction save to the current selection.
- e2e: the Settings feature covers the new sections and the sideways toggle,
  with platform tags and `data-testid` on new interactive elements.

## Docs

`docs/user-guide/settings.md` describes the new sections, including the
sideways toggle and where log settings went. `docs/user-guide/logs.md` (or
the page that documents Logs) gains the moved controls. Developer docs note
the scope rule where the settings store is documented.
