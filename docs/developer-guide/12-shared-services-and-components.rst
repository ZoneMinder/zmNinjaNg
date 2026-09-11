Shared Services and Reusable Components
=======================================

Code that more than one page needs lives in five places: ``lib/`` for pure
utilities with no React and no store imports, ``services/`` for platform
bridges, ``stores/`` for the client state several features share, ``hooks/``
for React-specific logic, and ``components/ui`` plus ``components/common``
for shared components. This chapter walks the pieces that carry behavior
worth explaining. Feature components that belong to one screen are in
:doc:`05-component-architecture`; the API layer is in
:doc:`07-api-and-data-fetching`.

Start from what you are trying to do:

==============================================  ===============================================================
Question                                        Section
==============================================  ===============================================================
Build any ZoneMinder URL                        URL Builder (``lib/zm/url-builder.ts``)
Route a monitor to the server that records it   Server Resolver (``lib/zm/server-resolver.ts``)
Close a ZMS stream without leaving a zombie     Delayed CMD_QUIT (``lib/zm/zms-quit.ts``)
Store a password or a PIN                       Secure Storage, Crypto Utilities
Give a monitor its own streaming port           Multi-port Resolution (``lib/monitor/multiport.ts``)
Show a query error to the user                  Query Error Resolution (``lib/query/query-error.ts``)
Navigate from outside a React component         Navigation Service (``lib/navigation.ts``)
Save a montage layout per monitor group         Group-Keyed Montage Settings (``stores/settings.ts``)
Count events the user has not seen yet          Monitor Seen Watermarks (``stores/monitorSeen.ts``)
Read a profile setting from a non-React module  Profile Settings Accessor (``lib/profile/profile-settings.ts``)
Explain an icon-only button on a touch screen   useLongPressHint (``hooks/useLongPressHint.ts``)
==============================================  ===============================================================

Shared Services (lib/ and services/)
------------------------------------

Logger (``lib/logger.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Structured logging with sanitization and component-scoped helpers. Every
entry goes to ``useLogStore`` (which backs the ``/logs`` page) and, where
the platform allows, to a file (see Log File below).

.. code:: typescript

   import { log, LogLevel } from '../lib/logger';

   log.api('Fetching monitors', LogLevel.INFO, { endpoint: '/monitors.json' });
   log.download('Download started', LogLevel.INFO, { filename: 'video.mp4' });
   log.profileService('Switching profile', LogLevel.INFO, { from: 'A', to: 'B' });

Component helpers beat the bare ``log.info`` / ``log.error`` because the
Logs page filters by component. The set comes from the ``componentLoggers``
array in ``lib/logger.ts``; adding one means appending to that array and to
the matching ``Logger`` class field. Levels are DEBUG, INFO, WARN, ERROR,
NONE.

``lib/log-sanitizer.ts`` strips passwords and tokens before an entry is
stored. It works mostly by field name, which is why values belong in the
context object rather than interpolated into the message: a key named
``password`` is redacted wherever it appears, while the same secret pasted
into a sentence is only found if it happens to match one of the string
rules.

Pass details as the object they are. Serializing them yourself flattens away
the keys the sanitizer matches on, and the secrets inside survive redaction.
The ERROR path used to do exactly that, which is how camera passwords
reached shared log files (refs #307).

``lib/security/url-credentials.ts`` is the one string rule worth knowing
about. ZoneMinder stores a camera's password as URL userinfo
(``rtsp://admin:secret@cam/live``) in ``Monitor.Path``, repeats it in
``Monitor.Options``, and writes the same string into its own logs. No key
name marks it and ``URL`` parsing never looked at ``rtsp://``, so one regex
handles every scheme. ``maskUrlCredentials`` replaces the password segment
and keeps the user and host; ``restoreUrlCredentials`` puts the real value
back when a masked field is saved. The monitor settings dialog uses the same
pair, so what the UI hides and what the logs hide cannot drift apart.

**Used by:** the whole app. Never call ``console.*`` directly.

Global Error Sinks (``lib/global-error-handlers.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Window-level listeners for ``unhandledrejection`` and ``error`` route the
async failures that escape React Query and try/catch into the logger, so
they still reach the Logs page and exported log files. ``main.tsx`` calls
``installGlobalErrorHandlers()`` once before React renders. Each listener
logs via ``log.app()`` at ``LogLevel.ERROR`` with the reason, source
location, and stack, truncated to ``LOGGING.maxStackLength`` characters
(4000). They never call ``preventDefault``, so browser console reporting is
unchanged. ``uninstallGlobalErrorHandlers()`` removes them; tests use it.

HTTP Client (``lib/http.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

One request abstraction over four runtimes. ``lib/http.ts`` is the facade
and the only import path consumers use: it builds the URL, dispatches to a
platform adapter, validates the status, and logs the request. Internals sit
in ``lib/http/``: ``types.ts`` (request/response/error shapes),
``encoding.ts`` (body serialization, base64/byte conversion), ``timeout.ts``
(abort-signal composition, native timeout race), ``logging.ts`` (request IDs,
correlation tags), and one adapter per platform.

.. code:: typescript

   import { httpGet, httpPost } from '../lib/http';

   const data = await httpGet<MonitorsResponse>('/api/monitors.json');
   await httpPost('/api/states/change.json', { monitorId: '1', newState: 'Alert' });
   await httpGet('/api/events.json', { token: accessToken, params: { limit: 50 } });
   const blob = await httpGet<Blob>('/video.mp4', { responseType: 'blob' });

Web uses ``fetch()`` plus a dev proxy (see Proxy URL Utilities). Mobile uses
``CapacitorHttp``, which bypasses the WebView's CORS enforcement entirely.
Electron bridges the request over IPC (``electron/preload.cjs``) to the main
process, which performs it with Electron's ``net`` module, again avoiding
renderer CORS.

Self-signed certificate handling is not part of this module, because the
adapters differ in how they surface TLS errors. On mobile a native plugin
owns it (see SSL Trust); on Electron and web the user must add the CA to the
system trust store.

**Used by:** every module in ``api/``, the download service, and anything
that touches the network. Raw ``fetch()`` and ``axios`` are banned.

SSL Trust (``lib/security/ssl-trust.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Most ZoneMinder installs sit behind a self-signed certificate, so the app
has to trust a certificate the OS does not. It does that with TOFU (Trust
On First Use) pinning rather than a blanket "accept anything" switch: the
first connection shows the user the certificate's SHA-256 fingerprint, and
every connection afterward is validated against the fingerprint the user
accepted. The setting is profile-scoped (``allowSelfSignedCerts`` and
``trustedCertFingerprint`` in ``ProfileSettings``) and off by default.

The user enables self-signed certificates and connects.
``getServerCertFingerprint(url)`` fetches the server's leaf certificate,
``CertTrustDialog`` shows its SHA-256 fingerprint, subject, issuer, and
expiry, and on accept the fingerprint is written to
``ProfileSettings.trustedCertFingerprint``. Every later connection validates
against it and rejects a mismatch.

The certificate fetch is the accepted risk: to read a certificate you must
first complete a handshake with a server you do not yet trust, so during that
one fetch the native layer accepts any certificate. Pinning cannot bootstrap
itself otherwise.

.. code:: typescript

   import { applyTrustedCertificates, getServerCertFingerprint } from '../lib/security/ssl-trust';

   // Normal operation: apply the union of every profile's trust setting.
   // Reads the profile and settings stores itself, so it takes no arguments.
   await applyTrustedCertificates();

   // A profile not yet saved (test-connection in progress) is folded in as
   // the candidate, so the probe can reach it before it exists in the store.
   await applyTrustedCertificates({ urls: [portalUrl], fingerprint, enabled });

   // Fetch the cert for the TOFU dialog. No fingerprint yet, so this enables
   // trust for HTTP requests only and does not install the WebView handler.
   const certInfo = await getServerCertFingerprint('https://zm.example.com');

   // Pin (or unpin, with null) after the user decides.
   await setTrustedFingerprint(certInfo.fingerprint);

The three plugin methods behind those calls (``plugins/ssl-trust/definitions.ts``):
``enable()`` / ``disable()`` activate the ``TrustManager`` used by HTTP
requests and do not touch the WebView; ``setTrustedFingerprint({ fingerprint })``
installs the WebView SSL handler only when the fingerprint is non-null;
``getServerCertFingerprint({ url })`` returns the leaf certificate's
fingerprint, subject, issuer, and expiry.

On Android, ``onReceivedSslError`` extracts the certificate via
``SslCertificate.saveState()``, computes SHA-256, and calls ``proceed()``
only on a fingerprint match, never unconditionally; HTTP requests go through
a ``TrustManager`` that validates fingerprints. On iOS, both ``URLProtocol``
and ``WKNavigationDelegate`` validate with CommonCrypto SHA-256.

Electron gets trust without pinning. ``applyTrustedCertificates`` forwards to
``window.electronSsl.setTrustSelfSigned`` over IPC, and while that flag is on
the main process accepts any invalid certificate, both for renderer loads (the
``certificate-error`` handler) and for the ``net.fetch`` the HTTP bridge uses
(``setCertificateVerifyProc``). It never sees a fingerprint, because
``getServerCertFingerprint`` is native-only; ``electron/main.cjs`` records that
as a hardening item for the experimental desktop shell. On web the call is a
no-op: Chromium validates the certificate and the page cannot override it.

**Bootstrap order.** ``bootstrapSSLTrust()`` in
``services/profile-bootstrap.ts`` runs before ``bootstrapAuth()``, because a
login request to a self-signed server fails if trust is not already applied.
When ``allowSelfSignedCerts`` is true but ``trustedCertFingerprint`` is null
(a profile created before pinning existed), it fetches the certificate and
signals the UI through ``lib/security/cert-trust-event.ts``, which
``AppLayout`` listens to in order to show the trust dialog.

The pieces: ``lib/security/ssl-trust.ts`` (JS interface),
``lib/security/cert-trust-event.ts`` (bootstrap-to-UI bridge),
``plugins/ssl-trust/`` (plugin definitions and web stub),
``components/CertTrustDialog.tsx``, ``components/CertTrustBanner.tsx``,
``hooks/useCertTrustPrompt.ts``, ``android/.../SSLTrustPlugin.java``,
``ios/App/App/SSLTrustPlugin.swift``.

**Used by:** ``services/profile-bootstrap.ts``, ``pages/ProfileForm.tsx``,
``pages/Profiles.tsx``, ``components/settings/AdvancedSection.tsx``,
``components/layout/AppLayout.tsx``, ``hooks/useCertTrustPrompt.ts``,
``components/CertTrustDialog.tsx``.

Known limitation: iOS rich-push images on self-signed servers
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Rich push notifications download their preview image in a Notification
Service Extension (``ios/App/ImageNotification/NotificationService.swift``),
which iOS runs as a separate OS process from the main app. It downloads with
a plain ``URLSession.shared.downloadTask`` and has no ``URLSessionDelegate``.
The pinned fingerprint (``SSLTrustPlugin.trustedFingerprint``) is a static
Swift variable in the main app's process, and the ``SSLTrustURLProtocol``
that consults it is registered only there, so neither is reachable from the
extension. On a self-signed server the image download's TLS handshake fails
and the push arrives without its image, silently: the extension just delivers
the notification unchanged.

Fixing this needs an App Group (or a shared Keychain access group) so the
extension can read the fingerprint and validate the certificate itself.
Neither the app's entitlements (``ios/App/App/App.entitlements``) nor the
extension's declare one today.

Never log or store secrets
^^^^^^^^^^^^^^^^^^^^^^^^^^

Passwords and PINs never touch ``localStorage`` directly:

.. code:: typescript

   // Wrong: readable by anyone with filesystem access, and by browser extensions.
   localStorage.setItem('password', password);

   // Right: Keychain on iOS, Keystore on Android, encrypted localStorage on web.
   import { setSecureValue } from '../lib/security/secureStorage';
   await setSecureValue('password_profile_123', password);

And credentials never appear in a log message:

.. code:: typescript

   // Wrong: the value lands in the Logs page and in exported log files.
   log.auth('Login', LogLevel.DEBUG, { password, accessToken });

   // Right: log that it happened, not what it was.
   log.auth('Login successful', LogLevel.INFO, { username });
   log.auth('Tokens received', LogLevel.DEBUG);

Discovery (``services/discovery.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Users type a hostname, not four URLs. Discovery probes for the API endpoint
and derives ``portalUrl``, ``apiUrl``, and ``cgiUrl`` from wherever it finds
one. It tries HTTPS before HTTP for a scheme-less input, probes ``/zm/api``
then ``/api``, and skips the remaining probes on a connection error rather
than a 404, since a refused connection means the host is wrong, not the path.
Given credentials it also authenticates once, so it can read the real
``ZM_PATH_ZMS`` from the server config instead of guessing the CGI path.

.. code:: typescript

   import { discoverUrls } from '../services/discovery';

   const result = await discoverUrls(portalUrl, {
     credentials: { username, password },
     signal: abortController.signal,
     onClientCreated: (client) => { profileClient = client; },
   });
   // { portalUrl, apiUrl, cgiUrl }

``discoverUrls`` wraps the lower-level ``discoverZoneminder`` with the iOS
retry logic and abort handling, so neither ``ProfileForm`` nor ``Profiles``
duplicates it. Failures throw a ``DiscoveryError`` whose ``code`` is
``API_NOT_FOUND``, ``PORTAL_UNREACHABLE``, ``CANCELLED``, or ``UNKNOWN``.
``CANCELLED`` is the one to swallow: it means the user typed another
character and the previous probe was aborted.

**Used by:** ``pages/ProfileForm.tsx``, ``pages/Profiles.tsx``.

Download Utilities (``services/download.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Cross-platform file download with progress and cancellation.

.. code:: typescript

   import { downloadFile, downloadSnapshot } from '../services/download';

   const abortController = new AbortController();

   await downloadFile('https://example.com/video.mp4', 'event-123.mp4', {
     signal: abortController.signal,
     onProgress: (progress) => setPercent(progress.percentage),
   });

   await downloadSnapshot(imageUrl, monitorName);

Web builds a Blob and clicks an anchor, and Electron takes that same path: its
renderer behaves like a regular browser here, so the module has no desktop
branch. Mobile uses CapacitorHttp, then Filesystem, then the Media library. It
keeps the payload as base64 all the way to Filesystem instead of converting to
a Blob, because a Blob round-trip on a large event video is an out-of-memory
crash on a phone.

Snapshot URLs must be normalized first
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

A ZMS URL with ``mode=jpeg`` and ``maxfps`` is a live MJPEG stream, not a
file. It never ends, so an HTTP client waiting for the response body waits
forever:

.. code:: typescript

   const streamUrl = 'https://server/zm/cgi-bin/zms?monitor=1&mode=jpeg&maxfps=10&connkey=12345';
   await downloadFile(streamUrl, 'snapshot.jpg');  // hangs indefinitely

``convertToSnapshotUrl``, exported from the same module, rewrites the URL to
request one frame. It treats a URL as ZMS when the path contains ``nph-zms``
anywhere or ends with ``/zms``, returns anything else untouched, sets
``mode=single``, and strips the
streaming-only ``maxfps``, ``connkey``, ``buffer``, ``fps``, and the
cache-busting ``_t`` and ``rand``. When the URL is a dev image-proxy wrapper
it recurses into the wrapped ``url`` parameter first. ``downloadSnapshot``
calls it for you; call it yourself if you hand a stream URL to
``downloadFile``. :doc:`call-flows` traces the whole download.

**Used by:** MonitorCard, MontageMonitor, and MonitorDetail for
``downloadSnapshotFromElement``; EventMontageView and EventDetail for
``downloadEventVideo``.

Proxy URL Utilities (``lib/zm/proxy-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

In web development the Vite dev server runs on a different origin than the
ZoneMinder server, so cross-origin images are blocked. These helpers wrap a
URL with the dev image proxy when, and only when, that applies.

.. code:: typescript

   import { wrapWithImageProxy, wrapWithImageProxyIfNeeded } from '../lib/zm/proxy-utils';

   wrapWithImageProxy('https://zm.example.com/image.jpg');
   // 'http://localhost:3001/image-proxy?url=https%3A%2F%2Fzm.example.com%2Fimage.jpg'

   wrapWithImageProxyIfNeeded('https://zm.example.com/image.jpg');

``wrapWithImageProxyIfNeeded`` checks ``Platform.shouldUseProxy`` first, so
production, Electron, and native builds pass the URL through unchanged.

**Used by:** API functions (monitors, events), download utilities, the HTTP
client.

Server Resolver (``lib/zm/server-resolver.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A ZoneMinder install can spread monitors across several recording servers.
Each monitor carries a ``ServerId``; this module maps that ID to the URLs of
the server that actually holds the stream. In a single-server setup the map is
empty and every lookup returns the profile's own URLs, so callers do not
branch.

.. code:: typescript

   import { buildServerMap, setServerMap, resolveMonitorUrls } from '../lib/zm/server-resolver';

   const serverMap = buildServerMap(servers);   // from /servers.json
   setServerMap(serverMap);                     // during bootstrap

   const urls = resolveMonitorUrls(monitor.ServerId, serverMap, {
     portalUrl: profile.portalUrl,
     apiUrl: profile.apiUrl,
   });

Each map entry holds ``recordingUrl``, ``portalPath``, and ``apiBaseUrl``.
``getPortalUrlForMonitor(serverId, fallback)`` and
``getPortalUrlForEvent(monitorId, monitors, fallback)`` are the quick lookups
list renderers use.

The map is a module-level variable, not a store, because ``api/`` modules read
it outside React. Components still need to re-render when bootstrap changes
it, so the ``useServerUrls`` hook bridges the two with ``useSyncExternalStore``,
a React hook that subscribes a component to a cache living outside React and
re-renders it when that cache signals a change. Without the bridge a montage
tile would build its stream URL from the profile default on first paint and
never correct itself once the real server map arrived.

**Used by:** ``hooks/useServerUrls.ts``, ``hooks/useMonitorStream.ts``, the
Server page, MonitorDetail, EventDetail.

URL Builder (``lib/zm/url-builder.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every ZoneMinder URL the app constructs comes from here: streams
(``getMonitorStreamUrl``), event images (``getEventImageUrl``), event videos
(``getEventVideoUrl``), the ZMS event endpoint (``getEventZmsUrl``), PTZ
control (``getMonitorControlUrl``), ZMS control (``getZmsControlUrl``), and
the Go2RTC endpoints.

.. code:: typescript

   import { getMonitorStreamUrl } from '../lib/zm/url-builder';

   const streamUrl = getMonitorStreamUrl(cgiUrl, monitorId, {
     token: accessToken,
     mode: 'jpeg',
     maxfps: 10,
     connkey: 12345,
     minStreamingPort: 7100,   // with monitorId '4', rewrites the port to 7104
   });

**Multi-port routing.** ZoneMinder can serve each monitor's stream on its own
port, computed as ``minStreamingPort + parseInt(monitorId)``. A private
``applyMultiPort`` helper rewrites the port, and all six builders call it. Four
of them (``getEventImageUrl``, ``getEventVideoUrl``, ``getEventZmsUrl``,
``getZmsControlUrl``) take both ``minStreamingPort`` and ``monitorId`` as
optional fields on their options object. ``getMonitorStreamUrl`` and
``getMonitorControlUrl`` already take ``monitorId`` positionally and read only
``minStreamingPort`` from options. With both present the
port is rewritten; with either missing the URL keeps the portal's port. Do not
compute the port at a call site: read it through ``lib/monitor/multiport.ts``
below, which honors the user's opt-out.

**Used by:** ``api/events.ts``, ``api/monitors.ts``,
``hooks/useStreamLifecycle.ts``, and the stream and playback components.

Delayed CMD_QUIT (``lib/zm/zms-quit.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Closing a ZMS stream means sending ``CMD_QUIT`` for its connkey, or the server
leaves an ``nph-zms`` process running. Sending it immediately on unmount breaks
development, because React's ``StrictMode`` deliberately mounts every
component, unmounts it, and mounts it again on the first render of a dev build,
to surface effects that are not cleanup-safe. That second mount reuses the
connkey the first mount's teardown just killed.

So the quit is scheduled after a grace delay (``ZM_INTEGRATION.cmdQuitGraceMs``,
150 ms) and tracked per connkey. A remount reusing the connkey cancels the
pending quit; a genuinely fresh mount generates a new connkey, so its cancel
matches nothing and the abandoned stream's quit still fires.

.. code:: typescript

   import { sendDelayedCmdQuit, cancelPendingQuit } from '../lib/zm/zms-quit';

   cancelPendingQuit(connkey);   // on mount: undo a dev-remount quit

   // On unmount. The timeout stops teardown hanging on an unreachable server.
   sendDelayedCmdQuit(controlUrl, connkey, {
     timeoutMs: apiTimeoutSeconds > 0 ? apiTimeoutSeconds * 1000 : undefined,
     logContext: { eventId },
   });

The request is fire-and-forget and its failures log at DEBUG, since the
connection may already be gone by the time the timer runs.

**Used by:** ``components/events/ZmsEventPlayer.tsx``,
``components/events/EventThumbnailHoverPreview.tsx``.

Multi-port Resolution (``lib/monitor/multiport.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The server's ``ZM_MIN_STREAMING_PORT`` is fetched once during profile
bootstrap and stored on the profile as ``minStreamingPort``. The per-profile
setting ``forceDisableMultiPort`` lets a user opt out for servers whose
per-monitor ports are unreachable. These two helpers are the only sanctioned
way to read the effective base port: with the override on they return
``undefined``, ``applyMultiPort`` becomes a no-op, and URLs fall back to the
portal's default port.

.. code:: typescript

   import { resolveMinStreamingPort, getEffectiveMinStreamingPort } from '../lib/monitor/multiport';

   // In React, where useCurrentProfile already put settings in scope.
   const port = resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort);

   // In services and other non-React code, which read both stores by profile id.
   const port = getEffectiveMinStreamingPort(currentProfileId);

Pass the result as ``minStreamingPort`` to the URL builders. Reading
``currentProfile.minStreamingPort`` at a call site bypasses the toggle.

Event Icons (``lib/event/event-icons.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps a ZoneMinder event cause to a Lucide icon. ZoneMinder writes variants
like ``Motion:All`` and ``Motion:Person``, so the lookup tries a prefix match
before falling back to the generic ``Circle``.

.. code:: typescript

   import { getEventCauseIcon, hasSpecificCauseIcon } from '../lib/event/event-icons';

   getEventCauseIcon('Motion:Person');  // Move (prefix match)
   getEventCauseIcon('Unknown');        // Circle (fallback)
   hasSpecificCauseIcon('Custom');      // false

Mapped causes: ``Motion`` to Move, ``Alarm`` to Bell, ``Signal`` to Wifi,
``Linked`` to Link, ``Forced Web`` to Hand, ``Continuous`` to Video.

**Used by:** EventCard and the event list components.

Relative Time Labels (``lib/relative-time.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Event cards and the event detail screen show a compact "how long ago" label.
``Intl.RelativeTimeFormat`` with ``style: 'narrow'`` produces abbreviated,
localized output ("40m ago", "3h ago") without a date-fns locale map; the
BCP-47 tag from the app's i18n state passes straight through.

Some locales render the narrow form as a bare signed number. French gives
"-40 min", which reads as a negative quantity rather than a time in the past,
so when the narrow output starts with a sign the helper falls back to
``style: 'short'``, which spells the direction ("il y a 40 min"). Under
60 000 ms (``RELATIVE_TIME_JUST_NOW_MS``) the label is ``t('events.now')``.

.. code:: typescript

   import { isWithinDays, formatEventRelative } from '../lib/relative-time';

   if (isWithinDays(event.startTime, RELATIVE_TIME_LIST_WINDOW_DAYS)) {
     const label = formatEventRelative(date, i18n.language, t);
   }

``EventCard`` renders an ``Hourglass`` chip
(``data-testid="event-relative-time"``) only inside the 7-day window
(``RELATIVE_TIME_LIST_WINDOW_DAYS``), so older events show no chip.
``EventDetail`` always shows a muted relative line under the Time value
(``data-testid="event-detail-relative-time"``), regardless of age.

**Used by:** EventCard, EventDetail.

Time Utilities (``lib/time.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Machine-facing date formatting: what the ZoneMinder API accepts and what an
``<input type="datetime-local">`` accepts.

.. code:: typescript

   import { formatForServer, formatLocalDateTime } from '../lib/time';

   formatForServer(new Date());      // '2024-01-10 15:30:45'
   formatLocalDateTime(new Date());  // '2024-01-10T15:30' (no seconds)

Nothing a user reads comes from this module. User-facing dates go through
``useDateTimeFormat()`` in React, or ``formatAppDate`` / ``formatAppTime`` /
``formatAppDateTime`` from ``lib/format-date-time.ts`` outside it, because
those honor the per-profile ``dateFormat`` and ``timeFormat`` settings. For a
short weekday label use ``fmtWeekday`` (hook) or ``formatAppWeekday``
(standalone); weekday has no user preset, but routing it through the same
layer keeps every user-visible date on one seam. Never call date-fns
``format()`` with a hard-coded pattern for output a user will see, including
canvas rendering, tooltips, and scrubber overlays.

**Used by:** API functions, the Events page, filters, dashboard widgets.

Crypto Utilities (``lib/security/crypto.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

AES-256-GCM encryption over the browser's SubtleCrypto, used by the web
fallback of secure storage. No key parameter appears at the call site: 16 bytes
of random key material are generated once per install and kept in
``localStorage``, and every ``encrypt`` or ``decrypt`` re-derives the
``CryptoKey`` from that material with PBKDF2 (100,000 iterations, the fixed
salt ``zmng-v1``). The material sits next to the ciphertext it protects, so
this defeats a plaintext grep of ``localStorage``, not an attacker who can read
it.

.. code:: typescript

   import { encrypt, decrypt } from '../lib/security/crypto';

   const encrypted = await encrypt('my-password');  // base64: IV + ciphertext
   const password = await decrypt(encrypted);

``decryptLegacy()`` reads data written by an older key derivation and exists
only for migration. ``isCryptoAvailable()`` reports whether SubtleCrypto is
present, which it is not on an insecure origin.

**Used by:** ``lib/security/secureStorage.ts`` (its web fallback) and
``stores/auth.ts``.

Secure Storage (``lib/security/secureStorage.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

One API over the iOS Keychain, the Android Keystore
(``@aparajita/capacitor-secure-storage``), and encrypted localStorage on web.

Keys are namespaced by the caller. ``ProfileService`` (``services/profile.ts``)
scopes a profile's password by id:

.. code:: typescript

   // services/profile.ts
   await setSecureValue(`password_${profileId}`, password);

   // getSecureValue resolves to null when nothing is stored under the key,
   // which is why the read maps it to undefined for its own callers.
   const password = await getSecureValue(`password_${profileId}`);
   return password || undefined;

``removeSecureValue(key)`` deletes one entry, ``hasSecureValue(key)`` tests
presence, ``clearSecureStorage()`` wipes every key, and ``getStorageInfo()``
reports which backend is active.

**Used by:** ProfileService (passwords), ``lib/kioskPin.ts`` (PIN hash and
salt).

Platform Detection (``lib/platform.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``Platform`` exposes the booleans the rest of the app branches on:
``isElectron``, ``isNative``, ``isDesktopOrWeb``, ``shouldUseProxy``, and the
per-OS flags. What matters is not the shape of the object but where the
guards are mandatory. They gate every dynamic Capacitor import: a static
import of a Capacitor plugin breaks the web build, so the pattern is always
a platform check followed by ``await import(...)`` (the Native contract).

**Used by:** the HTTP client, download utilities, proxy utilities, and every
platform-specific branch.

App Version (``lib/version.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The marketing version comes from ``package.json`` and is bumped only on a prod
release. The build number is the git commit count
(``git rev-list --count HEAD``), injected by ``vite.config.ts`` as the
``__BUILD_NUMBER__`` compile-time constant. It increases on every commit, so
two builds sharing a marketing version are still distinguishable in a bug
report. Outside a git checkout it is ``dev``; ``vitest.config.ts`` defines it
as ``test``.

.. code:: typescript

   import { getAppVersion, getBuildNumber, getFullVersion } from '../lib/version';

   getAppVersion();   // "1.3.0"
   getBuildNumber();  // "1509"
   getFullVersion();  // "1.3.0 (1509)"

**Used by:** ``SidebarContent``, which renders ``getFullVersion()`` expanded
and ``getAppVersion()`` collapsed.

Safe-Area Bootstrap (``lib/safe-area-bootstrap.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors iOS ``UIView.safeAreaInsets`` into ``--sai-top`` / ``--sai-right`` /
``--sai-bottom`` / ``--sai-left`` CSS custom properties on
``document.documentElement``. It works around a WKWebView bug (Capacitor 8,
``contentInset='never'``, ``viewport-fit=cover``) where
``env(safe-area-inset-*)`` reports stale values after rotation: on Dynamic
Island devices ``env(top)`` stays ``0`` in portrait, and ``env(left)`` and
``env(right)`` keep landscape-derived values regardless of orientation. The
native ``SafeArea`` plugin reads UIKit's source of truth and emits
``safeAreaInsetsChanged`` events this module applies to the variables.

``main.tsx`` calls ``installSafeAreaBootstrap()`` once, before React mounts.
On iOS it imports ``plugins/safe-area``, calls ``SafeArea.getInsets()`` once so
the initial paint is correct, then subscribes to ``safeAreaInsetsChanged``. On
Android, web, and Electron it early-returns: those engines resolve
``env(safe-area-inset-*)`` correctly and the CSS fallback suffices. Reference
the variables with the native ``env()`` as fallback so non-iOS platforms get
the browser value:

.. code:: css

   padding-top: var(--sai-top, env(safe-area-inset-top));

The plugin's TypeScript surface (``SafeAreaInsets``, ``SafeAreaPlugin``) is in
``plugins/safe-area/definitions.ts``; the web stub never invokes the listener.

**Used by:** ``main.tsx``, plus the CSS in ``index.css`` and component styles
that consume ``var(--sai-*)``.

API Validator (``lib/zm/api-validator.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ZoneMinder returns numbers as strings and omits fields between versions, so
responses are validated and coerced with Zod at the API boundary rather than
trusted.

.. code:: typescript

   import { httpGet } from '../lib/http';
   import { validateApiResponse } from '../lib/zm/api-validator';
   import { MonitorsResponseSchema } from '../api/types';

   const data = await httpGet<unknown>('/api/monitors.json');

   const validated = validateApiResponse(MonitorsResponseSchema, data, {
     endpoint: '/api/monitors.json',
     method: 'GET',
   });

The ``endpoint`` and ``method`` context lands in the thrown error, which is
what makes a schema failure debuggable from a user's exported log file.

**Used by:** every module in ``api/``. See :doc:`07-api-and-data-fetching`.

Grid Utils (``lib/grid-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Picks a grid shape for a small, fixed number of items: one item gets 1x1, two
to four get two columns, five or more get three.

.. code:: typescript

   import { calculateGridDimensions, getGridTemplateStyle } from '../lib/grid-utils';

   const { cols, rows } = calculateGridDimensions(monitorIds.length);
   const style = getGridTemplateStyle(cols, rows);
   // { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' }

**Used by:** ``components/dashboard/widgets/MonitorWidget.tsx`` only. Montage
and Monitors do not use it: their column count is user-chosen and stored per
group (see Group-Keyed Montage Settings).

Bandwidth Settings (``lib/zmninja-ng-constants.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every polling and refresh interval in the app is a field on the
``BandwidthSettings`` interface, with one value in the ``normal`` bucket and
a slower one in ``low``. Nothing hardcodes an interval.

.. code:: typescript

   import { useQuery } from '@tanstack/react-query';
   import { queryKeys } from '../lib/query/query-keys';
   import { useBandwidthSettings } from '../hooks/useBandwidthSettings';

   const bandwidth = useBandwidthSettings();

   const { data } = useQuery({
     queryKey: queryKeys.monitors(profileId),
     queryFn: getMonitors,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

The query key comes from the ``queryKeys`` factory, never an inline array, so
an invalidation elsewhere cannot drift out of sync with it.

Fields include ``monitorStatusInterval``, ``alarmStatusInterval``,
``monitorNewEventsInterval``, ``eventsWidgetInterval``,
``timelineHeatmapInterval``, ``daemonCheckInterval``,
``snapshotRefreshInterval``, ``zmsStatusInterval`` (3000 ms normal, 5000 ms
low; ``ZmsEventPlayer`` polls ``ZMS_COMMANDS.cmdQuery`` at this rate to track
playback position), ``imageScale``, ``imageQuality``, and ``streamMaxFps``. Adding one
means adding the field with values for both modes, then reading it through
``useBandwidthSettings()`` in React or ``getBandwidthSettings(mode)`` outside
it.

**Used by:** dashboard widgets, monitor views, the event player, montage, and
anything that polls.

Monitor Rotation (``lib/monitor/monitor-rotation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ZoneMinder stores a monitor's orientation separately from its width and
height, so a 1920x1080 camera mounted sideways still reports 1920x1080.
``parseMonitorRotation(orientation)`` turns the orientation string into
degrees, ``getMonitorAspectRatio(width, height, orientation)`` returns an
aspect-ratio string that accounts for it, and
``getOrientedResolution(width, height, orientation)`` returns a ``WxH`` string
with the dimensions swapped for 90 and 270 degrees.

**Used by:** ``pages/MonitorDetail.tsx``, ``pages/EventDetail.tsx``,
``components/montage/hooks/useMontageGrid.ts``.

Event Utilities (``lib/event/event-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``getMaxColsForWidth(width, minWidth, gap)`` returns how many columns of at
least ``minWidth`` fit in ``width`` once the inter-column ``gap`` is
subtracted. ``getMonitorDimensions(monitor, fallbackWidth, fallbackHeight)``
returns a monitor's dimensions with fallbacks, for monitors the server reports
as 0x0.

**Used by:** ``components/events/EventListView.tsx``,
``components/events/EventMontageView.tsx``, ``hooks/useEventMontageGrid.ts``.

Monitor Filters (``lib/monitor/filters.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Pure array-in, array-out functions, which is what makes them cheap to unit
test. ``filterEnabledMonitors(monitors)`` drops deleted monitors.
``filterExcludedMonitors(monitors, excludedIds)`` drops monitors whose ``Id``
is in ``excludedIds`` and returns the input unchanged when that list is empty.
``filterMonitorsByGroup(monitors, groupMonitorIds)`` keeps only monitors in the
group.

.. code:: typescript

   import { filterExcludedMonitors } from '../lib/monitor/filters';

   const visible = filterExcludedMonitors(monitors, ['3', '7']);

**Used by:** ``getMonitors`` in ``api/monitors.ts``, which applies the
per-profile exclusion at the API boundary so no page has to remember to.

Profile Settings Accessor (``lib/profile/profile-settings.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

API modules run outside React and cannot call hooks, but they still need
profile-scoped settings. This file used to read ``useProfileStore`` and
``useSettingsStore`` directly, which closed a static import cycle:
``api/events.ts`` imports this file, and ``stores/profile.ts`` reaches back
into ``api/``. It now takes a ``ProfileSettingsGate``, the same
dependency-injection shape as ``api/store-gates.ts``
(:doc:`07-api-and-data-fetching`). ``stores/profile.ts`` builds the gate from
both stores and registers it with ``setProfileSettingsGate(gate)`` at module
load; tests call that directly instead of mocking two stores (refs #217).

.. code:: typescript

   import { getExcludedMonitorIds } from '../lib/profile/profile-settings';

   const excluded = getExcludedMonitorIds();

``getExcludedMonitorIds()`` returns an empty array when there is no current
profile, the gate has not registered yet, or the stores are not initialized.
The ``excludedMonitorIds`` setting itself lives on ``ProfileSettings`` in
``stores/settings.ts``, is written via ``updateProfileSettings``, and defaults
to an empty array.

**Used by:** ``api/monitors.ts`` and ``api/events.ts``.


Watermark date math (``lib/event/watermark.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``nextSecondAfter(zmDateTime)`` turns a watermark into the lower bound for the
events list a badge click opens. The badge counts events with a strict ``>`` the
watermark, but the events list filters with ``>=`` its ``startDateTime``. Passing
the watermark straight through would put the already-seen boundary event back at
the top of the filtered list. Adding one second to the watermark makes the two
operators agree on the same set. Input and output are ZM second-granularity
local-time strings; a value that does not match the ``YYYY-MM-DD HH:mm:ss`` shape
is returned unchanged. The watermark it reads comes from the store described
under Monitor Seen Watermarks below.

**Used by:** ``hooks/useOpenMonitorEvents.ts`` only.

Zone Utilities (``lib/monitor/zone-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Parses and renders ZoneMinder zone data for the read-only overlay on the
monitor detail page.

- ``getZoneColor(type)``: hex color for a zone type, from the fixed palette
  ``Active`` ``#22c55e``, ``Inclusive`` ``#3b82f6``, ``Exclusive`` ``#ef4444``,
  ``Preclusive`` ``#f59e0b``, ``Inactive`` ``#4b5563``, ``Privacy``
  ``#a855f7``.
- ``ZONE_TYPE_ORDER``: ``['Active', 'Inclusive', 'Exclusive', 'Preclusive',
  'Inactive', 'Privacy']``. ``ZoneLegend`` iterates it, so legend rows keep a
  stable order regardless of what order the API returned zones in.
- ``parseZoneCoords(coords)``: the ZoneMinder ``"x,y x,y..."`` string to
  ``Point[]``.
- ``coordsToSvgPointsWithTransform(coords, transform?)``: coordinates to an SVG
  polygon points string, applying optional rotation.
- ``alarmRGBToHex(alarmRGB)``: a ZoneMinder ``AlarmRGB`` integer to a hex
  string. The overlay does not use it for color; it exists for other consumers.

**Used by:** ``ZoneOverlay``, ``ZoneLegend``.

Query Error Resolution (``lib/query/query-error.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps a React Query ``error`` to a message a user can act on. Events and
Monitors both special-cased a 401 status, or an "unauthorized" substring in the
message, into ``common.auth_required`` before falling back to a generic
message. ``resolveQueryError`` is that logic extracted once.

.. code:: typescript

   import { resolveQueryError } from '../lib/query/query-error';

   resolveQueryError(error, t);   // fallback: `${t('common.error')}: ${message}`
   resolveQueryError(error, t, { fallbackKey: 'monitors.failed_to_load' });

Five pages and two assistant components route their error text through it.
Monitors, Timeline, DeveloperNotice, ``AskPanel``, and
``AssistantOllamaSection`` pass a ``fallbackKey`` naming what failed to load;
Events and Montage take the generic fallback. Monitors, Timeline, Events,
Montage, and ``AskPanel`` hand the result to ``ErrorBanner``; DeveloperNotice
renders the string in its own layout and ``AssistantOllamaSection`` puts it in
a toast.

MonitorDetail and EventDetail are the exceptions. Both show a fixed translated
message with no interpolated error text, so they pass that string straight to
``ErrorBanner`` and never call this function: a detail page that could not load
its one record has nothing to interpolate.

**Used by:** Events, Monitors, Montage, Timeline, DeveloperNotice, AskPanel,
AssistantOllamaSection.

Navigation Service (``lib/navigation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Bridges non-React code with React Router. A push notification handler runs
outside the component tree and cannot call ``useNavigate()``, so it emits a
navigation event through this singleton, and ``NotificationHandler`` (a
component that renders nothing and exists only to hold effects) listens and
forwards it to the router.

.. code:: typescript

   import { navigationService } from '../lib/navigation';

   navigationService.navigateToEvent(eventId, {
     from: '/monitors',        // back-button destination
     fromNotification: true,   // skip lastRoute persistence
   });

   // In a React component:
   useEffect(() => {
     const unsubscribe = navigationService.addListener((event) => {
       navigate(event.path, { replace: event.replace, state: event.state });
     });
     return unsubscribe;   // React runs this on unmount; without it the
   }, [navigate]);         // listener leaks once per mount

``from`` is the explicit back-button destination, read by EventDetail and
MonitorDetail via ``location.state?.from``. ``fromNotification`` tells
AppLayout not to save the route as ``lastRoute``, so the app does not reopen
weeks later straight into a transient event playback screen.

**Used by:** ``services/pushNotifications.ts``,
``components/NotificationHandler.tsx``.

Kiosk PIN (``lib/kioskPin.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Hashes, stores, and verifies the kiosk-mode PIN. The PIN never exists in
plain text at rest: it is hashed with SHA-256 over a random 128-bit salt, and
both hash and salt go to secure storage under ``kiosk_pin_hash`` and
``kiosk_pin_salt``.

.. code:: typescript

   import { storePin, verifyPin, hasPinStored, clearPin } from '../lib/kioskPin';

   if (!(await hasPinStored())) await storePin('1234');
   const ok = await verifyPin(enteredPin);
   await clearPin();

``hashPin(pin, salt)`` returns the hex-encoded digest of ``salt + pin``. It is
exported for tests and not normally called directly.

**Used by:** ``hooks/useKioskLock.ts`` (setup),
``components/kiosk/KioskOverlay.tsx`` (unlock),
``components/settings/AdvancedSection.tsx`` (set, change, clear).

Log File (``lib/log-file/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors entries from ``useLogStore`` to a file on disk, so a user can send a
log from a session that has already ended.

- **Capacitor (iOS, Android)**: NDJSON at ``Directory.Data/zmninja-ng.log``
  in the app sandbox, resolved at runtime to a ``file://`` URI on iOS and a
  ``content://`` URI on Android. Sharing goes through the system share sheet
  and the recipient gets the file as an attachment.
- **Electron, web**: no file. ``getLogFile()`` returns ``NoopLogFileStore``
  unless ``Platform.isNative``, so logs live only in the in-memory store. Both
  its ``capabilities`` are false, which hides the Logs page status line and
  turns Share into a blob download of the current session's entries.
  ``getDisplayPath()`` returns ``null``.

``Logger.formatMessage`` builds each ``LogEntry`` once and hands the same
object to both ``useLogStore.addLog`` and ``LogFileStore.append``, so the page
and the file cannot disagree. The file caps at 10,000 entries and is rewritten
with the last 5,000 on overflow. On app start ``hydrateLogStoreFromFile()``
reads it back and replaces ``useLogStore.logs``, which is why the Logs page
shows prior-session entries.

**Used by:** ``lib/logger.ts``, ``pages/Logs.tsx``.

Notification services
~~~~~~~~~~~~~~~~~~~~~

``services/notifications.ts`` (WebSocket to the ZoneMinder Event Server),
``services/pushNotifications.ts`` (FCM), and ``services/eventPoller.ts``
(polling fallback for desktop and web) are documented in
:doc:`07-api-and-data-fetching`, alongside the store gates that keep them
free of store imports.

Token freshness
~~~~~~~~~~~~~~~

``useFreshAccessToken`` and ``useAuthStore.getState().getFreshAccessToken()``
gate any URL that the browser or native runtime loads directly with a token
embedded in it. :doc:`07-api-and-data-fetching` covers the leeway window and
the refresh-then-relogin fallthrough.

Assistant Agent and Providers (``lib/assistant/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The store-free core behind the "Ask" panel: a bounded tool loop in
``agent.ts`` plus one adapter per backend under ``providers/``, none of
which imports React or Zustand. :doc:`15-assistant` covers the loop, the
tool gates, token accounting, and each backend's device quirks. The React
surface that drives it (``AskPanel`` and its two shells) is in
:doc:`16-platform-surfaces`.

Shared Stores (stores/)
-----------------------

Montage layout and monitor-seen watermarks are Zustand stores rather than
``lib/`` utilities, and both are read by more than one feature.
:doc:`03-state-management-zustand` covers how a store is built and
subscribed to; what follows is what each one holds and why its shape is what
it is.

Group-Keyed Montage Settings (``stores/settings.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A profile can show all monitors or one selected monitor group, and each group
keeps its own grid columns, hidden monitors, and saved layouts. These
``ProfileSettings`` fields hold that:

.. code:: typescript

   montageByGroup: Record<string, MontageGroupLayout>;
   eventMontageByGroup: Record<string, EventMontageGroupLayout>;

The map key is the group ID, or a sentinel when no group is selected:

.. code:: typescript

   export const ALL_GROUPS_KEY = '__all__';

The active key is ``selectedGroupId ?? ALL_GROUPS_KEY``, where
``selectedGroupId`` is the profile's current group filter (``null`` for all
monitors).

.. code:: typescript

   interface MontageGroupLayout {
     workingLayout: Layout[];
     savedLayouts: MontageSavedLayout[];
     activeLayoutName: string | null;
     gridCols: number;
     hiddenMonitorIds: string[];
   }

   // Event montage is a uniform grid, so only the column count is scoped.
   interface EventMontageGroupLayout {
     gridCols: number;
   }

``DEFAULT_MONTAGE_GROUP_LAYOUT`` and ``DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT``
supply the values used when a group has no stored bucket. Both default
``gridCols`` to ``2``; the montage default also carries an empty
``workingLayout``, empty ``savedLayouts``, ``activeLayoutName: null``, and
empty ``hiddenMonitorIds``. ``DEFAULT_SETTINGS`` starts both maps empty, so a
group's bucket is created lazily on first write.

**Reading and writing.** Montage components use ``useMontageGroupState()``
rather than touching ``montageByGroup``:

.. code:: typescript

   import { useMontageGroupState } from '../hooks/useMontageGroupState';

   const { groupKey, bucket, update } = useMontageGroupState();
   update({ gridCols: 3, hiddenMonitorIds: ['12'] });

The hook resolves ``groupKey`` from ``useGroupFilter``, reads the matching
bucket (falling back to ``DEFAULT_MONTAGE_GROUP_LAYOUT``), and exposes
``update`` as a partial patch that calls the store action
``updateMontageGroupLayout(profileId, groupKey, patch)``. Event montage
columns go through the matching ``updateEventMontageGroupLayout`` action.

**Persist migration.** The store is at ``version: 1`` with ``migrateSettings``
as its ``migrate`` callback. Persisted v0 state held flat montage fields
(``montageLayouts``, ``montageSavedLayouts``, ``montageActiveLayoutName``,
``montageGridCols``, ``montageGridRows``, ``montageHiddenMonitorIds``,
``eventMontageGridCols``, ``eventMontageLayouts``). The migration removes those
from each profile and seeds the ``ALL_GROUPS_KEY`` bucket from them; the old
``montageLayouts.lg`` array becomes ``workingLayout``, and absent values fall
back to the defaults. Profiles created after v1 skip it and start empty.

**Dangling group filter self-heal.** A persisted ``selectedGroupId`` can point
at a group that no longer exists on the server. ``useGroupFilter`` resets it to
``null`` after a successful groups load when the stored ID is missing from the
returned list. The reset is gated on the groups query's ``isSuccess`` flag, not
``isLoading``: React Query v5 reports ``isLoading: false`` for a *disabled*
query, and the groups query stays disabled until the profile is loaded and
authenticated. Gating on ``isLoading`` let the empty disabled-state list wipe a
valid selection during cold start, which dropped the montage back to the
All-monitors bucket and streamed every monitor. ``isSuccess`` is false while a
query is disabled, loading, or errored, so the reset fires only once a real
fetch has returned. :doc:`02-react-fundamentals` covers the query-state flags.

**Render gate (``isFilterReady``).** Monitors and groups load from two separate
queries, and the monitors query usually returns first. A page that rendered as
soon as monitors arrived would mount a tile per monitor before it knew the
group membership, and mounting a tile starts its stream: that one frame opens a
stream for every monitor on the server before the group narrows the list back
down. ``useGroupFilter`` therefore exposes ``isFilterReady``, true when no
filter is active or when an active filter's groups query has settled
(``isSuccess`` or ``error``). Montage and Monitors hold their loading skeleton
until ``isLoading`` is false and ``isFilterReady`` is true, so tiles first mount
against the final filtered set. Both also render an empty list, not all
monitors, when a filter is active but ``filteredMonitorIds`` is empty.

**Used by:** ``useMontageGroupState`` (montage pages and the grid hook), the
Montage and Monitors render gates, the event montage column control, and the
persist layer of ``useSettingsStore``.

Monitor Seen Watermarks (``stores/monitorSeen.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This store holds the "you have seen up to here" mark that the monitor card's
new-event badge counts from. Per profile, per monitor, it stores the
``StartDateTime`` of the newest event the user had seen the last time they
opened that monitor. It persists under ``zmng-monitor-seen`` in local storage,
so watermarks are per device and do not sync across installs.

.. code:: typescript

   // stores/monitorSeen.ts
   profileWatermarks: Record<string, Record<string, string | null>>;

An absent key and a stored ``null`` mean different things, and the difference
drives the badge. An **absent** entry means the monitor has never been seeded:
``seed`` writes its newest event on the first response and the card shows no
badge, so a fresh install does not open on a week of backlog. A stored **null**
means the monitor had no events at all when it was seeded, so every event since
counts and the count query runs unfiltered. ``seed`` is idempotent (it returns
early if a watermark already exists), and ``markSeen(p, m, null)`` is a no-op, so
opening a monitor that has never recorded an event cannot overwrite a real
watermark with nothing.

The value is always a server ``StartDateTime``, never a local ``Date.now()``:
clock skew between the app and the ZoneMinder server would hide or duplicate
events. :doc:`call-flows` Flow 18 walks the absent-versus-null decision through
the seeding effect that makes it.

**Used by:** ``useMonitorNewEvents`` (the count queries and the seeding effect),
``useOpenMonitorEvents`` (stamps on opening the events, shared by ``MonitorCard``
and ``MontageMonitor``), and ``MonitorRecentEvents`` (stamps when the
recent-events list is on screen).

Shared Hooks (hooks/)
---------------------

useStreamLifecycle (``hooks/useStreamLifecycle.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every ZMS stream is identified on the server by a connection key, and every
key the app stops using must be closed with ``CMD_QUIT`` or the server keeps
an ``nph-zms`` process alive for it. This hook owns that key's whole life.

.. code:: typescript

   import { useStreamLifecycle } from '../hooks/useStreamLifecycle';

   const { connKey, forceRegenerate, releaseConnection } = useStreamLifecycle({
     monitorId,
     portalUrl: resolvedPortalUrl,
     accessToken,
     viewMode: effectiveViewMode,   // CMD_QUIT only fires in 'streaming'
     mediaRef: imgRef,
     logFn: log.monitor,
     enabled,
     minStreamingPort: effectiveMinStreamingPort,
     apiTimeoutSeconds: settings.apiTimeoutSeconds,
   });

``forceRegenerate({ killPrevious })`` mints a new key. Pass
``killPrevious: true`` when the old stream may still be alive on the server;
visibility resume, manual retry, and the error-driven reconnect all do, because
an ``<img>`` ``onError`` cannot distinguish a dead server process from a
dropped-but-alive one, and guessing wrong leaves an orphan.
``releaseConnection()`` quits the current key and clears it without minting a
replacement; ``useMonitorStream`` calls it when its reconnect loop gives up, so
the last key is not held until unmount. It returns early outside streaming
mode. ``forceRegenerate`` does not: it mints a new key in any view mode, and
only its optional ``killPrevious`` quit is streaming-gated, because the private
``sendCmdQuit`` is what checks ``viewMode``.
``mediaRef`` points at the ``<img>`` or ``<video>`` whose ``src`` is cleared on
unmount, which is what actually releases the browser's connection.

Three transitions end a key's life without an unmount, and each one quits it:
``enabled`` going false, a profile switch (below), and ``viewMode`` leaving
``'streaming'``. The last is easy to miss, because by the time any other
teardown runs the hook already reads ``'snapshot'`` and every quit path is
gated on ``'streaming'``, so the key it holds would never be closed at all: a
tile dropped to snapshots left a running ``nph-zms`` process behind until ZM's
own idle timeout. The Streaming Mode setting reaches that transition, and so
does the All-mode idle downgrade. Both directions of the flip then mint a
fresh key, because a snapshot URL carries a connkey too and reusing a quit one
risks colliding with the state it left on the server. A flip arriving in the
same commit as an ``enabled`` change belongs to the disable teardown, and one
arriving with a monitor change has no correct move
available: the key it holds was opened against the previous monitor's URL and
port, while every prop now describes the new one. It stands down in both
cases. The monitor-change path is a pre-existing gap rather than a delegation
(the regeneration effect returns early on a live hook, so it does not mint for
the new monitor either), and it is unreachable from the app today because
every call site that swaps monitors remounts the player instead, keyed by
monitor id (refs #201).

``useMonitorStream`` builds the retry behavior on top: ``reportStreamError``
(wired to ``<img onError>``) schedules an exponential-backoff reconnect
(``mjpegReconnectBaseDelayMs`` 1000 ms, doubling to ``mjpegReconnectMaxDelayMs``
15000 ms, capped at ``mjpegReconnectMaxAttempts`` 6 attempts unless insomnia
mode is on), and ``reportStreamLoad`` (wired to ``<img onLoad>``) resets the
backoff after a good frame.

The hook also answers whether there is a picture to show at all. ``hasFrame``
means "the ``src`` the element currently holds has fired ``load``", tracked by
recording that ``src`` in ``reportStreamLoad`` and comparing it with the current
one, and cleared by ``reportStreamError`` and by the visibility resume. It is a
comparison rather than a boolean flag on purpose: a flag reset from an effect
would clear one paint too late, because effects run after the browser has already
painted the new ``src`` with the old picture still on the element. Snapshot mode
is the exception the comparison has to carve out, since a refresh tick changes
the ``src`` on a still frame that remains perfectly good (refs #352).

Profile switch cannot rely on unmount
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Each lifecycle instance also registers a teardown thunk in the module-level
registry ``lib/monitor/active-streams.ts`` (``registerActiveStream`` /
``unregisterActiveStream``), and ``switchProfile`` in ``stores/profile.ts``
awaits ``quitAllActiveStreams()`` as its very first step, before logout and
before the SSL-trust flip.

The ordering is the point. Each tile's ``CMD_QUIT`` captures that tile's own
per-server URL and token, and has to go out while the previous profile's trust
setting and token are still in effect. React unmount races the switch: the new
profile's SSL-trust setting can flip before the old self-signed server's
``CMD_QUIT`` leaves, the request then fails its TLS handshake, and an
``nph-zms`` process is orphaned. A central quit keyed only by monitor ID could
not do this either, having no record of which server each stream used.

**Used by:** ``hooks/useMonitorStream.ts``,
``components/monitors/MonitorHoverPreview.tsx``.

useViewPrefs (``hooks/useViewPrefs.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Answers which settings bucket a rendered stream should obey. Preferences are
two-tier: an aggregate keeps its own bucket, stored under the group's own id,
separate from every individual profile's.

Page-level controls get that for free, because ``useCurrentProfile`` already
keys off ``currentProfileId`` and so resolves to the aggregate's own bucket
while aggregating.
The stream path does not. A montage tile owned by profile B passes
``profileId: B`` down the URL chain (``useServerUrls``, ``useFreshAccessToken``,
``useProfileById``) so its stream resolves against B's server, and reading its
view preferences from the same place would leave the aggregate's analysis-frames
toggle and the Settings page's aggregate Streaming Mode row governing nothing.

.. code:: typescript

   import { useViewPrefs } from '../hooks/useViewPrefs';

   // Owning profile in single mode; the aggregate's bucket while aggregating.
   const { viewMode, showAnalysisFrames } = useViewPrefs(profileId);

The split is by what a setting describes. ``viewMode`` and
``showAnalysisFrames`` describe the view, so the bucket the user is looking at
owns them. Timeouts, multi-port and bandwidth describe the server, so they
stay with the owning profile - ``useMonitorStream`` reads both, from
``useProfileById`` and from here. Resolution keys off the app's mode, not the
route, so the ``/all/monitors/:profileId/:id`` deep route follows the
aggregate's bucket like every other all-mode surface.

Streaming Mode is a tri-state while aggregating, and it gets its own setting in
that bucket, ``allModeViewMode`` (``'per-server' | 'streaming' | 'snapshot'``),
rather than reusing ``viewMode``. Its default, ``'per-server'``, sends each tile
back to its owning profile, so entering All mode never changes how anything
streams until the user asks. ``AllServersStreamingSection`` on the Settings page
is what writes it.

The obvious alternative - read the aggregate bucket's own ``viewMode`` and
treat "never written" as per-server - does not work, and the reason is worth
remembering: ``updateProfileSettings`` seeds a fresh bucket with the whole
``DEFAULT_SETTINGS`` shape, so the first write of ANY key (while aggregating,
``lastRoute`` on the very first navigation) materializes ``viewMode:
'snapshot'`` alongside it. Absence is not a state a bucket stays in, and an
e2e run caught exactly that: a montage that had merely been navigated to
already read as Snapshot. An explicit value also keeps every default inside
``mergeProfileSettings``, where the Settings contract wants it.

Analysis frames stay two-state: off is a coherent default, so nothing needs
distinguishing from absence.

``usePageViewMode`` answers the same question for a page-level control, which
has no owning monitor to ask. Under "Per server" the answer differs per tile,
so it reports streaming when ANY in-scope server streams - the analysis-frames
toolbar button would otherwise disable itself over a grid of live tiles.

**Used by:** ``hooks/useMonitorStream.ts``,
``components/monitors/AnalysisFramesToggle.tsx`` (``usePageViewMode``).

useEventFilters (``hooks/useEventFilters.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Holds the Events page's filter state and persists it as the user changes it,
with no Apply button in the persistence path.

- Local state (``selectedMonitorIds``, ``selectedTagIds``, and so on) drives
  both the UI and the ``filters`` object the API query consumes.
- Wrapped setters (``setSelectedTagIds``) update local state and call
  ``saveFilterField()`` to write to the settings store.
- The restore effect reads settings on mount and on profile change using the
  raw ``_set*`` functions, bypassing the save wrappers so restore does not
  immediately re-save what it just read.
- Persistence keys off ``currentProfileId``, so while aggregating, filters
  live in the aggregate's own bucket, following the same two-tier rule as
  ``useViewPrefs`` above.
- In All mode the persisted ``monitorIds`` are composite
  ``profileId:monitorId`` tokens, the same form ``EventsFilterPopover``
  builds and ``resolveOwnMonitorIds`` splits, since raw ZoneMinder ids
  collide across servers. Single mode stores bare ids, unchanged.
- ``ALL_TAGS_FILTER_ID`` (``'__all_tags__'``) means "any tag" and is mutually
  exclusive with individual tag selections.
- ``onlyDetectedObjects`` adds ``notesRegexp: 'detected:'`` to the API filter,
  which ZoneMinder evaluates server-side as a Notes REGEXP.
- ``clearFilters()`` resets everything (the popover's Clear button).
  ``clearDateRange()`` resets only the date range and active quick range. The
  "x" beside the date range (``events-clear-quick-range``) renders for any active
  start or end date, including a URL-driven range from a monitor card's Events
  link, and calls ``clearDateRange()``, so removing a time window does not silently
  widen the list back to every monitor.
- ``formatInputDate()`` formats a stored value as ``YYYY-MM-DDTHH:mm:ss``, and the
  two ``datetime-local`` inputs in ``EventsFilterPopover`` carry ``step="1"``, so
  the date filter keeps seconds. A monitor card's Events link sets a
  second-precise ``startDateTime``, and without seconds it would round to the
  minute and miss or double the events the badge counted.
- ``applyFilters()`` takes an optional date-range override. A handler that
  sets the date state and calls ``applyFilters()`` in the same pass (the
  quick-range chips) must pass the new range: the callback still closes over
  the pre-update state, so without the override it writes the previous range
  to the URL, and the URL-readback effect reflects that stale range back into
  state.

**Used by:** the Events page, ``EventsFilterPopover``.

useScrollRestoration (``hooks/useScrollRestoration.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Restores a scroll container's position across unmount and remount. Takes
``key`` (pass ``useLocation().key``) and ``ready`` (true once the scrollable
content has rendered), and returns a callback ref for the container.

Sibling routes such as ``/events`` and ``/events/:id`` unmount each other, so
opening an event destroys the list's scroll container and coming back recreates
it empty. Positions live in a module-level map keyed by the history entry's
``location.key``: browser back reuses the same key and gets its offset restored,
while fresh navigation mints a new key and starts at the top. Restore is
deferred until ``ready`` so the container is tall enough to accept the saved
offset, and runs once per entry so a later user scroll is not clobbered.

Because restoration is keyed by the history entry, every "back" affordance must
**pop** history rather than push a path. Esc (``KeyboardShortcuts``) and the
Android hardware back button (``useAndroidBackButton``) call ``navigate(-1)``.
The event detail back arrow routes through ``resolveBackNavigation``
(``lib/back-navigation.ts``), which returns ``pop`` whenever a prior entry
exists and pushes (to the referrer, or ``/events``) only on a cold deep-link
with no history behind it. A plain ``navigate(referrer)`` push would mint a new
key and lose the position (refs #197).

**Used by:** the Events page.

useAndroidBackButton (``hooks/useAndroidBackButton.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Registers one global Android hardware-back handler, native only, disabled
while the kiosk lock is engaged. The decision is a pure function,
``decideBackAction``, so it can be unit tested without a device: close an open
dialog or popover, else navigate back on a detail route, else on a root (menu)
route show "press back again to exit" and exit on a second press within
``ANDROID_BACK.exitConfirmWindowMs`` (2000 ms). ``isRootRoute`` lists the
top-level menu paths. Called once from ``AppRoutes``.

**Used by:** ``AppRoutes``.

useCapacitorListener (``hooks/useCapacitorListener.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Registers an event listener on a dynamically imported Capacitor plugin and
removes it on unmount or when ``enabled`` turns false, replacing the per-site
pattern of dynamic import, ``await addListener``, and a cancelled-flag
teardown.

.. code:: tsx

   useCapacitorListener(
     () => import('@capacitor/app').then((m) => m.App),
     'appStateChange',
     (state: { isActive: boolean }) => {
       if (!state.isActive) closePreview();
     },
     { enabled: open && Platform.isNative },
   );

``enabled`` defaults to ``Platform.isNative``. ``onError`` fires when the
plugin import or the registration fails; without it failures are swallowed,
which is right, because "plugin absent on this platform" is the common case.

The handler is stored in a ref, a mutable box React keeps across renders
without re-running anything when its contents change, so callers need no stable
callback identity and the listener never re-registers on a re-render. A plugin
handle that resolves *after* teardown (the component unmounted during the
awaits) is removed the moment it arrives. The plugin getter must use a static
import specifier so Vite can analyze and code-split it; never build the
specifier from a template literal.

**Used by:** ``App.tsx`` (flush logs on pause), ``HoverPreview``,
``KioskOverlay``, ``Mp4EventPlayer``, ``useNetworkStatus``,
``useNotificationAutoConnect``, ``useNotificationDelivered``.
``useAndroidBackButton`` deliberately does not: it registers its handler once
and never re-subscribes.

useNetworkStatus (``hooks/useNetworkStatus.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Tracks connectivity and drives ``components/layout/OfflineBanner.tsx``, which
``AppLayout`` renders. Returns ``{ isOnline }``.

.. code:: tsx

   const { isOnline } = useNetworkStatus();

On web and desktop it reads ``navigator.onLine`` and listens for the ``online``
and ``offline`` window events. On iOS and Android one effect dynamically
imports ``@capacitor/network``, reads ``Network.getStatus()`` once so the banner
does not wait for the first transition, then registers a ``networkStatusChange``
listener on the same import. Both steps share a single
``import('@capacitor/network')`` call: importing the same plugin from two
effects on one mount is wasted work, and under Vitest's module mocking the two
race.

**Used by:** ``components/layout/OfflineBanner.tsx``.

useLongPressHint (``hooks/useLongPressHint.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

An icon-only button explains itself through ``title``, which browsers reveal on
hover. A touch screen has no hover, so on a phone those buttons say nothing.
This hook gives them a touch equivalent: hold the button and its ``title``
appears as a brief toast, matching what Android does for a view with
``tooltipText``.

Pass the props you were about to spread on the element and spread the result
instead:

.. code:: tsx

   <button {...useLongPressHint({ title: t('events.delete'), onClick: remove })} />

Three decisions are worth knowing before you use it.

The hint fires on hold, not on tap. A tap already runs the action, so a toast
explaining what just happened would be noise on every use forever. The click
that would follow the release is swallowed in ``onClickCapture``, so a hold
explains the button instead of pressing it. A short tap is untouched.

A press whose ``pointerType`` is ``'mouse'`` is ignored, because hover already
shows the title there. Gating on the pointer rather than on the platform means
a touchscreen laptop gets the hint from its screen and not from its trackpad.

If the caller already passes ``onPointerDown``, the hook disables itself and
returns the props unchanged. On those elements a hold already means something:
``components/ui/zoom-controls.tsx`` and ``monitors/PTZControls.tsx`` repeat
their action while held, and a hint would fight the gesture. This is why
neither file needed an opt-out prop.

Timings come from ``UI_INTERACTIONS`` in ``lib/zmninja-ng-constants.ts``:
``longPressMs`` (500) to trigger, ``moveCancelPx`` (8) of drag to cancel so a
scroll never fires it, and ``hintDurationMs`` (1500) for how long the toast
stays up.

**Used by:** ``components/ui/button.tsx``, through both ``Button`` and
``HintButton``.

Shared Components
-----------------

``components/ui/`` holds the shadcn/ui primitives (``button``, ``card``,
``dialog``, ``popover``, ``select``, ``switch``, ``badge``, ``progress``, and
the rest). They behave as the
`shadcn/ui documentation <https://ui.shadcn.com/docs/components>`_ describes
and this guide does not restate it. What follows is what this project wrote.

``button.tsx`` is the one primitive that diverges. ``Button`` runs its own
props through ``useLongPressHint``, so any button carrying a ``title`` explains
itself on a long press without its call site changing. ``HintButton``, exported
from the same file, is a plain ``<button>`` with the same wiring and no
variants; reach for it where a control styles itself, such as an overlay on a
video tile, and would lose that styling as a ``Button``.

PageContainer (``components/common/PageContainer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Gives every page the same responsive padding, so a screen does not drift on a
phone because someone forgot a breakpoint. It always emits
``p-3 sm:p-4 md:p-6``. The ``spacing`` prop maps to one fixed vertical gap:
``'none'`` emits nothing, ``'tight'`` is ``space-y-3``, ``'normal'`` (the
default) is ``space-y-4``, ``'loose'`` is ``space-y-6``.

.. code:: tsx

   // src/pages/Settings.tsx
   <PageContainer spacing="loose">{/* ... */}</PageContainer>

   // src/pages/Monitors.tsx: needs a responsive gap, so opt out and pass one
   <PageContainer className="space-y-4 sm:space-y-6" spacing="none">{/* ... */}</PageContainer>

It is wrapped in ``forwardRef`` and spreads its remaining props onto the
``<div>``, so ``ref`` and ``data-testid`` flow through. ``className`` is
additive: extra classes merge via ``cn()`` and win on conflict.

RefreshButton (``components/common/RefreshButton.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The refresh control in every page header. Pressing it reloads the whole app,
not just the page's query: ``onRefresh`` defaults to ``reloadApp``
(``lib/reload.ts``), which calls ``window.location.reload()``. That re-runs
bootstrap, re-authenticates, re-fetches everything, and restarts streams,
which is what a user pressing refresh after a server hiccup actually wants. A
partial React Query refetch would leave a dead stream dead.

.. code:: tsx

   // src/pages/Monitors.tsx
   <RefreshButton className="h-8 w-8 sm:h-9 sm:w-9" data-testid="monitors-refresh-button" />

The icon gets ``animate-spin`` while ``isLoading``, and the button is disabled
while loading or when ``disabled`` is set. ``label`` defaults to the
``common.refresh`` translation key (present in en, de, es, fr, it, ru, zh) and doubles
as the ``title`` and ``aria-label`` when no explicit ``aria-label`` is passed.
``showLabel`` (``'always'``, ``'never'``, ``'sm-and-up'``) defaults to
``'never'``, so pages render it icon-only. The default ``data-testid`` is
``refresh-button``; pages override it when more than one can be on screen.

GridColumnsMenu (``components/common/GridColumnsMenu.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Changing how many columns a grid shows. On a phone it renders a bottom
``Sheet`` with large preset buttons; on a desktop, a ``DropdownMenu``. Both
come from this one component, so the montage and event-montage controls cannot
diverge. ``GridLayoutControls`` (montage) and ``EventMontageGridControls``
(event montage, events, monitors) wrap it.

It takes ``isMobile`` and ``gridCols`` for the rendering mode, ``title`` for
the tooltip and sheet title, ``triggerIcon`` / ``triggerLabel`` /
``triggerTestId`` for the trigger, ``presets`` as ``{ cols, icon, label,
testId? }``, ``customIcon`` / ``customLabel`` for the custom-columns entry,
and the ``onApplyGridLayout(cols)`` and ``onCustomSelect()`` callbacks.
``showGridColsAttr`` renders ``data-grid-cols`` on the trigger for e2e tests.
``renderSheetExtras(closeSheet)`` and ``renderMenuExtras()`` append optional
content after the custom entry; the montage wrapper uses them for saved
layouts and the save action.

The file also exports ``CustomColumnsDialog``, a controlled number-input
dialog (id ``custom-cols``, min 1, max 10, Enter submits). Validation stays
with the caller: ``GridLayoutControls`` validates inline,
``EventMontageGridControls`` delegates to
``useEventMontageGrid.handleCustomGridSubmit``.

CollapsibleCard (``components/ui/collapsible-card.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A Card whose header toggles its body, built on Radix Collapsible. Pass
``storageKey`` and the open/closed state persists to ``localStorage``, so the
Settings sections a user collapsed stay collapsed next launch.

.. code:: tsx

   <CollapsibleCard storageKey="settings-video" header={<CardTitle>Video</CardTitle>}>
     {/* body */}
   </CollapsibleCard>

**Used by:** nothing today. It is the primitive to reach for when a section
needs to remember that a user collapsed it; the example above is what a call
site would look like, not one that exists.

NotificationBadge (``components/NotificationBadge.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A bell with an unread count, placed beside page titles. It renders nothing
when there are no unread notifications, and rings (a CSS animation) when a new
one arrives.

The last known count lives in a module-level variable rather than component
state, so navigating between pages (which unmounts and remounts the badge)
does not replay the ring for notifications the user has already seen. The
ring works by incrementing a ``ringKey`` used as the Bell's ``key``
prop: React treats a changed ``key`` as a different element and remounts it,
which restarts the CSS animation. Re-adding the class to an existing element
would not.

**Used by:** every page header.

EmptyState (``components/ui/empty-state.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The placeholder for a list with nothing in it. ``icon`` takes the Lucide
component itself, not a rendered element.

.. code:: tsx

   import { Clock } from 'lucide-react';

   <EmptyState
     icon={Clock}
     title={t('events.no_events')}
     action={{ label: t('events.clear_filters'), onClick: clearFilters }}
   />

**Used by:** Events, Monitors, Montage, NotificationHistory, Timeline, the
HeatmapWidget, and the Dashboard when no widgets are configured.

ErrorBanner and DetailPageSkeleton (``components/ui/query-state.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every page rendered a query's ``error`` state as an icon-and-message box in a
destructive tint, each with its own markup. ``ErrorBanner`` is that box.
``DetailPageSkeleton`` is the loading skeleton MonitorDetail and EventDetail
both defined inline: a title bar plus one aspect-video placeholder.

.. code:: tsx

   import { ErrorBanner, DetailPageSkeleton } from '../components/ui/query-state';
   import { resolveQueryError } from '../lib/query/query-error';
   import { AlertTriangle } from 'lucide-react';

   if (isLoading) return <DetailPageSkeleton />;
   if (error) return <ErrorBanner icon={AlertTriangle} message={resolveQueryError(error, t)} />;

``icon`` defaults to ``AlertCircle``; MonitorDetail and EventDetail pass
``AlertTriangle``. ``message`` accepts any ``ReactNode``, so a caller with
nothing to interpolate can hand it a fixed translated string instead of a
``resolveQueryError`` result, which is what those two detail pages do.

**Used by:** Events, Monitors, Montage, Timeline, MonitorDetail, EventDetail,
and AskPanel. ``DetailPageSkeleton`` has only the two detail pages as
callers.

PasswordInput (``components/ui/password-input.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A text input with an eye-icon toggle between ``type="password"`` and
``type="text"``. Accepts every standard input prop.

**Used by:** ``components/monitor-detail/MonitorSettingsDialog.tsx`` only,
for the camera's source password.

SecureImage (``components/ui/secure-image.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

An ``<img>`` with a fallback path for images the WebView cannot load on its
own.

.. code:: tsx

   <SecureImage src={imageUrl} fallbackSrc={placeholderUrl} alt={alt} className="w-full" />

It renders ``<img src={src}>`` plainly. The interesting part is ``onError``.
On native, if the plain load failed, it retries through
``getSession(profileId).client`` (or ``getCurrentSession()`` when the caller
passes no profile) with ``responseType: 'base64'``, builds a ``data:`` URL from the response and its
``content-type`` header, and swaps that in. That second attempt exists because
the native HTTP layer can reach servers the WebView refuses: a self-signed
certificate the ``SSLTrust`` plugin trusts, or a CORS policy CapacitorHttp
ignores. If it also fails, or the platform is not native, the component falls
back to ``fallbackSrc``, and only then delegates to the caller's ``onError``.

A ``mountedRef`` guards the state update, because the base64 fetch can resolve
after the component unmounted.

**Used by:** nothing today. Every image surface currently renders a plain
``<img>`` or goes through ``EventThumbnail``; this is the primitive to reach
for when one of them starts failing against a self-signed server. It keeps
its own logger channel (``log.secureImage``), so a caller that adopts it can
be traced from the Logs page without adding one.

HoverPreview (``components/ui/hover-preview.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Hover a camera tile on a desktop and a larger live preview opens beside it;
long-press the same tile on a phone and you get the same preview.

.. code:: tsx

   export interface HoverPreviewProps {
     aspectRatio: number;
     renderPreview: () => ReactNode;
     children: ReactNode;
     previewWidth?: number;   // default UI_INTERACTIONS.previewWidthPx (400)
     hoverDelayMs?: number;   // default UI_INTERACTIONS.hoverDelayMs (700)
     testId?: string;
     className?: string;
   }

``children`` is the trigger. ``renderPreview`` is a function, not a node, and
runs only while the preview is open. That is what lets ``MonitorHoverPreview``
mount a fresh stream on hover and tear it down on leave: the inner component's
unmount runs ``useStreamLifecycle``'s cleanup, which sends ``CMD_QUIT`` for the
preview's connkey. Passing a prebuilt element instead would keep that stream
open forever.

The preview renders into a portal, a React feature that mounts an element into
a different DOM node than its parent, so the popup escapes a tile's
``overflow: hidden`` without leaving the component tree. On desktop the portal
carries ``pointer-events: none`` so the trigger stays clickable underneath; on
native it is ``'auto'``, since a long-press preview is dismissed by tapping it
rather than by hovering off. Either way the portal flips left when there is no
room on the right, and closes on mouse leave or on window scroll or wheel.

On native (``!Platform.isDesktopOrWeb``) the trigger wires pointer handlers
instead: a press held for ``UI_INTERACTIONS.longPressMs`` (500 ms) opens the
preview, a backdrop at ``Z_INDEX.overlayBackdrop`` catches the dismissing tap,
and dismissal fires on ``click`` rather than ``pointerdown``. Closing on
pointerdown would restore ``#root``'s pointer events before the synthetic click
arrived, and the tap would fall through to whatever sat underneath.

``components/monitors/MonitorHoverPreview.tsx`` wraps it around a live
monitor stream. ``components/events/EventThumbnailHoverPreview.tsx`` is not
a bigger thumbnail: hovering an event card plays the recorded event back.
Its inner ``EventZmsHoverPlayer`` mints a random connkey, builds a
``getEventZmsUrl`` with ``replay: 'single'``, ``maxfps: 30``, and the
per-profile ``hoverPreviewPlaybackRate``, and renders it in an ``<img>``. On
unmount it sends ``ZMS_COMMANDS.cmdQuit`` through ``sendDelayedCmdQuit``, and
on mount it calls ``cancelPendingQuit`` so a StrictMode remount reuses the same
connkey rather than killing it.

``EventZmsHoverPlayer`` is exported separately from its wrapper because two
surfaces already have their own thumbnail markup and only need the player:
``pages/NotificationHistory.tsx`` and ``components/assistant/AssistantResultCards.tsx``
(assistant answer cards, refs #270). Both pair it with ``HoverPreview``
directly and pass a descriptor built from their own data, which is why an
assistant event card carries ``monitorId`` on its ``DisplayEntity``: the ZMS
URL cannot resolve a multi-port stream without it. Each surface is gated on its
own ``hoverPreview`` key, so reuse means one player and one teardown path
rather than one per screen.

**Used by:** ``components/monitors/MonitorHoverPreview.tsx``,
``components/events/EventThumbnailHoverPreview.tsx``,
``pages/NotificationHistory.tsx``, and
``components/assistant/AssistantResultCards.tsx`` (the last two pair
``EventZmsHoverPlayer`` with it directly).

EventThumbnail (``components/events/EventThumbnail.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A thumbnail with a user-configurable fallback chain. Different ZoneMinder
versions and storage configurations expose different frame images, so the user
picks an ordered list of candidates and this component walks it. It takes
``urls`` (candidates, in order), a stable ``cacheKey`` (the event id),
``alt``, ``objectFit``, and any other ``<img>`` attribute.

.. code:: tsx

   const urls = buildThumbnailChain(portalUrl, event.Id, settings.thumbnailFallbackChain, {
     token: accessToken, width, height, minStreamingPort, monitorId: event.MonitorId,
   });

   <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} />

On ``onError`` it advances to the next URL. The image renders at ``opacity: 0``
until ``onLoad`` fires, so the browser never flashes its broken-image glyph
while the chain is walking. The winning index is kept in a session-scoped
``Map<cacheKey, index>``, so scrolling a list back and forth does not re-probe
a chain that already resolved.

``resolveFallbackFids`` and ``buildThumbnailChain``
(``lib/event/thumbnail-chain.ts``) turn the per-profile
``thumbnailFallbackChain`` setting into ordered frame IDs and full URLs,
skipping disabled entries and empty custom rows.

Walking the chain costs a real failed request per candidate, which is why
callers that hold an event record pass ``hasAlarmFrame`` (refs #331). The
default chain starts at ``alarm``, and ZoneMinder answers 404 for an alarm
frame it never recorded, so a list of such events spends one 404 each before
falling through to ``snapshot``. A reverse proxy reads that as an attack; one
reporter's proxy banned them for it. ``eventHasAlarmFrame`` answers from
``AlarmFrames``, a required field on ``EventSchema`` that every list response
already carries, so the check costs no request of its own. Branch on that count
rather than ``AlarmFrameId``, which is optional on the schema and absent from
some servers' list responses, and would drop the alarm frame of events that
have one. Omitting the option keeps the alarm candidate, which is what callers
with no event record to consult, such as push notifications, want.

**Used by:** EventCard (via EventListView and EventMontageView), the
TimelineScrubber thumbnails, NotificationHistory. The EventDetail hero poster
and EventPreviewPopover take the first frame ID from the resolved chain rather
than hardcoding ``snapshot`` or ``alarm``.

LiveMonitorPlayer (``components/monitors/LiveMonitorPlayer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The live view of one camera, wherever it appears. It picks Go2RTC WebRTC or
MJPEG from the user's preference and the monitor's capability, with a fallback
ladder of WebRTC, then MSE, then HLS, then MJPEG. :doc:`go2rtc-integration`
covers the selection logic.

Beyond ``monitor``, ``profile``, ``className``, ``objectFit``,
``showControls``, ``muted``, ``onLoad``, and ``externalMediaRef``, three props
exist for specific callers. ``onProtocolChange(protocol)`` reports the protocol
actually in use, which MonitorDetail displays: ``'MJPEG'``, or the Go2RTC
protocol upper-cased (``'WEBRTC'``, ``'MSE'``, ``'HLS'``), or the literal
``'Go2RTC'`` while a Go2RTC stream has not yet settled on one.
``forceViewMode`` pins a monitor to ``'streaming'`` or ``'snapshot'``
regardless of the global Streaming Mode setting; the single-monitor page uses
``'streaming'`` so it never degrades to periodic snapshots.
``bypassGo2rtcFailureCache`` opts a single-monitor view out of the shared,
module-level Go2RTC failure cache the montage tiles consult, so one failing
tile does not condemn the detail page to MJPEG.

**Used by:** MonitorDetail, MonitorCard, MontageMonitor, MonitorWidget.

Mp4EventPlayer (``components/events/Mp4EventPlayer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Video.js wrapper for recorded event playback (MP4 or HLS), with alarm-frame
markers on the timeline (``markers`` / ``onMarkerClick``) alongside the usual
``src``, ``type``, ``poster``, ``autoplay``, ``onReady``, and ``onError``.

Passing ``eventId`` enables Picture-in-Picture that survives navigation.
``contexts/PipContext.tsx`` provides ``PipProvider`` (wrapping the app in
``App.tsx``, rendering a hidden portal ``div`` beside the router) and the
``usePip()`` hook: ``adoptForPip(player, videoEl, eventId)`` moves the video
element into that portal so it outlives the component that created it,
``reclaimFromPip()`` pulls it back for inline resume, ``closePip()`` ends it,
and ``activePipEventId`` says which event is floating. ``LiveMonitorPlayer``
does not use PiP.

**Used by:** the EventDetail page.

ZoomControls (``components/ui/zoom-controls.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Zoom and pan overlay for an element controlled by ``useZoomPan``.
Click-and-hold repeats the action on every button.

.. code:: tsx

   const zoomPan = useZoomPan();

   <div ref={zoomPan.ref}>
     <div ref={zoomPan.innerRef}>{/* zoomable content */}</div>
     <ZoomControls zoomPan={zoomPan} className="bottom-2 left-2" />
   </div>

It takes the whole ``ZoomPanControls`` object rather than nine separate handler
props, so adding a control does not touch three call sites. Pass it the object
without the two refs (``const { ref, innerRef, ...controls } = useZoomPan()``)
when the compiler lint is in play: handing a component an object that still
carries refs trips ``react-hooks/refs``.

The buttons are an accessory, never the interaction itself. ``useZoomPan``
binds wheel zoom, pinch, drag-to-pan, and arrow-key pan to the ``ref``
container through ``@use-gesture``, whose binding effect runs on every render
and reads the ref as it goes. ``ref`` is therefore a callback ref that also
stores the node in state: a container rendered through a portal (the frame
viewer in ``EventFrameCarousel``) is absent on the first commit, and without
that re-render the gestures would never bind, leaving a view where the buttons
work and nothing else does (refs #272).

**Used by:** MonitorDetail, EventDetail, ZmsEventPlayer, EventFrameCarousel.

PullToRefreshIndicator (``components/ui/pull-to-refresh-indicator.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The spinner that appears when a user drags a list down past its top. The
gesture lives in ``hooks/usePullToRefresh.ts``, which wraps
``@use-gesture/react``'s ``useDrag``.

.. code:: tsx

   const containerRef = useRef<HTMLDivElement>(null);
   const { bind, isRefreshing, isPulling, pullDistance } =
     usePullToRefresh({ containerRef, onRefresh: () => refetch() });

   <div ref={containerRef} {...bind()} className="overflow-y-auto h-full">
     <PullToRefreshIndicator
       isPulling={isPulling}
       isRefreshing={isRefreshing}
       pullDistance={pullDistance}
     />
   </div>

Spread ``bind()`` onto the scroll container and pass that container's ref in:
the hook reads ``scrollTop`` from it to tell a pull-to-refresh from an ordinary
scroll. The caller owns the ref, the same arrangement ``useEventMontageGrid``
uses, because a page usually already has one on that element. It takes
``containerRef`` and ``onRefresh`` plus optional ``threshold`` and ``enabled``.

**Used by:** the Events page.

QuickDateRangeButtons (``components/ui/quick-date-range-buttons.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Nine preset range chips with abbreviated labels and tooltips; the text hides on
narrow screens. The presets are today (``hours: 0``), then 4, 8, 12, 24, and 48
hours, then 168 (a week), 336 (two weeks), and 720 (thirty days).
``onRangeSelect`` receives ``{ start, end, hours }``; callers persist ``hours``
as the active quick range so the chip stays highlighted after a reload.

**Used by:** the Events filter, the Timeline filter, dashboard widgets.

Filter popovers (``components/filters/``, ``components/events/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``MonitorFilterPopover.tsx`` exports ``MonitorFilterPopoverContent``: monitor
selection with an "All Monitors" toggle and a search box. It is the content,
not the popover, so a caller can host it in a popover, a sheet, or a dialog.
Pass ``idPrefix`` to keep checkbox ids unique when two instances coexist.

.. code:: tsx

   <MonitorFilterPopoverContent
     monitors={monitors}
     selectedMonitorIds={selectedMonitorIds}
     onSelectionChange={setSelectedMonitorIds}
     idPrefix="events"
   />

``EventsFilterPopover.tsx`` composes that with a favorites-only toggle, date
range inputs, the quick range chips, and Apply/Clear. It is presentational; all
its state comes from ``useEventFilters``.

**Used by:** the Events page, the Timeline page, the dashboard widget config.

BackgroundTaskDrawer (``components/BackgroundTaskDrawer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Shows downloads in flight, with progress bars and a cancel button. It renders
in the app layout and is driven entirely by the background task store, so a
download started from an event card keeps reporting progress after the user
navigates away.

.. code:: typescript

   const taskStore = useBackgroundTasks.getState();

   const taskId = taskStore.addTask({
     type: 'download',
     metadata: { title: 'Video.mp4', description: 'Event 12345' },
     cancelFn: () => abortController.abort(),
   });

   taskStore.updateProgress(taskId, percentage, bytesProcessed);
   taskStore.completeTask(taskId);

The drawer is hidden with no tasks, expands to show progress bars, collapses to
a thin bar at the bottom, and leaves a floating count badge when collapsed.
``cancelFn`` is what the cancel button calls, which is why every download must
pass its ``AbortController``.

**Used by:** the download service.

ZoneOverlay and ZoneLegend (``components/monitors/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``ZoneOverlay`` draws an SVG layer of semi-transparent polygons over the
monitor's video, one per detection zone, read-only. It takes ``zones``,
``monitorWidth`` and ``monitorHeight`` (original, before rotation),
``rotation``, ``monitorId``, and ``visible``. Zones are filtered to the current
monitor by ``MonitorId``, colored by ``getZoneColor(zone.Type)`` and not by
ZoneMinder's ``AlarmRGB``, and their coordinates transformed to match any
active monitor rotation. Hovering a polygon shows the zone name and the
translated type (``monitor_detail.zone_type.{type}``).

``ZoneLegend`` (``zones``, ``monitorId``, ``visible``) is its color key. It
lists only the zone types present on the current monitor, in
``ZONE_TYPE_ORDER``, each with a swatch and translated label. It sits at the
bottom-left of the player container and is ``pointer-events-none``, so it
cannot intercept a click meant for the video. It renders only while the overlay
is visible.

**Used by:** MonitorDetail.

Global chrome
~~~~~~~~~~~~~

Four components mount once, under the router, and serve every page.

``components/KeyboardShortcuts.tsx``: single letters jump to each menu section
(``d`` Dashboard, ``m`` Montage, ``e`` Events, ``v`` Monitors, ``t`` Timeline,
``n`` Notifications, ``l`` Logs, ``g`` Settings, ``p`` Profiles, ``r`` Server).
Digits buffer a monitor number shown in an overlay and, on Enter or after
``KEYBOARD_SHORTCUTS.monitorJumpCommitMs`` (1000 ms), open the monitor whose
ZoneMinder ID matches (``monitorIdFromBuffer``), not the one at that list
position (refs #200). ``Esc`` goes back, closing an open layer first via
``hasOpenOverlay``; ``?`` toggles a help dialog. All of it is inactive while
the user is typing (``isTypingTarget``), when a modifier is held, when the
kiosk is locked, or in TV mode. The shortcut table and the pure helpers live in
``lib/keyboard-shortcuts.ts``, so they are testable without a DOM.

``components/CommandPalette.tsx``: a global palette (refs #207) opened by
``/``, a sidebar button, or the mobile-header icon, all through
``useCommandPaletteStore``. It lists pages, monitors (by name and by ID), and
groups, filtered by the pure ``filterCommandItems`` helper in
``lib/command-palette.ts``. Selecting a page navigates to it, a monitor opens
its live view, and a group sets the group filter and opens Montage.

``components/layout/AppLayout.tsx`` is a thin shell: a desktop sidebar and a
mobile header both render ``components/layout/SidebarContent.tsx``, where the
navigation, reorder mode, and user controls live. The mobile menu button sits
on the left so it matches the side the drawer opens from. ``LanguageSwitcher``
is a self-contained dropdown in the ``SidebarContent`` footer, next to the
theme and lock controls, because language is a set-once control that does not
belong in the header. Its entries come from ``useLanguageOptions``, the same
hook the Settings picker uses, so both list the languages in one order.

Sidebar order is per profile. An edit mode (the pencil icon) lets a user drag
menu items; the order is saved to ``ProfileSettings.sidebarNavOrder`` as an
array of route paths, and ``SidebarContent`` sorts ``navItems`` by it in a
``useMemo``. Dragging uses pointer events with a live swap when the pointer
crosses an item's midpoint.

Event notes display
~~~~~~~~~~~~~~~~~~~

ZoneMinder stores object-detection results in an event's ``Notes`` field, not
in ``Cause``: a detected car reads ``detected:car| Motion: All``. EventCard,
EventMontageView, the dashboard EventsWidget, and NotificationHistory display
``Notes``, stripping everything after the ``|`` (which repeats ``Cause``) but
keeping the full string in the ``title`` attribute so a hover shows it.

EventDetail is the exception. It shows ``Cause`` in its own badge, and reads
``Notes`` only to decide whether the event carries a ``detected:`` prefix. When
it does, the class list before the ``|`` picks the icon for an extra
detected-objects row (``detectedClassInfo``); the notes text itself is never
rendered there.

Adding a New Shared Service
---------------------------

Pick the directory by what the code depends on, not by what it is about.
``lib/<domain>/`` is for pure utilities with no React and no store imports;
``hooks/`` for anything that calls a React hook; ``services/`` for platform
bridges and long-lived singletons; ``stores/`` for client state that outlives
a component and is read by more than one feature; ``components/ui/`` for
primitives, ``components/common/`` for shared app-level components, and
``components/<domain>/`` for domain components. A service must never statically
import a store: invert it with the gate pattern (``api/store-gates.ts``) and
keep ``npx madge --circular`` at zero.

A new store carries obligations the other directories do not. Profile-scoped
preferences belong on ``ProfileSettings`` behind ``getProfileSettings`` and
``updateProfileSettings`` rather than in a store of their own (the Settings
contract), every coercion and default goes in ``mergeProfileSettings``, and a
persisted shape change needs a ``migrate`` callback plus a bumped persist
``version`` or the rewrite never runs for anyone already installed.
Subscribers select every reactive field they read, with ``useShallow`` for a
multi-field select (the Stores contract).

The repo's ``AGENTS.md`` and ``AGENTS.project.md`` are the source for the
rest, and this guide does not restate it. The Constants, Server queries,
Logging, HTTP, and Date and time contracts, plus C5 (``lib/`` placement), all
constrain a new shared module. Write the test first, next to the source in
``__tests__/`` (:doc:`06-testing-strategy`).

Then document it here connected to behavior: say what a user can do because
this code exists, and give one example taken from a real call site. If the new
module sits on a path that :doc:`call-flows` traces, update the trace too.
