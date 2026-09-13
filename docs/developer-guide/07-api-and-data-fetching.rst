API and Data Fetching
=====================

How zmNinjaNg talks to ZoneMinder's REST API, keeps its access token usable,
and turns responses into cached server state.

Three layers stack up. ``lib/http.ts`` is the transport: it picks a platform
implementation (native, Electron, browser, dev proxy), injects the token, and
throws ``HttpError`` on non-2xx. ``api/client.ts`` wraps that with the
ZoneMinder concerns: base URL, form encoding, proactive login, 401 recovery.
The ``api/*.ts`` modules are thin functions over the client that validate
responses with Zod. React Query sits on top and owns caching, polling, and
invalidation.

ZoneMinder API
--------------

Base URL: ``https://your-server.com/zm/api/<endpoint>``

Endpoint Reference
~~~~~~~~~~~~~~~~~~

Every endpoint zmNinjaNg calls, and the module that owns the call. Reach for
this when you need to know whether an operation already has a wrapper before
writing a new one.

======  ==========================================================  ========================================================================  ====================
Method  Endpoint                                                    Description                                                               Module
======  ==========================================================  ========================================================================  ====================
POST    ``/host/login.json``                                        Authenticate and receive tokens                                           ``auth.ts``
GET     ``/host/getVersion.json``                                   Server version info                                                       ``auth.ts``
GET     ``/monitors.json``                                          List all monitors with status                                             ``monitors.ts``
GET     ``/monitors/<id>.json``                                     Single monitor details                                                    ``monitors.ts``
POST    ``/monitors/<id>.json``                                     Update monitor settings                                                   ``monitors.ts``
GET     ``/controls/<controlId>.json``                              PTZ control definition                                                    ``monitors.ts``
GET     ``/monitors/alarm/id:<id>/command:<cmd>.json``              Trigger/cancel/query alarm (cmd: on, off, status)                         ``monitors.ts``
GET     ``/monitors/daemonStatus/id:<id>/daemon:<daemon>.json``     Check daemon status for a monitor                                         ``monitors.ts``
GET     ``/events/index.json``                                      List events (with query params)                                           ``events.ts``
GET     ``/events/index/<filterPath>.json``                         List events with URL-based filters                                        ``events.ts``
GET     ``/events/<id>.json``                                       Single event details                                                      ``events.ts``
PUT     ``/events/<id>.json``                                       Update event metadata                                                     ``events.ts``
DELETE  ``/events/<id>.json``                                       Delete an event                                                           ``events.ts``
GET     ``/events/index/MonitorId:<id>/StartDateTime >:<ts>.json``  Count a monitor's events newer than a timestamp                           ``events.ts``
GET     ``/servers.json``                                           List ZoneMinder servers                                                   ``server.ts``
GET     ``/host/daemonCheck.json``                                  Check if ZoneMinder daemon is running                                     ``server.ts``
GET     ``/host/getLoad.json``                                      Server CPU load                                                           ``server.ts``
GET     ``/host/getDiskPercent.json``                               Disk usage percentage                                                     ``server.ts``
GET     ``/host/getTimeZone.json``                                  Server timezone                                                           ``time.ts``
GET     ``/configs.json``                                           All ZoneMinder config entries                                             ``server.ts``
GET     ``/configs/viewByName/<key>.json``                          Single config value (ZM_PATH_ZMS, ZM_GO2RTC_PATH, ZM_MIN_STREAMING_PORT)  ``auth.ts``, ``server.ts``
GET     ``/groups.json``                                            List monitor groups                                                       ``groups.ts``
GET     ``/users.json``                                             Permissions of the account this profile signs in as                       ``users.ts``
GET     ``/states.json``                                            List run states                                                           ``states.ts``
POST    ``/states/change/<stateName>.json``                         Switch to a run state                                                     ``states.ts``
GET     ``/notifications.json``                                     List push notification registrations                                      ``notifications.ts``
POST    ``/notifications.json``                                     Register for push notifications                                           ``notifications.ts``
PUT     ``/notifications/<id>.json``                                Update a notification registration                                        ``notifications.ts``
DELETE  ``/notifications/<id>.json``                                Remove a notification registration                                        ``notifications.ts``
GET     ``/tags.json``                                              List all tags                                                             ``tags.ts``
GET     ``/tags/index/Events.Id:<ids>.json``                        Tags for specific events                                                  ``tags.ts``
GET     ``/zones.json?MonitorId=<id>``                              Zones for a monitor                                                       ``zones.ts``
GET     ``/logs.json``                                              List server logs                                                          ``logs.ts``
GET     ``/logs/index/<filterPath>.json``                           Filtered server logs                                                      ``logs.ts``
======  ==========================================================  ========================================================================  ====================

Authentication
~~~~~~~~~~~~~~

Token-based: POST credentials to ``/host/login.json``, receive an
access and refresh token, send the access token on subsequent
requests, refresh when it expires.

**Implementation** (``src/api/auth.ts``, simplified: the real function also
logs and maps ``HttpError`` to a friendlier message):

.. code:: tsx

   import type { ApiClient } from './client';
   import { LoginResponseSchema, type LoginResponse } from './types';

   export async function login(
     client: ApiClient,
     credentials: LoginCredentials,
   ): Promise<LoginResponse> {
     // ZoneMinder expects form-encoded data for login
     const formData = new URLSearchParams();
     formData.append('user', credentials.user);
     formData.append('pass', credentials.pass);

     const response = await client.postForm<LoginResponse>('/host/login.json', formData);

     // Validate response shape with Zod
     return LoginResponseSchema.parse(response.data);
   }

``client.postForm`` / ``client.putForm`` take a ``URLSearchParams`` or a plain
record, serialize it to a string body, and set the
``application/x-www-form-urlencoded`` content-type. ZM's CakePHP API expects
this for login and most mutations. Use them instead of ``post``/``put`` with a
hand-built form body.

The returned ``LoginResponse`` carries ``access_token``,
``access_token_expires`` (seconds), ``refresh_token``, and
``refresh_token_expires``. The auth store converts the *_expires* fields to
absolute ms-epoch deadlines before persisting. Every API function takes the
``ApiClient`` it should use as its first argument; callers get one from
``getSession(profileId).client`` (``services/sessions.ts``). The client itself
comes from ``api/client.ts`` (CapacitorHttp on native, fetch on web and
Electron), and nothing calls raw ``fetch()``.

Only the refresh token is persisted, and never in plain localStorage. The
custom persist adapter in ``stores/auth.ts`` strips ``refreshToken`` out of the
serialized blob and writes it through ``setSecureValue`` from
``lib/security/secureStorage.ts`` (native Keychain/Keystore, AES-GCM on web)
under ``STORAGE_KEYS.authRefreshToken``:

.. code:: tsx

   // stores/auth.ts, persist storage adapter, trimmed
   const toStore = { ...value, state: { ...value.state, refreshToken: null } };

   if (value.state.refreshToken) {
     await setSecureValue(AUTH_REFRESH_TOKEN_KEY, value.state.refreshToken);
   }
   storage.setItem(name, JSON.stringify(toStore));

If secure storage is unavailable (no Web Crypto), the token is dropped rather
than written in plaintext, and the user re-authenticates. The access token is
never persisted at all, which has consequences on cold start (see the freshness
gate below).

Auth Gates
^^^^^^^^^^

``createApiClient`` (``src/api/client.ts``) needs the access token and the
profile's request timeout, and both live in zustand stores. It cannot import
them. ``stores/auth.ts`` imports ``api/auth.ts`` for the login and refresh
calls, and ``api/auth.ts`` imports ``api/client.ts`` for the ``ApiClient``
type, so an import from the client back to the store closes the loop:
``api/client.ts`` -> ``stores/auth.ts`` -> ``api/auth.ts`` ->
``api/client.ts``.

What the client takes instead is ``ApiClientGates``, a pair of narrow
interfaces: ``AuthGate`` (``getAccessToken``, ``getAccessTokenExpires``,
``isAuthenticated``, ``getFreshAccessToken``, ``proactiveLogin``,
``recoverFromAuthFailure``) and ``SettingsGate``
(``getApiTimeoutSeconds``). ``api/store-gates.ts`` is the one module that
imports both the stores and the client; ``makeProfileGates(profileId)``
assembles them from ``getState()`` calls, and
``createStoreApiClient(baseURL, reLogin, profileId)`` is the only caller of
``createApiClient``. ``services/sessions.ts`` is in turn the only caller of
that, so a client is always reached through ``getSession(profileId)``. Tests inject plain
object literals with the same method names, so no test mocks zustand to
exercise the client.

Single-flight state sits behind the gates rather than in the client. The
pending ``login``, ``getFreshAccessToken``, ``refreshAccessToken``,
``proactiveLogin``, and ``recoverFromAuthFailure`` promises are module-level
variables in ``stores/auth.ts``, keyed by profile, and
``resetAuthGates(profileId)`` clears that profile's five.
``dropSession(profileId)`` calls it while evicting the cached session, so a
rebuilt session cannot inherit a login, refresh, or recovery started for the
session it replaced; ``dropAllSessions()`` does the same for every profile.

The same DI-gate shape (module defines a narrow gate interface and a
setter, a store assembles the real implementation from ``getState()`` and
registers it once at load time) is used wherever a low-level module would
otherwise need a static import of a zustand store that itself depends on
that module, forming a cycle: ``lib/log-sanitizer.ts`` and
``lib/profile/profile-settings.ts`` (:doc:`12-shared-services-and-components`) take
their profile/settings reads this way, and
``services/pushNotifications.ts`` (:doc:`12-shared-services-and-components`)
takes its notifications/profile/auth reads this way. Refs #217.

Proactive Authentication
^^^^^^^^^^^^^^^^^^^^^^^^

Profiles rehydrate from localStorage at startup, but login takes a
few seconds. To avoid 401s, ``createApiClient`` checks authentication
before any non-login request, triggers login first, then retries the
original request:

.. code:: typescript

   // api/client.ts, inside request(method, url, data, config, hasRetried),
   // before the httpRequest call. hasRetried is the recursion guard: the
   // retry below passes true, so this branch runs at most once per request.
   if (!gates.auth.isAuthenticated() && !skipAuth && !isLoginRequest && reLogin && !hasRetried) {
     // Single-flight in the auth store: concurrent requests share one reLogin.
     const loginSuccess = await gates.auth.proactiveLogin(reLogin);

     if (!loginSuccess) {
       throw new Error('Authentication required but login failed');
     }

     // Retry original request with token
     return request(method, url, data, config, true);
   }

**Concurrent requests** share the same login attempt:
``proactiveLogin`` in ``stores/auth.ts`` holds a module-level
``pendingProactiveLogin`` promise, so the first request invokes
``reLogin`` and the rest attach to the same outcome.

**Reactive 401 handling.** If a request still returns 401 (e.g.
token expired mid-flight), the client runs the shared recovery and
retries once:

.. code:: typescript

   // api/client.ts, inside request(...), around the httpRequest call
   try {
     const response = await httpRequest<T>(fullUrl, { method, headers, params, /* ... */ });
     return response;
   } catch (error) {
     const httpError = error as HttpError;
     if (httpError.status === 401 && !hasRetried && !skipAuth && !isLoginRequest) {
       const recovered = await gates.auth.recoverFromAuthFailure(reLogin);
       if (recovered) {
         return request(method, url, data, config, true); // hasRetried=true prevents loops
       }
       // Recovery failed (logout already ran inside it). Fall through, log,
       // and propagate the original 401.
     }
     // ... error logging, then: throw error;
   }

``recoverFromAuthFailure`` in ``stores/auth.ts`` is single-flight: when a
token expires under a busy view (e.g. montage), every pending request
fails with 401 at once, the first caller runs refresh-then-reLogin, the
rest await the same outcome and retry once. The refresh goes through the
deduplicated ``refreshAccessToken``, so a recovery that starts while a
proactive refresh is pending attaches to the same POST instead of issuing
a second one. When refresh and reLogin both fail it logs out once and
resolves false; it never rejects. ``hasRetried`` ensures each request
attempts auth only once.

Access Token Freshness Gate
^^^^^^^^^^^^^^^^^^^^^^^^^^^

The background refresher in ``hooks/useTokenRefresh.ts`` keeps the
stored access token current on a 60-second cadence. That is enough for
calls routed through ``createApiClient``, which can intercept a 401
and retry. It is not enough for URLs that the browser or native runtime
loads directly: ZMS stream frames, event MP4s, event thumbnails, and
push-notification image backfills. Once a stale token is baked into a
``<img>`` or ``<video>`` ``src``, the request fires with no interceptor
in front of it. A 401 there shows up as a broken image, not a retry.

Stale tokens stay in play between refresh ticks for reasons the refresher
cannot fix on its own:

- ``setInterval`` is throttled or suspended when the tab is hidden or the
  device sleeps, so a token can be well past its leeway by the time the app
  wakes. ``useTokenRefresh`` compensates with a ``visibilitychange`` listener,
  but that fires after the first render of the restored view.
- React Query reads from cache before re-fetching, so a component can
  render with a token value that was correct one second ago and stale
  now.
- The auth store rehydrates from ``localStorage`` at startup with
  whatever ``accessTokenExpires`` was persisted last session.

``hooks/useFreshAccessToken.ts`` gates URL construction on this. The
hook reads ``accessToken``, ``accessTokenExpires``, and ``requiresAuth``
from the auth store and returns ``{ token, isFresh }``. On a server with
authentication disabled (``requiresAuth`` is false) no token is needed,
so ``isFresh`` is always true and ``token`` is null. On a server that
uses auth, a token is fresh only when it has more than
``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes) of validity left;
when it is not fresh the hook returns ``{ token: null, isFresh: false }``
and triggers ``authStore.getFreshAccessToken()`` from an effect. An effect is
React's escape hatch for work that is not rendering output: it runs after the
render commits, so the hook can return the "not fresh" answer immediately and
kick off the network call without blocking the paint. Subscribers re-render
once the new token lands.

.. code:: typescript

   // hooks/useFreshAccessToken.ts
   export function useFreshAccessToken(): FreshAccessToken {
     const accessToken = useAuthStore((state) => state.accessToken);
     const accessTokenExpires = useAuthStore((state) => state.accessTokenExpires);
     const requiresAuth = useAuthStore((state) => state.requiresAuth);
     const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);

     const tokenValid =
       !!accessToken &&
       !!accessTokenExpires &&
       accessTokenExpires - Date.now() > ZM_INTEGRATION.accessTokenLeewayMs;

     // A no-auth server needs no token, so it is always fresh.
     const isFresh = !requiresAuth || tokenValid;

     useEffect(() => {
       if (requiresAuth && !tokenValid) {
         void getFreshAccessToken();
       }
     }, [requiresAuth, tokenValid, getFreshAccessToken]);

     return { token: tokenValid ? accessToken : null, isFresh };
   }

Concurrent callers share one network round-trip. ``getFreshAccessToken``
in ``stores/auth.ts`` holds a module-level ``pendingFreshToken``
promise, so a montage view with twelve tiles plus an open hover preview
issues one ``/host/login.json`` refresh, not thirteen.

``getFreshAccessToken`` returns ``null`` early when the profile has no built
session yet, checked via ``hasActiveSession(profileId)`` from
``services/session-flags.ts``. The access token is never persisted (only the
refresh token is, see the persist adapter above), so on cold start a
token-bearing component mounts with ``requiresAuth`` true and no token and
calls this immediately, before profile bootstrap has built the session.
Without the gate that refresh throws, logs an error, and forces a logout, all
pointless because ``clearStaleState`` re-authenticates from stored credentials
regardless. ``session-flags.ts`` holds the set in a leaf module with no
imports, so ``stores/auth.ts`` can read it synchronously without an ``auth``
<-> ``services/sessions.ts`` load cycle; ``getSession`` and ``dropSession``
keep it in sync.

Callsites render a ``VideoOff`` placeholder while ``isFresh`` is
``false`` rather than building a URL with a stale or empty token:

.. code:: tsx

   // components/monitors/MonitorHoverPreview.tsx
   const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();

   if (!currentProfile || connKey === 0 || !isAccessTokenFresh) {
     return <VideoOff className="h-8 w-8 text-muted-foreground/40" />;
   }

   const streamUrl = getStreamUrl(currentProfile.cgiUrl, monitor.Id, {
     mode: 'jpeg',
     token: accessToken || undefined,
     connkey: connKey,
     minStreamingPort: effectiveMinStreamingPort,
   });

The hook is used by ``useMonitorStream``, ``MonitorHoverPreview``,
``MonitorRecentEvents``, ``EventThumbnailHoverPreview``,
``EventPreviewPopover``, ``TimelineScrubber``, ``ZmsEventPlayer``,
``NotificationHandler``, ``AskPanel``, ``Events``, ``EventDetail``,
and ``NotificationHistory``. Anything that builds a token-bearing URL the
runtime fetches directly should go through it (stores, which cannot call
hooks, read ``getFreshAccessToken()`` from the auth store instead).

The 30-minute leeway is deliberately larger than the 60-second
``tokenCheckInterval``. The background refresher prevents the leeway
window from being hit under normal operation; the gate exists to catch
the cases where it is hit anyway (return from sleep, cold start with a
near-expired persisted token, a refresh that failed and is being
retried).

Connection Keys (connkey)
~~~~~~~~~~~~~~~~~~~~~~~~~

Streaming URLs use connection keys in addition to tokens. A connkey names one
live ZMS stream so the client can later command that stream (pause, seek,
quit) instead of just consuming its bytes.

**Generation** (``src/stores/monitors.ts``):

Connection keys are generated and managed by the monitors store, not by a
component. A component-local counter would reset on remount and hand out a key
the server already has open. ``generateAndSetConnKey`` is the single private
helper both public actions call:

.. code:: tsx

   // stores/monitors.ts
   function generateAndSetConnKey(
     monitorId: string,
     set: (fn: (state: MonitorStore) => Partial<MonitorStore>) => void
   ): number {
     const newKey = Math.floor(Math.random() * 100000);
     set((state) => ({
       connKeys: { ...state.connKeys, [monitorId]: newKey },
     }));
     return newKey;
   }

The store returns a new object rather than editing ``state.connKeys`` in place.
Zustand compares the old and new values to decide who re-renders; an in-place
edit leaves the reference unchanged and every subscriber sleeps through it.

**Usage in stream URLs:**

.. code:: tsx

   const streamUrl = getStreamUrl(currentProfile.cgiUrl, monitorId, {
     mode: 'jpeg',
     connkey: connKey,
     token: accessToken || undefined,
   });

**Persistence:**

Connection keys are stored in the Zustand monitors store, persisted to
``localStorage`` under ``STORAGE_KEYS.monitorStore``. ``getConnKey(monitorId)``
returns the existing key if one is already stored, or generates a new one.
``regenerateConnKey`` always creates a fresh key (used on stream failure).
``clearConnKey`` removes the stored key, and the order in which
``useStreamLifecycle`` clears it relative to sending ``CMD_QUIT`` matters;
"Stream Lifecycle" below has the code and the reason.

Why stream URLs carry a cache buster, a port, and a mode
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Cache busting (``_t``)
^^^^^^^^^^^^^^^^^^^^^^

Browsers cache image URLs aggressively. In snapshot mode
or after a stream reconnects, the same URL would yield a stale frame.
``src/lib/zm/url-builder.ts`` appends a ``_t=<timestamp>`` cache buster:

::

   /cgi-bin/nph-zms?mode=jpeg&monitor=1&token=xyz&_t=1704358000000

Multi-port streaming
^^^^^^^^^^^^^^^^^^^^

Browsers cap concurrent connections per origin (typically 6). With
``minStreamingPort`` set (e.g. 30000) in the profile, each monitor
loads from a different port, monitor 1 from 30001, monitor 2 from
30002, and so on. Different ports are treated as different origins, so
the per-origin limit doesn't apply.

Streaming vs snapshot
^^^^^^^^^^^^^^^^^^^^^

- **Streaming** (``mode=jpeg``), long-lived MJPEG connection. Low
  latency, high bandwidth, holds an HTTP slot.
- **Snapshot**, single JPEG fetched every ``snapshotRefreshInterval``
  seconds. Lower resource use, lower frame rate.

Snapshot has two request shapes, picked per monitor. ``zms`` serves
``mode=single`` straight out of shared memory and never calls
``setLastViewed()``, so ``zmc`` sees no viewer. A monitor whose ``Decoding``
is anything but ``Always`` then stops decoding ten seconds after the last
real viewer, and every later snapshot returns the same frozen frame.
``mode=jpeg&frames=1`` runs one pass of the streaming loop instead, which
marks the monitor as viewed and keeps ``zmc`` decoding.

``useMonitorStream`` therefore sends ``mode=jpeg&frames=1`` only when the
monitor reports a ``Decoding`` other than ``ZM_DECODING_ALWAYS``, and
``mode=single`` otherwise: a monitor on ``Always`` never stops decoding and
does not need a stream, and a server that reports no ``Decoding`` at all is
older than the field. That fallback matters because ``frames=`` arrived
later than ``Decoding`` did: ``zms`` logs unknown parameters and keeps
streaming, so a ``frames=1`` request to a server without it would leave an
unbounded MJPEG connection open on every poll. The version check against
``ZMS_FRAMES_PARAM_MIN_VERSION`` closes the gap for the 1.37 development
builds that have ``Decoding`` but not ``frames=``.

Snapshot requests carry no ``connkey``. A connection key names a live
stream so the client can command it later, and nothing ever commands a
snapshot: ``useStreamLifecycle`` sends ``CMD_QUIT`` for streaming
connections only. Passing one to a ``frames=1`` jpeg request would also
make ``zms`` create a command socket and lock file per poll.

In snapshot mode, ``useMonitorStream`` exposes ``imageSrc`` for the
``<img>`` to bind to on every platform; this equals ``streamUrl``, so
the WebView or browser loads each snapshot URL directly as the cache
buster changes.

Per-platform transport
^^^^^^^^^^^^^^^^^^^^^^

Every platform fetches MJPEG feeds the same way: the ``<img>`` element loads
``nph-zms`` directly through the WebView or browser's network stack, and frame
memory is managed by that runtime (Chromium on web and Electron, the Android
WebView, WKWebView on iOS and iPadOS). There is no per-platform decoding path
and no JavaScript in the frame loop. The default view mode is Snapshot on all
four. The browser per-origin connection cap (~6 / origin) applies everywhere,
mitigated by Snapshot mode and multi-port streaming.

Go2RTC-enabled monitors take a different path on every platform: native
WebRTC/MSE/HLS into a ``<video>`` element, always continuous and
independent of the Streaming Mode setting. Everything described above is
the MJPEG (ZMS) path used when Go2RTC is off or unavailable.

How this app uses React Query
-----------------------------

Server state is managed with ``@tanstack/react-query``. :doc:`02-react-fundamentals`
teaches the model (a query is a keyed cache entry plus a fetch function; a
mutation writes and then invalidates keys). This section covers only what is
specific to zmNinjaNg, and none of it is guessable from the TanStack docs.

Query keys come from a factory
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Never write a key array inline. Every key comes from ``queryKeys`` in
``lib/query/query-keys.ts`` (the Server queries contract), and every key in a domain puts the
profile id in the same position, immediately after the domain name:

.. code:: tsx

   // lib/query/query-keys.ts
   monitors: (profileId: MaybeProfileId) => ['monitors', profileId] as const,
   monitor: (profileId: MaybeProfileId, monitorId: string | undefined) =>
     ['monitor', profileId, monitorId] as const,
   monitorAlarmStatus: (profileId: MaybeProfileId, monitorId: string | undefined) =>
     ['monitor-alarm-status', profileId, monitorId] as const,

React Query matches invalidations by array *prefix*: invalidating
``['events', profileId]`` marks every key that starts with those two elements
as stale, including ``['events', profileId, filters, limit, ...]``. That is
why the factory nests profile-scoped keys the way it does. Deleting one event
invalidates the whole ``events`` domain for that profile with a single call:

.. code:: tsx

   // pages/EventDetail.tsx
   await Promise.all([
     queryClient.invalidateQueries({ queryKey: queryKeys.event(currentProfile?.id, event.Event.Id) }),
     queryClient.invalidateQueries({ queryKey: queryKeys.events(currentProfile?.id) }),
   ]);

Put an optional parameter *before* the profile id in a key and prefix
invalidation silently stops matching: the domain-level invalidator no longer
shares a prefix with the leaf key, the leaf never refetches, and the list keeps
showing a deleted event until the next poll.

The new-events badge uses three keys off the same domain at three prefix widths,
so a caller can invalidate at exactly the scope it needs:

.. code:: tsx

   // lib/query/query-keys.ts
   monitorEventsSince: (p, monitorId, since) =>
     ['monitor-events-since', p, monitorId, since] as const,   // one monitor, one watermark
   monitorEventsSinceMonitor: (p, monitorId) =>
     ['monitor-events-since', p, monitorId] as const,          // one monitor, any watermark
   monitorEventsSinceAll: (p) =>
     ['monitor-events-since', p] as const,                     // every monitor

``monitorEventsSince`` is the leaf each count query runs under, keyed by the
watermark so stamping a new one refetches that monitor alone. Hiding a monitor
invalidates ``monitorEventsSinceAll`` to drop every count at once. When a
notification arrives, ``useNotificationBadgeNudge`` invalidates
``monitorEventsSinceMonitor``, the 3-element prefix, because it does not know that
monitor's current watermark and the prefix matches the leaf whatever the watermark
is.

Profile ids are the branded type ``ProfileId`` (``api/types.ts``), minted
through ``asProfileId()``. The branding means a key can only be scoped with a
string that came from a real profile. The primary cross-profile safety net is
still the global ``queryClient.clear()`` that ``stores/query-cache.ts`` runs on
profile switch; profile-scoped keys are defense in depth.

A few keys carry no profile id because the data is not tied to a server:
``queryKeys.developerNotices()`` is the only one today.

Stale time, and why fifteen seconds
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``staleTime`` is how long a cached response counts as fresh. While fresh, a
newly mounting subscriber reuses it and fires no request. zmNinjaNg sets it
globally to ``DEFAULT_QUERY_STALE_TIME_MS`` = 15000 ms:

.. code:: tsx

   // src/App.tsx
   const queryClient = new QueryClient({
     defaultOptions: {
       queries: {
         retry: shouldRetryQuery,
         refetchOnWindowFocus: false,
         staleTime: DEFAULT_QUERY_STALE_TIME_MS,
       },
     },
   });

   setQueryClient(queryClient);

Fifteen seconds is chosen to sit just under the shortest bandwidth-mode poll
(``monitorStatusInterval``, 20 s in Normal). Any longer and a monitor-status
refetch would land inside the fresh window and be skipped, which is exactly the
periodic refresh the user asked for. Any shorter and a query mounting right
after a network blip re-fetches, fails, and paints an error wall over data that
is fine.

``refetchInterval`` queries hit the server on their own schedule regardless of
``staleTime``. The setting mainly governs mount- and reconnect-triggered
refetches on queries without one: states, groups, tags, server info.

``refetchOnWindowFocus`` is off globally. ``refetchOnReconnect`` stays at the
TanStack default (``true``) so queries refresh once connectivity returns.
``gcTime`` (how long an unsubscribed cache entry survives before collection)
is left at the TanStack default of five minutes.

Two hooks override ``staleTime`` locally because their data barely moves:
``useGroups`` and the tags list in ``useEventTags`` use 5 minutes; the
per-event tag map in ``useEventTags`` uses 2 minutes because assigning a tag
should show up sooner than that.

Retries stop at auth errors
~~~~~~~~~~~~~~~~~~~~~~~~~~~

``shouldRetryQuery`` (``stores/query-cache.ts``) is the global ``retry``
predicate:

.. code:: tsx

   export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
     const status = (error as { status?: unknown } | null | undefined)?.status;
     if (status === 401 || status === 403) {
       return false;
     }
     return failureCount < MAX_QUERY_RETRIES;
   }

``MAX_QUERY_RETRIES`` is 1. 401 and 403 are never retried: the API client has
already run token refresh and a reLogin inside the request (see "Reactive 401
handling"), so an auth error that surfaces to React Query is final. Retrying it
adds latency and server load and changes nothing.

Offline behaviour, and the stale-over-error gate
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``useNetworkStatus()`` (``src/hooks/useNetworkStatus.ts``, see
:doc:`05-component-architecture`) drives a sticky ``OfflineBanner`` in
``AppLayout.tsx`` while the device or browser has no connectivity.

Pages that render an error wall gate it on the query *also* having no data:

.. code:: tsx

   // pages/Monitors.tsx
   if (error && !data) {
     return <ErrorBanner message={resolveQueryError(error, t, { fallbackKey: 'monitors.failed_to_load' })} />;
   }

So a background refetch failure (offline, server blip) while cached data is
already on screen falls through to the normal view instead of an error wall.
The ``OfflineBanner`` covers telling the user why. A cold start with no cached
data still hits the error wall.

Applied in ``pages/Monitors.tsx``, ``Montage.tsx``, and ``Events.tsx``.
``MonitorDetail.tsx`` and
``EventDetail.tsx`` keep the plain error wall: their guard already combines the
query error with other required values (``!monitor || !currentProfile``,
``!event``), and dropping the error term there changes what a falsy value
without an error means, so it was left alone rather than risk a subtle behavior
change.

Error walls always go through ``ErrorBanner`` (``components/ui/query-state.tsx``)
with ``resolveQueryError(err, t)`` (``lib/query/query-error.ts``), which folds a
401 into the localized auth prompt and everything else into a translated
fallback (the Query UI states contract). Never render ``error.message`` directly.

A request that never reached the server is resolved separately, and the test
for it is structural: it carries no ``status``, because there was no response
to take one from, while an HTTP error always has one. Do NOT match on the
message. The four adapters word this failure four different ways, and one of
them omits the address entirely:

.. list-table::
   :header-rows: 1

   * - Adapter
     - Message
   * - Android (``CapacitorHttpUrlConnection``)
     - ``failed to connect to /192.168.50.11 (port 11434) ...``
   * - Electron (Node)
     - ``connect ECONNREFUSED 192.168.50.11:11434``
   * - iOS (``URLSession``)
     - ``Could not connect to the server.``
   * - Browser (``fetch``)
     - ``Failed to fetch``

The leading slash in the Android form is ``InetSocketAddress.toString()``,
which prints ``hostname/literal-address``; a raw IP has no hostname, so the
hostname half comes out empty. That artifact used to reach users verbatim
through ``assistant.error_generic`` ("Ninjii error: {{error}}"), untranslated
in all five locales (refs #312).

The address therefore comes from the REQUEST, not the message. ``lib/http.ts``
stamps ``HttpError.host`` with ``new URL(fullUrl).host`` in its catch, the one
place that knows what was dialled, so the value is identical on every adapter
and exists even where the platform hides it. ``resolveQueryError`` renders
``common.cannot_reach_host`` with that host, which translates because its only
variable is an address rather than English platform prose.

Aborts are excluded: a cancelled request also has no ``status``, and a user
cancelling must not be told the server is unreachable. Use ``isAbortError``
here, not ``isTimeoutError``: the latter deliberately folds aborts into
timeouts for the assistant's retry logic, which is the opposite of what this
branch needs.

Refetch intervals come from bandwidth settings
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Any query that polls reads its interval from ``useBandwidthSettings()``, never
a literal (the Polling contract). The user's Normal/Low choice is the single lever that
changes network usage across every screen:

.. code:: tsx

   // pages/Monitors.tsx
   const { data, isLoading, error, refetch } = useQuery({
     queryKey: queryKeys.monitors(currentProfile?.id),
     queryFn: () => getMonitors(),
     enabled: !!currentProfile && isAuthenticated,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

See "Bandwidth Mode Settings" below for the property table.

Mutations invalidate; they do not write the cache
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

There is exactly one ``useMutation`` call site in the app, wrapping
``changeState`` (``pages/Server.tsx``). Everything else mutates through a
plain async handler and then invalidates.

No mutation in zmNinjaNg does an optimistic update. There is no ``onMutate``
anywhere in ``app/src``: nothing writes a predicted value into the cache and
rolls it back on failure. A mutation succeeds, invalidates the affected keys,
and lets the refetch supply the truth.

.. code:: tsx

   // pages/Server.tsx
   const changeStateMutation = useMutation({
     mutationFn: (stateName: string) => changeState(stateName),
     onSuccess: () => {
       toast({ title: t('common.success'), description: t('server.state_applied') });
       queryClient.invalidateQueries({ queryKey: queryKeys.states(currentProfile?.id) });
     },
     onError: (error) => {
       toast({ title: t('common.error'), description: t('server.state_apply_failed'),
               variant: 'destructive' });
       log.server('Failed to apply state/action', LogLevel.ERROR, error);
     },
   });

Run-state changes take seconds to settle on the server, so an optimistic write
would show the wrong state for longer than the refetch takes. If you add a
mutation where an optimistic write genuinely helps, it must snapshot and
restore through factory keys, not inline arrays.

Pagination without infinite queries
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The events list looks paginated but is not a ``useInfiniteQuery``. ZoneMinder's
events endpoint takes a ``limit``, and "Load More" raises that limit and
refetches the whole window. The key includes the limit, so each press is a new
cache entry:

.. code:: tsx

   // pages/Events.tsx
   const { data: eventsData, isLoading, isFetching, error, refetch } = useQuery({
     queryKey: queryKeys.eventsList(
       currentProfile?.id, filters, eventLimit, effectiveMonitorId,
       isGroupFilterActive, eventIdFilter, tagIdFilter,
     ),
     queryFn: () => getEvents({ ...filters, eventIds: eventIdFilter, tagIds: tagIdFilter, limit: eventLimit }),
     enabled: !!currentProfile && isAuthenticated,
     // Keep showing previous data while fetching more (prevents UI flash during pagination)
     placeholderData: keepPreviousData,
   });

``keepPreviousData`` is what makes that bearable: when the key changes, React
Query would normally drop to ``undefined`` while the new key loads, blanking
the list. ``placeholderData: keepPreviousData`` serves the previous key's data
until the new one arrives, and flags ``isFetching`` so the UI can show a
spinner without unmounting the rows.

How this goes wrong
~~~~~~~~~~~~~~~~~~~

The same failure modes recur, and the key factory only prevents part of the
last one.

**Forgetting the ``enabled`` gate.** A query runs on mount whether or not its
inputs exist. Without ``enabled``, a monitor-detail query fires with
``monitorId`` undefined, the API 404s or 401s, and the user sees an error wall
before a profile is even selected. Every profile-scoped query in this app
carries ``enabled: !!currentProfile && isAuthenticated`` or equivalent.

There is a v5 trap attached to this. For a *disabled* query, ``isLoading`` is
``false``, not ``true``: React Query reports it as idle, not pending. Effects
that self-heal or reset on ``!isLoading && !data`` will therefore fire against
a query that never ran. Gate those on ``isSuccess`` instead.

**Invalidating too narrow a prefix.** After hiding a monitor, invalidating only
``queryKeys.monitors(profileId)`` leaves stale events, console counts, timeline
rows, and montage tiles for a monitor the user just hid. The real handler
invalidates every domain the change touches:

.. code:: tsx

   // components/settings/HiddenMonitorsSection.tsx
   queryClient.invalidateQueries({ queryKey: queryKeys.monitors(currentProfile?.id) });
   queryClient.invalidateQueries({ queryKey: queryKeys.events(currentProfile?.id) });
   queryClient.invalidateQueries({ queryKey: queryKeys.monitorEventsSinceAll(currentProfile?.id) });
   queryClient.invalidateQueries({ queryKey: queryKeys.timelineEvents(currentProfile?.id) });
   queryClient.invalidateQueries({ queryKey: queryKeys.eventMontage(currentProfile?.id) });

Each of those is a domain-level factory entry that exists solely to be a
prefix. When you add a domain, add its bare ``(profileId)`` entry too, or
callers will invent narrower keys that miss.

**Reaching around the factory.** Writing ``queryKey: ['monitors']`` compiles
and works until a second profile exists, at which point two servers share one
cache entry. The factory removes the chance to forget the profile id. It does
not stop you from calling ``queryClient.setQueryData(['monitors'], ...)`` with
a hand-built array, which will silently miss the real entry (``['monitors',
profileId]``) and create a phantom one. Use the factory for reads and writes
alike.

Every recurring timer, and who owns it
--------------------------------------

App-level timers
~~~~~~~~~~~~~~~~

- **Token refresh** (``hooks/useTokenRefresh.ts``), every 60 s
  (``ZM_INTEGRATION.tokenCheckInterval``); if the access token expires within
  30 minutes (``accessTokenLeewayMs``), refresh it.
- **WebSocket keepalive** (``services/notifications.ts``), at the profile's
  ``wsKeepaliveInterval`` (60 s Normal, 120 s Low); sends a version-request
  ping. On disconnect, reconnects with exponential backoff.

**Token Refresh Implementation:**

.. code:: tsx

   // hooks/useTokenRefresh.ts, trimmed
   export function useTokenRefresh(): void {
     const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
     const accessTokenExpires = useAuthStore((state) => state.accessTokenExpires);
     const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);
     const isRefreshingRef = useRef(false);

     useEffect(() => {
       if (!isAuthenticated) return;

       const checkAndRefresh = async () => {
         if (accessTokenExpires && !isRefreshingRef.current) {
           const timeUntilExpiry = accessTokenExpires - Date.now();
           // Refresh if expiring soon OR already expired. Already-expired
           // tokens happen when the app returns from background and timers
           // were paused.
           if (timeUntilExpiry < ZM_INTEGRATION.accessTokenLeewayMs) {
             isRefreshingRef.current = true;
             try {
               // Route through getFreshAccessToken so concurrent refreshes
               // share one network call via the auth-store dedup.
               await getFreshAccessToken();
             } finally {
               isRefreshingRef.current = false;
             }
           }
         }
       };

       checkAndRefresh();
       const interval = setInterval(checkAndRefresh, ZM_INTEGRATION.tokenCheckInterval);

       const handleVisibilityChange = () => {
         if (document.visibilityState === 'visible') checkAndRefresh();
       };
       document.addEventListener('visibilitychange', handleVisibilityChange);

       return () => {
         clearInterval(interval);
         document.removeEventListener('visibilitychange', handleVisibilityChange);
       };
     }, [isAuthenticated, accessTokenExpires, getFreshAccessToken]);
   }

There is no ``timeUntilExpiry > 0`` guard, and that omission is deliberate:
an already-expired token must still be refreshed, and that is the exact
state the app wakes up in after the device sleeps. ``isRefreshingRef`` is a ``ref``,
not state: a ref holds a mutable value across renders without triggering one,
so flipping it cannot re-run the effect that owns it.

Screen-specific timers
~~~~~~~~~~~~~~~~~~~~~~

**Monitors** (``pages/Monitors.tsx``), the count of events recorded since the
user last looked at each monitor refreshes at ``monitorNewEventsInterval``
(60000 ms normal, 120000 ms low). ``useMonitorNewEvents`` runs one query per
monitor and sets that interval on each:

.. code:: tsx

   // hooks/useMonitorNewEvents.ts
   const results = useQueries({
     queries: monitorIds.map((monitorId) => {
       const since = watermarks[monitorId] ?? null;
       return {
         queryKey: queryKeys.monitorEventsSince(profileId, monitorId, since),
         queryFn: () => getMonitorEventsSince(monitorId, since),
         enabled: !!profileId && isAuthenticated,
         refetchInterval: bandwidth.monitorNewEventsInterval,
       };
     }),
   });

**Monitor Detail** (``pages/MonitorDetail.tsx`` via
``pages/hooks/useAlarmControl.ts``), alarm status polls at
``alarmStatusInterval``; monitor cycling on a user-configured interval
(``settings.monitorDetailCycleSeconds``, 0 disables it).

.. code:: tsx

   // pages/hooks/useAlarmControl.ts
   const { data: alarmStatus, isLoading: isAlarmLoading, refetch: refetchAlarmStatus } = useQuery({
     queryKey: queryKeys.monitorAlarmStatus(currentProfile?.id, monitorId),
     queryFn: () => getAlarmStatus(monitorId!, apiBaseUrl),
     enabled: !!monitorId,
     refetchInterval: bandwidth.alarmStatusInterval,
     refetchIntervalInBackground: true,
     refetchOnWindowFocus: false,
   });

Alarm status is the one poll that keeps running in the background
(``refetchIntervalInBackground: true``): the arm/disarm badge would otherwise
be wrong the instant the user returns to the tab.

**Montage** (``pages/Montage.tsx`` + ``MontageMonitor.tsx``), snapshot mode
reloads each image at ``snapshotRefreshInterval`` seconds; no timer in
streaming mode, because the MJPEG connection pushes frames on its own.

.. code:: tsx

   // hooks/useMonitorStream.ts, trimmed
   useEffect(() => {
     if (!enabled || effectiveViewMode !== 'snapshot') return;

     const interval = setInterval(() => {
       setCacheBuster(Date.now());  // Forces image reload
     }, settings.snapshotRefreshInterval * 1000);

     return () => clearInterval(interval);
   }, [enabled, effectiveViewMode, settings.snapshotRefreshInterval]);

The function an effect returns is its cleanup; React runs it before the next
run of the effect and once on unmount. Skip the ``clearInterval`` here and
every montage navigation leaves another timer hammering the server.

**Server** (``pages/Server.tsx``), daemon-status check at
``bandwidth.daemonCheckInterval`` under ``queryKeys.daemonCheck(profileId)``.
The other six queries on that page (servers, load, disk, states, timezone,
storages) have no ``refetchInterval`` and refresh only on mount.

Dashboard widget timers
~~~~~~~~~~~~~~~~~~~~~~~

- **EventsWidget**: ``bandwidth.eventsWidgetInterval``, overridable by a
  ``refreshInterval`` prop.
- **TimelineWidget** / **HeatmapWidget**: ``bandwidth.timelineHeatmapInterval``.
- **MonitorWidget**: snapshot reload at ``snapshotRefreshInterval``
  in snapshot mode; no timer in streaming mode.

The token and stream constants live in ``ZM_INTEGRATION`` in
``lib/zmninja-ng-constants.ts`` (the Constants contract), alongside ``httpTimeout`` (10 s),
``largeHttpTimeout`` (30 s for event responses), and ``loginInterval``
(30 min); the polling intervals above live in ``BANDWIDTH_SETTINGS`` in the
same file, as the next section covers. Import them; do not redeclare a
timeout per file.

Default request timeout
~~~~~~~~~~~~~~~~~~~~~~~

REST calls have no built-in timeout, so a stalled request (for example when
the HTTP connection pool is saturated by a burst of stream-teardown requests
on leaving the montage) would hang forever and leave the page stuck loading.
``createApiClient`` takes a ``profileId`` and applies the profile's
``apiTimeoutSeconds`` setting (``API_REQUEST.defaultTimeoutSeconds`` = 15 by
default; ``0`` disables it) as the default ``timeoutMs`` when the caller
doesn't pass one. Downloads (``onDownloadProgress`` or a binary
``responseType``) are exempt so large transfers are not cut off. The setting
lives in Advanced settings and is read at request time, so changes apply
without recreating the client. The ``CMD_QUIT`` stream-teardown request goes
through ``httpGet`` (not the API client), so ``useStreamLifecycle`` is passed
``apiTimeoutSeconds`` and applies the same timeout, keeping a slow quit from
holding a connection slot during bulk teardown.

The timeout is enforced on every transport. Web (``fetch``) and Electron use an
``AbortSignal`` from ``withTimeoutSignal``; Electron also passes ``timeoutMs`` to
the main process. The Capacitor native path has no ``AbortSignal``, so it sets
CapacitorHttp ``connectTimeout``/``readTimeout`` (so the native socket gives up)
and races the request against a JS timer (so the promise settles on time even
though the underlying native request can't be cancelled).

Bandwidth Mode Settings
~~~~~~~~~~~~~~~~~~~~~~~

Most polling intervals are controlled by the user's **bandwidth mode**
setting (Normal or Low), so users can cut network usage on metered
connections.

Both modes are defined in ``BANDWIDTH_SETTINGS`` in
``lib/zmninja-ng-constants.ts``. Read them with ``useBandwidthSettings()``
inside React, ``getBandwidthSettings(mode)`` outside it (services, stores).

The full property set, and where to look when a value seems wrong:

===============================  ======  =====  =========================================================
Property                         Normal  Low    Where used
===============================  ======  =====  =========================================================
``monitorStatusInterval``        20 s    40 s   ``pages/Monitors.tsx``, ``hooks/useMonitors.ts``, Montage
``alarmStatusInterval``          5 s     10 s   ``pages/hooks/useAlarmControl.ts``
``monitorNewEventsInterval``     60 s    120 s  ``hooks/useMonitorNewEvents.ts`` new-event badges
``eventsWidgetInterval``         30 s    60 s   ``components/dashboard/widgets/EventsWidget.tsx``
``timelineHeatmapInterval``      60 s    120 s  ``TimelineWidget.tsx``, ``HeatmapWidget.tsx``
``daemonCheckInterval``          30 s    60 s   ``pages/Server.tsx``
``snapshotRefreshInterval``      3 s     10 s   ``hooks/useMonitorStream.ts`` (snapshot mode)
``zmsStatusInterval``            3 s     5 s    ``components/events/ZmsEventPlayer.tsx`` playback poll
``eventPollerInterval``          30 s    60 s   ``services/eventPoller.ts`` (Direct mode, desktop/web)
``wsKeepaliveInterval``          60 s    120 s  ``services/notifications.ts`` keepalive ping
``timelineNowRefreshInterval``   30 s    60 s   ``components/timeline/TimelineCanvas.tsx`` now-line
``monitorRecentEventsInterval``  30 s    60 s   ``hooks/useMonitorRecentEvents.ts``
``streamMaxFps``                 10      5      Live stream URL construction
``imageScale``                   100%    50%    Image and stream requests
``imageQuality``                 100%    50%    Image requests
===============================  ======  =====  =========================================================

Two rows are indirect: ``snapshotRefreshInterval`` seeds the per-profile
setting ``useMonitorStream`` actually reads, and ``eventPollerInterval`` is
injected into the poller by ``stores/notifications.ts`` rather than read
inside it, where it acts as the Low-mode floor under the user's own
``pollingInterval`` choice.

**What does not use bandwidth settings:**

====================================  =============================  ===================================================================
Feature                               Interval                       Reason
====================================  =============================  ===================================================================
Groups (``useGroups``)                ``staleTime: 5 min``           Rarely change; no poll, just a long fresh window
Tags list (``useEventTags``)          ``staleTime: 5 min``           Rarely change
Per-event tag map (``useEventTags``)  ``staleTime: 2 min``           Assigning a tag should surface sooner than the tags list
Token expiry check                    60 s (``tokenCheckInterval``)  Security cadence, independent of network budget
Monitor cycle navigation              User-configured                A UI timer, not data fetching
One-time queries                      none                           Queries without ``refetchInterval`` (event lists, states, timezone)
====================================  =============================  ===================================================================

**When to add a bandwidth setting.** Use one for background polling that
fetches server data repeatedly, auto-refresh features on timers, and anything
that adds up to noticeable bandwidth over a session. Do not use one for
user-triggered actions, one-time fetches, or data that rarely changes (raise
``staleTime`` instead). The WebSocket keepalive *is* on a bandwidth setting
even though it is a protocol requirement: the protocol dictates that a ping
exists, not how often.

To add a property: extend the ``BandwidthSettings`` interface and both the
``normal`` and ``low`` objects. Low mode should be roughly twice as slow.

Timer rules
~~~~~~~~~~~

- Prefer ``refetchInterval`` to a manual ``setInterval``: React Query owns the
  cleanup and ties the timer to the query's subscriber count.
- For data polling, leave ``refetchIntervalInBackground`` at its default
  (``false``) so the poll stops when the app is backgrounded. Override it only
  when a stale value would be actively misleading on return, as with alarm
  status.
- For a manual ``setInterval``, always return a ``clearInterval`` from the
  effect.
- Guard the effect with the conditions that determine whether the timer should
  run at all, so you never start a no-op interval.

HTTP Client Architecture
------------------------

``src/lib/http.ts`` is the single HTTP entry point across Web, iOS, Android,
and Electron. Always use ``httpGet``, ``httpPost``, ``httpPut``, ``httpDelete``
from it. Never raw ``fetch()`` or a third-party HTTP library (the HTTP contract).

The transport is ``lib/http.ts``, its shared shapes are ``lib/http/types.ts``,
and it reads ``lib/platform.ts`` to pick an adapter. Above it:

::

   src/api/
   ├── auth.ts               # login(), refreshAccessToken(), getVersion()
   ├── client.ts             # createApiClient()
   ├── store-gates.ts        # createStoreApiClient(), makeProfileGates()
   ├── developer-notices.ts  # Developer notice feed
   ├── events.ts             # getEvents(), getEvent(), deleteEvent(), URL helpers
   ├── groups.ts             # getGroups()
   ├── logs.ts               # Server log endpoints
   ├── monitors.ts           # getMonitors(), getStreamUrl(), alarm + daemon calls
   ├── notifications.ts      # FCM token registration via ZM's Notifications API
   ├── server.ts             # getServers(), getStorages(), health checks, configs
   ├── states.ts             # getStates(), changeState()
   ├── tags.ts               # getTags(), extractUniqueTags(), getEventTags()
   ├── time.ts               # getServerTimeZone()
   ├── types.ts              # Zod schemas and TypeScript types
   └── zones.ts              # Zone endpoints

There is no ``api/streaming.ts``. Stream URL construction is ``getStreamUrl`` in
``api/monitors.ts``, which delegates to ``getMonitorStreamUrl`` in
``lib/zm/url-builder.ts``. Connkey generation lives in ``stores/monitors.ts``.

Platform implementations
~~~~~~~~~~~~~~~~~~~~~~~~

==================  =====================  ============================================
Platform            Implementation         Notes
==================  =====================  ============================================
iOS / Android       Capacitor HTTP plugin  Bypasses CORS, native networking, native TLS
Desktop (Electron)  Chromium fetch         Same code path as web
Web (dev)           fetch + proxy          Routes through ``localhost:3001``
Web (prod)          fetch                  Standard browser fetch
==================  =====================  ============================================

**Basic Usage:**

.. code:: tsx

   import { httpGet, httpPut } from '../lib/http';

   const response = await httpGet<MonitorsResponse>(
     `${apiUrl}/api/monitors.json`,
     { token: accessToken }
   );
   const monitors = response.data;

   await httpPut(
     `${apiUrl}/api/monitors/${id}.json`,
     { Monitor: updates },
     { token: accessToken }
   );

``httpPost`` takes the same shape as ``httpPut``: body second, options third.
``httpGet`` and ``httpDelete`` take no body, so options are the second
argument.

**Options** (``lib/http/types.ts``):

.. code:: tsx

   export interface HttpOptions {
     method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
     headers?: Record<string, string>;
     params?: Record<string, string | number>;
     body?: unknown;
     responseType?: 'json' | 'blob' | 'arraybuffer' | 'text' | 'base64';
     token?: string;                  // Injected into params
     timeoutMs?: number;
     timeout?: number;
     signal?: AbortSignal;
     validateStatus?: (status: number) => boolean;
     onDownloadProgress?: (progress: HttpProgress) => void;
     correlationId?: number;          // Ties the wire log to the api/client.ts request
     intent?: string;                 // Business-level label, e.g. "Fetch monitors list"
     suppressLog?: boolean;           // For high-frequency internal fetches (snapshot frames)
   }

``suppressLog`` exists because snapshot frames would otherwise emit a log line
every three seconds per tile. A suppressed call still logs genuine failures via
the caller.

Request/Response Correlation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every HTTP request is assigned a monotonically increasing correlation ID, and
``api/client.ts`` passes its own id down so a single line carries both.

::

   [HTTP] Request #1 GET https://server.com/api/monitors.json
     { requestId: 1, platform: 'Web', method: 'GET', url: '...' }

   [HTTP] Response #1 GET https://server.com/api/monitors.json
     { requestId: 1, platform: 'Web', status: 200, duration: '145ms' }

Failures log as ``[HTTP] Failed #N`` with the same id. That matters most when
tracing an auth flow, where one user action produces a request, a 401, a
refresh, and a retry that all look alike in the log.

Native (iOS/Android)
~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   // Used when Platform.isNative is true. Dynamic import: a static one
   // breaks the web bundle (the Native contract).
   const { CapacitorHttp } = await import('@capacitor/core');
   const response = await CapacitorHttp.request({
     method: 'GET',
     url: fullUrl,
     headers,
     data: body,
     responseType: 'json',
   });

Bypasses CORS, uses the native networking stack, handles TLS natively, and
supports self-signed certificates via the ``SSLTrust`` Capacitor plugin (see
``lib/security/ssl-trust.ts``).

Proxy Support (Development)
~~~~~~~~~~~~~~~~~~~~~~~~~~~

In development on web only, requests route through a local proxy to bypass
CORS. ``Platform.shouldUseProxy`` (``lib/platform.ts``) is true only when
``import.meta.env.DEV`` and the platform is web. Native bypasses CORS already;
production builds talk to the server directly.

The client rewrites ``https://server.com/api`` to
``http://localhost:3001/proxy/api`` and adds an ``X-Target-Host:
https://server.com`` header (``lib/http.ts``). The proxy forwards and returns
the response.

Pick a response type by platform
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

================== ===================== ====================
Type               Description           Use Case
================== ===================== ====================
``json`` (default) Parses JSON response  API responses
``text``           Returns raw text      HTML, plain text
``blob``           Returns Blob object   File downloads (web)
``arraybuffer``    Returns ArrayBuffer   Binary data
``base64``         Returns base64 string Mobile downloads
================== ===================== ====================

.. code:: tsx

   import { log, LogLevel } from '../lib/logger';

   // Web: blob
   const response = await httpGet<Blob>(url, {
     responseType: 'blob',
     onDownloadProgress: (progress) => {
       log.download('Download progress', LogLevel.DEBUG, { percentage: progress.percentage });
     },
   });

   // Mobile: base64, written straight to the filesystem
   const response = await httpGet<string>(url, { responseType: 'base64' });

On mobile, never convert to a Blob (the Native contract). A large MP4 held as a Blob in the
WebView heap will OOM the app.

Error Handling
~~~~~~~~~~~~~~

The HTTP client throws ``HttpError`` (``lib/http/types.ts``, re-exported from
``lib/http.ts``) for non-2xx responses. It is a plain ``Error`` with extra
fields, created by ``createHttpError``, not a subclass, so use a status check
rather than ``instanceof``:

.. code:: tsx

   export interface HttpError extends Error {
     status: number;
     statusText: string;
     data: unknown;
     headers: Record<string, string>;
   }

.. code:: tsx

   try {
     const response = await httpGet(url, { token });
     return response.data;
   } catch (error) {
     if ((error as HttpError).status === 404) {
       return null;
     }
     throw error;
   }

Inside React, do not hand-roll this branch. Let the error reach React Query and
render it through ``ErrorBanner`` + ``resolveQueryError`` (the Query UI states contract).

The client logs every non-2xx response at ERROR before the caller sees it. For
endpoints where a status is expected and handled, pass ``expectedStatuses`` so
the client logs that status at DEBUG instead. The request still rejects, so the
caller branches on it as before. Used by the event-tags probe, where a 404
means the server build predates tags rather than a real error:

.. code:: tsx

   // api/tags.ts
   const response = await client.get<EventTagsResponse>(url, { expectedStatuses: [404] });

Schema drift tolerance
----------------------

ZoneMinder changes what it sends between releases, and the Zod schemas in
``api/types.ts`` are the only thing between that and a blank screen. The policy,
enforced by tests in ``api/__tests__/types.test.ts`` and by the data-integrity
playbook (``agents/project/data-integrity.md``): a response must never fail because of a field.

There are two distinct hazards, and only one is about *new* fields.

A field ZoneMinder adds that we do not declare is already harmless, because Zod
strips unknown keys. The danger is the reverse: a field we *do* declare whose
type drifts. In ZM 1.38.3 ``V4LMultiBuffer`` began arriving as boolean ``false``
where ``MonitorSchema`` said ``z.string()``, and one field the app never reads
took every camera off the screen (#247).

Two helpers in ``lib/zm/schema-tolerance.ts`` handle it, and every schema in
``api/`` uses them rather than re-deriving the behavior:

- ``withFieldCatch(shape, identity)`` wraps every field except the named
  identity fields in ``.catch(fallback)``, where the fallback is read off the
  field's own Zod definition so it matches the declared type (nullable falls to
  null, a required string to ``''``, and so on). A drifted field falls back and
  the rest of the row survives. Identity fields (``Id``, ``Name``) stay strict:
  a fallback there would render a phantom entity.
- ``tolerantArray(itemSchema, label)`` drops the rows that fail instead of
  failing the whole array, so a monitor missing its ``Id`` costs only itself,
  not the list. It logs the dropped count so a real data problem stays visible.

A value whose vocabulary ZoneMinder controls, such as ``Monitor.Function`` or
``Zone.Type``, is ``z.string()``, never ``z.enum()``. An enum would fail the
response on a value a future release adds, and defaulting an unknown mode would
be worse than failing: it would report a recording camera as switched off. The
known values are kept as plain arrays (``KNOWN_MONITOR_FUNCTIONS``) for pickers,
not as the parse contract. Reads are tolerant; writes stay strict, since we
choose the values we send.

API Modules
-----------

The ``api/*.ts`` functions are thin: build a URL, call the client, validate
with Zod, return typed data. Business logic (filtering, merging, exclusion)
that must apply to *every* caller lives here too, at the API boundary, so no
screen can accidentally skip it.

Server API (``api/server.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Server info, storage, and health checks. Several functions accept an optional
``apiBaseUrl`` for multi-server routing (see ``lib/zm/server-resolver.ts``).

.. code:: typescript

   import { getServers, getStorages, getDaemonCheck, getLoad, getDiskPercent } from '../api/server';

   // All configured servers, with routing fields:
   // Protocol, Hostname, Port, PathToIndex, PathToZMS, PathToApi
   const servers = await getServers();

   // Storage info: ServerId, DiskTotalSpace, DiskUsedSpace
   const storages = await getStorages();

   const daemonOk = await getDaemonCheck();                      // profile default server
   const daemonOk2 = await getDaemonCheck('https://server2/zm'); // specific server
   const load = await getLoad(apiBaseUrl);
   const disk = await getDiskPercent(apiBaseUrl);

When ``apiBaseUrl`` is omitted, requests go to the profile's default API URL.
The Server page passes it to display per-server health in a multi-server setup.
``getConfigs()`` and ``fetchMinStreamingPort()`` live here too; the latter reads
``ZM_MIN_STREAMING_PORT`` and drives multi-port streaming.

Monitor API (``api/monitors.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Monitor functions that touch per-monitor daemons or alarms accept an optional
``apiBaseUrl`` for multi-server routing.

.. code:: typescript

   import {
     getMonitors,
     getDaemonStatus,
     getAlarmStatus,
     triggerAlarm,
     cancelAlarm,
     controlMonitor,
     getStreamUrl,
   } from '../api/monitors';

   const { monitors } = await getMonitors();

   // Routed to the server hosting this monitor
   const status = await getDaemonStatus(monitorId, 'zmc', apiBaseUrl);
   const alarm = await getAlarmStatus(monitorId, apiBaseUrl);
   await triggerAlarm(monitorId, apiBaseUrl);
   await cancelAlarm(monitorId, apiBaseUrl);

   // PTZ, multi-port aware
   await controlMonitor(portalUrl, monitorId, command, token, minStreamingPort);

``controlMonitor`` accepts ``minStreamingPort`` to compute the per-monitor port
as ``minStreamingPort + parseInt(monitorId)``.

``getStreamUrl(cgiUrl, monitorId, options)`` builds an ``nph-zms`` URL. Options
are ``mode`` (``'jpeg' | 'single' | 'stream'``), ``scale``, ``width``,
``height``, ``maxfps``, ``buffer``, ``token``, ``connkey``, ``cacheBuster``,
and ``minStreamingPort``. It wraps the result in ``wrapWithImageProxy`` so the
dev proxy applies on web.

Event URL helpers (``api/events.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every event URL builder takes ``portalUrl`` and ``eventId`` as positional
arguments (not an event object), with multi-port and HLS support in options:

.. code:: typescript

   export function getEventImageUrl(
     portalUrl: string,
     eventId: string,
     frame: number | 'snapshot' | 'alarm' | 'objdetect' | string,
     options: { token?: string; width?: number; height?: number; apiUrl?: string;
                minStreamingPort?: number; monitorId?: string } = {},
   ): string;

   export function getEventVideoUrl(
     portalUrl: string,
     eventId: string,
     token?: string,
     apiUrl?: string,
     hls?: boolean,
     minStreamingPort?: number,
     monitorId?: string,
   ): string;

   export function getEventZmsUrl(
     portalUrl: string,
     eventId: string,
     options: { token?: string; apiUrl?: string; frame?: number; rate?: number;
                maxfps?: number; replay?: 'single' | 'all' | 'gapless' | 'none';
                scale?: number; minStreamingPort?: number; monitorId?: string } = {},
   ): string;

The caller decides HLS, not the helper. ``EventDetail.tsx`` inspects the event's
``DefaultVideo`` field, computes ``isHlsEvent``, and passes it through:

.. code:: tsx

   // pages/EventDetail.tsx
   getEventVideoUrl(
     resolvedPortalUrl, eventIdForUrls, accessToken || undefined,
     currentProfile.apiUrl, isHlsEvent, effectiveMinStreamingPort, monitorIdForUrls,
   );

When ``hls`` is true the builder emits ``view_event_hls`` for the m3u8 manifest;
otherwise ``mode=mp4``.

Monitor Exclusion
~~~~~~~~~~~~~~~~~

Each profile can hide monitors. The hidden IDs live in
``excludedMonitorIds`` on the profile's settings, and the exclusion is
applied at the API boundary so hidden monitors never enter the rest of the
app.

``getMonitors`` drops excluded monitors by default. Callers that need the full
list, such as the Settings UI that restores monitors, pass ``includeExcluded``:

.. code:: typescript

   export async function getMonitors(
     options?: { includeExcluded?: boolean }
   ): Promise<MonitorsResponse>

   const visible = await getMonitors();                          // excluded removed
   const all = await getMonitors({ includeExcluded: true });     // full list

Deleted monitors are always dropped. The per-profile exclusion is applied
afterwards via ``filterExcludedMonitors`` (``lib/monitor/filters.ts``, see
:doc:`12-shared-services-and-components`) using IDs from
``getExcludedMonitorIds``.

The events API filters the same way. After fetching and deduplicating events,
it removes any event whose ``MonitorId`` is in the excluded set, so events for
hidden monitors do not show in event lists, the console, montage, or the
timeline.

Dropping events after the fetch leaves the server's ``totalCount`` counting
hidden events, which keeps "Load More" running past the visible end (refs #205).
So the events list also narrows the query: when monitors are excluded and the
user has not picked a monitor or group, ``Events.tsx`` sends the included
monitor IDs (``includedMonitorIdParam`` in ``src/lib/monitor/filters.ts``) as the
``MonitorId`` filter. The post-fetch drop stays as a safety net for callers that
do not pass that filter (timeline, console) and for races where a monitor is
hidden mid-session.

Filtering by event ID (favorites)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Favorites are stored locally (``stores/eventFavorites.ts``), so the server
does not know about them. Filtering the list client-side after a server page
breaks pagination: a favorite past the first 100-event page is never fetched,
so it cannot be shown, and ``totalCount`` keeps counting non-favorites, so
"Load More" never stops (refs #205).

``getEvents`` instead accepts an ``eventIds`` array and pushes it to the server
as an ``Id IN:<id1,id2,...>`` filter segment, composed (AND) with the other
filters. ``Events.tsx`` passes the favorite IDs when the favorites-only toggle
is on:

.. code:: tsx

   const eventIdFilter = favoritesOnly ? favoriteIds : undefined;
   getEvents({ ...filters, eventIds: eventIdFilter, limit: currentEventLimit });

Behavior of the ``eventIds`` path:

- ``undefined`` means no ID filter (normal query).
- An empty array matches nothing and returns an empty list without a request.
- The IDs are chunked by ``API_PAGINATION.eventIdFilterChunkSize`` (200) to
  stay under ZM's request-line length limit (HTTP 414 above ~500 IDs on ZM
  1.36). Each chunk is fetched in full by ``fetchEventsByVariants``, then the
  chunks are merged, de-duplicated, ordered by ``StartDateTime``, and sliced to
  ``limit``.
- ``totalCount`` reflects the matched set, so "Load More" disappears once every
  matching event is shown.

Filtering by archived status
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``EventFilters.archived`` (declared in ``src/api/types.ts``, re-exported from
``src/api/events.ts``) is a boolean that, when
``true``, adds an ``Archived:1`` path segment to the server query. The segment
is composed with the monitor, date, favorites, and tag filter segments in the
same AND chain. When ``archived`` is ``undefined`` or ``false``, no segment is
added and the server returns all events regardless of archived status.

``archivedOnly`` in ``useEventFilters`` mirrors ``favoritesOnly``: the state
is persisted per profile in ``settings.eventsPageFilters.archivedOnly``,
reflected in the ``archived=true`` URL search parameter, and counted in the
active-filter badge. Archiving or unarchiving an event is a separate action
(``setEventArchived`` in ``src/api/events.ts``) available in the event detail
screen.

Counting new events per monitor (``getMonitorEventsSince``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``getMonitorEventsSince(monitorId, since)`` backs the new-event badge on each
monitor card: it answers how many events a monitor recorded after the user last
looked at it. It requests ``limit=1``, ``sort=StartDateTime``, ``direction=desc``
and returns ``{ count, newest }``, reading ``count`` from ``pagination.count``
and ``newest`` from ``events[0].Event.StartDateTime``. One response carries both
the badge number and the timestamp the card stamps as the next watermark, so the
card never issues a request to discover a timestamp it already holds. Stamping
does move the watermark, which is part of the query key, so that monitor's count
query refetches once and returns zero.

.. code:: typescript

   // src/api/events.ts
   export async function getMonitorEventsSince(
     monitorId: string,
     since: string | null
   ): Promise<{ count: number; newest: string | null }>

The filter segment is ``StartDateTime >:<since>``, a strict ``>``. ``>=`` was
checked against ZoneMinder 1.39.1 and matches the watermark event itself, which
would leave a caught-up monitor showing a permanent "1 new" for an event the
user had already seen. A ``since`` of ``null`` means no watermark yet, so the
``StartDateTime`` segment is dropped and every event counts. :doc:`call-flows`
Flow 18 traces the badge from this call to the store that clears it.

Monitor Groups API (``api/groups.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Fetches monitor groups, which the ``GroupFilterSelect`` component uses to
filter monitors in the Monitors and Montage views.

.. code:: tsx

   import { getGroups } from '../api/groups';

   const response = await getGroups();
   // response.groups: Group[]

.. code:: tsx

   interface Group {
     Id: string;
     Name: string;
     ParentId: string | null;  // For hierarchical groups
     MonitorIds: string;       // Comma-separated list of monitor IDs
   }

``useGroups`` wraps this with ``queryKeys.groups(profileId)`` and a 5-minute
``staleTime``.

Account Permissions API (``api/users.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ZoneMinder has no endpoint for "what may the current user do". The permission
columns live on the Users row, and ``UsersController`` gates ``/users.json`` on
``System() != 'None'``, so an account can read its own permissions only when it
already has some system access. ``fetchAccountPermissions`` works with that
shape rather than around it:

.. code:: tsx

   import { fetchAccountPermissions } from '../api/users';

   // Matches the row whose Username equals the profile's, case-insensitively.
   const permissions = await fetchAccountPermissions(client, profile.username);

Three results, each meaning something different:

- The account's columns, when the list came back and contained its row.
- ``SYSTEM_NONE_PERMISSIONS`` when the server answered 401. That refusal is
  itself an answer: it proves ``System`` is ``'None'``, and leaves every other
  column unknown.
- ``undefined`` when the list came back without a matching row, which happens
  if ZoneMinder maps the token to a name the profile does not store. Gating a
  session on somebody else's row would be worse than knowing nothing.

A profile with no username talks to a server with ``ZM_OPT_USE_AUTH`` off,
where ZoneMinder short-circuits every check on ``!$user``. That returns
``UNRESTRICTED_PERMISSIONS`` without a request.

Transport failures reject, so the query retries them. A privilege refusal does
not: retrying spends requests to be told the same thing.

Every consumer asks ``lib/permissions/zm-permissions.ts`` for a verdict rather
than reading a column, and every verdict has three values:

.. code:: tsx

   import { canViewStream } from '../lib/permissions/zm-permissions';

   canViewStream(permissions); // 'allowed' | 'denied' | 'unknown'

Only ``denied`` may hide or grey a control. ``unknown`` has to leave the
surface exactly as it was, because ``System='None'`` with ``Monitors='Edit'``
is a legal ZoneMinder account: guessing there takes a feature away from someone
who has it. ``usePermissions(profileId)`` wraps the fetch with
``queryKeys.accountPermissions(profileId)`` and an infinite ``staleTime``. It
takes an explicit profile id because an aggregate has no account of its own;
in All mode each monitor and event belongs to a real profile, and that owner's
permissions are the ones that decide what its controls can do.

Event Tags API (``api/tags.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Tags are labels assigned to events ("person", "car", "cat"). Not every
ZoneMinder build supports them, so this module degrades instead of throwing.
Its three exports:

.. code:: tsx

   import { getTags, extractUniqueTags, getEventTags } from '../api/tags';

   // All available tags. Returns null (not a throw) if the server lacks tag
   // support (404) or the user lacks permission (401/403).
   const tagsResponse = await getTags();
   const tags = tagsResponse ? extractUniqueTags(tagsResponse) : [];

   // Tags for specific events, batched at TAGS_BATCH_SIZE (100) per request.
   // Returns Map<eventId, Tag[]>, or null if not supported.
   const eventTagMap = await getEventTags(['123', '456', '789']);

There is no ``checkTagsSupported``. Support detection is the ``null`` return of
``getTags`` itself. ``getTags`` returns the API's tag/event association rows,
which repeat a tag once per associated event; ``extractUniqueTags``
de-duplicates them by ID.

.. code:: tsx

   interface Tag {
     Id: string;
     Name: string;
     CreateDate: string;
     CreatedBy: string;
     LastAssignedDate: string;
   }

Keys come from the factory: ``queryKeys.tags(profileId)`` and
``queryKeys.eventTags(profileId, sortedEventIds)``. The event IDs are sorted
before they enter the key, because React Query hashes the key structurally and
``['1','2']`` would otherwise miss the cache entry stored under ``['2','1']``.

``getEventTags`` is a forward lookup (event IDs to their tags) used to show tag
chips on the events already on screen. Filtering the list *by* tag is the
reverse, and is done server-side: ``getEvents`` accepts ``tagIds`` and queries
``/events/index/Tags.Id:<id>.json``, so tagged events past the first page stay
reachable and ``totalCount`` is accurate (same pagination concern as favorites,
refs #205).

ZoneMinder rejects ``Tags.Id IN:`` and cannot combine ``Tags.Id:`` with the
favorites ``Id IN:`` filter in one query, so:

- Each selected tag is a separate ``Tags.Id:<id>`` request; the results are
  merged by ``fetchEventsByVariants`` (the same merge used for favorites
  chunks). "All tags" expands to every available tag ID.
- When the favorites toggle is also on, tags are not sent to the server.
  ``Events.tsx`` filters the (fully fetched) favorite set by tag client-side
  instead, which is accurate because the whole favorite set is in hand.

Adjacent Event Navigation
~~~~~~~~~~~~~~~~~~~~~~~~~

``getAdjacentEvent`` (``src/api/events.ts``) fetches a single event adjacent to
a given timestamp. ``hooks/useEventNavigation.ts`` uses it for prev/next
navigation in EventDetail.

.. code:: typescript

   export async function getAdjacentEvent(
     direction: 'next' | 'prev',
     currentStartDateTime: string,
     filters?: EventFilters
   ): Promise<EventData | null>

It builds a ZM filter path using ``StartDateTime >`` (next) or
``StartDateTime <`` (prev) relative to the timestamp, applies the same
server-side filters as the events list (``monitorId``, ``minAlarmFrames``,
``notesRegexp``), requests one result sorted ascending (next) or descending
(prev), and returns the closest match or ``null``.

Fetching one adjacent event per press, rather than paging the list, is what
lets prev/next work from a deep-linked event whose neighbours were never in any
list the app loaded.

Continuous playback (#250) reuses this same path. The event player calls
``onEnded`` when a video finishes (video.js ``ended`` for MP4/HLS, or the
``progress / duration >= 0.99`` end signal already tracked by the ZMS player).
``EventDetail`` responds by calling ``goToNextEvent`` when the
``eventContinuousPlay`` profile setting is on. That is why ``goToNextEvent`` now
resolves ``Promise<boolean>``: the auto-advance needs to know whether a next
event existed. On ``false`` (the filtered list is exhausted) it stops and shows
a "no more videos" toast rather than looping. Advancing goes through the same
``navigateToEvent(id, 'left')`` call as the next button, so the new event slides
in from the right with no extra animation code. Speed carries across the run via
the ``eventPlaybackRate`` setting, applied to both players (video.js
``playbackRate`` for MP4, ``CMD_VARPLAY`` rate for ZMS). Mute carries the same
way through ``eventPlaybackMuted``, MP4 only, since ZMS has no audio (refs #463).

Notifications API (``api/notifications.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages FCM push token registration through ZoneMinder's Notifications REST
API. Used in Direct ZM notification mode, where tokens are registered via REST
instead of over the Event Server WebSocket.

.. code:: tsx

   import {
     registerToken,
     updateNotification,
     deleteNotification,
     checkNotificationsApiSupport,
   } from '../api/notifications';

   // false on 404 (older ZM builds), throws on anything else
   const supported = await checkNotificationsApiSupport();

   // Register or upsert an FCM token. POST with an existing token updates the row.
   const notif = await registerToken({
     token: fcmToken,
     platform: 'android',
     monitorList: '1,2,3',
     interval: 60,
     pushState: 'enabled',
     appVersion: '2.0.0',
   });

   await updateNotification(notif.Id, { monitorList: '1,2', interval: 30 });
   await deleteNotification(notif.Id);

Both writes go through ``client.postForm`` / ``client.putForm`` with
``Notification[Field]`` keys, the CakePHP form convention. Registrations are
user-scoped: the server only returns the current user's tokens.

Notification Delivery Services
------------------------------

Which service delivers an event to the user depends on notification mode and
platform. ``components/NotificationHandler.tsx`` is the headless component that
turns delivered events into toasts; it mounts
``hooks/useNotificationAutoConnect.ts``, which owns the choice of service and
the listeners that keep it alive.

WebSocket to the Event Server (``services/notifications.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Connects to ``zmeventnotification.pl`` for real-time alarms in ES mode.
Singleton via ``getNotificationService()``.

**Reconnection:**

- Exponential backoff with jitter: 2 s, 4 s, 8 s, 16 s, capped at 2 minutes
  (``baseReconnectDelay`` 2000, ``maxReconnectDelay`` 120000).
- Jitter of ±25% prevents a thundering herd when many clients reconnect.
- Reconnection continues indefinitely until the user explicitly disconnects.
  An ``intentionalDisconnect`` flag distinguishes a user-initiated disconnect
  from a network failure; only the former stops reconnection.
- ``reconnectAttempts`` resets after successful *authentication*, not on socket
  open, so a server that accepts the socket and then rejects the credentials
  cannot reset the backoff into a hot loop.

**Liveness:**

- Keepalive ping (a version request) at the profile's bandwidth
  ``wsKeepaliveInterval``: 60 s Normal, 120 s Low. This is a bandwidth setting,
  read through ``providers.getKeepaliveIntervalMs()``, not a hardcoded value.
- ``checkAlive(timeoutMs)`` sends a version request and resolves true/false on
  whether a response arrives in time. ``useNotificationAutoConnect`` calls it
  on app resume (mobile ``appStateChange``) and tab visibility change (desktop
  ``visibilitychange``) to detect a socket the OS killed while backgrounded.
  It only runs when the store still believes it is connected; a resume that
  finds the state already disconnected skips the ping and reconnects at once,
  because the backoff timer was frozen along with the rest of the WebView.
- ``reconnectNow(force)`` fires on network restore. ``useNotificationAutoConnect``
  listens to ``window.addEventListener('online')`` on desktop/web and
  ``@capacitor/network`` on mobile. Without ``force`` it declines to act while
  the state is connected, connecting, or authenticating. A failed liveness check
  passes ``force``: a socket that outlived an app suspension reads as ``OPEN``
  with a dead peer, so the caller that proved it is gone would otherwise be the
  one caller turned away (refs #274). Forcing closes the stale socket first,
  clearing ``this.ws`` so the late close event fails the handler identity guard
  and cannot schedule a second, competing reconnect.
- Every failure path ends in either a live socket or a scheduled reconnect. A
  ``WebSocket`` constructor throw produces no close event, so ``_connect``
  schedules the retry from its own catch; the auth timeout closes the socket but
  leaves ``this.ws`` set so ``_handleClose`` runs and schedules it there.

The service imports no stores. ``stores/notifications.ts`` injects a
``ZMNotificationProviders`` object at connect time carrying the fresh-token
getter, the event image URL builder, and the keepalive interval getter. The
module-level ``DEFAULT_PROVIDERS`` fallback supplies a no-token, normal-bandwidth
default for the temporary deregistration connection in ``pushNotifications.ts``.

Event poller (``services/eventPoller.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Polls the ZM events API for new events in Direct notification mode on desktop
(Electron) and web. Singleton via ``getEventPoller()``. On mobile, FCM push
handles delivery and the poller never starts.

``useNotificationAutoConnect`` decides: when ``notificationMode`` is
``'direct'`` and ``Platform.isDesktopOrWeb``, it calls
``startEventPoller(profileId)``, exported by ``stores/notifications.ts``. That
wiring function builds ``EventPollerDeps`` (event sink, token provider,
``getPollIntervalMs``, portal URL, multi-port lookup); the poller itself has no
store imports.

- Poll interval comes from ``resolvePollIntervalMs`` in
  ``stores/notifications.ts``: the profile's own ``pollingInterval`` (the
  Notification settings dropdown) wins, and Low bandwidth mode floors it at
  ``eventPollerInterval`` so the mode can never be made faster than itself.
  A missing or nonsensical stored value falls back to the bandwidth default.
- Scheduling is a recursive ``setTimeout``, not ``setInterval``, so an interval
  change (the user picking a new cadence, or switching to Low mode) takes effect
  on the next tick rather than being frozen at the value captured when the timer
  was created.
- A ``seenEventIds`` set, trimmed once it exceeds 500 entries, suppresses
  duplicate notifications across polls.
- When ``onlyDetectedEvents`` is enabled in notification settings, the poller
  adds a ``Notes REGEXP:detected:`` filter, limiting results to events carrying
  object-detection data.

Push registration (``services/pushNotifications.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

FCM handling for iOS and Android. Singleton via ``getPushService()``. Requests
permission, obtains the FCM token, and registers it with the server: over the
WebSocket in ES mode, through ``api/notifications.ts`` in Direct mode.

A foreground push is added to the notification store, unless the WebSocket is
already connected, in which case it is dropped to avoid showing the same event
twice. Tapping a notification navigates to the event detail screen.

Like the API client, this service takes its store reads through a gate
(``PushServiceStoreGates`` via ``setPushServiceStoreGates``, registered by
``stores/notifications.ts`` at module load). See
:doc:`12-shared-services-and-components`. Refs #217.

End-to-end Flow: Viewing Monitors
---------------------------------

1. ``pages/Monitors.tsx`` calls ``useQuery({ queryKey:
   queryKeys.monitors(currentProfile?.id), queryFn: () => getMonitors(),
   enabled: !!currentProfile && isAuthenticated, refetchInterval:
   bandwidth.monitorStatusInterval })``.
2. ``getMonitors`` (``src/api/monitors.ts``) calls ``client.get('/monitors.json')``,
   validates the response against ``MonitorsResponseSchema``, drops deleted
   monitors, then drops this profile's excluded monitors.
3. ``api/client.ts`` checks authentication first and runs ``proactiveLogin`` if
   needed, then hands the request to ``lib/http.ts``.
4. ``lib/http.ts`` injects the token, assigns a correlation ID, and dispatches
   via the platform implementation: ``fetch`` on web (with the dev proxy),
   CapacitorHttp on iOS/Android, Chromium fetch on Electron.
5. Response and duration are logged with the same correlation ID, and React
   Query stores the validated data under the profile-scoped key.
6. ``Monitors.tsx`` maps the (group-filtered) list to one ``MonitorCard`` per
   monitor; each card calls ``useMonitorStream({ monitorId })``, which gates on
   ``useFreshAccessToken()``, takes a connkey from the monitors store, builds a
   URL through ``getStreamUrl``, and renders an ``<img>``.

The stream URL never touches React Query. It is a plain string handed to the
browser, which is the whole reason the freshness gate exists.

ZoneMinder Streaming Protocol
-----------------------------

Video streams are served by a separate ZoneMinder daemon (ZMS). Tracking the
stream lifecycle correctly avoids leaving zombie streams on the server.

Stream Lifecycle
~~~~~~~~~~~~~~~~

**1. Connection key generation**

``useStreamLifecycle`` subscribes to the store's ``regenerateConnKey`` action
and calls it whenever the stream needs a fresh connection, reaching for
``useMonitorStore.getState()`` in its unmount cleanup where a subscription
would be stale. See "Connection Keys" above for the store code. Keys are
per-monitor and persisted, never a component-local counter.

**2. Stream URL construction**

.. code:: tsx

   // hooks/useMonitorStream.ts
   const streamUrl = currentProfile && connKey !== 0 && isAccessTokenFresh
     ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
         mode: effectiveViewMode === 'snapshot' ? 'single' : 'jpeg',
         scale: bandwidth.imageScale,
         maxfps: effectiveViewMode === 'streaming' ? settings.streamMaxFps : undefined,
         token: accessToken || undefined,
         connkey: connKey,
         cacheBuster: effectiveViewMode === 'snapshot' ? cacheBuster : undefined,
         minStreamingPort: effectiveMinStreamingPort,
       })
     : '';

A profile, a nonzero connkey, and a fresh token all have to be present. Any
one of them missing produces an empty string, and the consumer renders a
placeholder instead of an ``<img>`` pointed at a broken URL.

**3. Cleanup with CMD_QUIT**

When a stream is no longer needed, ``useStreamLifecycle`` builds the quit URL
for the *old* connkey, clears that key from the store, and only then awaits
the ``CMD_QUIT`` (17) request. The order is deliberate (the source comment
says so): a fast remount must find the store empty and mint a fresh key, not
reuse one attached to a stream that is mid-quit. The clear is conditional on
the stored key still being the one this teardown quit, read through
``useMonitorStore.getState()`` rather than a subscription: if a concurrent
mount already regenerated the key, that newer key survives.

.. code:: tsx

   // hooks/useStreamLifecycle.ts, trimmed (the real code awaits inside try/catch)
   const controlUrl = getZmsControlUrl(
     portalUrl,
     ZMS_COMMANDS.cmdQuit,
     prevConnKeyRef.current.toString(),
     { token: accessToken || undefined, minStreamingPort, monitorId },
   );

   httpGet(controlUrl, { timeoutMs: cmdQuitTimeoutMs }).catch(() => {
     // Silently ignore errors - connection may already be closed
   });

The quit goes through ``httpGet``, not the API client, because it targets
``nph-zms`` rather than the REST API. It carries the profile's
``apiTimeoutSeconds`` so a slow quit cannot hold a connection slot while a
montage tears down twelve streams at once.

``ZmsEventPlayer`` and ``EventThumbnailHoverPreview`` quit through
``lib/zm/zms-quit.ts`` instead (``sendDelayedCmdQuit`` / ``cancelPendingQuit``),
which delays the quit by ``ZM_INTEGRATION.cmdQuitGraceMs`` (150 ms). React's
StrictMode double-mounts components in development; without the grace window,
the first mount's cleanup would kill the stream the surviving mount is using,
and ``cancelPendingQuit`` is what the surviving mount calls to stop it.

Never render without a valid connkey
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A stream started with ``connKey=0`` creates a zombie that cannot be terminated:
``CMD_QUIT`` needs a connkey to name the stream it should close, and 0 names
nothing. Only build a stream URL once ``connKey !== 0``, as the snippet above
does.

Stream modes
~~~~~~~~~~~~

Accepted by ``getStreamUrl``'s ``mode`` option:

- ``jpeg``: MJPEG streaming (continuous multipart JPEG frames)
- ``single``: single frame snapshot (one JPEG image)
- ``stream``: raw stream (rarely used)

ZMS commands
~~~~~~~~~~~~

``ZMS_COMMANDS`` in ``src/lib/zm/zm-constants.ts`` maps names to the wire
values ZMS expects:

.. code:: tsx

   export const ZMS_COMMANDS = {
     cmdNone: 0,
     cmdPause: 1,
     cmdPlay: 2,
     cmdStop: 3,
     cmdFastFwd: 4,
     cmdSlowFwd: 5,
     cmdSlowRev: 6,
     cmdFastRev: 7,
     cmdZoomIn: 8,
     cmdZoomOut: 9,
     cmdPan: 10,
     cmdScale: 11,
     cmdPrev: 12,
     cmdNext: 13,
     cmdSeek: 14,
     cmdVarPlay: 15,
     cmdGetImage: 16,
     cmdQuit: 17,
     cmdMaxFps: 18,
     cmdQuery: 99,
   } as const;

``cmdQuit`` (17) is the one that matters for cleanup. ``ZmsEventPlayer`` is the
only component that uses the rest: ``cmdPause``, ``cmdPlay``, ``cmdVarPlay``,
``cmdSeek``, ``cmdQuery`` (polled at ``bandwidth.zmsStatusInterval``), and
``cmdQuit`` on teardown.

The zombie-stream trap and how to avoid it (never render with
``connKey === 0``, always send ``CMD_QUIT`` on teardown, keep effect deps to
primitive IDs) is covered in :doc:`05-component-architecture`; the narrative
walk of the same code is Flow 2 in :doc:`call-flows`.
