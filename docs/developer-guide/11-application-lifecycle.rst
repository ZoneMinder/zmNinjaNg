Application Lifecycle
=====================

How the app runs from launch to shutdown, a runtime map of zmNinjaNg.

Entry Point (``index.html`` to ``main.tsx``)
--------------------------------------------

Everything starts at ``app/index.html``, the container for the React app. The
browser, Electron's Chromium (desktop), or the Capacitor WebView (mobile) loads
it; the page loads ``src/main.tsx``; and ``main.tsx`` finds the
``<div id="root">`` element and mounts the React application into it.

.. code:: tsx

   // src/main.tsx
   createRoot(document.getElementById('root')!).render(
     <StrictMode>
       <App />
     </StrictMode>,
   )

Both names are imported directly: ``createRoot`` from ``react-dom/client`` and
``StrictMode`` from ``react``. ``StrictMode`` deliberately mounts every
component twice in development, running each effect's setup, then its cleanup,
then its setup again. That matters more here than in most apps, because effects
in this codebase open MJPEG streams and WebSocket connections. Anything that
connects on mount has to survive being torn down and reconnected immediately, so
several hooks guard or delay their connect for exactly this reason.
``StrictMode`` has no effect in a production build.

Bootstrapping Phase (``App.tsx``)
---------------------------------

When ``<App />`` renders, the app is not yet ready to use. It must
rehydrate its state from storage and bootstrap the active profile.

Rehydrating persisted state
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The ``useProfileStore`` attempts to read saved profiles and the last
active user from browser ``localStorage`` (the default Zustand
``persist`` storage; this is what runs on web, Electron, and the
Capacitor webviews). Sensitive values like the encrypted password go
through ``lib/security/secureStorage.ts``, which delegates to the Capacitor
secure-storage plugin on iOS/Android and to encrypted localStorage on
web/Electron.

``isInitialized`` starts as ``false``, so the user sees
``<RouteLoadingFallback />``, a spinner, while ``zustand/persist`` runs
``onRehydrateStorage`` and ``services/profile-initialization.ts`` picks up from
there.

Profile Bootstrap
~~~~~~~~~~~~~~~~~

Once storage is rehydrated and a profile exists, ``isBootstrapping`` becomes
``true`` and a bootstrap overlay covers the app, showing progress steps and a
**Cancel** button.

Two steps run before the overlay goes up, and they are the only ones that can
abort. ``handleProfileRehydration`` clears stale auth and the query cache from
the previous session, then installs the API client for the profile's
``apiUrl``. If either throws, the whole bootstrap is abandoned:
``isInitialized`` is set to ``true`` so the UI is not stuck on a spinner, and
no server calls are attempted.

Everything after that is ``performBootstrap`` in
``services/profile-bootstrap.ts``, launched without ``await`` so the UI stays
responsive. It runs in order:

1. ``bootstrapSSLTrust`` applies the profile's self-signed-certificate setting.
   This has to be first, because it decides whether any later HTTPS call can
   connect at all.
2. ``bootstrapAuth`` logs in with the stored credentials.
3. ``bootstrapServerMap`` fetches ``/servers.json``.
4. ``bootstrapTimezone`` fetches the server's timezone.
5. ``bootstrapZmsPath`` derives the CGI URL from the server's ZMS path.
6. ``bootstrapGo2RTCPath`` picks up the go2rtc path if the server publishes one.
7. ``bootstrapMultiPortStreaming`` reads ``MIN_STREAMING_PORT`` and returns it.
8. ``bootstrapViewMode`` picks the Streaming Mode a brand-new profile starts in,
   from that port and the server's monitor count.

Step 8 only runs while the profile's ``viewModeChosen`` flag is unset. Neither
the bucket nor ``viewMode`` itself is the signal: ``lastRoute``, the theme, or
the self-signed certificate flag can create the bucket before the first
bootstrap ever runs (the first profile is only bootstrapped on the next
launch, and ``ProfileForm`` writes the certificate flag before switching to a
self-signed profile), and every bucket write copies ``DEFAULT_SETTINGS`` in, so
``viewMode`` is present from the first write. An earlier bucket-existence
check never fired on either path. The user's toggle and the bootstrap both set
``viewModeChosen`` alongside ``viewMode``; from then on the mode belongs to the
user, so a later bootstrap leaves it alone even if the server has grown since. The step honors the profile's
``forceDisableMultiPort`` override the same way Settings does, and when the
monitor count cannot be fetched and multi-port is off it writes nothing, so the
merge default applies until the next bootstrap can decide. The rule itself is
``recommendViewMode`` (``lib/monitor/view-mode-recommendation.ts``): five or
fewer monitors, or multi-port streaming at any count, means streaming; anything
else means snapshot. Settings shows the same call's answer as a hint under the
Streaming Mode row, which is why the rule lives in a pure function rather than
inside the bootstrap step.

Every one of those eight wraps its own body in ``try``/``catch`` and logs a
warning on failure. None of them rethrows, so a step that fails does not stop
the next one, and the app finishes bootstrapping in a degraded state rather
than not at all. That includes authentication: a login failure is logged as
"this might be OK if server does not require auth" and the sequence continues,
because a public ZoneMinder server is a real configuration. What that buys is
also what it costs, since a wrong password and a public server look identical
from here until the first authenticated query returns 401.

Two timers bound the whole thing, both from ``BOOTSTRAP_TIMEOUTS``:
``performBootstrap`` is raced against ``totalTimeoutMs``, and a separate timer
of the same length flips ``isBootstrapping`` to ``false`` so the overlay cannot
outlive it.

Bootstrap Server Map
~~~~~~~~~~~~~~~~~~~~

After authentication, the bootstrap process calls
``bootstrapServerMap()``:

1. Fetches ``/servers.json`` from the ZoneMinder API
2. Builds a ServerId-to-URLs map via ``buildServerMap()`` from
   ``lib/zm/server-resolver.ts``
3. Stores the map in the module-level cache via ``setServerMap()``
4. The cache is cleared on profile switch

For single-server setups the map is empty. All URL lookups in
``resolveMonitorUrls`` and ``getPortalUrlForMonitor`` return the
profile's default URLs when the map is empty or a ServerId is not found.

Bootstrap Cancellation
~~~~~~~~~~~~~~~~~~~~~~

If the server is unreachable or bootstrap takes too long, users can
cancel:

The **Cancel** button on the bootstrap overlay calls ``cancelBootstrap()``,
which clears ``currentProfileId``. With no active profile the router sends the
user to ``/profiles`` to pick another one, or to ``/profiles/new`` when none
exist.

Initialization Complete
~~~~~~~~~~~~~~~~~~~~~~~

Once bootstrap completes (or is cancelled):

1. ``isInitialized`` becomes ``true``, ``isBootstrapping`` becomes
   ``false``.
2. ``AppRoutes`` decides where to send the user, on the ``/`` route:

  - **Active profile**: Redirects to the last visited route, or ``/monitors``
    if there is none.
  - **Profiles exist, none active**: Redirects to ``/profiles`` to pick one.
  - **No profiles at all**: Redirects to ``/profiles/new``.

Authentication Flow
-------------------

zmNinjaNg handles authentication differently than a typical SaaS app because
it connects to potentially *any* ZoneMinder server, each with different
auth requirements.

Token Exchange
~~~~~~~~~~~~~~

On login, or when the app wakes up:

1. **Credentials**: ``bootstrapAuth`` asks the profile store for the decrypted
   password (``getDecryptedPassword``) and passes it with the profile's
   username to the auth store's ``login()``. The refresh token itself never
   sits in the persisted blob: ``stores/auth.ts`` reads and writes it through
   ``lib/security/secureStorage.ts``, and drops it rather than falling back to
   plaintext when secure storage is unavailable.
2. **Login API**: ``login()`` in ``api/auth.ts`` posts form-encoded credentials
   to ``/host/login.json``. ZoneMinder wants a form body here, not JSON, so the
   call goes through ``client.postForm`` rather than the usual JSON path.
3. **Response**: Server returns ``access_token`` and ``refresh_token``, which
   ``LoginResponseSchema.parse`` validates before anything reads them.
4. **Store**: Tokens are saved to ``useAuthStore`` (in memory mostly,
   refresh token persisted).

``refreshToken()`` in the same file posts to ``/host/login.json`` as well,
sending the refresh token instead of the credentials. There is one login
endpoint, not two.

Refresh Loop
~~~~~~~~~~~~

Access tokens expire on a schedule the ZoneMinder server chooses. The app has to
replace one before it lapses, without the user noticing.

- **Hook**: ``useTokenRefresh`` runs in ``AppRoutes`` (``App.tsx``).
- **Logic**: It checks immediately, then every
  ``ZM_INTEGRATION.tokenCheckInterval`` (60 seconds), and again whenever the
  document becomes visible. If the access token expires within
  ``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes), or has already expired,
  it calls ``getFreshAccessToken()``.
- **Why the visibility check**: on mobile and in throttled browser tabs the
  interval timer stops firing while backgrounded, so a token can lapse with no
  check having run. The token is refreshed on the way back in, not on a timer
  that was asleep.
- **Why one shared call**: the timer, a component's proactive refresh, and a
  401 recovery can all want a new token at once. ``refreshAccessToken`` in
  ``stores/auth.ts`` keeps a single in-flight promise, so concurrent callers
  attach to the same POST instead of racing three of them.
- **On failure**: ``refreshAccessToken`` calls ``get().logout()`` and rethrows.
  The logout happens in the store, so ``useTokenRefresh`` only logs the error;
  it does not handle sign-out itself. Note what ``logout()`` does not do: it
  clears the tokens and sets ``isAuthenticated`` to false, but it does not clear
  the current profile and does not navigate anywhere. There is no redirect to a
  login screen, because there is no login screen. The user stays on the page
  they were on, and the next query needing auth fails with a 401 that
  ``resolveQueryError`` turns into a localized prompt to re-authenticate.

Steady State
------------

Once logged in and on the Dashboard, several background processes keep
the app alive.

Every interval below except the token check comes from
``BANDWIDTH_SETTINGS`` in ``lib/zmninja-ng-constants.ts``, read through
``useBandwidthSettings()``. Each has a ``normal`` and a ``low`` value, and
switching the profile to low-bandwidth mode slows all of them at once. Both
values are given.

1. **Token Refresh**: Background timer checks token expiry every 60
   seconds (``ZM_INTEGRATION.tokenCheckInterval``) and refreshes once within 30
   minutes of expiry (``ZM_INTEGRATION.accessTokenLeewayMs``). This one is not
   bandwidth-scaled: a lapsed token breaks everything, so it is not a knob.
2. **Event Polling**: Dashboard event widgets poll on
   ``eventsWidgetInterval`` (30s / 60s). The monitor-detail recent-events list
   uses ``monitorRecentEventsInterval`` (30s / 60s).
3. **Monitor Status**: The monitor list polls ``monitorStatusInterval``
   (20s / 40s). Alarm state on the Monitor Detail page polls the faster
   ``alarmStatusInterval`` (5s / 10s), because an alarm the user cannot see
   within a few seconds is not worth showing.
4. **Stream Keep-Alive**: Streaming connections (``useMonitorStream``, via
   the ``useStreamLifecycle`` hook it composes) monitor their own health. If a
   stream dies, they reconnect with a fresh connection key (``connkey``),
   releasing the dead one with ``ZMS_COMMANDS.cmdQuit`` first so ZMS does not
   leak the old process. The requested ``scale`` is part of that connection's
   identity: a running nph-zms keeps sending the size it started at, so
   changing the scale quits the key and mints a new one rather than re-pointing
   the ``<img>``. Zooming into a feed does exactly that, asking for
   ``ZMS_FULL_SCALE`` while zoomed and dropping back to the profile's Stream
   scale on reset. The frame gate in ``useMonitorStream`` holds the picture
   already on screen across that swap, the same way it does across a snapshot
   refresh, and gives up after ``plannedRestartHoldMs`` so a restart that never
   produces a frame stops standing in for a live one. Both the scale change and
   the CMD_QUIT it triggers are logged.
5. **WebSocket Keepalive & Reconnect**: The notification WebSocket
   (``services/notifications.ts``) sends a version-request ping every
   ``wsKeepaliveInterval`` (60s / 120s) to maintain the connection. On
   disconnection, it reconnects automatically using exponential backoff with
   jitter (2s, 4s, 8s, ... plus or minus 25%). The cap depends on whether the
   app is on screen: ``maxReconnectDelay`` (2 minutes) while the document is
   hidden, ``NOTIFICATIONS_SERVICE.foregroundMaxReconnectDelayMs`` (15 seconds)
   while it is visible, so a user watching a disconnected badge is not left
   waiting on a two-minute timer. An ``intentionalDisconnect`` flag ensures only
   user-initiated disconnects stop reconnection; network drops always
   retry. On mobile, ``@capacitor/network`` triggers immediate reconnect
   when connectivity is restored. On desktop, a ``visibilitychange``
   listener checks liveness when a tab becomes visible.
   ``NotificationHandler`` delegates this work to three focused hooks:
   ``useNotificationAutoConnect`` (connection lifecycle and reconnection),
   ``useNotificationPushSetup`` (FCM token initialization on mobile), and
   ``useNotificationDelivered`` (cold start notification processing and
   resume badge sync)
6. **Daemon Status**: Server page checks ZoneMinder daemon health on
   ``daemonCheckInterval`` (30s / 60s)

For a reference of all timers, polling intervals, and scheduled
actions across the application, see :doc:`07-api-and-data-fetching`.

Mobile Lifecycle (Capacitor)
----------------------------

On iOS and Android, the app has unique lifecycle states handled by the
OS.

Backgrounding
~~~~~~~~~~~~~

When the user swipes the app away (but doesn't close it):

Capacitor fires ``pause`` and ``appStateChange``, and JavaScript execution
mostly stops. Intervals stop firing, so anything that depends on a timer is
stale on return.

Nothing explicitly pauses the MJPEG streams. The OS suspends the webview, the
socket goes quiet, and the stream is simply dead when the app comes back.
Recovery happens on resume, not on the way out.

The montage while aggregating is the one exception, and only when
``allModePauseHidden`` is on: ``useHiddenPause`` fires
``MONTAGE_GRID.pauseHiddenGraceMs`` after the page goes hidden and disables
each tile's stream hooks, which CMD_QUITs the connkey instead of leaving the
server's ``nph-zms`` process running until it notices the socket is gone. See
:doc:`04-pages-and-views` for the rest of the All-mode guardrails.

``App.tsx`` flushes the log buffer on ``pause``, so entries are not lost if the
OS kills the process while it is backgrounded.

Resuming
~~~~~~~~

When the user re-opens the app:

- **State**: App comes to Foreground.
- **Streams**: ``useVisibilityResume`` fires and ``useMonitorStream`` mints a
  fresh ``connkey`` and rebinds. It debounces on ``minHiddenMs`` (1500ms by
  default) so that a quick alt-tab does not trigger a reconnect storm. On native
  the signal is Capacitor's ``appStateChange`` as well as ``visibilitychange``,
  for the same reason notifications need both (refs #274): the WebView suspends
  with the app and is not obliged to report an app state change as a visibility
  change. The resume drops the recorded frame before it awaits anything, so tiles
  show the VideoOff placeholder for the length of the reconnect rather than the
  stale picture the suspended connection left behind (refs #352).
- **Token**: ``useTokenRefresh`` re-checks expiry on ``visibilitychange``,
  because its 60-second interval was not running while suspended.
- **WebSocket Liveness**: ``useNotificationAutoConnect`` calls
  ``service.checkAlive(5000)``, which sends a ping and waits for a response. If
  the server does not respond within those 5 seconds, the connection is treated
  as dead and a forced reconnect is triggered: the socket still reads as open,
  so an ordinary ``reconnectNow()`` would decline (refs #274). When the store
  already reads disconnected, resume skips the ping and reconnects immediately
  rather than waiting on a backoff timer that the suspended WebView froze. That
  resume nudge is a single attempt: when it fails, the foreground backoff cap
  above is what retries.
- **Badge Clear**: ``useNotificationDelivered`` listens for ``appStateChange``,
  ingests any notifications delivered while backgrounded into the history
  store, then clears the native badge via
  ``FirebaseMessaging.removeAllDeliveredNotifications()``.

Note two things resume does **not** do. There is no idle timeout: the app does
not track a last-interaction timestamp and does not re-lock after a period
away. And biometric authentication is not a resume gate. Kiosk lock is
user-initiated (``useKioskLock``, from the sidebar or the fullscreen montage
controls), and ``KioskOverlay`` offers biometrics only as a way to dismiss a
lock the user already set. ``useKioskStore`` is ephemeral and resets to
unlocked on app restart.

Navigation Lifecycle
--------------------

Navigation is ``react-router-dom``, and ``App.tsx`` mounts it as a
``HashRouter`` rather than a ``BrowserRouter``. That is a deployment
constraint, not a preference. Electron and the Capacitor WebViews load the app
from ``file://`` or from a static server with no rewrite rule, and a
``BrowserRouter`` puts the route in the URL path, so reloading on
``/monitors`` asks for a ``/monitors`` document that does not exist and returns
a 404. A hash fragment is never sent to the server at all, so
``index.html#/monitors`` reloads correctly everywhere the app ships.

Routes are defined in ``AppRoutes`` (``App.tsx``). Every page is a ``lazy()``
import, so its code is fetched the first time the route is visited rather than
at startup.

Navigating from ``/monitors`` to ``/events`` unmounts ``pages/Monitors.tsx``,
which runs the cleanup function returned by each of its effects, and that is
what closes the live streams. Then ``pages/Events.tsx`` mounts, its effects run
for the first time, and its queries start fetching.

Unmounting is not a pause. React discards the component instance and every
``useState`` value in it. Anything that must outlive navigation has to be stored
somewhere else: the Events page keeps its result count in ``useState`` and
mirrors it into ``useEventPaginationStore`` (``stores/eventPagination.ts``),
keyed by profile and filters, precisely because opening an event unmounts the
page and a purely component-local count would collapse back to the first page
when the user navigated back.

The one place this bites is scroll position, which is component-local by
default. Persist it to a Zustand store if a screen needs to restore it.

