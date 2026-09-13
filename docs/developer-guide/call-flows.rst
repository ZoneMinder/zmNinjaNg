Call Flows
==========

The other chapters are reference material, organized by topic. This one
follows real user actions end to end, step by step, through the actual code.
Flow 1 covers what happens from launch until the first monitor list renders,
and the reference chapters go deeper into each layer.

How to read this
----------------

Each flow opens with a sequence diagram (the whole flow at a glance), then walks
the steps in detail. Every step has a bold plain-language lead, says what happens
and why it matters, names the code it lives in (``file.ts`` plus the function or
symbol), and ends with two links: ``source`` opens that exact code on GitHub, and
the ``→`` link goes to the reference chapter that explains that layer in full.

The ``source`` links point at ``main`` and the function may drift by a few lines
over time, so the symbol name in the text is the durable anchor.

The layers a request moves through, top to bottom:

::

   pages/        route-level views (what you see)
   components/   reusable UI
   hooks/        component logic (React Query, stream lifecycle, ...)
   stores/       global state (Zustand: profile, auth, settings, notifications)
   services/     startup orchestration + native plugin glue
   api/          thin ZoneMinder request wrappers
   lib/          pure helpers (http, url-builder, crypto, ...)
   <native>      Capacitor plugins (iOS/Android/Electron)

If you already know the symptom, jump straight to its flow:

1. Cold start to an authenticated session: the app opens on the wrong screen,
   or network setup runs at the wrong moment.
2. Montage and a live MJPEG stream: tiles stay blank, or leave ``nph-zms``
   processes behind.
3. A push notification, registration to tap: a push never arrives, or tapping
   one lands nowhere.
4. Adding a server profile: onboarding, credential storage, first contact with
   a server.
5. Browse events and play a video: the event list filters wrong, or the player
   picks the wrong source.
6. Access-token lifecycle: 401s, refresh storms, a token that lapsed
   mid-request.
7. Live notifications over the Event Server websocket: the bell stops updating,
   or the socket will not reconnect.
8. A go2rtc WebRTC live stream: a monitor plays MJPEG when it should not.
9. Timeline view: the timeline lands on the wrong span, or fetches too much.
10. Downloading an event: a download fails, or fails only on mobile.
11. A bandwidth setting becomes polling cadence: you need a new recurring
    refresh.
12. A Dashboard widget: widgets lose their layout, or fetch on their own
    schedule.
13. Kiosk lock and biometric unlock: the lock will not engage, or will not
    release.
14. Capturing a snapshot: a saved still is black, or saves as a stream.
15. Changing the ZoneMinder run state: a write to the server, and how its
    cache is invalidated.
16. Editing and deleting a server profile: an edit does not take effect until
    a reload.
17. Aiming a PTZ camera: the pad is missing, or a camera keeps moving after
    release.
18. Seeing what happened while you were away: the new-events badge counts
    wrong.
19. Asking the assistant a question: a turn answers without data, or a backend
    is missing from settings.
20. A Live Activity poll tick: a tile will not leave, or a monitor never
    appears.
21. Switching into a virtual profile group: monitors from every server in it
    show up tagged with their origin, or one down server blanks the whole list.
22. Merged events and direct tap-through while aggregating: events from several
    servers sort wrong, or tapping one opens under the wrong server.
23. Live notifications across every server in an aggregate: one server's
    toasts stop, or an event lands under the wrong server.
24. Opening a monitor's settings on a restricted account: the settings gear
    shows for an account that cannot use it, or hides for one that can.

Flow 1: Cold start to an authenticated session
----------------------------------------------

When you launch the app with a profile already saved, a lot happens before the
monitor list appears. The app restores your saved profile, throws away any
leftover session from last time, makes sure your server has a session, and then
does the slow network setup (logging in, fetching
server details) in the background so the splash screen never sits there
waiting on the network.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Shell as App shell
       participant Store as Profile store
       participant Boot as Bootstrap services
       participant Auth as Auth + HTTP client
       participant ZM as ZoneMinder server
       participant UI as Monitors page

       Shell->>Store: import store, persist restores the saved profile
       Store->>Boot: onRehydrateStorage then handleProfileRehydration
       Boot->>Auth: clear stale auth and query cache
       Boot->>Auth: create and install the API client
       Boot->>Store: mark initialized
       Note over Shell,UI: UI unblocks here. Splash hides, routes render.
       Boot->>Boot: run bootstrap tasks in the background
       Boot->>Auth: apply SSL trust, then log in
       Auth->>ZM: POST /host/login.json
       ZM-->>Auth: access and refresh tokens
       Boot->>ZM: servers, timezone, ZMS path, multi-port
       UI->>ZM: GET /monitors.json once authenticated
       ZM-->>UI: monitor list, rendered

#. **Before React mounts, the global error handlers are installed.** ``main.tsx`` is the very
   first code to run. It installs the global error handlers (so an uncaught
   error anywhere ends up in the in-app log instead of vanishing), tags the
   ``<html>`` element as native vs web, and starts the iOS safe-area bootstrap,
   then renders ``<App/>``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/main.tsx>`__
   · → :doc:`11-application-lifecycle`

#. **The stores wake up and read the disk.** Importing the app pulls in the
   Zustand stores. ``stores/profile.ts`` is wrapped in ``persist(...)``, so the
   moment it loads it reads your saved profiles from local storage. ``App.tsx``
   also builds the single React Query ``queryClient`` and registers it with
   ``setQueryClient()`` so non-React code can reach the same cache later.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Rehydration decides what kind of start this is.** Once persist finishes
   reading, ``stores/profile.ts`` fires ``onRehydrateStorage``, which calls
   ``handleProfileRehydration`` in ``services/profile-initialization.ts``. No
   saved profile sends you to the Profiles screen and stops; a valid one
   continues. Any error still flips ``isInitialized: true``, so the splash always
   hides.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Throw away last session's leftovers.** ``clearStaleState`` calls ``logout()``
   on the auth store and ``clearQueryCache()``. A persisted token or cached
   monitor list from a previous run must not be shown before we have
   re-authenticated this run, especially after switching servers.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Make sure this server has a session.** ``initializeApiClient`` calls
   ``getSession(profile.id)``. The session registry builds one ``ApiClient`` per
   profile on first ask and caches it, so a request carries its profile with it rather than depending on
   which server was selected last. Building the session also hands the
   client a re-login callback for this profile's saved credentials
   (``reLoginFor``), which is what lets the client re-authenticate a lapsed
   token on its own.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Let the user in.** ``setInitializationState(true)``
   flips ``isInitialized`` and ``isBootstrapping``. This is the moment the UI
   becomes usable: the splash hides, routing renders, and the slow network setup
   is kicked off without being awaited, so it runs in the background.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Background setup, SSL trust first.** ``performBootstrap`` runs
   ``bootstrapSSLTrust`` before any network call. For a self-signed server it
   applies the trust override (and, the first time, shows the trust-on-first-use
   dialog) via ``lib/security/ssl-trust.ts`` ``applyTrustedCertificates``, dispatching
   to the native ``ssl-trust`` plugin or Electron. Trust is global, not
   per-profile: the function reads every profile's setting and applies the
   union, so one self-signed server turns trust on for all of them. If trust were applied after the login
   call, a self-signed server would reject it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts>`__
   · → :doc:`13-network-endpoints`

#. **Log in.** ``bootstrapAuth`` decrypts the stored password and calls the auth
   store's ``login()``, which is single-flight (concurrent callers share one
   request) and POSTs to ``/host/login.json``. On success it stores the access
   and refresh tokens and sets ``isAuthenticated: true``. A failure here is only
   a warning, since some servers do not require auth.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Fetch the server's shape.** Still in the background, ``performBootstrap``
   runs ``bootstrapServerMap`` (multi-server routing), ``bootstrapTimezone``,
   ``bootstrapZmsPath``, ``bootstrapGo2RTCPath``, and
   ``bootstrapMultiPortStreaming``, and finally ``bootstrapViewMode``, each
   wrapped on its own so one failure does not sink the rest, then clears
   ``isBootstrapping``. These resolve the streaming and routing details the
   monitor and montage views rely on, down to which Streaming Mode a first-time
   profile opens in.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts>`__
   · → :doc:`13-network-endpoints`

#. **Hide the splash, land on a page.** An effect in ``App.tsx`` hides the native
   splash once ``isInitialized`` is set, and ``AppRoutes`` navigates to your last
   route (or ``/monitors``) and starts the periodic token refresh
   (``useTokenRefresh``).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx>`__
   · → :doc:`04-pages-and-views`

#. **First real data.** ``pages/Monitors.tsx`` calls ``useScopedMonitors``,
   which fans one React Query out over every profile in scope through
   ``useQueries`` and combines the results. The scope is the selected profile,
   or every member of an aggregate (a virtual profile group spanning several
   servers, see Flow 21). In single mode, with one ordinary profile selected,
   the scope is a one-element array, so it is still one query. It is not gated on
   ``isAuthenticated``: a profile in scope always gets an enabled query,
   because the client self-heals through its own ``proactiveLogin`` path and a
   real auth failure surfaces as that profile's ``ProfileError``. Gating on
   auth would render an aggregate blank for any profile that had not
   bootstrapped yet, and the hook carries a comment saying so. It polls at the
   bandwidth-profile interval, staggered across profiles.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Monitors.tsx>`__
   · → :doc:`07-api-and-data-fetching`

Switching profiles at runtime (``stores/profile.ts`` ``switchProfile``) converges
on this same ``performBootstrap``; it just tears down the old profile's streams
and resets the client first. That teardown is the last step of Flow 2.

Flow 2: Montage opens and a live MJPEG stream runs
--------------------------------------------------

A montage tile goes from "just mounted" to a live ``nph-zms`` feed, and along the
way the app manages a **connection key** (connkey) per stream so feeds never
collide on the server and never leak a zombie process when they go away.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Montage page
       participant Tile as Tile (LiveMonitorPlayer)
       participant Stream as useMonitorStream
       participant Life as useStreamLifecycle
       participant Store as Monitor store
       participant ZM as ZoneMinder (nph-zms)

       Page->>ZM: GET /monitors.json
       Page->>Tile: render one tile per filtered monitor
       Tile->>Stream: useMonitorStream (mjpeg)
       Stream->>Life: useStreamLifecycle
       Life->>Store: regenerateConnKey, get a unique key
       Stream->>ZM: img src = nph-zms?connkey=K
       ZM-->>Tile: MJPEG frames
       Note over Tile,ZM: on img error: backoff, CMD_QUIT old key, mint new key
       Tile->>ZM: CMD_QUIT on unmount or profile switch

#. **The page fetches its monitors.** ``pages/Montage.tsx`` runs a
   profile-scoped, bandwidth-throttled ``useQuery`` keyed by
   ``queryKeys.monitors(currentProfile?.id)`` for the list and live status the
   grid renders. A React Query cache entry belongs to a key, not to a component,
   so the app-wide ``staleTime`` that ``App.tsx`` sets on the ``queryClient``
   (``DEFAULT_QUERY_STALE_TIME_MS``, 15000 ms) keeps the last good response
   serving that key for 15 seconds and a remount during a network blip re-uses
   it. The query's ``refetchInterval`` is untouched by that: the grid still polls
   on the bandwidth cadence.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Do not render until the filter is ready.** The page holds rendering behind
   ``isLoading || !isFilterReady``. Mounting a tile starts a stream, so flashing the full monitor set for even one frame before
   the group/hidden filter narrows it would briefly open *every* stream at once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx>`__
   · → :doc:`04-pages-and-views`

#. **One tile per monitor.** Each monitor becomes a grid cell wrapping an error
   boundary and ``MontageMonitor`` (memoized), keyed by ``Monitor.Id``. ``memo``
   keeps grid re-renders (drag, resize) from tearing the stream down and back up,
   and the boundary isolates a crashing tile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MontageMonitor.tsx>`__
   · → :doc:`05-component-architecture`

#. **Pick a streaming method.** ``LiveMonitorPlayer`` computes
   ``effectiveStreamingMethod`` (``webrtc`` vs ``mjpeg``) from the user setting,
   ``monitor.Go2RTCEnabled``, and ``profile.go2rtcUrl``; a go2rtc failure falls
   back to MJPEG. For a plain MJPEG monitor this is ``'mjpeg'`` and the rest of
   this flow follows the ``<img>`` path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`go2rtc-integration`

#. **The hook that owns the stream.** ``LiveMonitorPlayer`` calls
   ``useMonitorStream``, which resolves the profile, a fresh access token, the
   per-server URLs, the view mode, and the multi-port base. It assembles
   everything needed to build a valid stream URL and the matching CMD_QUIT URL.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts>`__
   · → :doc:`05-component-architecture`

#. **Mint a connection key.** ``useMonitorStream`` delegates the connkey
   lifecycle to ``useStreamLifecycle``, whose mount effect calls
   ``regenerateConnKey(monitorId)`` and sets ``connKey``. Each concurrent stream
   needs a unique key so ZoneMinder's ``nph-zms`` processes do not collide.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useStreamLifecycle.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The key goes into the store.** ``stores/monitors.ts``
   ``generateAndSetConnKey`` generates a random number and stores it in the
   persisted ``connKeys[monitorId]`` map. Keeping it in the store is what lets
   teardown later compare-and-clear the key it owns, never a newer
   concurrent one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/monitors.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Build the stream URL (only when safe).** Once ``connKey !== 0`` and the
   token is fresh, ``useMonitorStream`` builds the URL via ``getStreamUrl``
   (``api/monitors.ts`` then ``lib/zm/url-builder.ts`` to ``/cgi-bin/nph-zms``) and
   mirrors it into ``imageSrc``. The double gate prevents minting a zombie stream
   before a key exists. :doc:`05-component-architecture` walks the connkey
   lifecycle this gate protects.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The browser opens the feed.** ``LiveMonitorPlayer`` binds
   ``<img src={imageSrc} onLoad onError>``. The browser itself opens the
   multipart MJPEG connection through the ``<img>``; the connkey lives right in
   the ``src``. A good frame calls ``reportStreamLoad``, which zeroes the
   reconnect backoff and records which ``src`` produced it. That record is what
   ``hasFrame`` compares against, and the player keeps the ``<img>``
   ``visibility: hidden`` until it agrees, so the VideoOff placeholder covers the
   tile instead of a stale frame or the browser's broken-image glyph. ``hasFrame``
   waits for ``onLoad`` rather than for a minted connkey, because nothing has
   been decoded when the key is minted, and after a mobile suspend the element
   still holds the dead connection's last picture (refs #352).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts>`__
   · → :doc:`05-component-architecture`

#. **When the feed drops, reconnect with backoff.** An ``<img onError>`` calls
   ``reportStreamError`` (``scheduleReconnect``), which waits an exponentially
   growing, capped delay then calls ``forceRegenerate({ killPrevious: true })``.
   At the attempt cap it calls ``releaseConnection()`` instead, unless the
   profile's keep-awake setting (``insomnia``) is on, which removes the cap. The error cannot tell a dead server process
   from a dropped-but-alive one, so it must CMD_QUIT the old key before minting a
   new one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Quit cleanly on every mint and unmount.** ``forceRegenerate`` (and the
   unmount cleanup ``quitStreamForParams``) send a CMD_QUIT for the old connkey
   and clear it from the store with a compare-and-clear, then the ``<img>`` src is
   removed to abort the in-flight connection. This is what prevents leaked
   ``nph-zms`` processes when a tile reconnects or leaves the grid.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useStreamLifecycle.ts>`__
   · → :doc:`11-application-lifecycle`

#. **A profile switch tears down all streams first.** Each lifecycle registers a
   teardown thunk in ``lib/monitor/active-streams.ts``; ``stores/profile.ts``
   ``switchProfile`` awaits ``quitAllActiveStreams()`` before logout and the
   SSL-trust flip, while the old profile's trust and token are still in effect.
   Relying on React unmount alone races the switch and can orphan an ``nph-zms``
   process on a self-signed server.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/active-streams.ts>`__
   · → :doc:`11-application-lifecycle`

Flow 3: A push notification, from registration to tap
-----------------------------------------------------

Native only (iOS/Android). Every ``@capacitor-firebase/messaging`` call sits
behind a ``Platform.isNative`` check and a dynamic ``import()``, so on web the
whole flow short-circuits and none of it runs. There are two halves: registering
a token on startup, and reacting when a push arrives.

.. mermaid::

   sequenceDiagram
       autonumber
       participant App as NotificationHandler
       participant Svc as Push service
       participant OS as FCM / OS
       participant ZM as ZoneMinder
       participant Nav as Router

       App->>Svc: initialize (on startup)
       Svc->>OS: request permission
       Svc->>OS: create channel zmninja-ng (Android)
       Svc->>OS: getToken
       OS-->>Svc: FCM token
       Svc->>ZM: register token (postForm /notifications.json)
       OS->>Svc: user taps a push (notificationActionPerformed)
       Svc->>Svc: resolve profile, store the event
       Svc->>Nav: navigate to /events/:id

#. **A headless component wires it all up.** ``App.tsx`` mounts
   ``<NotificationHandler/>`` once. It renders no UI of its own (only the
   cross-profile switch dialog) and exists purely to wire the notification side
   effects through three hooks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/NotificationHandler.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Set up push for the active profile.** ``useNotificationPushSetup`` runs an
   effect gated on ``Platform.isNative && settings.enabled``. It registers the
   token against the current profile and the chosen backend: re-register if the
   push service is already running, otherwise ``initialize()`` for the first
   time.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationPushSetup.ts>`__
   · → :doc:`11-application-lifecycle`

#. **One push service for the whole app.** ``services/pushNotifications.ts``
   exposes ``getPushService``, a module-level singleton holding ``currentToken``
   and init state, so token state survives re-renders and profile switches
   instead of being recreated.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Ask permission.** ``initialize`` imports ``FirebaseMessaging`` and calls
   ``requestPermissions()``, continuing only if granted. No token can be obtained
   without OS push permission.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Create the Android channel.** ``_createNotificationChannel`` (Android only)
   creates the FCM channel ``id: 'zmninja-ng'`` at ``importance: 4`` (HIGH).
   Android needs a high-importance channel for heads-up banners, and the
   manifest's ``default_notification_channel_id`` routes channel-less server
   pushes here so they alert instead of landing silently.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Listen before fetching the token.** ``_setupListeners`` registers
   ``tokenReceived``, ``notificationReceived``, and ``notificationActionPerformed``
   *before* ``getToken`` so a token refresh is never missed.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Get the FCM token.** Back in ``initialize``, ``FirebaseMessaging.getToken()``
   requests the token, stores it in ``currentToken``, and retries once after 5s on
   a transient failure. The service's own ``getToken()`` is only an accessor for
   that stored value.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Register the token with the server.** ``_registerWithServer`` forks on
   ``settings.notificationMode``: direct mode calls ``api/notifications``
   ``registerToken``; ES mode registers over the websocket, deferring until
   connected.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The actual REST call.** ``api/notifications.ts`` ``registerToken`` POSTs a
   form-encoded ``Notification[...]`` body to ``/notifications.json`` via
   ``client.postForm``. ZoneMinder's notifications endpoint expects form fields,
   not JSON.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/notifications.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A push arrives while the app is open.** ``notificationReceived`` →
   ``_handleNotification`` ignores the push if already connected to the event
   server (the same event also arrives over the websocket), otherwise it builds a
   snapshot URL for the current profile and adds the event to the notification
   store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The user taps the notification.** ``notificationActionPerformed`` →
   ``_handleNotificationAction`` resolves the target profile and stores the event
   under it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Same profile or switch?** ``resolveProfileForNotification`` matches the
   payload's profile name to a stored profile. Same profile navigates directly; a
   different one calls ``requestProfileSwitch`` to ask first (the dialog lives in
   ``NotificationHandler``).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/profile/notification-profile.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Navigate to the event.** A service cannot use React Router's hook, so it
   calls ``navigationService.navigateToEvent``; ``NotificationHandler``'s listener
   catches that event and calls ``navigate``, landing on ``/events/:id``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/navigation.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Reconcile pushes you missed.** ``useNotificationDelivered`` covers pushes
   that arrived while the app was killed or backgrounded: on cold start and on
   ``appStateChange`` it reads ``getDeliveredNotifications()``, ingests them into
   history, clears them, and syncs the badge. A tray item read back this way can
   arrive without its FCM ``data`` payload, so it has no event id. It is stored
   with ``EventId`` 0 and rendered with the shared no-image thumbnail. The code
   never invents an id from ``Date.now()``: a fabricated id would drive a
   ``view=image&eid=<timestamp>`` request ZoneMinder logs as "Event not found"
   (issue #242). The same rule holds for the two live handlers above.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationDelivered.ts>`__
   · → :doc:`11-application-lifecycle`

Flow 4: Adding a server profile
-------------------------------

Adding a profile is one long orchestrated method, ``handleTestConnection``: it
discovers the server's real API and CGI URLs, trusts its certificate the first
time, logs in to confirm the details, then saves the profile and switches to it.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Form as ProfileForm
       participant Disc as Discovery
       participant SSL as SSL trust
       participant ZM as ZoneMinder
       participant Store as Profile store

       Form->>SSL: enable trust-all (if self-signed)
       Form->>Disc: discover URLs from the portal you typed
       Disc->>ZM: probe /api and /zm/api for getVersion
       Disc->>ZM: read ZM_PATH_ZMS for the real CGI URL
       Form->>SSL: fetch the cert fingerprint
       SSL-->>Form: show trust-on-first-use dialog
       Form->>ZM: log in to confirm
       Form->>Store: addProfile, then switchProfile

#. **The form.** ``ProfileForm`` holds state for the portal URL, credentials, the
   self-signed switch, manual-URL mode, and the trust-dialog. The same screen
   serves first-time setup and adding another profile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/ProfileForm.tsx>`__
   · → :doc:`04-pages-and-views`

#. **One method runs the whole thing.** ``handleTestConnection`` (the Connect
   button) sets up an ``AbortController``, validates the inputs, then drives
   discovery → trust → login → save → switch in order.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/ProfileForm.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Trust the cert before probing.** When self-signed is on,
   ``applyTrustedCertificates({ urls, fingerprint: null, enabled })`` runs first,
   so the upcoming discovery calls can reach a self-signed host instead of
   failing the handshake. The profile is not saved yet, so it is passed as the
   ``candidate`` argument to be folded into the trust set.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/security/ssl-trust.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Find the real URLs.** ``discoverUrls`` wraps ``discoverZoneminder`` with one
   retry (to absorb the iOS local-network permission prompt) and installs the API
   client once a candidate answers.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Probe candidates.** ``discoverZoneminder`` crosses ``https``/``http`` with
   ``/api`` and ``/zm/api``, probing ``host/getVersion.json``, then derives the
   portal URL and CGI URL from whichever responds.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Read the server's ZMS path.** With credentials, ``fetchCgiUrl`` logs in and
   reads ``ZM_PATH_ZMS`` from config, so the streaming URL matches the server's
   real setup.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts>`__
   · → :doc:`13-network-endpoints`

#. **Trust on first use.** On native with self-signed enabled,
   ``getServerCertFingerprint`` fetches the cert; ``CertTrustDialog`` shows it and
   waits. Accepting pins the fingerprint (``applyTrustedCertificates({ urls,
   fingerprint, enabled: true })``); rejecting aborts.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/CertTrustDialog.tsx>`__
   · → :doc:`05-component-architecture`

#. **Install the login discovery already did.** Discovery logged in to read
   ``ZM_PATH_ZMS`` and returns that response as ``loginResponse``; after a fresh
   ``logout()`` the form hands it to ``setTokens()`` rather than calling
   ``login()`` a second time. ZoneMinder's ``login.json`` hashes the password
   server-side and costs about 0.6s, twenty times any other call. Only when discovery returned no
   tokens (no credentials, or a server with auth off) does ``login()`` run.
   Failure is surfaced as a localized error either way.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Save it.** ``addProfile`` validates the name, generates a UUID, writes the
   password to secure storage (never to Zustand), appends the profile, and makes
   it current if it is the first.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Switch to it.** For a non-first profile, ``switchProfile`` quits the old
   profile's streams, resets the client, and runs ``performBootstrap`` (the same
   bootstrap as Flow 1) before navigating away.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`11-application-lifecycle`

Flow 5: Browse events and play a video
--------------------------------------

From the Events list to a playing video. An event whose ``DefaultVideo`` is an ``.m3u8`` plays HLS, a normal recording plays
MP4, and anything else (or any MP4 error, or a TV device) falls back to the ZMS
MJPEG player.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Events page
       participant API as getEvents
       participant ZM as ZoneMinder
       participant Detail as EventDetail
       participant Player as Video player

       Page->>API: query with the active filters
       API->>ZM: GET /events/index...json (paged)
       ZM-->>Page: event list, rendered as thumbnail cards
       Page->>Detail: tap a card, navigate to /events/:id
       Detail->>ZM: GET /events/:id.json
       Detail->>Detail: pick MP4 vs HLS vs ZMS
       Detail->>Player: build the video URL and play
       Player->>ZM: stream from /index.php or /cgi-bin/nph-zms

#. **Assemble the filters.** ``Events`` reads monitor, date, tag, and favorite
   filters from ``useEventFilters`` and computes the effective monitor set that
   drives the query.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Events.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Run the events query.** ``pages/Events.tsx`` calls ``useScopedEvents``,
   which runs one query per profile in scope and combines them, keeping the
   previous page visible during pagination
   (``placeholderData: keepPreviousData``). As with the monitor list it is not
   gated on auth, for the same reason and with the same warning in the hook.
   Its error wall is guarded by ``error && !eventsData``: once a page of
   events is cached, a failed background refetch leaves the stale list on screen
   rather than replacing it. Only a cold start with nothing cached renders
   ``ErrorBanner`` with ``resolveQueryError(error, t)``, which folds a 401 into
   the localized ``common.auth_required`` message instead of leaking the raw
   error text. ``pages/Montage.tsx`` and ``pages/Monitors.tsx`` guard the same way.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Events.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **Build the ZM filter path and paginate.** ``getEvents`` turns filters into
   CakePHP-style URL segments, fetches up to ten pages of 100, dedupes by id,
   drops excluded monitors, and returns a synthesized pagination block.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/events.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Render thumbnail cards.** ``EventListView`` maps each event to an
   ``EventCard``, each showing a representative still built from a fallback chain
   of frame ids (snapshot/objdetect/alarm).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventListView.tsx>`__
   · → :doc:`05-component-architecture`

#. **Open one.** Tapping a card navigates to ``/events/:id``, carrying the
   referrer and active filters in router state so the detail page can do
   next/prev within the same filtered set.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventCard.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Load the event.** ``EventDetail`` fetches the full event (``getEvent``) and
   its monitor, and resolves the monitor's portal URL and streaming port for
   multi-server support.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Pick the player.** ``isHlsEvent`` (an ``.m3u8`` ``DefaultVideo``) chooses HLS;
   otherwise MP4. JPEG-only events, TV devices, and any MP4 error flip
   ``useZmsFallback`` to the ZMS player; it is seeded from ``isTvMode`` at the top
   of the component so a Fire Stick never even attempts the MP4 path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Build the video URL (stably).** ``videoUrl`` is memoized so its identity does
   not change mid-playback (re-issuing the source resets iOS WKWebView); it calls
   ``getEventVideoUrl`` with the token, port, and HLS flag.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **The URL shape.** ``url-builder.ts`` ``getEventVideoUrl`` emits the HLS
   (``view_event_hls``) or MP4 (``view_video``) ``/index.php`` URL, appends the
   token, and rewrites the port when multi-port streaming is on.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts>`__
   · → :doc:`10-key-libraries`

#. **MP4/HLS playback.** ``Mp4EventPlayer`` creates a Video.js player, wires alarm
   markers and PiP, and bubbles a playback ``error`` up to ``EventDetail``, which
   switches to ZMS.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/Mp4EventPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **The ZMS fallback.** ``ZmsEventPlayer`` streams MJPEG from ``/cgi-bin/nph-zms``
   into an ``<img>`` and sends play/pause/seek/speed as ZMS commands over the same
   connkey, quitting on unmount, just like a live stream.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/ZmsEventPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **The still frames above the player.** ``EventFrameCarousel`` renders the
   objdetect, alarm, and snapshot frames as thumbnails, in that order. ZoneMinder reports no
   list of which ones exist, so each is requested and any whose image errors
   removes itself; when all of them error the card disappears. Opening one calls
   ``onViewerOpenChange``, and ``EventDetail`` pauses the Video.js player it kept
   from ``onReady`` (or passes ``suspended`` to ``ZmsEventPlayer``), resuming on
   close only if playback was running.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventFrameCarousel.tsx>`__
   · → :doc:`05-component-architecture`

Flow 6: The access-token lifecycle
----------------------------------

A timer refreshes the access token before it expires, each request refreshes it
just-in-time if needed, and a 401 triggers recovery. All three sit behind
module-level single-flight gates, so they collapse to one network request when
they overlap.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Timer as useTokenRefresh
       participant Auth as Auth store (gates)
       participant ZM as ZoneMinder
       participant Client as API client

       Timer->>Auth: token expiring soon? getFreshAccessToken
       Auth->>ZM: POST refresh (single-flight)
       ZM-->>Auth: new tokens
       Client->>Auth: getAccessToken before each request
       Client->>Auth: expired? getFreshAccessToken (shares the same gate)
       Client->>ZM: request with token
       ZM-->>Client: 401
       Client->>Auth: recoverFromAuthFailure (refresh, then re-login)
       Client->>ZM: retry once

#. **A minute timer watches expiry.** ``useTokenRefresh`` mounts once, arms a
   one-minute interval and a ``visibilitychange`` listener so it re-checks the
   moment the app returns from background.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTokenRefresh.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Refresh before it lapses.** ``checkAndRefresh`` refreshes when the time to
   expiry drops below the leeway window, covering both "expiring soon" and
   "already expired while backgrounded".
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTokenRefresh.ts>`__
   · → :doc:`11-application-lifecycle`

#. **One shared entry point.** ``getFreshAccessToken`` returns the current token if
   still fresh, else attaches to (or installs) the module-level ``pendingFreshToken``
   gate, so concurrent callers share one outcome.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The deduped refresh POST.** ``refreshAccessToken`` runs the network refresh
   behind its own ``pendingRefresh`` gate and logs out if the refresh token is
   already expired, so a proactive refresh and a 401 recovery collapse to one POST.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts>`__
   · → :doc:`03-state-management-zustand`

#. **New tokens land.** ``setTokens`` converts the relative expiry seconds to
   absolute timestamps and stores them (access in memory, refresh in secure
   storage); updating the expiry is what re-arms the timer.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Every request reads the token through a gate.** The API client's ``request``
   pulls the token via the injected ``AuthGate`` rather than importing the store;
   login and ``skipAuth`` requests bypass it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Just-in-time refresh.** If the token is already expired when a request is
   about to fire, the client calls ``getFreshAccessToken`` (the same gate) and
   attaches the new token, catching tokens that died between timer ticks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **401 recovery, single-flight.** A 401 triggers ``recoverFromAuthFailure``,
   which refreshes, falls back to re-login, logs out once if both fail, never
   rejects, and on success retries the original request exactly once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The gate that breaks the import cycle.** ``makeProfileGates(profileId)``
   in ``api/store-gates.ts`` injects that profile's auth accessors into the
   client, so the client never imports the store directly; the single-flight
   dedup stays in the store and the client stays mockable.
   ``createStoreApiClient`` is the only caller of ``createApiClient``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/store-gates.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **A switch clears the gates.** ``dropSession(profileId)`` evicts the cached
   session and calls ``resetAuthGates(profileId)``, which nulls that profile's
   pending gates so a rebuilt session never attaches to the dropped one's
   in-flight login or refresh. ``dropAllSessions`` does the same for every
   profile at once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts>`__
   · → :doc:`12-shared-services-and-components`

Flow 7: Live notifications over the Event Server websocket
----------------------------------------------------------

The other notification path (separate from FCM push in Flow 3): in "ES mode" the
app opens a websocket to the ZoneMinder event server, authenticates, keeps it
alive, and turns each live alarm into an event in the store and a toast on screen.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Hook as Auto-connect hook
       participant Store as Notification store
       participant Svc as WS service
       participant ES as Event server

       Hook->>Store: connect(profile, user, pass)
       Store->>Svc: connect + inject providers
       Svc->>ES: open websocket, send auth
       ES-->>Svc: auth Success
       Svc->>ES: keepalive ping (bandwidth interval)
       ES-->>Svc: alarm event
       Svc->>Store: onEvent, addEvent
       Store-->>Hook: toast + badge update

#. **The handler wires the hook.** ``NotificationHandler`` hands the store's
   ``connect``/``disconnect``/``reconnect`` and the current profile to
   ``useNotificationAutoConnect``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/NotificationHandler.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Choose the ES path.** The auto-connect effect reads ``notificationMode``; for
   ``es`` it proceeds only when a host is set and nothing is connected, guarded
   against re-entry.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAutoConnect.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Decrypt and connect (race-checked).** ``attemptConnect`` decrypts the
   password, re-reads the connection state right before connecting (the await
   could have changed it), then calls the store's ``connect``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAutoConnect.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Store builds the config and listeners.** ``connect`` gets its own service
   instance per profile id, builds the server config, registers state/event
   listeners, and awaits the service connect. It does not disconnect any
   other profile, since an aggregate needs more than one profile connected
   at once (refs #337; see Flow 23).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Inject store-derived providers.** ``_buildServiceProviders`` hands the
   import-free service its token getter, image-URL builder, and bandwidth-derived
   keepalive interval.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Open the socket.** The service ``connect`` builds the ``ws(s)://host:port``
   URL, opens the websocket with stale-socket guards on every handler, and waits
   for auth.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Send credentials on open.** ``_handleOpen`` sends the ``auth`` message and a
   20-second timer rejects (and reconnects) if no response comes back.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts>`__
   · → :doc:`13-network-endpoints`

#. **Handle the auth reply.** ``_handleMessage`` resolves the pending auth on
   ``Success`` (starts keepalive, state ``connected``) or disconnects without
   reconnect on bad credentials.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts>`__
   · → :doc:`13-network-endpoints`

#. **Keep it alive.** ``_startPingInterval`` sends a periodic version request at the
   bandwidth-derived interval; the same request backs the liveness check on resume.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Reconnect with backoff.** On an unintended close, ``_scheduleReconnect`` waits
   an exponential, jittered delay, capped at two minutes while the document is
   hidden and at ``foregroundMaxReconnectDelayMs`` (15 seconds) while it is not.
   The lower ceiling is what keeps a visible app recovering on its own: resume
   fires a single immediate retry, and if that one attempt fails, which is common
   while a woken device is still bringing its network up, nothing re-triggers it
   (refs #274). ``reconnectNow`` jumps the queue on network-restored and on app
   resume; ``reconnectNow(true)`` additionally replaces a socket that still reads
   as open but failed its liveness ping.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts>`__
   · → :doc:`16-platform-surfaces`

#. **Bridge events into the store.** ``_initialize`` subscribes to the service's
   state and event streams, mirroring connection state and calling ``addEvent`` per
   alarm.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Record the alarm.** ``addEvent`` wraps it as a notification, dedupes and caps
   the history, recomputes the unread badge, and pushes the count back to the
   server. A toast then shows for the latest event.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

Flow 8: A go2rtc WebRTC live stream
-----------------------------------

The alternative to the MJPEG tile in Flow 2. When a monitor has go2rtc enabled,
the tile drives a low-latency WebRTC/MSE ``<video>`` via the vendored ``video-rtc``
element, with a ladder of watchdogs that fall back to MJPEG if anything stalls.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Tile as LiveMonitorPlayer
       participant Hook as useGo2RTCStream
       participant El as video-rtc element
       participant GR as go2rtc server

       Tile->>Tile: webrtc selected? (not failed recently)
       Tile->>Hook: useGo2RTCStream
       Hook->>El: new VideoRTC, src = ws URL
       El->>GR: open websocket, negotiate webrtc/mse/hls
       GR-->>El: video frames
       Note over Tile,GR: no frames in 15s, or freeze, or error
       Tile->>Tile: record failure, fall back to MJPEG

#. **Choose WebRTC.** ``streamingMethod`` resolves ``webrtc`` only when the user
   setting allows it, the monitor has go2rtc enabled, and the profile has a go2rtc
   URL.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Skip known-broken monitors.** A module-level failure cache (5-minute TTL)
   makes a monitor that recently failed go2rtc go straight to MJPEG, so montage
   tiles do not each re-attempt a broken stream.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **MJPEG-first placeholder.** ``effectiveStreamingMethod`` shows the MJPEG stream
   as a placeholder while WebRTC establishes, swapping to ``<video>`` once decoded
   frames appear, so the tile is never blank.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Call the hook.** ``useGo2RTCStream`` is invoked with the go2rtc URL, channel,
   protocols, and a host guard against leaking the token to the wrong origin.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Connect lifecycle.** The hook waits a short delay (to survive Strict-Mode
   double-invoke) then connects, and tears down on unmount or disable.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useGo2RTCStream.ts>`__
   · → :doc:`11-application-lifecycle`

#. **Build the websocket URL.** ``getGo2RTCWebSocketUrl`` converts http(s) to
   ws(s), appends ``/ws``, and sets ``src={monitorId}_{channel}`` plus the token.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Create the element.** ``connect`` instantiates ``VideoRTC``, wraps its
   ``oninit``/``onopen``/``ondisconnect`` handlers into React state, and assigns
   ``src`` to kick off the socket. It also overwrites the ``pcConfig.iceServers``
   the vendored file hardcodes, with ``GO2RTC_STUN_SERVERS`` or an empty list
   depending on the per-profile ``webrtcUseStun`` setting (off by default, since
   LAN and VPN clients reach go2rtc directly at its local address, the ICE
   host candidate, with no STUN server). The override has to
   happen here rather than during negotiation: ``onwebrtc()`` reads ``pcConfig``
   only when it builds the peer connection, after the websocket has opened.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useGo2RTCStream.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Negotiate protocols.** On open, the vendored element starts MSE (or HLS) and
   WebRTC in parallel; whichever delivers video first wins and becomes the active
   protocol.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/vendor/go2rtc/video-rtc.js>`__
   · → :doc:`go2rtc-integration`

#. **Watchdog: connected but no frames.** A 15-second timer checks for actual video
   dimensions; if none, it records the failure and falls back to MJPEG (a faster
   poll swaps to ``<video>`` the instant frames appear).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Watchdog: freeze after playing.** A 3-second liveness check watches
   ``currentTime`` advance; a stall past the threshold retries up to twice, then
   demotes to MJPEG. Healthy playback for a minute clears the retry count.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Resume after background.** ``useVisibilityResume`` resets freeze counters,
   clears any latched MJPEG fallback, and nudges a retry, recovering tiles the
   browser suspended.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`11-application-lifecycle`

Flow 9: The Timeline view
-------------------------

The Timeline fetches events for a time range, transforms them into bars, and
paints them on a ``<canvas>`` you can pan, zoom, and scrub, with live events
injected the instant they arrive.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Timeline page
       participant Data as useTimelineData
       participant ZM as ZoneMinder
       participant Canvas as TimelineCanvas
       participant Render as renderer

       Page->>Data: fetch monitors + events for the range
       Data->>ZM: GET events (fan out per monitor if filtered)
       ZM-->>Data: events, transformed to bars
       Data->>Page: live events injected from the store
       Page->>Canvas: viewport + gestures
       Canvas->>Render: paint axis, swimlanes, bars, playhead

#. **The page and its range.** ``Timeline`` reads filters, defaults to the last 24
   hours, and restores the scrubber from session storage so the playhead survives
   a round-trip to an event page.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Timeline.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Fetch monitors and events.** ``useTimelineData`` runs a monitors query and a
   range-bounded events query, using "now" as the end in live mode.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Fan out per monitor when filtered.** With a cause filter active, it issues one
   capped ``getEvents`` per monitor at limited concurrency and merges them, so one
   busy camera cannot fill ``getEvents``' ten-page cap and crowd out the rest.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Inject live events.** In live mode it subscribes to the notification store and
   adds a synthetic bar immediately on a new alarm, then debounces a refetch and
   prunes the synthetic once the real event lands.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Transform to bars.** ``allTimelineEvents`` maps each event to a
   ``TimelineEvent`` (start/end ms, alarm ratio, pulse timestamp), merging live
   synthetics with the API winning on id collisions.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts>`__
   · → :doc:`05-component-architecture`

#. **The canvas orchestrator.** ``TimelineCanvas`` wires the viewport, gestures,
   render loop, and hit-testing, translating one-shot actions (reset, zoom, go-to-now)
   into animated viewport changes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/TimelineCanvas.tsx>`__
   · → :doc:`05-component-architecture`

#. **Viewport math.** ``useTimelineViewport`` holds the visible range and does pan,
   zoom (clamped between one minute and 90 days), and eased animations.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/useTimelineViewport.ts>`__
   · → :doc:`05-component-architecture`

#. **Input gestures.** ``useTimelineGestures`` normalizes mouse, touch, wheel, and
   pinch into pan/zoom/hover/click/brush callbacks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/useTimelineGestures.ts>`__
   · → :doc:`05-component-architecture`

#. **Hit-testing.** ``hitTest`` maps a canvas point to a monitor row and event,
   expanding thin bars to a minimum width so they stay clickable.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/timeline-hit-test.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Paint the canvas.** ``renderTimeline`` layers swimlanes, a collision-pruned
   time axis, rounded per-monitor event bars (with a pulse halo for live arrivals),
   the dashed "NOW" pill, and the scrubber playhead.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/timeline-renderer.ts>`__
   · → :doc:`10-key-libraries`

#. **Scrub and preview.** ``TimelineScrubber`` drags the playhead and shows
   thumbnail buttons for the events under it; a canvas click opens
   ``EventPreviewPopover``, whose Play button navigates to the event.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/TimelineScrubber.tsx>`__
   · → :doc:`05-component-architecture`

Flow 10: Downloading an event
-----------------------------

A download registers a background task and then splits by platform: on mobile it
fetches base64 and writes via Capacitor (never a Blob, to avoid running out of memory); on web it
streams a Blob with real progress. The drawer shows progress and a cancel button.

.. mermaid::

   sequenceDiagram
       autonumber
       participant UI as Download button
       participant Svc as download service
       participant Task as Background-task store
       participant HTTP as http adapter
       participant Save as Filesystem / Media
       participant Drawer as Task drawer

       UI->>Svc: downloadEventVideo
       Svc->>Task: addTask (drawer pops open)
       Svc->>HTTP: fetch (base64 on mobile, Blob on web)
       HTTP->>Save: write file + add to media library
       Svc->>Task: updateProgress, then completeTask
       Task-->>Drawer: progress bar + cancel

#. **The trigger.** The "Download video" button calls ``downloadEventVideo`` with
   the URL inputs and returns immediately; the drawer surfaces progress.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx>`__
   · → :doc:`05-component-architecture`

#. **Orchestrate and register a task.** ``downloadEventVideo`` builds the URL,
   sanitizes the filename, creates an ``AbortController``, registers a background
   task with a cancel function, and kicks off the work asynchronously.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The task store.** ``addTask`` creates the task, trims old finished ones, and
   auto-expands the drawer. Using ``.getState()`` is what lets a non-React service
   drive the store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/backgroundTasks.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Platform dispatch.** ``downloadFile`` picks the native or web handler from the
   platform; this is the split point.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Mobile: base64, never a Blob.** ``downloadFileNative`` fetches with
   ``responseType: 'base64'`` and uses the string directly, explicitly avoiding a
   Blob to prevent out-of-memory on large videos.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The native HTTP adapter.** ``nativeHttpRequest`` uses CapacitorHttp and returns
   base64; it has no abort support, so a timeout race stands in.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/http/adapter-native.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Mobile save.** The base64 is written to Documents, then added to the Photo or
   Video library by extension; a media-library failure is non-fatal because the
   file is already saved.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Web: streaming Blob.** ``downloadFileWeb`` fetches a Blob with streaming
   progress and triggers a browser download via a temporary anchor, falling back to
   a direct link if the fetch fails.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Progress feeds the store.** Each tick calls ``updateProgress`` (web has real
   streaming progress; native emits a single 100% tick), then ``completeTask`` /
   ``failTask`` on finish.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/backgroundTasks.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The drawer.** ``BackgroundTaskDrawer`` (mounted globally) renders progress bars
   and a cancel button that calls the task's cancel function, which aborts the
   request.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/BackgroundTaskDrawer.tsx>`__
   · → :doc:`05-component-architecture`

Flow 11: A bandwidth setting becomes polling cadence
----------------------------------------------------

The diagram shows where the values come from rather than an order of events.
One per-profile setting (``bandwidthMode``) selects a preset, and the app's
recurring polls read their intervals from that preset, so flipping low mode
changes their cadence together.

.. mermaid::

   graph LR
       Presets["BANDWIDTH_SETTINGS<br/>(normal / low)"] --> Getter["getBandwidthSettings()"]
       Mode["bandwidthMode<br/>(per-profile setting)"] --> Hook["useBandwidthSettings()"]
       Getter --> Hook
       Hook --> C1["useMonitors<br/>refetchInterval"]
       Hook --> C2["Monitors page<br/>queries"]
       Getter --> C3["notifications<br/>keepalive / poller"]

#. **The contract.** ``BandwidthSettings`` declares the shape: every interval and
   quality knob the app polls on (monitor status, alarm status, snapshot refresh,
   keepalive, and more).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The two presets.** ``BANDWIDTH_SETTINGS`` holds the ``normal`` and ``low``
   objects; ``low`` roughly doubles every interval and halves image scale and fps.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The non-React getter.** ``getBandwidthSettings(mode)`` is the one sanctioned
   way for services and stores (outside React) to read a preset.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The user's knob.** ``bandwidthMode`` is a profile-scoped setting in the
   settings store, so switching profiles can switch cadence.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/settings.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The React hook.** ``useBandwidthSettings`` reads ``bandwidthMode`` from the
   current profile and memoizes the matching preset, so components get a live,
   profile-correct settings object.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useBandwidthSettings.ts>`__
   · → :doc:`05-component-architecture`

#. **A typical consumer.** ``useMonitors`` feeds ``bandwidth.monitorStatusInterval``
   straight into the React Query ``refetchInterval`` (overridable by the caller).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitors.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The seeded path.** Toggling low mode in ``LiveStreamingSection`` copies the
   preset's stream knobs (scale, fps, snapshot refresh) into the profile settings,
   which is why ``useMonitorStream`` reads them as ``settings.*``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/settings/LiveStreamingSection.tsx>`__
   · → :doc:`03-state-management-zustand`

#. **The non-React consumers.** Outside React, the notification keepalive and the
   direct-mode poller call ``getBandwidthSettings`` directly for their intervals.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

Flow 12: A Dashboard widget
---------------------------

The Dashboard is a per-profile grid of widgets you add, arrange, and resize. The
layout lives in its own persisted store (not profile settings), keyed by profile
id, and each widget fetches its own live data.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Dashboard page
       participant Store as Dashboard store
       participant Grid as DashboardLayout
       participant Widget as A widget
       participant ZM as ZoneMinder

       Page->>Store: read widgets[profileId]
       Store-->>Grid: saved widgets + layouts
       Grid->>Widget: render each by type
       Widget->>ZM: query its own data on an interval
       Page->>Store: add / move / resize / remove
       Store-->>Page: persisted, survives reload

#. **The page reads the saved list.** ``Dashboard`` resolves the current profile
   and pulls that profile's widgets from the dashboard store, falling back to an
   empty array.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Dashboard.tsx>`__
   · → :doc:`04-pages-and-views`

#. **A dedicated persisted store.** ``useDashboardStore`` keeps
   ``widgets: Record<profileId, DashboardWidget[]>`` plus an editing flag, persisted
   under its own key with versioned migrations. It is profile-scoped by keying on
   profile id, not by ``getProfileSettings``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The grid.** ``DashboardLayout`` maps each widget's stored geometry into a
   react-grid-layout and packs widgets upward, showing an empty state when there
   are none.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardLayout.tsx>`__
   · → :doc:`05-component-architecture`

#. **Card chrome per cell.** ``DashboardWidget`` wraps each cell in a card with the
   drag handle and, in edit mode, the per-widget edit and delete buttons; the live
   content is passed in by type.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardWidget.tsx>`__
   · → :doc:`05-component-architecture`

#. **Add a widget.** ``DashboardConfig`` opens the Add Widget dialog with four type
   tiles (monitor, events, timeline, heatmap) and the per-type options (monitor
   multi-select, feed fit, and so on).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardConfig.tsx>`__
   · → :doc:`05-component-architecture`

#. **The store appends and auto-places it.** ``addWidget`` generates a UUID,
   computes a ``y`` below the existing widgets so it stacks, and persists
   immediately so it survives a reload.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts>`__
   · → :doc:`03-state-management-zustand`

#. **A widget fetches its own data.** ``EventsWidget`` runs a React Query against
   ``getEvents`` with its ``refetchInterval`` drawn from the widget override or
   ``bandwidth.eventsWidgetInterval``, then renders a
   clickable list.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/widgets/EventsWidget.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **Drag and resize persist.** ``handleLayoutChange`` fires on every move, and only
   while editing (guarded against a store→state→store feedback loop) writes the new
   geometry back. For the subscription rules that keep that loop from re-arming,
   see :doc:`05-component-architecture`.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardLayout.tsx>`__
   · → :doc:`05-component-architecture`

#. **Per-breakpoint layout write.** ``updateLayouts`` merges the new geometry per
   breakpoint and recomputes the primary layout, so a resized widget keeps its size
   across reloads.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Remove a widget.** The edit-mode X button calls ``removeWidget``, which filters
   it out of that profile's array and re-renders the grid.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts>`__
   · → :doc:`03-state-management-zustand`

Flow 13: Kiosk lock and biometric unlock
----------------------------------------

A wall-display lock: a full-screen overlay, protected by a global PIN, with
biometric unlock on mobile. The lock is
triggered only by a manual tap and resets to unlocked on app restart. There is no
idle timeout and no auto-lock on backgrounding.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Btn as Lock button
       participant Store as Kiosk store
       participant Overlay as KioskOverlay
       participant Bio as Biometrics
       participant Pin as PinPad

       Btn->>Store: lock() (manual)
       Store-->>Overlay: isLocked, mount full-screen gate
       Overlay->>Bio: try biometrics on unlock tap
       Bio-->>Overlay: success unlocks
       Overlay->>Pin: on unavailable / cancel, show PIN
       Pin->>Store: verifyPin, count failed attempts
       Store-->>Overlay: unlock (or 30s cooldown after 5 misses)

#. **Set the PIN.** ``AdvancedSection`` hosts setting, changing, and clearing the
   global kiosk PIN, each gated behind biometric-then-PIN re-verification.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/settings/AdvancedSection.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The PIN secret.** ``kioskPin.ts`` stores a salted SHA-256 of the PIN in secure
   storage and verifies against it; this is the single source of truth for whether a
   PIN is configured.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/kioskPin.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The lock-state store.** ``useKioskStore`` holds ``isLocked``, the failed-attempt
   count, and a cooldown timestamp. It is not persisted, so locking does not survive
   a restart.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/kioskStore.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Activating the lock.** ``useKioskLock`` is the shared logic behind the lock
   buttons: with no PIN it opens first-time setup, otherwise it locks and force-enables
   screen keep-awake (restoring the prior value on unlock).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useKioskLock.ts>`__
   · → :doc:`16-platform-surfaces`

#. **The trigger.** The sidebar lock button calls that hook to lock, or signals the
   overlay to begin unlock when already locked. The fullscreen montage controls
   expose the same button.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/SidebarContent.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **The gate.** ``KioskOverlay`` renders nothing until locked, then mounts a
   full-screen overlay that captures pointer events, swallows keyboard shortcuts, and
   blocks browser and Android hardware back. The live view keeps updating underneath.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/KioskOverlay.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Unlock: biometric first.** ``handleUnlockTap`` checks the cooldown, tries
   biometrics, and unlocks on success; if biometrics are unavailable or cancelled it
   falls through to the PIN pad.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/KioskOverlay.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **The native prompt and its web fallback.** ``useBiometricAuth`` dynamically
   imports the biometric plugin inside try/catch, so on web or desktop the import
   throws and the flow degrades to PIN. Cancelling routes to the PIN pad, not the OS
   passcode.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useBiometricAuth.ts>`__
   · → :doc:`16-platform-surfaces`

#. **PIN entry.** ``PinPad`` (in unlock mode) verifies the entry; a miss records a
   failed attempt and, after five, surfaces a 30-second cooldown. The same component
   serves first-time set and PIN change.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/PinPad.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Mount and restore.** ``AppLayout`` mounts the overlay and, on unlock, restores
   the pre-lock keep-awake state.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/AppLayout.tsx>`__
   · → :doc:`11-application-lifecycle`

Flow 14: Capturing a snapshot
-----------------------------

Saving a still of a live monitor. The source is whatever the tile is currently
showing: a WebRTC ``<video>`` is drawn to a canvas, while an MJPEG ``<img>`` is
either reused as-is or re-fetched as a single still. The save then splits by
platform, base64 on mobile and an anchor download on web.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Btn as Snapshot button
       participant Cap as downloadSnapshotFromElement
       participant ZM as ZoneMinder
       participant Save as Platform save

       Btn->>Cap: pass the live media element
       alt video element
           Cap->>Cap: draw current frame to canvas, toDataURL
       else img element
           Cap->>ZM: re-fetch as mode=single still (if not a data URL)
       end
       Cap->>Save: base64 on mobile / anchor on web
       Save-->>Btn: toast: saved

#. **The button.** ``handleDownloadSnapshot`` on a monitor card reads the live media
   ref and shows a success or failure toast; ``MonitorDetail`` has the same button.
   Snapshots show a toast and are not tracked as background tasks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MonitorCard.tsx>`__
   · → :doc:`05-component-architecture`

#. **What the ref points at.** ``LiveMonitorPlayer`` syncs the external media ref to
   the ``<img>`` for MJPEG or the ``<video>`` for WebRTC, and the capture step
   branches on that element type.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

#. **Capture dispatch.** ``downloadSnapshotFromElement`` builds a timestamped
   filename, then for a ``<video>`` draws the current frame to a canvas and reads a
   JPEG data URL; for an ``<img>`` it reuses a data URL or sends the stream URL on to
   be re-fetched.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Rewriting a stream to one frame.** ``convertToSnapshotUrl`` unwraps any image
   proxy, then sets ``mode=single`` and strips the streaming params so ZoneMinder
   returns a single still instead of a live multipart stream. What happens when a
   stream URL reaches the downloader unrewritten is covered in
   :doc:`12-shared-services-and-components`.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Data-URL dispatch.** ``downloadSnapshot`` builds the ``.jpg`` filename and picks
   the platform-specific data-URL handler, or falls back to fetching a converted
   still.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Mobile save (no Blob).** ``downloadDataUrlNative`` splits the base64 off the data
   URL and writes it straight to Documents via Capacitor Filesystem, then adds it to
   the photo library.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Web save.** ``downloadFromDataUrlWeb`` creates a temporary ``<a download>`` with
   the data URL as its href, clicks it, and removes it, triggering the browser's
   native download.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The MJPEG-still fetch path.** When an ``<img>`` carries a stream URL rather than a
   data URL, the same ``downloadFile`` split from Flow 10 fetches the ``mode=single``
   still: base64 on mobile, Blob on web.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts>`__
   · → :doc:`07-api-and-data-fetching`

Flow 15: Changing the ZoneMinder run state
------------------------------------------

This flow changes state on the server. ZoneMinder run
states are named sets of monitor capture functions: the server ships one,
``default``, and users add their own, commonly a Home and an Away. Picking one
on the Server page is how you arm or disarm the system from the app. Once
the POST succeeds, the app never touches the cached state list. It invalidates
the key and lets the query fetch the answer back, because the server decides
what a state change actually did. The app could not patch the list for every
action anyway: the same control also sends ``start``, ``stop`` and ``restart``,
which are not states at all.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as Server page
       participant Mut as changeStateMutation
       participant API as api/states.ts
       participant ZM as ZoneMinder
       participant Cache as Query cache

       Page->>ZM: GET /states.json (the states query)
       ZM-->>Page: states, one flagged IsActive
       Page->>Page: effect seeds selectedAction from activeState
       User->>Mut: Apply, mutate(selectedAction)
       Mut->>API: changeState(stateName)
       API->>ZM: POST /states/change/{name}.json
       ZM-->>API: 200, no useful body
       Note over Mut,Cache: on success: invalidate the key, never patch it
       Mut->>Cache: invalidateQueries(queryKeys.states(profileId))
       Cache->>ZM: the mounted states query refetches
       ZM-->>Page: new IsActive, the badge re-renders

#. **Getting to the control.** The sidebar's Server entry routes to ``/server``
   and renders ``pages/Server.tsx``. The run-state control is the last card on
   that page, "ZoneMinder Control"; everything above it is read-only health and
   storage reporting.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/SidebarContent.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The state list arrives first, with no error wall and no polling.** ``pages/Server.tsx`` runs a
   ``useQuery`` keyed by ``queryKeys.states(currentProfile?.id)``, gated on
   ``!!currentProfile && isAuthenticated``. It destructures no ``error``, so this
   query has no error wall, and sets no ``refetchInterval``, so it never polls. A failed fetch leaves the Current State badge reading
   ``common.unknown`` and the dropdown holding only the three literal actions
   from step 4.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **The active state is derived, then copied into local state.** ``activeState``
   is ``states?.find((s) => s.IsActive === '1')``, recomputed on every
   render. An effect then seeds ``selectedAction`` from it. An effect runs *after*
   the render that scheduled it, so the dropdown paints empty for one frame and
   fills on the next; the ``&& !selectedAction`` half of the guard is what stops
   that effect from later stomping on a choice the user made by hand.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`02-react-fundamentals`

#. **The dropdown mixes two unlike things.** ``Select`` (``server-state-select``)
   lists three hardcoded ``SelectItem`` values, ``start``, ``stop`` and
   ``restart``, and then maps one item per fetched state, badging whichever is
   active. Both kinds collapse to the same ``selectedAction`` string, and both
   travel the identical write path below. ZoneMinder's endpoint accepts the daemon
   verbs in the slot where a state name goes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`05-component-architecture`

#. **Apply is the only trigger.** The ``server-apply-button`` calls
   ``handleApply``, which fires ``changeStateMutation.mutate(selectedAction)``.
   The button disables itself on ``!selectedAction || changeStateMutation.isPending``
   and swaps its icon for a spinner. There is no confirm dialog, and the UI never
   flips optimistically: the badge above it stays on the old state until the
   server has been re-asked.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`05-component-architecture`

#. **What a mutation is.** ``useMutation`` is React Query's wrapper for a write.
   Unlike a query it is never cached, never refetched, and never fires on its own:
   you call ``mutate()`` and it runs ``mutationFn`` once. What it hands back is
   lifecycle, ``isPending`` while the request is open plus ``onSuccess`` and
   ``onError`` callbacks, which is the surface step 5's button binds to.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **The API call is one line.** ``changeState`` logs the intent and POSTs to
   ``/states/change/{stateName}.json`` with no body. Unlike ``getStates``
   directly above it, it skips schema validation: no ``validateApiResponse``, no
   Zod schema. The
   response carries nothing worth parsing, so the only signal is the HTTP status.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/states.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The write rides the same client as every read.** ``client.post`` is a thin
   alias for the shared ``request()`` in ``api/client.ts``, so this POST inherits
   the auth gate, the just-in-time token refresh, and the single 401 recovery
   retry that Flow 6 traces. A token that lapsed while the Server page sat open
   therefore refreshes and re-sends the POST rather than failing the state change.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A failed write is never retried.** ``App.tsx`` passes ``retry:
   shouldRetryQuery`` under ``defaultOptions.queries`` and gives ``mutations`` no
   entry at all, so mutations fall back to React Query's default of zero retries.
   A retried GET only reads the data again, but silently re-issuing ``restart``
   would bounce a server the user already watched fail to bounce.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **Success invalidates the key rather than editing the cache.** ``onSuccess``
   toasts, then calls
   ``queryClient.invalidateQueries({ queryKey: queryKeys.states(currentProfile?.id) })``.
   Writing ``IsActive: '1'`` into the cached array by hand would be faster but
   could be wrong. ZoneMinder may normalize the name or refuse the change, and
   when the user picked ``start`` there is no matching entry in that array to
   patch at all, because the daemon verbs are not states.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **The invalidated key comes from the factory.** ``queryKeys.states`` returns
   ``['states', profileId]``, the same array the query in step 2 was keyed with.
   Invalidation matches by key prefix, so this reaches that entry and any future
   longer key under it. The Server queries contract forbids writing the array
   inline here: an invalidator that spells its own key drifts away from
   the query that reads it, and the symptom is a page that silently stops
   updating. The ``profileId`` is a branded ``ProfileId``, minted once by
   ``asProfileId`` when ``addProfile`` generates the UUID back in Flow 4, and it
   is what keeps one profile's states out of another's cache.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/query/query-keys.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The refetch is the only thing that can update the badge.** Invalidating marks
   the entry stale and immediately refetches it if a mounted component is still
   observing it, and the states query from step 2 is. That query has no
   ``refetchInterval``, so without this invalidation the Current State badge would
   keep showing the old state until the page remounted. The 15-second
   ``staleTime`` from Flow 2 does not hold the refetch back either, because
   invalidation refetches regardless of ``staleTime``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`02-react-fundamentals`

#. **The user hears about it through a toast.** ``onSuccess`` and ``onError`` raise
   ``toast({ title, description })`` from ``hooks/use-toast``, the error variant
   being ``destructive``, and each writes a ``log.server`` line. The page stays
   open.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx>`__
   · → :doc:`05-component-architecture`

The Server page holds the app's only ``useMutation`` and its only write to the
ZoneMinder run state; other writes (PTZ, event delete, push registration) go
through plain handlers, not mutations.

Flow 16: Editing and deleting a server profile
-----------------------------------------------

Flow 4 added a profile on a screen of its own. Editing and deleting are two
dialogs on the profile list, in different code. Opening the edit dialog decrypts the saved
password and puts the plaintext into a form field, the exact inverse of "the
password goes to secure storage, never to Zustand". And neither ``updateProfile``
nor ``deleteProfile`` logs out, clears the query cache, or quits a running
stream, all of which ``switchProfile`` does. The clean state comes from a
``window.location.reload()`` in the page, not from the store.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as Profiles page
       participant Store as Profile store
       participant Sec as Secure storage
       participant Client as API client

       User->>Page: tap Edit
       Page->>Store: getDecryptedPassword(id)
       Store->>Sec: getSecureValue("password_<id>")
       Sec-->>Page: plaintext, straight into a form field
       User->>Page: Save
       Page->>Store: updateProfile(id, updates)
       Store->>Sec: savePassword, state keeps the "stored-securely" sentinel
       Store->>Client: rebuild, but only if this is the current profile
       Note over Page,Client: No logout, no cache clear, no stream teardown here.
       Page->>Page: window.location.reload() if the edited profile was current
       User->>Page: tap Delete
       Page->>Store: deleteProfile(id)
       Store->>Sec: removeSecureValue, then auto-select profiles[0]
       Page->>Page: reload, or navigate to /profiles/new if none are left

#. **Both verbs live on the list page.** ``pages/Profiles.tsx`` renders the saved
   profiles and owns an edit dialog and a delete confirmation dialog. Adding is
   the odd one out: the Add button navigates to ``/profiles/new`` and hands off to
   ``ProfileForm``, which is why Flow 4 traces a different file. Discovery, the
   trust-on-first-use dialog and the confirming login all belong to that other
   screen, so an edit never re-probes the server the way an add does.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Opening the edit dialog decrypts the password.** ``handleOpenEditDialog``
   sees the persisted ``profile.password`` holding the sentinel string
   ``'stored-securely'``, reaches for ``getDecryptedPassword`` and awaits the real
   secret, then drops the plaintext into ``formData.password``. For as long as the
   dialog is open, the password lives in ordinary React component state, because
   the field has to show a value the user can edit and the store cannot supply one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The store is read, not subscribed to.** That handler calls
   ``useProfileStore.getState().getDecryptedPassword`` rather than pulling the
   function out of the hook at the top of the component. ``getState()`` reads
   Zustand once with no subscription, so the dialog does not re-render every time
   any other field of the profile store changes. Using the hook here would buy a
   reactive binding for a function that never changes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The password is read from secure storage.** ``getDecryptedPassword`` delegates to
   ``ProfileService.getPassword``, which reads ``getSecureValue('password_<id>')``.
   On iOS and Android that resolves to the Keychain or Keystore. On web and
   Electron it is AES-GCM ciphertext in local storage, with the key material
   sitting in local storage beside it, which ``lib/security/crypto.ts`` states
   plainly is obfuscation and not confidentiality against anyone who can read the
   store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The self-signed toggle is not part of the profile.** The dialog seeds it
   from ``useSettingsStore.getState().getProfileSettings(profile.id)``, because SSL
   trust is a profile-scoped setting, not a field on the ``Profile`` object. Saving
   writes it back through ``updateProfileSettings``. Anything you add to this
   dialog has to pick one of these two homes on purpose.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`03-state-management-zustand`

#. **Saving applies trust before it probes.** ``handleUpdateProfile`` validates
   that username and password are both present or both absent, awaits
   ``applyTrustedCertificates`` with the edited profile as the candidate, and only then runs
   ``discoverUrls`` for any API or CGI URL the user blanked out. If trust were
   applied after discovery, a self-signed host would fail the handshake and the
   probe would report the server as unreachable. This is the same ordering
   constraint as step 3 of Flow 4.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`13-network-endpoints`

#. **The store swaps the secret back out.** ``updateProfile`` writes any supplied
   password to secure storage with ``ProfileService.savePassword``, then replaces
   it with the ``'stored-securely'`` sentinel before the ``set()`` call. Zustand
   persists the whole profile state to local storage with no ``partialize``, so
   the sentinel is the only thing keeping the plaintext out of the persisted blob.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The client is rebuilt narrowly, and nothing else is torn down.** Still in
   ``updateProfile``, the client is re-created only when both conditions hold: the
   edited profile is the current one, and ``updates.apiUrl`` is present. No
   ``logout()``, no ``clearQueryCache()``, no ``quitAllActiveStreams()``, none of
   the six-step sequence ``switchProfile`` runs. Change a username here and the
   auth store still holds a token minted with the old one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`11-application-lifecycle`

#. **The reload is what re-authenticates.** Back in the page,
   ``handleUpdateProfile`` closes the dialog and, if the edited profile was the
   current one, calls ``window.location.reload()`` behind a 500ms timeout so the
   success toast is visible first. The reload restarts the app, which re-runs
   ``onRehydrateStorage`` and the whole of Flow 1, and that bootstrap is where the
   new credentials produce a new token. Editing a profile that is not current
   skips the reload entirely and touches nothing but the stored record.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`11-application-lifecycle`

#. **Before deleting, the page notes whether the profile is the current one.**
   ``handleDeleteProfile`` records ``isDeletingCurrent`` before awaiting
   ``deleteProfile``, because afterwards ``currentProfileId`` already points at a
   different profile. It then re-reads ``useProfileStore.getState().profiles``
   rather than trusting the ``profiles`` value captured by its closure: that value
   was frozen when the render that created this handler ran, and it still contains
   the profile just deleted.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`02-react-fundamentals`

#. **The store removes the password and the profile, then reselects if needed.** ``deleteProfile`` removes the
   password from secure storage, filters the profile out of the array, and, if the
   deleted profile was current, auto-selects ``profiles[0]`` and points the API
   client at its ``apiUrl``. The session belonging to the deleted server is still
   live in the auth store and its monitor list is still in the query cache.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The page then reloads, navigates away, or does nothing.** ``handleDeleteProfile`` ends in
   one of three ways. No profiles remain: navigate to ``/profiles/new``. The
   current profile was deleted and others remain: ``window.location.reload()``,
   which is the only thing that discards the dead session and cache for the
   auto-selected replacement. Some other profile was deleted: nothing happens
   beyond the list re-rendering.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Delete-all is the exception that calls the reset.**
   ``deleteAllProfiles`` loops ``deletePassword`` over every profile, empties the
   state, and is the only one of the three writes to call ``dropAllSessions()``,
   which clears the whole session registry and every profile's auth
   single-flight gates. Its caller navigates to ``/profiles/new``
   without a reload, since there is no server left to talk to.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`07-api-and-data-fetching`

Switching between two profiles that both exist is the third verb, and the only
one that does the teardown properly. Flow 1 ends by pointing at it.

Flow 17: Aiming a PTZ camera
----------------------------

Tapping a monitor opens ``/monitors/:id``, a live stream with a pan-tilt-zoom pad
under it. The
capabilities of the camera are not on the monitor record; they come from a second
query against a different endpoint that is gated on the first one's answer. And
the pad has two implementations of press-and-hold, chosen by what the camera's
ZoneMinder driver can do: continuous drivers get one start command and one stop
command, while relative and absolute drivers get the same step command re-fired
on a 400ms timer for as long as the button is held. Only the stop command halts the
camera, so the pad sends it on release and again if it unmounts mid-hold.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as MonitorDetail
       participant Pad as PTZControls
       participant URL as url-builder
       participant ZM as ZoneMinder

       Page->>ZM: GET /monitors/{id}.json
       ZM-->>Page: Monitor record, Controllable and ControlId
       Page->>ZM: GET /controls/{controlId}.json (only if both are set)
       ZM-->>Pad: driver capabilities: CanMoveCon, HasPresets, NumPresets
       User->>Pad: pointerdown on an arrow
       Note over Pad,ZM: The camera is moving now. Only moveStop ends it.
       Pad->>URL: onCommand("moveConUp")
       URL->>ZM: GET /index.php?request=control&control=moveConUp&xge=0&yge=0
       User->>Pad: pointerup, or the component unmounts
       Pad->>ZM: moveStop

#. **The route is lazy and guarded.** ``App.tsx`` declares ``/monitors/:id``
   pointing at a ``lazy()`` import of ``pages/MonitorDetail``, wrapped in a
   ``RouteErrorBoundary``. The id arrives through ``useParams``, which means the
   page has a monitor id and nothing else: every fact about the monitor has to be
   fetched.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The monitor record comes first, and it decides everything after it.** A
   ``useQuery`` on ``queryKeys.monitor(profileId, id)`` fetches
   ``/monitors/{id}.json`` through ``getMonitor``, validated against
   ``MonitorDataSchema``. The two fields that drive this flow are ``Controllable``,
   a string ``'1'`` or ``'0'``, and ``ControlId``, a pointer into a table the
   monitor record does not contain.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **Capabilities are a second query, gated on the first.** ``getControl`` hits
   ``/controls/{controlId}.json``, a different table with its own record. Its
   ``enabled`` gate is ``!!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1'``.
   A React Query with ``enabled: false`` does not run and stays in a pending state,
   which is what the first render needs: ``ControlId`` is
   ``undefined`` until the monitor lands, and firing ``/controls/undefined.json``
   would be a guaranteed 404 for every non-PTZ camera in the system.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx>`__
   · → :doc:`07-api-and-data-fetching`

#. **What the control record says.** ``ZMControlSchema`` coerces every field to a
   string, so a capability is the character ``'1'``, never a boolean. The ones the
   pad reads are ``CanMoveCon``, ``CanMoveRel``, ``CanMoveAbs``, ``CanMoveDiag``,
   ``CanZoomCon`` and ``CanZoomRel``, ``CanReset``, and ``HasPresets`` with
   ``NumPresets``. There is no field that says "this camera can pan", only fields
   that say how.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The stream ignores your snapshot setting.** ``LiveMonitorPlayer`` renders
   with ``forceViewMode="streaming"``, so the global Snapshot bandwidth mode that
   throttles the montage does not apply on this page: you opened one camera and you
   get a live feed. Its ``key={monitor.Monitor.Id}`` forces a full remount when the
   id changes, rather than letting a stream from the previous monitor limp along
   inside a reused component.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx>`__
   · → :doc:`05-component-architecture`

#. **The pad mounts when the monitor is controllable, then waits for the control record.**
   ``PTZControls`` renders when ``!isFullscreen && monitor.Monitor.Controllable === '1'``,
   and receives ``control={controlData?.control.Control}``, which is ``undefined``
   while the query from step 3 is still in flight. The component returns ``null``
   for that undefined case, so the panel appears one render after the monitor does.
   Fullscreen is CSS, not the browser Fullscreen API, and it hides the pad because
   there is nowhere to put it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx>`__
   · → :doc:`05-component-architecture`

#. **The driver picks the verb.** ``PTZControls`` computes
   ``movePrefix = canMoveCon ? 'moveCon' : (canMoveRel ? 'moveRel' : 'moveCon')``
   and appends a direction, producing ``moveConUp`` or ``moveRelUp``. Diagonal
   buttons are rendered but ``invisible`` without ``CanMoveDiag``, which keeps the
   3x3 grid from collapsing. Zoom does the same with ``zoomCon`` and ``zoomRel``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx>`__
   · → :doc:`05-component-architecture`

#. **Press and hold has two implementations.** ``moveRepeatMs`` is ``undefined``
   for a continuous driver and ``UI_INTERACTIONS.ptzHoldRepeatMs`` (400ms) for
   anything else. ``HoldButton`` fires the command once on ``pointerdown``, and if
   it was given a repeat interval it starts a ``setInterval`` re-firing that same
   command. ZoneMinder's protocol has no continuous verb on relative and absolute
   drivers, so a stream of discrete steps is the only way to get hold-to-move on
   them. On release, both paths send ``moveStop``: the continuous camera needs it,
   the stepping camera ignores it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx>`__
   · → :doc:`05-component-architecture`

#. **Unmounting while a button is held still sends the stop command.** ``pointerup`` never
   arrives if the panel collapses, the monitor changes, or the user leaves the
   page. A continuous camera would keep panning into its physical limit and the
   repeat timer would keep issuing requests from a dead component. ``HoldButton``
   therefore has an unmount cleanup effect that clears the timer and sends the stop
   command. It reads the handlers from a ``cleanupParamsRef`` refreshed on every
   render, because a cleanup function closes over the values from the render that
   created it, and a guard on ``activePointerRef`` makes the whole thing a no-op on
   the throwaway mount React StrictMode performs in development.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx>`__
   · → :doc:`02-react-fundamentals`

#. **Each press calls ``controlMonitor`` once and keeps no state.** Every button calls the ``onCommand``
   prop, which is ``handlePTZCommand`` from the ``usePTZControl`` hook. It calls
   ``controlMonitor`` and, on failure, shows a toast. There is no mutation, no
   optimistic update, no query invalidation and no read-back: the app never asks
   the camera where it ended up pointing, because the live stream already shows it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/hooks/usePTZControl.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The control endpoint is the classic web UI, not the API.**
   ``controlMonitor`` builds a URL against ``/index.php`` rather than
   ``/api/...``, runs it through ``wrapWithImageProxy``, and sends it with a
   ``Skip-Auth`` header. Skipping the auth gate is correct here because
   the access token is already baked into the query string by the URL builder, the
   same way the streaming URLs in Flow 2 carry theirs.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts>`__
   · → :doc:`13-network-endpoints`

#. **Two server quirks live in the URL builder.** ``getMonitorControlUrl`` matches
   ``presetGoto<N>`` and splits it into ``control=presetGoto`` plus ``preset=<N>``,
   the structured form ZoneMinder's Perl drivers read, so the client does not depend
   on a translation regex in the server's PHP surviving a refactor. It then attaches
   ``xge=0&yge=0`` only to commands matching an axis, mode and direction, such as
   ``moveConUp``. The server uses the presence of those two parameters to decide it
   is parsing a movement command; send them with ``moveStop`` or ``presetHome`` and
   it logs "Invalid control parameter" and does nothing.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts>`__
   · → :doc:`13-network-endpoints`

This page is the only place in the app that sends a control command. The PTZ badge
on ``MonitorCard`` reads the same ``Controllable`` field but only to tell you the
camera has a pad waiting for you here. The stream underneath the pad is Flow 2.

Flow 18: Seeing what happened while you were away
-------------------------------------------------

Each card on the Monitors page, and each tile on the Montage page, carries a
badge counting the events a monitor recorded since the user last opened it. The
count comes from one request per monitor, and that request answers two questions
at once: how many events are newer than the last-seen watermark, and what the
newest event's timestamp is. The first number fills the badge. The second is
stamped as the new watermark the moment the user opens that monitor's events,
read from the cached response, so the card never has to ask the server what it
already knows for the stamp. Stamping does change the query key, so React Query
refetches that one monitor's count once on the way out, and it comes back zero.
Tapping the badge opens the events list filtered to the new window, not the full
history. The watermark is a server ``StartDateTime`` stored per profile per
monitor on this device only. It does not sync across devices. A notification for
a monitor refreshes that monitor's badge within a second instead of waiting for
the next poll.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Grid as Monitors / Montage page
       participant Hook as useMonitorNewEvents
       participant Store as monitorSeen store
       participant API as getMonitorEventsSince
       participant ZM as ZoneMinder
       participant Notif as NotificationHandler

       Grid->>Hook: monitor ids from the monitors query
       Hook->>Store: read the watermark for each monitor
       Hook->>API: one query per monitor, since = watermark
       API->>ZM: GET /events/index/MonitorId/StartDateTime >:since (limit 1, desc)
       ZM-->>API: pagination.count and events[0] StartDateTime
       Note over Hook,Store: an unseeded monitor's first response seeds the store and reports 0
       Hook-->>Grid: counts and newest timestamps
       Grid->>User: blue badge on the Events button
       User->>Grid: taps Events (useOpenMonitorEvents)
       Grid->>Store: markSeen with the cached newest, then navigate to a date-filtered list
       Notif->>Hook: a notification invalidates that monitor's count, refetching before the 60s poll

#. **The monitors query supplies the ids, nothing more.** ``pages/Monitors.tsx``
   turns the fetched monitor list into a plain ``monitorIds`` array with a
   ``useMemo``, then hands it to ``useMonitorNewEvents``. The badge feature never
   fetches monitors of its own: it rides on the list the page already loaded, so a
   monitor the user has hidden is gone from this array before any count query is
   built.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Monitors.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The hook reads a watermark for each monitor from the store.**
   ``useMonitorNewEvents`` selects ``profileWatermarks`` from the ``monitorSeen``
   Zustand store and narrows it to the current profile with a ``useMemo``. The
   store is persisted under ``zmng-monitor-seen`` in local storage, so the
   watermark lives on this device and this browser only: open the same server on a
   second phone and its badges start from that phone's own blank slate.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorNewEvents.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **One query per monitor, not one query for all of them.** ``useMonitorNewEvents``
   builds a ``useQueries`` array, one entry per id, each calling
   ``getMonitorEventsSince(monitorId, since)`` on ``bandwidth.monitorNewEventsInterval``
   (60000 ms normal, 120000 ms low). A single request OR-ing every ``MonitorId``
   would starve: ZoneMinder ORs repeated ``MonitorId`` segments, so one busy camera
   would eat the whole page limit and every other monitor would read zero.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorNewEvents.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The filter operator is strict ``>``, not ``>=``.** ``getMonitorEventsSince``
   builds ``/events/index/MonitorId:<id>/StartDateTime >:<since>.json``. The
   operator was checked against ZoneMinder 1.39.1: ``>=`` matches the watermark
   event itself, so a monitor the user had fully caught up on would show a
   permanent "1 new" for the event whose timestamp is the watermark. A ``since`` of
   ``null`` means no watermark yet, and the ``StartDateTime`` segment is dropped so
   every event counts.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/events.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **One response answers both questions.** The request asks for ``limit=1``,
   ``sort=StartDateTime``, ``direction=desc``. ``getMonitorEventsSince`` reads the
   full match size from ``response.data.pagination.count`` and the newest timestamp
   from ``response.data.events[0].Event.StartDateTime``, returning
   ``{ count, newest }``. Counting with a separate request from fetching the newest
   row would double the request load for a number the first response already
   carried.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/events.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Seeding happens in an effect, and reports zero for the monitor it seeds.**
   The hook seeds an unseen monitor from its first response inside a ``useEffect``,
   then reports its count as 0 for that render. It is an effect and not part of
   render because seeding writes to the store, and a store write during render
   would update every component subscribed to that store while React is still
   rendering, which React warns against. It reports 0 because the same
   response that seeds a fresh install would otherwise show the
   monitor's entire history as new.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorNewEvents.ts>`__
   · → :doc:`02-react-fundamentals`

#. **The badge renders only for a positive, resolved count.** ``MonitorCard``
   renders the ``monitor-new-events-badge`` when
   ``newEventCount !== undefined && newEventCount > 0``, formatting the number with
   ``formatEventCount``. ``counts[id]`` is absent until the query resolves, so the
   ``undefined`` guard keeps a zero-width flicker off the button between mount and
   first response, distinct from a resolved count of 0 that means "nothing new".
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MonitorCard.tsx>`__
   · → :doc:`05-component-architecture`

#. **Opening the events stamps the watermark and filters the list to the new window.**
   Both cards call the shared ``useOpenMonitorEvents`` hook. It reads the watermark
   that was in effect before this click, calls
   ``markSeen(profileId, monitorId, newestEventAt)``, then navigates to
   ``/events?monitorId=<id>``. When the badge counted something (``newEventCount > 0``
   and the old watermark is non-null) it adds a ``startDateTime`` param set to
   ``nextSecondAfter(watermark)``, so the list opens on exactly the events the badge
   promised; a quiet or never-seeded monitor navigates with no date param.
   ``nextSecondAfter`` adds one second because the list filters with ``>=`` while the
   badge counted with ``>``, so without it the already-seen boundary event would
   reappear. Reading ``newestEventAt`` needs no request (it is the ``newest`` value
   the hook already returned), but stamping the new watermark changes the query key
   and does cost exactly one refetch of that monitor's count, the next step.
   ``markSeen`` with a ``null`` newest is a no-op, so opening a monitor that has never
   recorded an event does not overwrite a real watermark with nothing.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useOpenMonitorEvents.ts>`__
   · → :doc:`05-component-architecture`

#. **The montage tiles carry the same badge and the same click.** ``pages/Montage.tsx``
   calls ``useMonitorNewEvents`` once at page level and passes ``newEventCount`` and
   ``newestEventAt`` to each ``MontageMonitor``, the same way ``pages/Monitors.tsx`` does.
   The tile renders the same blue ``montage-new-events-badge`` and its Events button
   runs the same ``useOpenMonitorEvents`` hook with ``from: '/montage'``. The tile's
   red alarm pulse is a separate signal, driven by the notification store. Only the counted number is shared with ``MonitorCard``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MontageMonitor.tsx>`__
   · → :doc:`05-component-architecture`

#. **The detail page clears the badge only when the list was actually shown.**
   ``MonitorRecentEvents`` runs an effect that calls ``markSeen`` with the newest
   listed event, but only when ``!hidden && !isLoading && events.length > 0``.
   Collapsed means the user opened the page for the live stream and never saw the
   list, so stamping then would clear a badge for events the user did not look at.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MonitorRecentEvents.tsx>`__
   · → :doc:`05-component-architecture`

#. **The watermark sits inside the query key, so clearing invalidates one monitor.**
   ``queryKeys.monitorEventsSince(profileId, monitorId, since)`` puts the watermark
   in the key. When ``markSeen`` writes a new watermark, that monitor's ``since``
   changes, so its query key changes and React Query fetches the new key while
   leaving every other monitor's cached count untouched. This is also why a
   freshly-seeded monitor issues two requests: once with ``since=null``, then again
   once the seed lands and the key carries the real watermark.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/query/query-keys.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A notification refreshes one monitor's badge before the next poll.**
   ``useNotificationBadgeNudge``, called from ``NotificationHandler``, watches the
   notification store. When a new ``events[0].EventId`` arrives it invalidates
   ``queryKeys.monitorEventsSinceMonitor(profileId, String(events[0].MonitorId))``,
   the 3-element prefix of the 4-element ``monitorEventsSince`` key, so that monitor's
   count refetches whatever its watermark, within a second instead of at the 60000 ms
   poll. It seeds its last-seen id on first run and re-seeds on profile change, so
   mounting with a backlog does not fire a burst of invalidations. It moves the badge
   only while the Monitors or Montage page holds the query; otherwise the next mount
   refetches anyway.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationBadgeNudge.ts>`__
   · → :doc:`07-api-and-data-fetching`

The badge decorates the Events button, and tapping that button lands the user in
Flow 5 filtered to the new window. The polling cadence that keeps the count
current is Flow 11.

Flow 19: Asking the assistant a question
-----------------------------------------

Pressing ``?`` (or picking the Ask command in the palette) opens a floating
chat window backed by one of five providers: an on-device WebLLM model, the
on-device native llama.cpp bridge (iPhone and iPad, refs #270), Apple's
OS-hosted Foundation Models system model (iOS 26, refs #270), Android's Gemini
Nano over AICore (refs #270), or an OpenAI-compatible server such as Ollama.
The question is classified before any tool is offered, then a tool-use loop
decides which ZoneMinder API calls answer it. Every tool the loop can reach
is read-only (``TOOLS`` holds no mutating tool and ``ToolDefinition`` cannot
express one), so no step in this flow asks for confirmation.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Key as Ask entry point
       participant Panel as AskPanel
       participant Triage as classifyRequest
       participant Agent as runAssistantTurn
       participant Prov as AssistantProvider
       participant Tool as Tool executor
       participant ZM as ZoneMinder

       Key->>Panel: open(), widget renders AskPanel
       Panel->>Triage: provider.complete(TRIAGE_PROMPT, TRIAGE_SCHEMA)
       Triage-->>Panel: zoneminder / chat / action (advisory)
       Panel->>Agent: runAssistantTurn(history, system, tools)
       Agent->>Prov: provider.chat (constrained JSON or native tools)
       Prov-->>Agent: AssistantTurn (toolCalls or text)
       Agent->>Agent: gates: availability, repeat, mismatch, schema
       Agent->>Tool: execute(input) via captureApiCalls
       Tool->>ZM: api/* request
       ZM-->>Tool: rows
       Agent->>Agent: grounding and live-data checks
       Agent-->>Panel: this turn's messages
       Panel->>Panel: render, append context boundary if nearly full

#. **The `?` key opens the assistant window.** ``components/KeyboardShortcuts.tsx``'s
   ``onKeyDown`` treats ``?`` as dual-purpose: when the assistant is enabled
   (``settings.assistantEnabled``) it calls ``useAssistantPanelStore``'s
   ``open()`` instead of showing the shortcuts help overlay. The command
   palette's Ask item (``components/CommandPalette.tsx``) is the second entry
   point, same store call. This branch has to be checked first: everything
   after it assumes the assistant, not the help overlay.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/KeyboardShortcuts.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **One widget owns the window states.** ``AssistantWidget``
   (``components/assistant/AssistantWidget.tsx``) switches on
   ``useAssistantPanelStore``'s ``state``: nothing when closed, a floating
   button when minimized, the conversation shell when open. The shell is the
   resizable desktop card or the mobile bottom sheet, chosen by viewport, and
   both embed the same ``AskPanel``. It stays mounted (hidden) while
   minimized, so the conversation and any in-flight turn survive collapsing
   to the button.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/assistant/AssistantWidget.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Sending a message assembles the turn's context.** ``AskPanel``'s
   ``handleSend`` appends the user's text to the per-profile thread, reads the
   optional Bearer key from secure storage, and hands a ``ProviderConfig`` to
   ``getAssistantProvider`` (``lib/assistant/providers/provider.ts``), which
   returns the provider for the configured backend: ``WebLlmProvider``,
   ``NativeLlmProvider``, ``AppleIntelligenceProvider``, ``GeminiNanoProvider``,
   or ``OpenAiProvider`` for Ollama.
   ``buildSystemPrompt`` (``system-prompt.ts``) folds in the profile timezone,
   locale, ZM version, and the install's own detected-object labels. The
   monitor list is not copied into every prompt because ``list_monitors``
   resolves names when needed; what does run up front is
   ``scanMonitorMentions`` (``monitor-stage.ts``), a deterministic pass that
   matches monitor names against the cached per-profile roster
   (``getMonitorRoster``) two ways: the whole name as a substring on the same
   normalized key ``resolveMonitorRef`` uses for model-supplied names, or
   every token of the name present among the question's words, so "front of
   my door" still finds "FrontDoor" with words intervening (refs #430).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/assistant/AskPanel.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **One routing call returns four verdicts.** ``classifyRequest``
   (``triage.ts``) runs ``provider.complete`` under a constrained schema and
   decides, in one round: ``continues`` (does the latest message lean on the
   earlier exchange; decoded first, and the only thing that lets any
   context reach the later calls, refs #446), ``kind``
   (ZONEMINDER/ACTION/CHAT; advisory: a chat or action verdict runs the
   turn with ``tools: []`` and ``buildNoToolPrompt``, and the loop fails
   open if the model then insists on a real read tool), ``subject``
   (events/monitors/server/groups/other), and ``objects`` (an array over
   the install's recorded labels, so "folks" or "Leute" land on ``person``
   in any language; selecting the whole vocabulary derives no filter, since
   that is what the model did live on a general "how busy..." question, refs
   #436). A status question about a period with no other topic
   defaults to the system, and a CHAT verdict contradicting its own subject
   is flipped to the data lane in code: the tool-less lane fabricates when
   handed a real question. Context is structured (``prevTurnFromThread`` +
   ``buildContextualQuestion``, ``parse-context.ts``): the previous user
   question, the slots that turn resolved, and the assistant's closing
   offer only when it asked something, never answer prose, which the model
   mined for "truck", "Front Yard", and "today" across three live
   transcripts. A continuation answer renders a subdued status line in the
   panel; a fresh topic renders nothing.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/triage.ts>`__
   · → :doc:`15-assistant`

#. **A separate, focused call resolves places into monitor groups.**
   ``resolveCoverage`` (``monitor-stage.ts``) runs only when the
   deterministic name scan found nothing, and asks one thing: which monitors
   the message's places mean. It returns groups ("the front vs the back"
   is one monitor set per side, refs #446), because judged inside the
   consolidated parse this failed live twice and every rewording rotated
   the failures, while the focused call measured 8/8 on the same
   cases. ``deriveMonitorGroups`` keeps every guard in code, per group:
   names filtered to the roster, the covered/named contradiction and
   whole-roster selections drop the group, a time-word place is no place,
   and a failed call degrades to an unpinned turn.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/monitor-stage.ts>`__
   · → :doc:`15-assistant`

#. **One call turns every period in the question into structured windows.**
   ``resolveTimeframesFromQuestion`` (``timeframe-stage.ts``) asks the model
   to express every period the question means as structured windows in the
   interpreter's own branch shapes, describing what each period means
   rather than quoting the user's words. Nothing is copied, so
   the copy-truncation class ("same day, last week" -> "last week") cannot
   occur, and a comparison of two periods emits one window each
   (refs #444). Code resolves every window through ``parseFields`` +
   ``resolveWindow``, dedupes identical ranges, and seeds the interpreter
   cache under each window's meaning label, so the tool round re-interprets
   nothing. The rolling branch is offered only when the question shows a
   rolling marker, and a multi-group (place) comparison skips the model
   entirely when the deterministic scan can time the question: the windows
   model emits one window per compared place under every wording measured
   (refs #446). The deterministic scan (``scanTimeExpressions``) is also
   the fallback for any failure, and
   the same path runs on every backend.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/timeframe-stage.ts>`__
   · → :doc:`15-assistant`

#. **Code composes the planned tool calls.** ``planToolCalls``
   (``plan.ts``) fans one ``list_events`` per window x group x monitor with
   the parsed ``objectType``, capped at ``ASSISTANT.maxPlannedToolCalls``;
   server/monitors/groups subjects map to their read tools. A null plan
   (unknown subject, no roster, group mode, test mode) falls back to the
   free tool loop. Planned calls execute through the loop's own
   ``runOneCall`` machinery before the first model round, and same-window
   results merge per place group in code (``mergePlannedEventResultsByGroup``:
   summed counts, recomputed busiest hour, one summary sentence, the group
   label stamped as ``place``), so cross-monitor totals are never the
   model's arithmetic and a comparison keeps its sides (refs #436, #446).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/plan.ts>`__
   · → :doc:`15-assistant`

#. **The tool-use loop.** ``runAssistantTurn`` (``lib/assistant/agent.ts``)
   slices the history at the last context boundary, trims it to the message,
   character, and turn budgets (``truncateHistory``), executes any
   ``plannedCalls`` from the parse first (through the same ``runOneCall``
   machinery as model-initiated calls, so validation, trace, and result
   cards are identical, and the model's first round opens on the data), and
   then calls
   ``provider.chat(history, tools, system, signal)`` in a loop capped at
   ``ASSISTANT.maxToolIterations`` (6); hitting the cap ends the turn with the
   ``__i18n:assistant.iteration_cap_reached`` sentinel instead of a real
   reply.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/agent.ts>`__
   · → :doc:`15-assistant`

#. **The on-device provider constrains generation to the envelope.**
   ``WebLlmProvider.chat`` never uses WebLLM's native function calling: every
   reply must be one of two JSON shapes, ``{"tool": ..., "input": ...}`` or
   ``{"answer": ...}``, and generation is constrained to exactly those via
   ``response_format: { type: 'json_object', schema }`` with the
   ``ENVELOPE_SCHEMA`` string, so the sampler cannot produce prose around the
   JSON. If the engine's grammar compiler rejects the request once,
   ``grammarUsable`` flips false for the session, and from then on the
   prompt and the parser alone enforce the reply shape. The abort signal is wired to
   ``engine.interruptGenerate()``, the only way to actually stop an in-flight
   on-device generation.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/webllm.ts>`__
   · → :doc:`15-assistant`

#. **The native backend's settings gate is a device probe, not a toggle.**
   ``useNativeLlmSupported`` (``hooks/useNativeLlmSupported.ts``) probes the
   Capacitor ``NativeLlm`` plugin's ``isSupported()`` once on mount, behind
   ``Platform.isNative`` (the Native contract: the plugin ships native
   implementations only). On iOS, ``LlamaPlugin.isSupported`` answers ``false``
   below a 5.5GiB physical-memory floor (``LlamaPlugin.swift``), and a device
   that fails never sees **On-device (Download model)** in ``AssistantSection``'s
   backend ``<select>`` at all, rather than a disabled option to interpret.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNativeLlmSupported.ts>`__
   · → :doc:`15-assistant`

#. **Android is gated separately, and its "not ready" is fixable in place.**
   That hook short-circuits to ``false`` off iOS: the llama.cpp bridge was
   removed from the Android build (issue #270), where it had no GPU path,
   decoded at ~6.6 tok/s, and cost 76MB of
   native libraries plus a 2.5GB model download. Android's on-device backend is
   Gemini Nano, whose replies take about 1.5s, probed by ``useGeminiNanoSupported``. ``GeminiNanoPlugin``
   reports ``platform`` below API 26 (ML Kit GenAI's floor) and ``notReady``
   while AICore still has the weights to fetch, which renders
   ``AssistantGeminiNanoSection``'s download row so the hook's ``refresh`` can
   re-probe once they land, without an app restart.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useGeminiNanoSupported.ts>`__
   · → :doc:`15-assistant`

#. **Apple Intelligence is a third, independent probe.**
   ``useAppleIntelligenceSupported`` calls the ``AppleIntelligence`` plugin's
   ``isSupported()`` the same way: ``AssistantSection`` shows the **On-device
   (Apple Intelligence)** option only when it resolves supported, and a "turn it
   on in iOS Settings" hint only when the reason is ``disabled``, never for
   ``platform`` (ineligible device or pre-iOS-26) or ``notReady`` (still
   provisioning). The three gates are independent, so a phone can qualify for
   one and not the others. Whichever passes, ``settings.assistantBackend``
   decides: ``getAssistantProvider`` (``providers/provider.ts``) returns the
   matching provider in place of ``WebLlmProvider`` or ``OpenAiProvider``, the
   same one-field switch every backend goes through.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useAppleIntelligenceSupported.ts>`__
   · → :doc:`15-assistant`

#. **The native provider reuses WebLLM's prompt and parser.** Only the
   transport is native: ``NativeLlmProvider.chat`` (``providers/native-llm.ts``)
   builds the turn's messages with the same ``buildWebLlmMessages`` WebLLM
   uses (tool catalog, few-shot, ``OUTPUT_CONTRACT``, ``/no_think`` for the
   reasoning family) and parses the reply with the same ``parseWebLlmTurn``,
   imported straight from ``providers/webllm.ts`` rather than reimplemented;
   the module's own header states that only the transport differs from
   WebLLM. Each call crosses the Capacitor bridge as one ``NativeLlm.chat()``
   invocation carrying the JSON message array, temperature, and context size.
   ``NativeLlmProvider`` has no platform branch of its own; only iOS registers a
   plugin that answers the call. Swift's ``LlamaPlugin`` hands the request to
   ``LlamaEngine``, a llama.cpp context loaded with ``n_gpu_layers`` set high
   enough to run on Metal on a real device (0 in the simulator, where Metal
   is unavailable). The Android build has no llama.cpp integration
   (issue #270). The engine renders the messages through
   the model's own built-in chat template (``llama_model_chat_template``) rather
   than a template the app supplies, and returns one
   ``{content, promptTokens, completionTokens}``
   reply with no streaming. An unparseable reply retries through the same
   self-repair loop (``SELF_REPAIR_PROMPT``, ``ASSISTANT.maxParseAttempts``)
   that ``WebLlmProvider`` and ``GeminiNanoProvider`` use, because ``parseWebLlmTurn`` and the retry
   shape are shared code. The model itself and
   the engine it runs on are both pinned, not chosen at runtime:
   ``ASSISTANT.nativeLlmModel`` (``lib/zmninja-ng-constants.ts``) names
   Qwen3-4B-Instruct-2507 at a Q4_K_M GGUF quantization from unsloth's
   HuggingFace repo, and the llama.cpp release it runs on is pinned in the
   platform build files, covered in :doc:`15-assistant`.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/native-llm.ts>`__
   · → :doc:`15-assistant`

#. **The Apple Intelligence provider lets Foundation Models run the tool loop
   itself.** For the ``'apple'`` backend ``AppleIntelligenceProvider.chat``
   (``providers/apple-intelligence.ts``) assembles the messages with
   ``buildWebLlmMessages``, but around instructions it composes itself
   (``buildAppleInstructions``: the persona, the caller's dynamic facts, the
   tool-less policy text triage appended, and the behavioural rules), never the
   shared prompt with its tool catalog, few-shot block and ``OUTPUT_CONTRACT``.
   A turn that has tools crosses into the framework rather than staying in JS:
   the tool schemas cross the bridge as ``plugin.chat({messagesJson, temperature, maxTokens, toolsJson})``,
   ``AppleIntelligencePlugin.swift`` (iOS only) registers them as Foundation
   Models tools on the ``LanguageModelSession``, and the framework decides and
   sequences the calls itself. Each call comes back to JS as a ``toolCall``
   plugin event, the provider runs it through the ``runTool`` callback
   ``runAssistantTurn`` handed to ``chat`` (so the duplicate-call guard,
   argument repair, schema validation, activity steps and trace entries are the
   agent's own, shared with every other backend), and answers the waiting
   session with ``plugin.resolveToolCall({callId, output})``; a failed tool
   resolves with its error text, which is what the model has to read to correct
   itself. The chat promise then resolves with the finished prose rather than
   another tool call, and the provider returns it with ``nativeToolResults``
   set, which tells ``runAssistantTurn`` the turn is already finished. A tool-less turn (triage said chat or action) instead
   takes the guided fallback path: ``schemaJson`` constrains the reply to the
   answer-only shape, ``parseWebLlmTurn`` reads it, and an empty or unusable
   reply retries with ``APPLE_RETRY_PROMPT`` (never WebLLM's contract-restating
   ``SELF_REPAIR_PROMPT``, which would teach a format guided generation already
   enforces). The abort signal is wired to the plugin's ``cancelChat()`` on both
   paths. Because the OS owns the model, this path drops
   what the native llama.cpp path carries.
   There is no download or model file, the model is fixed
   (``ASSISTANT.appleIntelligenceModelId``, not user-chosen), and an OS build
   that reports no token counts leaves ``turn.usage`` on the provider's own
   characters-over-3.5 estimate, so auto-clear can still act before the small
   window overflows. Its
   ``contextWindow`` is learned instead from ``isSupported().contextSize`` (4096)
   on the first native call of the turn. Rejections
   map on the plugin's stable ``code`` the same way the native provider's do:
   ``CHAT_BUSY`` to ``__i18n:assistant.native_busy`` and anything else to
   ``__i18n:assistant.native_engine_failed`` (both strings shared, both being
   on-device engines), never the Swift ``localizedDescription``, which is only
   logged.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/apple-intelligence.ts>`__
   · → :doc:`15-assistant`

#. **A stable error code decides how a native failure surfaces.**
   ``LlamaPlugin.chat`` (Swift) rejects with a fixed set of codes (``MODEL_NOT_DOWNLOADED``,
   ``CHAT_BUSY``, or ``ENGINE_FAILED`` for anything else), which Capacitor
   copies onto the JS exception untouched. ``NativeLlmProvider.mapPluginError`` (``providers/native-llm.ts``)
   switches on that code, never on the platform's own localized message: a
   missing model maps to the same ``NATIVE_LLM_NOT_AVAILABLE_MESSAGE`` the
   off-platform case throws, so ``AskPanel``'s existing "not configured, go
   to Settings" prompt covers it with no separate UI path, while
   ``CHAT_BUSY`` and ``ENGINE_FAILED`` (or no code at all) become
   ``__i18n:assistant.native_busy`` and ``__i18n:assistant.native_engine_failed``,
   sentinel strings ``AskPanel`` already renders through ``t()`` (see the
   render-the-reply step below) rather than as literal text. The native-side
   reason (Swift's ``localizedDescription``) is logged, never shown, since it
   is not translated. ``CHAT_BUSY`` also
   guards ``deleteModel`` and ``unload``, not just ``chat``: freeing the loaded model out from under an in-flight generation
   is a use-after-free, so both reject with ``CHAT_BUSY`` while a reply is
   still generating instead of tearing down the model underneath it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/native-llm.ts>`__
   · → :doc:`15-assistant`

#. **A download failure carries its native reason into the settings toast.**
   Unlike a chat failure, a download failure is not coded: Swift's
   ``URLSessionDownloadDelegate`` rejects with ``DOWNLOAD_FAILED`` and
   ``URLSession``'s own OS-localized error text. ``downloadNativeModel``
   (``lib/assistant/native-model-download.ts``) fails the
   ``backgroundTasks`` task with that error, and ``AssistantNativeSection``
   reads ``downloadTask.error.message`` straight into
   ``settings.assistant.download_failed_reason``, falling back to a
   reason-less toast only when the task carries no error. A failed
   re-download never touches a prior model file: the native side only
   writes the final destination on success, so an interrupted re-download
   leaves the previously downloaded model in place.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/settings/AssistantNativeSection.tsx>`__
   · → :doc:`15-assistant`

#. **The remote provider uses native tools and stops teaching the fallback.**
   ``OpenAiProvider.chat`` sends each ``ToolDefinition`` as a native ``tools``
   entry (``toOpenAiTools``) and includes ``PORTABLE_TOOL_FALLBACK`` (the same
   JSON envelope, taught as a prompt line) only until the server emits a
   native tool call; ``NATIVE_TOOL_SERVERS`` remembers which
   ``baseUrl::model`` pairs have this session, because for a capable model
   that instruction invites ``{"answer": ...}`` JSON as text where a plain
   answer was wanted. ``complete``'s ``jsonSchema`` maps to
   ``response_format: json_schema``, which Ollama compiles into a grammar
   constraint, so triage gets the same constrained decoding on this backend.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/openai.ts>`__
   · → :doc:`15-assistant`

#. **The WebLLM, native, Gemini Nano and Ollama providers self-repair an
   unparseable reply.** A reply that parses to neither a tool call nor an answer
   is retried up to ``ASSISTANT.maxParseAttempts`` (3). Before each retry, the
   failed reply and a correction naming the fault (``SELF_REPAIR_PROMPT``) are
   appended to the conversation, so even a
   temperature-0 greedy sampler produces a different generation. The
   temperature is raised (to ``ASSISTANT.assistantRetryTemperature``) only on
   the final attempt, in case the model is stuck regardless of the correction.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/providers/webllm.ts>`__
   · → :doc:`15-assistant`

#. **Four gates run before any tool executes.** The turn's own ``opts.tools``
   list is the execution authority, not the registry: the definition must come
   from that list, and ``getToolByName``/``isWithheldToolName`` (``tools.ts``)
   are consulted only to phrase the refusal for a name outside it,
   distinguishing a withheld action (``WITHHELD_TOOL_NAMES``: the arm, alarm,
   run-state, delete, and archive actions the assistant does not implement
   at all) from a known tool on a tool-less turn and from a typo. Then, in
   order: an identical repeat is refused (``toolCallSignature`` over
   ``stripOmittedArgs``-normalized input, so placeholder spelling cannot
   disguise one), ``objectQuestionMismatch`` refuses ``count_events`` for an
   object-type question it cannot answer, and ``validateToolInput`` checks the
   input against the tool's own schema. Each failure returns as an ordinary
   error result the model corrects from within the same turn, which is
   cheaper than a request that succeeds against the wrong data and gets
   answered confidently.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/agent.ts>`__
   · → :doc:`15-assistant`

#. **The model copies the time phrase, an interpreter parses it, and code computes the window.** The assistant
   model copies the user's time words into ``list_events``' ``when``
   verbatim and unmodified, in whatever language (both reference models
   copied every measured phrase exactly). A dedicated interpreter call (``interpretWhen``,
   ``window-interpreter.ts``) then maps the phrase onto structured fields
   (``lastCount``+``lastUnit``, ``daysAgo``, ``weekday``, ``date``,
   ``fromDate``/``toDate`` calendar spans, ``fromTime``/``toTime``) under a
   constrained schema, cached per phrase and day; "letzte Woche" becomes
   ``lastCount: 1, lastUnit: "week"``, and "april" becomes an inclusive
   ``fromDate``/``toDate`` month span (either side may stand alone, the end
   is capped at now, and an impossible date like a non-leap February 29 is
   a corrective error, since V8 would otherwise roll it into March).
   Finally ``resolveWindow`` (``event-range.ts``) does the arithmetic into
   concrete ZM datetime strings against the profile timezone. No app-side
   phrase grammar exists anywhere on this path; the middle job was given its
   own model call after measurement showed the assistant models copy phrases
   perfectly but fill the fields directly at 27/36 and 15/36. Any failure
   along the way returns a corrective error the calling model retries from.
   Row and window timestamps in the tool output are re-rendered through the
   profile's date/time format (``formatTimestamp``, ``tools-readonly.ts``):
   the model echoes whatever format the rows carry, so the answer uses the
   profile's format too.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/window-interpreter.ts>`__
   · → :doc:`15-assistant`

#. **Results feed back into history.** ``captureApiCalls`` wraps
   ``def.execute`` so the transcript records the actual ZoneMinder requests
   each tool made; outputs become ``ToolResult``s in one ``role: 'tool'``
   message and the loop calls ``provider.chat`` again with them, so the model
   sees what its own call returned before deciding to call another tool or
   answer. The requests themselves are the same authenticated ``api/*``
   helpers the rest of the app uses: there is no separate "assistant" API
   path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/api-capture.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Code computes the counts in the result, and the model quotes them.**
   ``list_events`` output leads with a code-built ``summary`` sentence
   (``buildResultSummary``, ``result-summary.ts``) the model is told to quote
   as its first sentence. ``matchCount`` is the server's whole-query total from
   ZM pagination, not the page: two capped results would both say 25 and the
   model would compare the caps as totals, so the sentence leads with the real
   count ("142 events ... The 25 most recent are listed.") and the
   per-monitor and per-object tallies say "(listed rows)" whenever rows were
   capped. ``busiestHour``/``countsByHour`` are tallied app-side from the
   listed rows and ride outside the summary rather than inside it, so quoting
   the summary never
   narrows the result cards to one hour unless the question asked for it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/result-summary.ts>`__
   · → :doc:`15-assistant`

#. **Grounding is checked by code, not by a judge model.** When a turn that
   fetched data answers, ``retryIsUnusable`` (``grounding.ts``) checks two
   decidable faults: ``deniesTheData`` (a nothing-found claim over results
   whose ``matchCount`` is positive, guarded so any positive count in the
   answer reads as describing the data rather than denying it) and
   ``echoesToolOutput`` (the raw result JSON returned as the answer). One
   correction retry (``buildGroundingCorrection``) is allowed; if the retry
   fails the same check, ``fallbackAnswerFromData`` answers with the tool's
   own code-built summary line. There is no second model call: a judge model
   caught no fabrication and rejected accurate answers.
   Separately, two language-neutral nets cover live data without English
   regexes (refs #265): a tool-less turn whose model calls a real registry
   read tool is allowed through rather than blocked (``activeTools`` flips to
   the registry and the call runs, since the model's own attempt outranks the
   classifier), and a
   tools-available turn answered without any tool attempt gets one generic
   reminder, with the second answer accepted rather than replaced. The
   fail-open path pushes back once first (refs #270): the first tool-less
   call is answered with a corrective error asking the model to reply in
   plain text if the message was conversation, and only a model that insists
   on the next call opens the registry, so a greeting that reflexively calls
   a tool does not come back as an event report.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/grounding.ts>`__
   · → :doc:`15-assistant`

#. **Render the reply.** ``runAssistantTurn`` resolves with only the messages
   this turn produced, never the history it was handed: what it sends the
   model is a trimmed view of the panel's thread, so a returned "history"
   would be a different length than the panel's own. ``AskPanel`` appends
   them, attaches the accumulated activity steps to the final answer message,
   and renders assistant text as Markdown, except the ``__i18n:`` sentinels
   (iteration cap, context cleared), which
   ``renderAssistantText`` localizes with ``t()`` instead of treating as
   literal text. Result cards under the answer are selected by the answer
   itself: an answer about specific rows ends with one machine-readable
   ``SHOW: events=<ids> monitors=<ids>`` line, which
   ``extractShowDirective`` (``display.ts``) strips before display and
   ``filterDisplayByShow`` uses to pick which cards render; ids no tool
   produced select nothing, and an answer with no directive shows every
   card. Monitor cards render live previews (``LiveMonitorPlayer``), capped
   at ``ASSISTANT.maxLiveMonitorCards``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/assistant/AskPanel.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Clear the context before it overflows.** ``AskPanel`` checks
   ``isContextNearlyFull(provider.contextWindow, usage)`` against the
   ``promptTokens`` the backend reported for the turn that just finished; past
   ``ASSISTANT.contextClearThreshold`` (0.75) it appends an
   ``assistant.context_cleared`` notice carrying ``contextBoundary: true``.
   ``contextWindow`` is exact on-device (the value ``model-download.ts``
   passed to ``CreateMLCEngine``) and learned on Ollama: after a chat turn,
   ``OpenAiProvider``'s ``refreshContextWindow`` asks Ollama's native
   ``/api/ps`` what window the loaded model actually runs with (the
   OpenAI-compatible API never reports ``num_ctx``) and caches it in
   ``CONTEXT_WINDOWS``, so auto-clear works on that backend from the next
   turn on. On the next send, ``sliceAfterContextBoundary`` (``agent.ts``)
   hides everything before the boundary from the model while the thread in
   ``stores/assistant.ts`` keeps rendering it for the user.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/assistant/agent.ts>`__
   · → :doc:`15-assistant`

Typing text into the command palette without choosing the Ask item skips all
of this and stays plain command-palette navigation: a direct ``navigate()``
call with no model and no tools, documented alongside this entry point in
:doc:`16-platform-surfaces`.

Flow 20: A Live Activity poll tick
-----------------------------------

The Live Activity page shows only monitors ZoneMinder currently reports as
alarming. Every poll tick fans out one status request per watched monitor,
parses the response into a state, and runs that state through a dwell policy
that decides whether each monitor's tile should exist. The reducer needs
the most care, because mounting or unmounting a tile mints or quits a ZMS
connection (Flow 2), so a policy that flickered a monitor in and out would
thrash ``nph-zms`` on the server, not just the display.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as LiveActivity page
       participant Hook as useAlarmStates
       participant ZM as ZoneMinder
       participant Parse as parseAlarmState
       participant Reduce as reduceActiveMonitors
       participant Tile as MontageMonitor tile
       participant Life as useStreamLifecycle

       Page->>Hook: watched monitor ids, pollIntervalMs
       Hook->>ZM: GET alarm status, one query per id
       ZM-->>Hook: raw status per monitor
       Hook->>Parse: parseAlarmState(raw)
       Parse-->>Hook: alarm / alert / idle / ...
       Page->>Reduce: reduceActiveMonitors(prev, states, now, dwellMs)
       Reduce-->>Page: next active list (newest alarm first)
       Page->>Tile: render capActiveMonitors(active, maxTiles).visible
       Tile->>Life: mount mints a connkey
       Note over Reduce,Tile: dwell expires, or overflow drops a tile
       Tile->>Life: unmount sends CMD_QUIT

#. **The poll interval respects the bandwidth floor.** ``LiveActivity``
   builds ``pollIntervalMs`` with ``resolvePollIntervalMs(bandwidthMode,
   settings.liveActivityPollSeconds, 'alarmStatusInterval')``, the same
   function notification polling already uses to fold a per-feature user
   value against the bandwidth-mode floor. A per-page interval looks like
   it contradicts the Polling contract's "users tune bandwidth globally";
   routing it through this shared resolver instead of a raw literal is what
   keeps it inside that contract.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/LiveActivity.tsx>`__
   · → :doc:`11-application-lifecycle`

#. **One query per watched monitor.** ``useAlarmStates`` calls
   ``useQueries`` with one ``getAlarmStatus(monitorId)`` query per id, keyed
   by ``queryKeys.monitorAlarmStatus``, the same per-id fanout
   ``useMonitorNewEvents`` uses because ZoneMinder's alarm endpoint only
   accepts a single monitor. Every requested id gets an entry in the
   returned map even before its query resolves: a missing key reads
   downstream as "no longer watched", which would drop a monitor before its
   dwell window ever ran. The map is built in the ``combine`` option so the
   returned object is identity-stable across renders; step 5 stamps
   ``Date.now()`` into its output, so a per-render identity here would loop
   the page forever.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useAlarmStates.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Parse whatever ZoneMinder sent back.** ``parseAlarmState`` reads
   ``status`` or ``output``, accepts both a numeric code and an older
   word-based value, and falls back to ``'unknown'`` for anything it does
   not recognize (including the API's own ``status: 'false'`` error
   marker) rather than guessing alarming.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/alarm-state.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A push notification promotes a monitor early.** Before the states
   reach the reducer, ``applyLiveAlarmHints`` overlays any monitor with a
   notification received inside the current dwell window, forcing it to
   ``'alarm'`` even though the last poll has not confirmed it yet. It only
   ever touches a monitor id already present in ``states``, so a hint for a
   page-ignored or profile-excluded monitor cannot resurrect it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/live-activity.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The dwell reducer decides who stays.** ``reduceActiveMonitors`` runs in
   an effect, not during render, because it depends on the previous list and
   on ``Date.now()``. A monitor entering ``alarm``/``alert`` joins or stays;
   one that stops alarming keeps its slot until ``now - lastAlarmingAt``
   exceeds the dwell window, then drops. The result
   is then sorted by ``episodeStartedAt`` descending with the monitor id as a
   tiebreak, so the freshest alarm is the first tile and monitors that
   alarmed in the same poll hold a fixed order. That key is the start of the
   current alarm episode, not the last alarming moment: ZoneMinder drops a
   winding-down monitor out of the alarming set and back into it every second
   or two, and sorting on ``lastAlarmingAt`` restamped the key on every pass,
   so the tiles traded places on almost every tick of an event's tail. A
   monitor has to stay quiet for ``LIVE_ACTIVITY.episodeGraceSeconds`` before
   its next alarm starts a new episode and moves it back to the top. The sort
   runs before the identity check, so an order that did not actually change
   still hands back the previous array rather than re-rendering every tile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/live-activity.ts>`__
   · → :doc:`05-component-architecture`

#. **A cooling tile still expires with no new poll data.** A second effect
   arms a one-second interval, only while the list is non-empty, and re-runs
   the same reducer against the same states. The dwell window is measured in
   wall-clock time, not poll ticks, so a tile that stopped alarming between
   polls does not wait for the next network response to leave. Both effects
   call one ``useCallback`` with no dependencies, which reads the previous
   list from a ref rather than from ``active``: a per-render identity, or
   ``active`` in this effect's deps, would clear and rearm the interval
   before its 1000ms ever elapsed and cooling tiles would never expire.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/LiveActivity.tsx>`__
   · → :doc:`04-pages-and-views`

#. **A dismissed monitor is held out, not filtered at render time.** The
   page hands the reducer the set of monitors the user cleared by hand, and
   the reducer skips them as residents and as new arrivals alike, so the
   tile unmounts for real and step 9 quits its stream. The suppression is
   needed because a dismissed monitor is usually still alarming, so without it the
   next poll would readmit the tile immediately. ``releaseDismissed`` then
   drops a dismissal once that monitor has stopped alarming, and the
   page calls it after the reduce rather than before, or a tile dismissed
   while already cooling would survive its own dismissal.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/live-activity.ts>`__
   · → :doc:`04-pages-and-views`

#. **Cap the grid, and say what got hidden.** ``capActiveMonitors`` slices
   the reduced list to ``liveActivityMaxTiles`` and reports the remainder as
   ``overflowCount``, rendered as the "+N more active" line rather than
   silently dropped.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/live-activity.ts>`__
   · → :doc:`04-pages-and-views`

#. **Mounting or removing a tile opens or quits a ZMS connection.** Each
   visible entry renders a ``MontageMonitor``, the same tile Montage uses,
   so mounting it mints a ZMS connkey as Flow 2 describes. When the
   reducer drops a monitor, its tile unmounts and ``useStreamLifecycle``'s
   cleanup sends ``CMD_QUIT`` for that connkey. The dwell window prevents
   churn here: without it, a monitor alarming in short bursts
   would mint and quit a fresh ``nph-zms`` process on almost every poll.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/LiveActivity.tsx>`__
   · → :doc:`12-shared-services-and-components`

Flow 21: Switching into a virtual profile group
-----------------------------------------------

An aggregate scope is an id with no backing ``Profile`` record, and every
hook that fans out over profiles handles a list of one or of many the same
way. Each profile's data comes from the same
per-profile React Query key ``useMonitors`` uses in single mode, so switching into an aggregate never refetches a profile whose monitors are
already cached.

A virtual profile (a virtual profile group in the UI, ``VirtualProfile`` in
``api/types.ts``) is stored on the profile store and gets an id shaped
``__virtual_<uuid>``, which is what ``isVirtualProfileId`` tests and what
``isAggregateProfileId`` recognizes. It is the only aggregate a user can
select. Its ``'all'`` scope arm carries ``aggregateId`` and ``aggregateName``
so surfaces that name the aggregate can say which one, and its profile list is
the group's members filtered down to the ones still present and enabled.

.. note::

   ``ALL_PROFILES_ID`` is the retired built-in "All Servers" aggregate. Groups
   replaced it: no surface offers it, ``switchProfile`` rejects it, and
   ``handleProfileRehydration`` (Flow 1) resets a stored one to ``null`` and
   deletes the settings and dashboard buckets it owned. The sentinel itself
   survives in ``api/types.ts`` so the guards that keep an aggregate id out of
   session, token and notification paths still recognize a stored one, and so
   a frame rendered before that migration runs shows an aggregate rather than
   an empty screen. Nothing new should reference it. Refs #337.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as Profiles page
       participant Store as Profile store
       participant Scope as useProfileScope
       participant Mon as Monitors page
       participant Hook as useScopedMonitors
       participant A as Server A
       participant B as Server B

       User->>Page: tap the group's card
       Page->>Store: switchProfile(__virtual_<uuid>)
       Store-->>Page: currentProfileId = the group id (no session, no login)
       Page->>Mon: navigate('/monitors')
       Mon->>Scope: useProfileScope()
       Scope-->>Mon: {mode:'all', profile:null, profiles:[A,B]}
       Mon->>Hook: useScopedMonitors()
       Hook->>A: getMonitors (queryKeys.monitors(A))
       Hook->>B: getMonitors (queryKeys.monitors(B))
       A-->>Hook: monitors
       B-->>Hook: error
       Hook-->>Mon: {monitors: Scoped<MonitorData>[], errors: [B]}
       Mon->>Mon: render A's cards + chip, render a strip for B

#. **An aggregate id is not a profile.** A group id is a minted string with no
   ``Profile`` record behind it. ``currentProfileId`` can point at it the same
   way it points at any real profile id, which is what lets the rest of the
   store and every hook treat "these servers" as one more value rather than a
   mode flag threaded through every consumer.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/types.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Making a group needs a real second profile.** ``Profiles`` offers the new
   group action only when two or more profiles are enabled; with one there is
   nothing to aggregate, which is the ≥2 rule the user guide documents. The
   cards of groups that already exist stay, since editing and deleting them is
   the only way out of that state.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx>`__
   · → :doc:`04-pages-and-views`

#. **Switching to an aggregate is the cheap branch of switchProfile.**
   ``Profiles``'s ``handleSwitchProfile`` calls the same ``switchProfile(id)``
   action for a group card as for every real card. The store special-cases
   ``isAggregateProfileId(id)`` before it reaches any of the six per-profile
   bootstrap steps Flow 1 walks: it quits every active stream and sets
   ``currentProfileId``, nothing else, because an id with no server has no
   session to build. A group id that no longer resolves to a stored group is
   rejected instead, the same way an unknown profile id is.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **One hook resolves the scope for everyone.** ``useProfileScope``
   reads ``currentProfileId`` and, when it is an aggregate, returns
   ``{mode:'all', profile:null, profiles}``, the group's member list instead
   of a one-element array. Every consumer below fans out over ``scope.profiles``
   identically in both modes, so the fan-out itself needs no mode branch. Other
   code still checks ``isAllMode`` for mode-specific behavior, as the paragraph
   after this flow lists.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useProfileScope.ts>`__
   · → :doc:`05-component-architecture`

#. **useCurrentProfile keeps ``currentProfile`` null in All mode.** Its
   ``isAllMode`` flag is exposed alongside a ``currentProfile`` that stays
   null, since no single profile is "the" current one while aggregating. Code that needs
   one profile while aggregating takes it from the item it renders or from a
   local profile picker instead.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useCurrentProfile.ts>`__
   · → :doc:`03-state-management-zustand`

#. **One ``useQueries`` call, one query per profile, the same cache key.**
   ``useScopedMonitors`` maps ``scope.profiles`` into a ``getMonitors`` query
   per profile keyed by ``queryKeys.monitors(p.id)``, the identical key
   ``useMonitors`` uses in single mode. A profile already cached from single
   mode is not refetched just because All mode also asked for it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedMonitors.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **``combine`` tags every item with its owner and isolates failures.** The
   ``combine`` option wraps each monitor as ``{profileId, profileName, item}``
   and, separately, pushes any profile whose query errored into its own
   ``errors`` array, so one unreachable server cannot fail the whole hook or
   blank the profiles that did answer.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedMonitors.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The grid keys each card by profile and monitor, not monitor alone.**
   ``Monitors``'s ``renderItems`` keeps ``profileId``/``profileChip`` on every
   All-mode item and keys each ``MonitorCard`` ``${profileId}-${Monitor.Id}``,
   because two servers can and do reuse the same ZoneMinder monitor id. Each
   card then renders a ``monitor-profile-chip`` naming the server it came
   from.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Monitors.tsx>`__
   · → :doc:`05-component-architecture`

#. **A failed profile gets its own strip, and only if it has nothing to
   show.** ``visibleErrors`` filters down to profiles that produced zero
   monitors; a profile with cached data and a background refetch error falls
   through to the normal view instead (the offline banner covers that case).
   Each remaining entry renders a ``profile-error-strip-<id>`` with a retry
   button that refetches that profile's query key, not the whole
   scope.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Monitors.tsx>`__
   · → :doc:`07-api-and-data-fetching`

The Monitors page, the Events and Timeline pages, and the profile switcher
branch on ``isAllMode``; Flow 22 covers how Events aggregates the same way
Monitors does here. Montage and Dashboard resolve the same scope and
aggregate identically. Montage additionally caps the number of simultaneous
All-mode streams it opens, so a large combined camera count can't try to open a
live stream to every camera on every server at once. That cap reads
``settings.allModeMaxStreams`` from the aggregate's settings bucket, edited in
Settings' aggregate performance section and defaulting to
``MONTAGE_GRID.allModeMaxStreams``; Live Activity's watch cap and poll floor
come from the same bucket the same way. Screens that are inherently single-server instead
(Logs, Server, Notification settings, the server-scoped part of Settings, and
the assistant panel) resolve a locally-picked profile via
``ProfilePicker``/``useProfileById``, defaulting to the first profile in
scope, rather than aggregating. Live Activity aggregates too, through
``useLiveActivityAllMode`` (refs #337, #341), keying every tile by
``monitorCacheKey`` so two servers sharing a raw monitor id never collide.

Flow 16 covers editing and deleting a profile. Switching into a group, traced
here, is the only case where "the current profile" can mean more than one
server at a time.

Flow 22: Merged events and direct tap-through while aggregating
-------------------------------------------------------------------

Events aggregation reuses Flow 21's shape (one ``useQueries`` fan-out over
``scope.profiles``, one ``Scoped<T>`` wrapper, one error strip per empty
profile) but adds two things Monitors doesn't need: a true cross-server sort
order, and a way into a specific event or monitor that skips the profile
switch entirely. A monitor card, an event row, and a push notification all
resolve the owning profile and land on the same ``/all/...`` deep route. The
URL carries the profile id, so the destination page never has to work out
whose session it is in.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Card as MonitorCard (All mode)
       participant Hook as useOpenMonitorEvents
       participant Push as pushNotifications service
       participant Nav as navigationService
       participant Events as Events page
       participant Scoped as useScopedEvents
       participant A as Server A
       participant B as Server B

       User->>Card: tap a card owned by profile B
       Card->>Hook: openMonitorEvents({monitorId, profileId: B})
       Hook->>Events: navigate(/events?profileId=B)
       Events->>Scoped: useScopedEvents({filters})
       Scoped->>A: getEvents (queryKeys.eventsList(A, ...))
       Scoped->>B: getEvents (queryKeys.eventsList(B, ...))
       A-->>Scoped: events
       B-->>Scoped: events
       Scoped-->>Events: events sorted by eventInstant, chip per row
       Events->>Events: eventsServerFilter narrows to B (deep-link param)

       Push->>Push: notification arrives for profile B while in All mode
       Push->>Nav: navigateToEvent(eventId, state, profileId=B)
       Nav->>Events: navigate(/all/events/B/eventId), no switchProfile call

#. **The merge sorts by real instant, not server-local time.** ``eventInstant``
   converts each event's ``StartDateTime`` to an epoch using its owning
   profile's timezone, so a 9pm event on an America/New_York server and a 2am
   event on a UTC server interleave in true chronological order instead of by
   the raw string, which Flow 21's monitor cards have no equivalent of, since there
   is nothing to sort there.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/event/event-instant.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **One query per profile, with the same cache key single mode uses.**
   ``useScopedEvents`` maps ``scope.profiles`` into a ``getEvents`` query keyed
   by ``queryKeys.eventsList(p.id, ...)``, identical to the single-profile
   Events query, so switching between single and All mode for a profile
   already visited never refetches it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedEvents.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **Each row carries its own chip, keyed like Monitors' cards.**
   ``EventCard`` renders an ``event-profile-chip`` whenever ``profileChip`` is
   set (only in All mode), wired the same way ``monitor-profile-chip`` is in
   Flow 21.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventCard.tsx>`__
   · → :doc:`05-component-architecture`

#. **A monitor card's "Events" button navigates with the owning profile
   attached, not the current one.** ``useOpenMonitorEvents`` reads
   ``profileId`` off the card it was called from (undefined in single mode) and
   appends it as a ``profileId`` query param on the ``/events`` navigation,
   rather than assuming the globally-selected profile owns the monitor that
   was clicked.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useOpenMonitorEvents.ts>`__
   · → :doc:`05-component-architecture`

#. **The Events page turns that param into a standing filter, once.** An
   effect reads ``?profileId=`` and writes it into
   ``settings.eventsServerFilter`` for the aggregate's settings bucket, keyed off
   the deep-linked id so a card click narrows the merged list to
   that server instead of leaving a colliding numeric event id ambiguous
   across two profiles.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Events.tsx>`__
   · → :doc:`04-pages-and-views`

#. **A monitor detail click never calls switchProfile at all.**
   ``MonitorCard``'s ``goToDetail`` navigates straight to
   ``/all/monitors/:profileId/:monitorId`` when the card carries a
   ``profileId``, instead of Flow 21's switch-then-navigate; ``MonitorDetail``
   resolves its session from the route param, so the profile switcher
   still names the group the whole time, which is the outcome the deep-link e2e scenario
   asserts.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MonitorCard.tsx>`__
   · → :doc:`05-component-architecture`

#. **A push notification resolves to a real profile even while an aggregate
   has none current.** ``resolveProfileForNotification`` special-cases an
   aggregate id via ``isAggregateProfileId``: when the notification's own
   profile is known, it returns that profile as the target with
   ``isCrossProfile: false``, with no switch-confirmation dialog, because there is
   no "wrong" profile to switch away from while aggregating.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/profile/notification-profile.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The tap lands on the same ``/all/`` deep route a card click would.**
   ``navigateToEvent`` builds ``/all/events/:profileId/:eventId`` whenever a
   ``profileId`` is passed, so the notification handler and ``MonitorCard``
   converge on one routing convention for carrying "which server".
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/navigation.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **Tags fan out per profile and are keyed by owner, not by event id.**
   ``useScopedEventTagMapping`` asks each profile only for the event ids that
   profile owns and merges the answers under ``scopedEventKey``:
   ``${profileId}:${eventId}`` in All mode, the bare id in single mode, which
   is exactly what a row carries. A single map keyed by bare event id would
   hand one server's tags to the other server's row, the event-side twin of
   the ``monitorCacheKey`` collision.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedEventTags.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The tag filter aggregates by name, because tag ids are per-server.**
   ``useScopedTags`` offers one entry per distinct tag name with the name
   standing in for ``Id``, and ``resolveOwnTagIds`` maps a selection back into
   each profile's real ids before its query runs, using the same composite-token
   shape the All-mode monitor filter persists in the aggregate's settings bucket. A
   profile that has no tag by that name resolves to an empty list, which
   ``getEvents`` treats as "matches nothing" rather than falling through to an
   unfiltered query.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedEventTags.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A profile that owns none of the selected monitors contributes nothing.**
   ``resolveOwnMonitorIds`` can only answer "no monitor filter" for a profile
   none of the composite tokens name, and ZoneMinder reads that as "every
   monitor", so filtering to one server's camera would put the other
   server's whole event list on screen. ``ownFilterIds`` pairs that case with
   the impossible ``eventIds: []`` filter instead, the same shape
   ``favoritesOnly`` uses for a profile with no favorites of its own, and the
   shape the tag filter above uses for a server without the selected tag.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useScopedEvents.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The command palette and the keyboard shortcuts fan out the same way.**
   Both read ``useScopedMonitors`` (with ``poll: false``, since they mount for
   the whole session and share the monitors query key with the Monitors page),
   label each row with its owning profile, and navigate to
   ``/all/monitors/:profileId/:id``. Group entries are absent in All mode:
   ZoneMinder monitor groups are per-server and nothing aggregates them.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/CommandPalette.tsx>`__
   · → :doc:`05-component-architecture`

Timeline aggregates the same way through its own ``isAllMode`` branch, reusing
``useScopedEvents``'s sibling query rather than a second hook. The Events
montage (grid) view works in All mode because each tile resolves thumbnails
against its event's own profile rather than the page-level current profile,
which is absent while aggregating, so ``events-view-toggle`` stays enabled and
the grid renders with no gate notice.

Flow 21 covers how a profile enters All mode in the first place; this flow
picks up once it's there.

Flow 23: Live notifications across every server in an aggregate
---------------------------------------------------------------------

Flow 7 covers one profile's websocket. Aggregating does not multiplex
that single connection. It mounts one independent connector per profile in
scope, each running Flow 7's own connect/reconnect/backoff machinery
unchanged, so one server's flaky network never stalls another's toasts. No
aggregation code decides which profile an
event belongs to: each connector closes over its own profile id at mount, so
the same numeric monitor or event id from two different servers can never
land in the wrong bucket.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Handler as NotificationHandler
       participant ConnA as Connector (profile A)
       participant ConnB as Connector (profile B)
       participant Store as Notification store
       participant Toasts as All-mode toasts hook

       Handler->>ConnA: mount, bound to profile A
       Handler->>ConnB: mount, bound to profile B
       ConnA->>Store: connect(profileA)
       ConnB->>Store: connect(profileB)
       Store-->>ConnA: alarm event, closure-bound to A
       Store-->>ConnB: alarm event, closure-bound to B
       Store->>Toasts: profileEvents changed
       Toasts-->>Handler: coalesced toast, A's own settings

#. **The handler fans out one connector per scope profile.** ``NotificationHandler``
   renders a ``ProfileNotificationConnector`` for every profile in
   ``scope.profiles`` when ``scope.mode`` is ``'all'`` and
   ``allModeNotifications`` is not ``'off'``, gated to desktop/web only;
   mobile keeps Flow 3's single connection for the anchor profile (the one
   the notification store's ``currentProfileId`` points at), since Firebase
   Cloud Messaging (FCM) already delivers every profile's events server-side regardless of which one is
   foregrounded.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/NotificationHandler.tsx>`__
   · → :doc:`16-platform-surfaces`

#. **Mount is the fan-out, unmount is the teardown.** ``ProfileNotificationConnector``
   reuses ``useNotificationAutoConnect`` unmodified, permanently bound to its
   own profile; React mounting or unmounting it as profiles enter or leave
   scope (switch, disable, delete, or ``allModeNotifications`` flipping off)
   is the only fan-out and teardown mechanism, with an explicit cleanup that
   disconnects the socket and stops the poller on unmount.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/notifications/ProfileNotificationConnector.tsx>`__
   · → :doc:`03-state-management-zustand`

#. **Each profile gets its own service instance.** The store's ``connect``
   resolves a service through ``getNotificationService(profileId)`` and does
   not disconnect any other profile before connecting, because two connectors
   can be connecting at once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Listeners bind their profile id at registration, not at read time.**
   ``_initialize`` wires each connector's own event/state callbacks, so an
   alarm from server B's websocket can only ever reach the handler closed
   over profile B's id.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The write stores each alarm under its own profile.** ``addEvent(profileId, event)``
   stores the alarm under ``profileEvents[profileId]``; two servers reporting
   monitor id ``3`` write to two different buckets, never one overwriting the
   other.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Toast display is a separate seam from the store write.**
   ``useNotificationAllModeToasts`` watches every scope profile's events and
   reads each one's own ``showToasts``/``playSound`` out of that profile's
   settings, since there is no "current profile" to fall back on while
   aggregating.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAllModeToasts.tsx>`__
   · → :doc:`03-state-management-zustand`

#. **Events landing close together coalesce.** ``flushBurst`` collapses every
   event collected within the burst window into one summary toast naming the
   event and server counts, and plays at most one sound per window, so
   several busy servers can't flood the screen with individual toasts.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAllModeToasts.tsx>`__
   · → :doc:`03-state-management-zustand`

#. **``allModeNotifications`` is the kill switch upstream of all of it.**
   ``'off'`` means the handler never mounts a single connector, so no All-mode
   sockets or pollers exist at all; ``'muted'`` still mounts every connector
   (badge and history keep updating) but the toasts hook's own check
   suppresses toast and sound display.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/settings.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Notification Settings reads the same state the connectors write.**
   ``NotificationOverview`` renders each profile's live connection status and
   stored settings straight from the store's ``connections`` map and
   ``profileSettings``, with no separate aggregation hook of its own.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/notifications/NotificationOverview.tsx>`__
   · → :doc:`05-component-architecture`

Flow 21 covers the scope these connectors fan out over; Flow 7 is the
single-profile mechanics each connector runs for its own profile.

Flow 24: Opening a monitor's settings on a restricted account
-------------------------------------------------------------

ZoneMinder accounts are not all administrators, and the app has to work out
what this one may do without an endpoint that answers the question.
``/users.json`` is gated on ``System() != 'None'``, so a 401 there
proves the account has no system access, which is the fact the gear
needs.

.. mermaid::

   sequenceDiagram
       autonumber
       participant UI as MonitorDetail
       participant Hook as usePermissions
       participant Api as api/users.ts
       participant ZM as ZoneMinder
       participant Dialog as MonitorSettingsDialog

       UI->>Hook: usePermissions(ownerProfile.id)
       Hook->>Api: fetchAccountPermissions(client, username)
       Api->>ZM: GET /users.json
       ZM-->>Api: 401 Insufficient Privileges
       Api-->>Hook: SYSTEM_NONE_PERMISSIONS
       UI->>Dialog: onSave omitted, restrictedReason="account"
       Dialog-->>UI: read-only panel, no camera fields

#. **The page asks about the owning profile, not the current one.**
   ``usePermissions`` takes an explicit id because an aggregate has no account:
   in All mode the monitor on screen belongs to one real profile, and that is
   whose permissions decide what its controls do.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/usePermissions.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The probe runs once per profile.** The query uses an infinite
   ``staleTime``: permissions change when an administrator edits the account,
   which this app can neither observe nor cause. React Query's cache makes
   every later consumer a cache read rather than a request.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/usePermissions.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A profile with no username never asks.** That server has
   ``ZM_OPT_USE_AUTH`` off, where ZoneMinder short-circuits every check on
   ``!$user``, so the answer is ``UNRESTRICTED_PERMISSIONS`` with no request.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/users.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The refusal is recognized by its body.** ``isPermissionDenied`` matches
   ZoneMinder's "Insufficient Privileges" body rather than the bare 401 status,
   because the same status also means "log in again" and the two need opposite
   handling.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/permissions/permission-error.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **A privilege 401 skips token recovery.** In ``api/client.ts`` the retry
   path is what a stale session needs and what a refusal cannot use: a refusal
   survives any number of fresh tokens, so refreshing one only spends a refresh
   and a retry before failing identically.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts>`__
   · → :doc:`07-api-and-data-fetching`

#. **The verdict is three-valued.** ``canEditMonitorSettings`` answers
   ``allowed``, ``denied`` or ``unknown``, and only ``denied`` may take
   anything away. ``System='None'`` with ``Monitors='Edit'`` is a legal
   account, so guessing on ``unknown`` would remove an editor from someone
   entitled to it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/permissions/zm-permissions.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **The page withholds the callback rather than passing a flag.** Denied,
   ``MonitorDetail`` omits ``onSave``, and the dialog's existing
   ``editable = !!onSave`` does the rest. No new state, and the read-only path
   cannot drift from the "no save handler" path because they are the same path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx>`__
   · → :doc:`04-pages-and-views`

#. **The restricted panel keeps the app's own per-monitor settings.** Force-ZMS, the
   per-monitor Go2RTC override and the cycle interval are profile settings, not
   monitor columns, and they are the stream troubleshooting knobs a restricted
   user needs. The camera's address, username and password are what goes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitor-detail/MonitorRestrictedSettings.tsx>`__
   · → :doc:`05-component-architecture`

#. **A save can still be refused, and the refusal is remembered.** ZoneMinder
   also keeps per-monitor permission rows (``editableMonitor`` in
   ``web/includes/auth.php``) that override the account columns and appear
   nowhere in the API, so ``System='Edit'`` does not guarantee a save. The
   catch latches that monitor through ``markPermissionDenied``, and the dialog
   turns read-only with a note naming the monitor rather than the account.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/permissions.ts>`__
   · → :doc:`03-state-management-zustand`

#. **The latch is deliberately not persisted.** Granting a permission on the
   server should take effect on the next launch with no cache to bust.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/permissions.ts>`__
   · → :doc:`03-state-management-zustand`

#. **Buttons elsewhere grey instead of vanishing, and stay clickable.**
   ``useDeniedControl`` returns ``aria-disabled`` rather than ``disabled``: a
   disabled button dispatches no pointer events, so ``useLongPressHint`` never
   fires and browsers suppress ``title`` too, leaving a greyed button that explains
   nothing.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useDeniedControl.ts>`__
   · → :doc:`12-shared-services-and-components`

#. **A denied stream has no failing request to catch.** ``zms.cpp`` checks
   ``Stream`` independently of ``Monitors``, and a denied stream is an image
   that never loads. ``LiveMonitorPlayer`` is the single gate for every stream
   surface, so the probe lets it show a message instead of a permanently
   blank tile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx>`__
   · → :doc:`05-component-architecture`

Absent here: any attempt to discover permissions before login, and any check
that hides a surface on ``unknown``. Flow 6 covers the token lifecycle this
flow steps around; Flow 17 is the PTZ path, and ``PTZControls``
hides its pad when the account's ``Control`` permission is denied.

When you need to change something, find the nearest flow, open its ``source`` link to land on the exact
code, and follow the ``→`` link for the chapter that explains that layer.
