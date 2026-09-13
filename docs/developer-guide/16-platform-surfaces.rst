Platform Surfaces
=================

The features in this chapter are not page components. Each of them sits over
or beside the whole app: a lock screen that covers whatever view is showing, a
d-pad input layer that changes how every screen is driven, a push pipeline that
delivers notifications while the app is closed, and an assistant window that floats above
the page you were reading. They are grouped here because they share that
shape, not because they share code.

Everything about ordinary feature components (players, cards, widgets, error
boundaries) is in :doc:`05-component-architecture`, and the shared primitives
they build on are in :doc:`12-shared-services-and-components`.

Kiosk mode
----------

Kiosk mode locks the UI so the current view stays visible and live-updating
while navigation and interaction are blocked. It is activated from the sidebar
lock icon or the fullscreen montage controls.

KioskOverlay
~~~~~~~~~~~~

**Location**: ``src/components/kiosk/KioskOverlay.tsx``

Tapping the lock leaves the view where it was: streams keep running and badges
keep counting, but nothing responds to touch. ``KioskOverlay`` renders ``null`` unless ``kioskStore.isLocked`` is true, and
when it is true it renders a transparent ``fixed inset-0`` div at
``Z_INDEX.overlay`` (9999) with ``pointerEvents: 'auto'``. The app underneath
is untouched and still re-rendering; the overlay just swallows every pointer
event before it can reach anything.

Browser and gesture back navigation is intercepted
by pushing a history entry when the lock engages and pushing another one from
a ``popstate`` handler, so every back attempt lands on the same entry again.
The Android hardware back button does not raise ``popstate``, so it is
swallowed separately by a no-op ``backButton`` listener registered through
``useCapacitorListener`` (``@capacitor/app``, dynamically imported, enabled
only on native platforms). Keyboard shortcuts are blocked by a capture-phase
``keydown`` listener on ``window`` that calls ``preventDefault`` and
``stopPropagation`` on everything that arrives.

That keyboard blocker needs a hole in it, because unlocking with a PIN means
typing. The effect that installs it depends on ``showPinPad`` and bails out
while the pad is open, which is the only reason ``PinPad`` can see digits at
all.

Unlocking starts at one button, bottom right. Tapping it tries biometrics
first and falls through to the PIN pad when biometrics are unavailable, fail,
or are cancelled. Either route ends in the store's ``unlock()`` followed by
the ``onUnlock`` prop. A wrong PIN calls ``recordFailedAttempt()``, which is
what drives the cooldown the pad counts down.

The overlay also answers unlock requests it did not start. The sidebar's lock
button calls ``requestUnlock()`` on the kiosk store; an effect here notices
``unlockRequested``, clears it with ``clearUnlockRequest()``, and runs the same
unlock flow. Keeping the flow in one place is what lets a second call site
exist without duplicating the biometrics-then-PIN sequence.

**Test ids**: ``kiosk-overlay``, ``kiosk-unlock-button``, ``kiosk-pin-pad``.

PinPad
~~~~~~

**Location**: ``src/components/kiosk/PinPad.tsx``

A 4-digit numeric keypad in a modal, used for both first-time setup and
unlock. ``PinPadMode`` is ``'set'`` (choose a PIN), ``'confirm'`` (re-enter to
verify), or ``'unlock'``. It auto-submits on the 4th digit after a 100 ms
delay (``KIOSK.pinAutoSubmitDelayMs``) so the filled dot renders first. PIN
state resets when ``mode`` or ``error`` changes.

``PinPad`` listens for ``keydown`` on ``window`` in the capture phase. Digits
add, Backspace deletes, Escape cancels; all three call ``preventDefault`` and
``stopPropagation`` so they never reach ``KioskOverlay``'s keyboard blocker.
Keyboard input is disabled during cooldown.

**Props**: ``mode``, ``onSubmit(pin)``, ``onCancel``, ``error``,
``cooldownSeconds`` (when > 0, shows a countdown and disables the digits).

**Test ids**: ``kiosk-pin-pad``, ``kiosk-pin-input``, ``kiosk-pin-digit-{0-9}``,
``kiosk-pin-cancel``, ``kiosk-pin-delete``.

useKioskLock
~~~~~~~~~~~~

**Location**: ``src/hooks/useKioskLock.ts``

Shared lock-activation logic for the sidebar and the fullscreen montage
controls, so neither call site duplicates the first-time PIN setup flow.

1. ``handleLockToggle`` checks whether a PIN is stored (``hasPinStored()``).
2. If not, it opens ``PinPad`` in ``'set'`` then ``'confirm'`` mode, stores the
   PIN via ``storePin()``, then activates kiosk mode.
3. If a PIN exists, it activates kiosk mode immediately.
4. On lock it enables insomnia (keep-screen-on) if it was off.

**Returns**: ``isLocked``, ``showSetPin``, ``setPinMode``, ``pinError``,
``handleLockToggle``, ``handleChangePin`` (replaces the PIN without locking),
``handleSetPinSubmit(pin)``, ``handleSetPinCancel``.

.. code:: tsx

   // src/components/layout/SidebarContent.tsx
   const {
     isLocked,
     showSetPin,
     setPinMode,
     pinError,
     handleLockToggle,
     handleChangePin,
     handleSetPinSubmit,
     handleSetPinCancel,
   } = useKioskLock({ onLocked: () => onMobileClose?.() });

useBiometricAuth
~~~~~~~~~~~~~~~~

**Location**: ``src/hooks/useBiometricAuth.ts``

Despite the name, this module exports async functions rather than a React
hook:

- ``checkBiometricAvailability(): Promise<boolean>`` returns ``true`` if the
  device has enrolled biometrics and the plugin is available.
- ``authenticateWithBiometrics(reason): Promise<{ success, error? }>`` prompts
  the system biometric UI.

On iOS and Android it uses ``@aparajita/capacitor-biometric-auth`` (Touch ID,
Face ID). On Electron and web it returns ``false`` / ``{ success: false }``.
Both functions catch every error and return a safe value, so callers never
need their own try/catch.

PIN set, change, and clear live in the Settings page (Advanced section), which
renders a "Kiosk PIN" row (``settings-kiosk-change-pin``,
``settings-kiosk-clear-pin``). Change and Clear verify identity first, with
biometrics if available and the current PIN otherwise; Clear then calls
``clearPin()`` from ``lib/kioskPin.ts``.

TV mode
-------

Point a remote at the app on an Android TV or Fire TV and the d-pad has to
move focus somewhere sensible. TV mode turns on the WebView's own spatial
navigation and layers a couple of page-specific
keymaps on top of it. It is not an app-wide focus-management system.

TvDetector (native plugin)
~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**:
``android/app/src/main/java/com/zoneminder/zmNinjaNG/TvDetectorPlugin.java``

A Capacitor plugin registered as ``TvDetector`` and called from
``lib/tv/tv-spatial-nav.ts``. ``isTV()`` reports whether
``UiModeManager.getCurrentModeType()`` equals ``UI_MODE_TYPE_TELEVISION``.
``enableSpatialNavigation()`` turns on the WebView's built-in spatial
navigation by reaching the hidden
``WebSettings.setSpatialNavigationEnabled(true)`` API through reflection, then
makes the WebView focusable and requests focus.

lib/tv/tv-spatial-nav.ts
~~~~~~~~~~~~~~~~~~~~~~~~

Both plugin calls go through this module, which owns the platform checks so no
caller has to repeat them. ``checkIsTV()`` trusts ``Platform.isTVDevice``
first (a native-injected flag, or a user-agent match against
``tv`` / ``aft`` / ``stb`` / ``fire tv`` in ``lib/platform.ts``), then falls
back to the plugin's ``isTV()`` on native platforms, and answers ``false`` on
web without touching the plugin. ``enableSpatialNavigation()`` is a no-op
outside native platforms and swallows the error when the plugin is not
registered, which is the normal case on a phone.

Wiring in AppLayout
~~~~~~~~~~~~~~~~~~~

``useTvMode()`` (``src/hooks/useTvMode.ts``) is a thin read of
``settings.tvMode``, a profile-scoped setting with a manual toggle in
Settings > Appearance (``settings-tv-mode``). ``AppLayout`` runs
``checkIsTV()`` once per profile switch, and if the device is a TV while
``tvMode`` is off it turns the setting on through ``updateProfileSettings``.

While TV mode is active, ``AppLayout`` toggles a ``tv-mode`` class on
``<html>``, which is where ``index.css`` raises the base font size to 20px and
gives ``:focus-visible`` elements a heavier ring for reading from across a
room, and calls
``enableSpatialNavigation()`` once.

useTvKeyHandler
~~~~~~~~~~~~~~~

**Location**: ``src/hooks/useTvKeyHandler.ts``

Registers a ``window`` ``keydown`` listener, active only while ``isTvMode`` is
true. Pages pass a ``TvKeyMap``
(``{ ArrowLeft?, ArrowRight?, ArrowUp?, ArrowDown?, Enter? }``). A key with a
handler in the map calls ``preventDefault()`` and runs the handler; a key
without one falls through to the WebView's native spatial navigation, which is
what makes a partial keymap useful.

``Enter`` has a fallback even with no map entry. If the focused element is not
one of the natively clickable tags (``BUTTON``, ``A``, ``INPUT``, ``SELECT``,
``TEXTAREA``), the hook synthesizes a ``.click()`` on it. Combined with
``lib/tv/tv-a11y.ts``'s ``clickableProps()`` / ``handleKeyClick()``
(``tabIndex={0}`` plus ``role="button"`` plus an Enter/Space ``onKeyDown``),
that is what lets ``div`` and ``span`` "buttons" such as monitor tiles respond
to the remote.

Per-page keymaps
~~~~~~~~~~~~~~~~

- **Montage** (``src/pages/Montage.tsx``): arrow keys move a focused-tile index
  (``handleDpadNav``) through the grid; Enter navigates to that monitor's detail
  page. A separate effect calls ``.focus()`` on the tile's DOM node
  (``data-testid="montage-monitor-<id>"``) whenever the index changes, since the
  index is plain state, not real DOM focus.
- **Timeline** (``src/pages/Timeline.tsx``): arrow keys pan and zoom the canvas
  viewport (``panLeft``, ``panRight``, ``zoomIn``, ``zoomOut``) instead of moving
  between DOM elements. No ``Enter`` handler is registered, so Enter falls
  through to the synthesize-click default.
- **EventDetail** (``src/pages/EventDetail.tsx``) registers no keymap. It only
  reads ``isTvMode`` to force ZMS playback.

What this does not do
~~~~~~~~~~~~~~~~~~~~~

Pages without a ``TvKeyMap`` (Dashboard, Events, Settings) rely entirely on the
WebView's native spatial navigation moving focus between focusable elements.

Notifications
-------------

A camera trips an alarm and a toast slides in, or, if the app is closed, a
system notification arrives and tapping it opens that event. Two delivery modes
sit behind that, and ``src/components/NotificationHandler.tsx`` is the component
that turns either one into UI.

**The two modes.** In **ES (Event Server)** mode the app holds a WebSocket to
the zmeventnotification server and receives events in real time, with FCM push
on iOS and Android. It is the default. In **Direct** mode there is no Event
Server: ZoneMinder's own Notifications REST API registers the FCM token and
pushes directly, and desktop and web fall back to polling ``/api/events.json``.

**What sits underneath.** Native push arrives through Firebase Cloud Messaging
via ``@capacitor-firebase/messaging``. Above it, one module per delivery path:
``services/notifications.ts`` holds the Event Server WebSocket,
``services/pushNotifications.ts`` (class ``MobilePushService``) owns the FCM
token and payload parsing, ``services/eventPoller.ts`` is the desktop and web
poller for Direct mode, and ``api/notifications.ts`` is the REST client that
registers a token with ZoneMinder. They all converge on one Zustand store,
``stores/notifications.ts``.

``NotificationHandler`` is the orchestrator over that set, and it holds no
logic itself: it delegates to ``useNotificationAutoConnect``,
``useNotificationPushSetup``, ``useNotificationDelivered``, and
``useNotificationBadgeNudge``. The configuration UI is separate again,
``src/pages/NotificationSettings.tsx`` composing ``NotificationModeSection``,
``ServerConfigSection``, and ``MonitorFilterSection`` from
``components/notifications/``.

**Registration.** In ES mode the app connects to the Event Server over the
WebSocket and authenticates; on mobile ``MobilePushService`` then requests FCM
permission, obtains a token, and sends it to the Event Server via the WebSocket
``push`` command. In Direct mode ``MobilePushService`` gets the same token but
registers it with ZoneMinder through ``POST /api/notifications.json`` (platform,
monitor list, push state); on desktop and web the event poller starts instead.

**Delivery.** Every path converges on one store action:

- Foreground, ES mode: the event arrives on the WebSocket.
  ``NotificationHandler`` watches the store and raises the toast. FCM duplicates
  are suppressed by a guard on ``isConnected``.
- Foreground, Direct mode on mobile: FCM's ``notificationReceived`` fires,
  ``MobilePushService`` parses the payload (it accepts both the ES and the ZM
  field shapes) and calls ``addEvent``. The store update raises the toast.
- Foreground, Direct mode on desktop: the poller calls ``addEvent``.
- Background or closed: tapping the system notification fires
  ``notificationActionPerformed``, and the handler calls
  ``navigationService.navigateToEvent()`` with state
  ``{ from: '/monitors', fromNotification: true }``. The ``from`` gives the back
  button somewhere to go when the history stack is empty, and
  ``fromNotification`` keeps the route out of ``lastRoute``.

Because four sources can report the same alarm, ``addEvent`` in the store
deduplicates on ``EventId``, dropping any existing entry before unshifting the
new one:

.. code:: tsx

   // Remove any existing event with the same ID to avoid duplicates
   // This prevents duplicate entries when receiving the same event from both WebSocket and FCM
   const otherEvents = current.filter((e) => e.EventId !== event.EventId);
   return [notificationEvent, ...otherEvents].slice(0, NOTIFICATIONS_SERVICE.maxEvents);

Events are stored per profile, and the list is capped at the newest 100
(``NOTIFICATIONS_SERVICE.maxEvents``). ``MontageMonitor``'s alarm pulse
(:doc:`05-component-architecture`) reads this same store.

``useNotificationBadgeNudge`` bridges this store to the new-events badge. It
watches ``events[0].EventId`` and, when a new one appears, invalidates
``queryKeys.monitorEventsSinceMonitor`` for that monitor, so its badge count
refetches within a second instead of at the 60000 ms poll. It runs independent of
the toast effect above (which is gated on ``settings.showToasts``) so the badge
updates along with the ``NotificationBadge`` bell whatever the toast setting,
and it seeds its own last-seen id
on first run so a backlog present at mount does not fire a burst of invalidations.
:doc:`call-flows` Flow 18 places it in the badge's refetch path.

:doc:`call-flows` traces both halves: "A push notification, from registration to
tap" and "Live notifications over the Event Server websocket".

In-app assistant (Ask)
----------------------

Pressing ``?`` (or picking the "Ask" item in the command palette) opens the
assistant's own floating window, whose conversation body is ``AskPanel``
(``components/assistant/AskPanel.tsx``). It answers questions about your
ZoneMinder server and is read-only: asking it to change something gets a
refusal pointing at the screen that does the job.
:doc:`call-flows`'s "Asking the assistant a question" traces one send
end to end through ``lib/assistant/``; this section covers the component
pieces on the React side of that trace.

**Entry point.** The assistant is not hosted inside the command palette; it
has its own window state in ``stores/assistantPanel.ts``.
``KeyboardShortcuts.tsx``'s global ``?`` handler calls that store's
``open()``; ``CommandPalette.tsx``'s "Ask" row does the same and closes the
palette first, so opening the chat never leaves the palette dialog behind.
Both entry points are gated on ``settings.assistantEnabled``: the palette
hides the row, and the ``?`` key falls back to the keyboard-shortcuts help
overlay instead.

**Two shells around one body.** ``AskPanel`` is only the conversation body
(messages, input, cards). The window around it is one of two shells chosen at
runtime by viewport, because they need different JavaScript, not only
different CSS. ``AssistantWidget.tsx`` is a thin switch over
``useAssistantPanelStore``'s ``closed | minimized | open`` state: nothing,
a floating button, or a shell. ``useIsMobile`` (a ``matchMedia`` hook at the
``sm`` breakpoint) picks ``AssistantDesktopPanel`` (a resizable card pinned
bottom-right) or ``AssistantMobileSheet`` (a bottom sheet that shares the screen
with the app). The mobile sheet stores its height as a fraction of the visible
viewport so a rotation keeps its proportion, and uses ``useKeyboardViewport``
(a ``window.visualViewport`` wrapper, no Capacitor plugin) to hold the input
above the on-screen keyboard. Both shells embed the same ``<AskPanel/>`` and
share ``useAssistantChrome`` for the clear/minimize/close controls, so they
differ only in layout. The shell stays mounted (hidden) while minimized, so a
running turn survives collapsing to the button.

**Empty state and connection dot.** With an empty thread ``AskPanel`` renders
``AssistantIntro``: a greeting from Ninjii (the assistant's name in the UI) plus a row of clickable example prompts
(``assistant.intro_example_1..4``, one of them "Summarize my day") that teach
the kind of question the assistant answers. A chip click fills the input rather
than sending, so the user can edit before the turn starts. Next to the backend
label in both shells sits ``OllamaStatusDot``, which renders nothing unless the
Ollama backend is selected. When it is, ``useOllamaHealth`` runs the same
``GET /models`` reachability probe as the Settings Test-connection button on the
bandwidth-scoped ``assistantHealthInterval`` (30s normal, 60s low) and the dot
shows green (reachable), red (unreachable), or a pulsing amber for the first
probe. The query is mounted only with the header, so it stops polling when the
panel closes; on-device WebLLM has no connection to report, so no dot appears
for it.

**Driving a turn.** ``AskPanel``'s ``handleSend`` appends the typed message to
the per-profile thread in ``useAssistantStore``, builds a system prompt from
the current profile's monitor list and ZM version (``buildSystemPrompt``),
and calls ``runAssistantTurn`` with an ``AbortController`` it owns. That same
controller's ``signal`` is what an abort or an unmount cancels, so the agent
loop never keeps generating for a panel that is gone.

**Rendering the model's answer.** ``agent.ts`` never renders user-facing text
itself; the only text it emits outside a normal reply is the sentinel
``__i18n:assistant.iteration_cap_reached`` when the tool-loop cap is hit.
``AskPanel`` is the one place that resolves that contract:

.. code:: tsx

   function renderAssistantText(text: string | undefined, t: TFunction) {
     if (!text) return null;
     if (text.startsWith(I18N_SENTINEL)) {
       return <p className="text-sm">{t(text.slice(I18N_SENTINEL.length))}</p>;
     }
     return <Markdown source={text} />;
   }

Every other assistant message renders as Markdown directly: the model writes
in the user's language already (the system prompt tells it to), so there is
no translation lookup for a normal reply, only for this one fixed sentinel
(the Localization contract's "never hardcode user-facing strings" applies
to the sentinel's key, not to arbitrary model output).

**No confirm flow on the host.** ``useAssistantHost``
(``components/assistant/useAssistantHost.ts``) is the ``AssistantHost``
implementation ``AskPanel`` hands to ``runAssistantTurn``. The assistant is
read-only: there are no destructive tools, so the host has no confirmation
flow (no ``confirm``/``resolveConfirm`` and no confirm card). ``navigate`` on
the host minimizes the assistant panel (``stores/assistantPanel.ts``) before
routing, so an "Open" click on an event or monitor result card collapses the
panel to the floating button instead of leaving a chat window open behind the
page it just opened. The assistant itself never routes the app: result cards
are the only way to navigate from it.

**Used by:** ``AppLayout.tsx`` mounts ``AssistantWidget`` once for the whole
app; ``AssistantDesktopPanel`` and ``AssistantMobileSheet`` are the only
components that embed ``AskPanel``. ``useAssistantStore`` holds the
per-profile conversation thread and is not persisted, closing the app clears
it.
