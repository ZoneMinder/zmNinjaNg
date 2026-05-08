Shared Services and Reusable Components
=======================================

This chapter documents all shared utilities, services, and reusable
components in zmNinjaNg, including who uses them and how.

Table of Contents
-----------------

- `Shared Services (lib/) <#shared-services-lib>`__
- `Reusable UI Components <#reusable-ui-components>`__
- `Reusable Domain Components <#reusable-domain-components>`__
- `Usage Matrix <#usage-matrix>`__

--------------

Shared Services (lib/)
----------------------

The ``lib/`` directory contains platform-agnostic utilities that could
theoretically be extracted into separate npm packages.

Logger (``lib/logger.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Structured logging system with sanitization and component-specific
helpers.

**Features:**

- Log levels: DEBUG, INFO, WARN, ERROR, NONE
- Automatic sanitization of passwords, tokens, and sensitive data
- Component-specific logger methods (e.g., ``log.api()``,
  ``log.profile()``, ``log.download()``)
- Centralized log storage for debug UI (``/logs`` page)

**Implementation:**

.. code:: typescript

   import { log, LogLevel } from '../lib/logger';

   // Basic logging
   log.info('User logged in', { username: 'john' });
   log.error('Failed to fetch', { endpoint: '/api/monitors' }, error);

   // Component-specific (preferred)
   log.api('Fetching monitors', LogLevel.INFO, { endpoint: '/monitors.json' });
   log.download('Download started', LogLevel.INFO, { filename: 'video.mp4' });
   log.profileService('Switching profile', LogLevel.INFO, { from: 'A', to: 'B' });

**Available Component Loggers:**

- ``api``, ``app``, ``auth``, ``crypto``, ``dashboard``, ``discovery``,
  ``download``
- ``errorBoundary``, ``eventCard``, ``eventDetail``, ``eventMontage``
- ``http``, ``imageError``, ``monitor``, ``monitorCard``,
  ``monitorDetail``, ``montageMonitor``
- ``navigation``, ``notificationHandler``, ``notifications``,
  ``notificationSettings``
- ``profile``, ``profileForm``, ``profileService``, ``profileSwitcher``
- ``push``, ``queryCache``, ``secureImage``, ``secureStorage``,
  ``server``, ``time``
- ``videoMarkers``, ``videoPlayer``, ``zmsEventPlayer``

**Used By:** Entire application (all components, stores, API functions)

--------------

HTTP Client (``lib/http.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform-agnostic HTTP request abstraction that works on Web, iOS,
Android, and Desktop.

**Features:**

- Automatic platform detection (Capacitor, Tauri, or Web)
- CORS handling via proxy in development
- Request/response logging via logger
- Token injection for authentication
- Support for multiple response types (json, blob, arraybuffer, text)

**Implementation:**

.. code:: typescript

   import { httpGet, httpPost, httpPut, httpDelete } from '../lib/http';

   // GET request
   const data = await httpGet<MonitorsResponse>('/api/monitors.json');

   // POST with body
   await httpPost('/api/states/change.json', {
     monitorId: '1',
     newState: 'Alert'
   });

   // With auth token
   await httpGet('/api/events.json', {
     token: accessToken,
     params: { limit: 50 }
   });

   // Blob response (for downloads)
   const blob = await httpGet<Blob>('/video.mp4', {
     responseType: 'blob'
   });

**Platform Implementations:**

- **Web**: Uses ``fetch()`` with standard CORS handling
- **Mobile (Capacitor)**: Uses ``CapacitorHttp`` for native networking
- **Desktop (Tauri)**: Uses ``@tauri-apps/plugin-http`` for native fetch

**SSL Trust:** When self-signed certificates are enabled for a profile,
the Tauri HTTP path passes ``danger: { acceptInvalidCerts: true,
acceptInvalidHostnames: true }`` to ``@tauri-apps/plugin-http``. On
mobile, the native Capacitor plugin handles SSL trust separately (see
SSL Trust section below).

**Used By:** API functions (``api/``), download utilities, all network
requests

--------------

SSL Trust (``lib/ssl-trust.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Controls whether the app accepts self-signed/untrusted HTTPS certificates
using TOFU (Trust On First Use) certificate pinning. The setting is
profile-scoped (``allowSelfSignedCerts`` + ``trustedCertFingerprint`` in
``ProfileSettings``) and disabled by default.

**TOFU Flow:**

1. User enables self-signed certs and connects to a server
2. App fetches the server's TLS certificate via ``getServerCertFingerprint()``
3. A dialog (``CertTrustDialog``) shows the cert's SHA-256 fingerprint
4. If the user accepts, the fingerprint is stored in
   ``ProfileSettings.trustedCertFingerprint``
5. All subsequent connections validate the server cert against the stored
   fingerprint — mismatches are rejected

**Platform Implementations:**

- **Mobile (iOS/Android)**: Uses a custom Capacitor plugin (``SSLTrust``)
  registered in ``src/plugins/ssl-trust/``. On Android,
  ``onReceivedSslError`` extracts the cert via ``SslCertificate.saveState()``,
  computes SHA-256, and calls ``proceed()`` only on fingerprint match — never
  without validation. The WebView handler is only installed when a fingerprint
  is set (via ``setTrustedFingerprint()``). HTTP requests use a
  ``TrustManager`` that validates fingerprints. On iOS, both ``URLProtocol``
  and ``WKNavigationDelegate`` validate cert fingerprints via CommonCrypto
  SHA-256.
- **Desktop (Tauri)**: Sets a module-level flag read by ``http.ts`` to pass
  ``danger`` options to ``@tauri-apps/plugin-http``. Requires the
  ``dangerous-settings`` Cargo feature on ``tauri-plugin-http``.
- **Web**: No-op (browsers enforce certificate validation).

**Plugin Methods:**

- ``enable()`` / ``disable()`` — activate/deactivate the TrustManager
  (HTTP requests). Does not install the WebView handler.
- ``setTrustedFingerprint({ fingerprint })`` — pass the pinned fingerprint.
  Installs the WebView SSL handler only when fingerprint is non-null.
- ``getServerCertFingerprint({ url })`` — fetches the server's leaf
  certificate and returns its SHA-256 fingerprint, subject, issuer, and
  expiry.

**Implementation:**

.. code:: typescript

   import { applySSLTrustSetting, getServerCertFingerprint } from '../lib/ssl-trust';

   // Enable with fingerprint (normal operation)
   await applySSLTrustSetting(true, storedFingerprint);

   // Fetch cert for TOFU dialog
   const certInfo = await getServerCertFingerprint('https://zm.example.com');
   // certInfo.fingerprint = "AB:CD:12:..."

   // Enable trust-all for HTTP only (no WebView handler, used during cert fetch)
   await applySSLTrustSetting(true);

**Bootstrap Order:** ``bootstrapSSLTrust()`` in ``stores/profile-bootstrap.ts``
runs before ``bootstrapAuth()``. If ``allowSelfSignedCerts`` is true but
``trustedCertFingerprint`` is null (upgrade migration), it fetches the cert
and signals the UI via ``lib/cert-trust-event.ts`` to show the trust dialog
in ``AppLayout``.

**Key Files:**

- ``lib/ssl-trust.ts`` — JS interface
- ``lib/cert-trust-event.ts`` — event bridge for bootstrap-to-UI TOFU dialog
- ``plugins/ssl-trust/`` — Capacitor plugin definitions
- ``components/CertTrustDialog.tsx`` — trust dialog component
- ``android/.../SSLTrustPlugin.java`` — Android native implementation
- ``ios/.../SSLTrustPlugin.swift`` — iOS native implementation

**Used By:** ``stores/profile-bootstrap.ts``, ``pages/ProfileForm.tsx``,
``components/settings/ConnectionSettings.tsx``,
``components/layout/AppLayout.tsx`` (migration dialog)

--------------

Discovery (``lib/discovery.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ZoneMinder server discovery utility that probes for API endpoints and
derives connection URLs.

**Features:**

- Automatic HTTPS/HTTP fallback for scheme-less URLs
- Probes ``/zm/api`` and ``/api`` paths to find API endpoint
- Derives ``portalUrl`` and ``cgiUrl`` from confirmed API location
- Optional authentication to fetch accurate ``ZM_PATH_ZMS`` from server
  config
- Cancellable via AbortSignal
- Skips redundant probes on connection errors (faster failure)

**Implementation:**

.. code:: typescript

   import { discoverZoneminder, DiscoveryError } from '../lib/discovery';

   // Basic discovery (no auth)
   const result = await discoverZoneminder('192.168.1.100');
   // Returns: { portalUrl, apiUrl, cgiUrl }

   // With credentials (fetches accurate ZMS path from server)
   const result = await discoverZoneminder('myserver.com', {
     username: 'admin',
     password: 'secret'
   });

   // With cancellation support
   const abortController = new AbortController();
   try {
     const result = await discoverZoneminder('192.168.1.100', {
       signal: abortController.signal
     });
   } catch (error) {
     if (error instanceof DiscoveryError && error.code === 'CANCELLED') {
       console.log('Discovery was cancelled');
     }
   }

   // Cancel from elsewhere
   abortController.abort();

**Error Codes:**

- ``API_NOT_FOUND`` - No ZoneMinder API found at any probed path
- ``PORTAL_UNREACHABLE`` - Server completely unreachable
- ``CANCELLED`` - Discovery was cancelled via AbortSignal
- ``UNKNOWN`` - Unexpected error

A higher-level wrapper, ``discoverUrls``, bundles the common call pattern
with iOS retry logic and an abort signal, so neither ``ProfileForm`` nor
``Profiles`` need to duplicate that handling:

.. code:: typescript

   import { discoverUrls } from '../lib/discovery';

   // Shared wrapper with iOS retry logic and abort signal
   const result = await discoverUrls(portalUrl, {
     credentials: { username, password },
     signal: abortController.signal,
     onClientCreated: (client) => setApiClient(client),
   });
   // Returns: { portalUrl, apiUrl, cgiUrl }

**Used By:** ``ProfileForm.tsx``, ``Profiles.tsx`` (both call
``discoverUrls`` for profile creation/editing)

--------------

Download Utilities (``lib/download.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Cross-platform file download with progress tracking and cancellation
support.

**Features:**

- Platform-specific implementations (Web, Mobile, Desktop)
- Progress callbacks for UI updates
- Cancellation via AbortSignal
- Automatic file saving to appropriate locations
- Mobile: Saves to Documents + Photo/Video library
- Desktop: User selects save location
- Web: Browser download

**Implementation:**

.. code:: typescript

   import { downloadFile, downloadSnapshot } from '../lib/download';

   // Download a file with progress
   const abortController = new AbortController();

   await downloadFile('https://example.com/video.mp4', 'event-123.mp4', {
     signal: abortController.signal,
     onProgress: (progress) => {
       console.log(`${progress.percentage}% - ${progress.loaded}/${progress.total} bytes`);
     },
   });

   // Cancel download
   abortController.abort();

   // Download monitor snapshot
   await downloadSnapshot(imageUrl, monitorName);

**Platform Implementations:**

- **Web**: Blob + anchor download
- **Mobile**: CapacitorHttp → Filesystem → Media library
- **Desktop**: Tauri fetch → User-selected path

**Critical Note:** Mobile implementation uses base64 directly (NOT Blob
conversion) to avoid Out-Of-Memory errors on large video files.

**Used By:** MonitorCard, EventDetail, EventCard, VideoPlayer

--------------

Proxy URL Utilities (``lib/proxy-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Utilities for wrapping URLs with development proxy to handle CORS.

**Features:**

- Automatically wraps external URLs with proxy in development mode
- Preserves URLs in production
- Platform-aware (only web development needs proxy)

**Implementation:**

.. code:: typescript

   import { wrapWithImageProxy, wrapWithImageProxyIfNeeded } from '../lib/proxy-utils';

   // Always wrap if proxy is enabled
   const proxiedUrl = wrapWithImageProxy('https://zm.example.com/image.jpg');
   // → 'http://localhost:3001/image-proxy?url=https%3A%2F%2Fzm.example.com%2Fimage.jpg'

   // Conditionally wrap (checks if URL is external)
   const url = wrapWithImageProxyIfNeeded('https://zm.example.com/image.jpg');

**Used By:** API functions (monitors, events), download utilities, HTTP
client

--------------

Server Resolver (``lib/server-resolver.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps ZoneMinder ServerId values to per-server URLs for multi-server
routing. In single-server setups the map is empty and all lookups return
profile defaults.

**Key functions:**

.. code:: typescript

   import {
     buildServerMap,
     resolveMonitorUrls,
     getPortalUrlForMonitor,
     getPortalUrlForEvent,
     setServerMap,
   } from '../lib/server-resolver';

   // Build the map from /servers.json response
   const serverMap = buildServerMap(servers);
   // Each entry contains: recordingUrl, portalPath, apiBaseUrl

   // Store in module-level cache (called during bootstrap)
   setServerMap(serverMap);

   // Resolve URLs for a monitor by its ServerId
   const urls = resolveMonitorUrls(monitor.ServerId, serverMap, {
     portalUrl: profile.portalUrl,
     apiUrl: profile.apiUrl,
   });

   // Quick lookups for list renderers
   const portalUrl = getPortalUrlForMonitor(monitor.ServerId, profile.portalUrl);
   const eventPortalUrl = getPortalUrlForEvent(monitorId, monitors, profile.portalUrl);

**Caching:** The module maintains a module-level cache updated via
``setServerMap()`` during bootstrap and cleared on profile switch.
React components access the cache reactively via ``useSyncExternalStore``
through the ``useServerUrls`` hook.

**Fallback:** When no servers exist or a ServerId is not found in the
map, all functions return the profile's default URLs.

**Used By:** ``useServerUrls`` hook, ``useMonitorStream``, Server page,
MonitorDetail, EventDetail

--------------

URL Builder (``lib/url-builder.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Centralized URL construction for ZoneMinder endpoints.

**Features:**

- Stream URLs with authentication
- Event image/video URLs
- Control URLs for PTZ
- Consistent parameter handling
- Cache busting support
- Multi-port routing via ``applyMultiPort``

**Multi-port helper:**

.. code:: typescript

   import { applyMultiPort } from '../lib/url-builder';

   // Shared helper for per-monitor port routing
   // Formula: port = minStreamingPort + parseInt(monitorId)
   const url = applyMultiPort('https://zm.example.com/cgi-bin/nph-zms', '4', 7100);
   // → URL with port 7104

All URL builder functions (``getMonitorStreamUrl``, ``getEventImageUrl``,
``getEventVideoUrl``, ``getEventZmsUrl``) accept optional
``minStreamingPort`` and ``monitorId`` parameters. When both are
provided, the output URL's port is rewritten using the multi-port
formula.

**Implementation:**

.. code:: typescript

   import {
     getMonitorStreamUrl,
     getEventImageUrl,
     getEventVideoUrl
   } from '../lib/url-builder';

   // Monitor stream
   const streamUrl = getMonitorStreamUrl(cgiUrl, monitorId, {
     token: accessToken,
     mode: 'jpeg',
     maxfps: 10,
     connkey: 12345,
   });

   // Event thumbnail
   const imageUrl = getEventImageUrl(portalUrl, eventId, frameNumber, {
     token: accessToken,
     width: 320,
     height: 240,
   });

   // Event video download
   const videoUrl = getEventVideoUrl(portalUrl, eventId, {
     token: accessToken,
     format: 'mp4',
   });

   // With multi-port routing
   const streamUrl = getMonitorStreamUrl(cgiUrl, monitorId, {
     token: accessToken,
     mode: 'jpeg',
     connkey: 12345,
     minStreamingPort: 7100,
     monitorId: '4',
   });

**Used By:** API functions, hooks (useMonitorStream, useEventPlayer),
components

--------------

Event Icons (``lib/event-icons.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps event causes from ZoneMinder to Lucide icons for visual display.

**Features:**

- Exact match for known causes (Motion, Alarm, Signal, Linked, etc.)
- Prefix matching for cause variants (e.g., “Motion:All”,
  “Motion:Person” → Motion icon)
- Fallback to Circle icon for unknown causes

**Implementation:**

.. code:: typescript

   import { getEventCauseIcon, hasSpecificCauseIcon } from '../lib/event-icons';

   // Get icon component for a cause
   const Icon = getEventCauseIcon('Motion');  // Returns Move icon
   const Icon2 = getEventCauseIcon('Motion:Person');  // Also returns Move icon (prefix match)
   const Icon3 = getEventCauseIcon('Unknown');  // Returns Circle icon (fallback)

   // Check if cause has a specific (non-fallback) icon
   const hasIcon = hasSpecificCauseIcon('Motion');  // true
   const hasIcon2 = hasSpecificCauseIcon('Custom');  // false

**Mapped Causes:**

- ``Motion`` → Move icon
- ``Alarm`` → Bell icon
- ``Signal`` → Wifi icon
- ``Linked`` → Link icon
- ``Forced Web`` → Hand icon
- ``Continuous`` → Video icon

**Used By:** EventCard, event list components

--------------

Time Utilities (``lib/time.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Date/time formatting and timezone conversion for ZoneMinder API.

**Features:**

- Server-compatible ISO format
- Local datetime formatting for inputs
- Timezone conversion
- Duration formatting

**Implementation:**

.. code:: typescript

   import { formatForServer, formatLocalDateTime, formatDuration } from '../lib/time';

   // For API requests (server timezone)
   const serverTime = formatForServer(new Date());
   // → '2024-01-10 15:30:45'

   // For datetime-local inputs
   const localTime = formatLocalDateTime(new Date());
   // → '2024-01-10T15:30:45'

   // Duration formatting
   const duration = formatDuration(125); // seconds
   // → '2:05'

**Used By:** API functions, Events page, filters, dashboard widgets

--------------

Crypto Utilities (``lib/crypto.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Encryption/decryption for secure password storage (web platform).

**Features:**

- AES-256-GCM encryption
- Secure key derivation
- Browser SubtleCrypto API
- Base64 encoding for storage

**Implementation:**

.. code:: typescript

   import { encrypt, decrypt } from '../lib/crypto';

   // Encrypt password
   const encrypted = await encrypt('my-password', 'encryption-key');
   // → Base64 string

   // Decrypt password
   const password = await decrypt(encrypted, 'encryption-key');
   // → 'my-password'

**Used By:** ProfileService, secure storage (web fallback)

--------------

Secure Storage (``lib/secureStorage.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform-specific secure storage abstraction.

**Features:**

- **Mobile**: Native keychain/keystore via
  ``@aparajita/capacitor-secure-storage``
- **Web**: Encrypted localStorage via crypto utilities
- Consistent API across platforms

**Implementation:**

.. code:: typescript

   import { saveSecure, getSecure, removeSecure } from '../lib/secureStorage';

   // Save password
   await saveSecure('password_profile_123', 'my-secure-password');

   // Retrieve password
   const password = await getSecure('password_profile_123');

   // Delete password
   await removeSecure('password_profile_123');

**Used By:** ProfileService (password management)

--------------

Platform Detection (``lib/platform.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform detection utilities.

**Features:**

- Detects Tauri (desktop), Capacitor (mobile), or Web
- Proxy mode detection (development)
- Consistent platform checks

**Implementation:**

.. code:: typescript

   import { Platform } from '../lib/platform';

   if (Platform.isTauri) {
     // Desktop-specific code
   }

   if (Platform.isNative) {
     // Mobile-specific code
   }

   if (Platform.shouldUseProxy) {
     // Wrap URLs with proxy
   }

**Used By:** HTTP client, download utilities, proxy utilities,
platform-specific features

--------------

API Validator (``lib/api-validator.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Zod-based runtime validation for API responses.

**Features:**

- Type-safe runtime validation
- Detailed error messages
- Schema coercion (e.g., numbers as strings)

**Implementation:**

.. code:: typescript

   import { validateApiResponse } from '../lib/api-validator';
   import { MonitorsResponseSchema } from '../api/types';

   const response = await fetch('/api/monitors.json');
   const data = await response.json();

   // Validate and coerce types
   const validated = validateApiResponse(MonitorsResponseSchema, data, {
     endpoint: '/api/monitors.json',
     method: 'GET',
   });

**Used By:** All API functions in ``api/`` directory

--------------

Grid Utils (``lib/grid-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Grid layout calculations for montage views.

**Features:**

- Responsive grid column calculations
- Aspect ratio handling
- Breakpoint support

**Implementation:**

.. code:: typescript

   import { calculateGridCols, calculateItemHeight } from '../lib/grid-utils';

   const cols = calculateGridCols(viewportWidth, minCardWidth);
   const height = calculateItemHeight(cardWidth, aspectRatio);

**Used By:** Montage page, EventMontage page, dashboard grid

--------------

Bandwidth Settings (``lib/zmninja-ng-constants.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Configurable polling and refresh intervals that adapt to the user's
bandwidth mode (normal vs. low). Defined in the ``BandwidthSettings``
interface and the ``BANDWIDTH_SETTINGS`` constant map.

**Usage:**

.. code:: typescript

   import { useBandwidthSettings } from '../hooks/useBandwidthSettings';

   const bandwidth = useBandwidthSettings();

   // Use in React Query
   const { data } = useQuery({
     queryKey: ['monitors'],
     queryFn: getMonitors,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

**Available Properties:**

- ``monitorStatusInterval`` — Monitor status updates
- ``alarmStatusInterval`` — Alarm state checking
- ``consoleEventsInterval`` — Event count refreshing
- ``eventsWidgetInterval`` — Dashboard events widget
- ``timelineHeatmapInterval`` — Timeline/heatmap data
- ``daemonCheckInterval`` — Server daemon health
- ``snapshotRefreshInterval`` — Snapshot image refresh
- ``zmsStatusInterval`` — ZMS playback status polling interval
  (normal: 3000 ms, low: 5000 ms). Used by ``ZmsEventPlayer`` to poll
  the ZMS stream status (``ZM_CMD.QUERY``) for tracking playback
  position.
- ``imageScale`` — Image scaling percentage
- ``imageQuality`` — Image quality percentage
- ``streamMaxFps`` — Maximum stream FPS

**Adding a new property:** Add the field to ``BandwidthSettings`` in
``lib/zmninja-ng-constants.ts`` with values for both ``normal`` and
``low`` modes, then consume it via ``useBandwidthSettings()``.

**Used By:** Dashboard widgets, monitor views, event player, montage,
any component that polls or auto-refreshes

--------------

Monitor Rotation (``lib/monitor-rotation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Utilities for handling monitor orientation and aspect ratio calculations.

**Key Functions:**

- ``parseMonitorRotation(orientation)``: Parses monitor orientation string to degrees
- ``getMonitorAspectRatio(width, height, orientation)``: Returns aspect ratio string accounting for rotation
- ``getOrientedResolution(width, height, orientation)``: Returns oriented ``WxH`` string (swaps dimensions for 90°/270° rotation)

**Used By:** ``MonitorDetail.tsx``, ``EventDetail.tsx``, ``useMontageGrid.ts``

--------------

Event Utilities (``lib/event-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Shared helpers for event and monitor grid calculations.

**Key Functions:**

- ``getMaxColsForWidth(width, minWidth, margin)``: Calculate maximum grid columns for a given container width
- ``getMonitorDimensions(monitor, fallbackWidth, fallbackHeight)``: Extract monitor dimensions with fallbacks

**Used By:** ``EventListView.tsx``, ``EventMontageView.tsx``, ``useEventMontageGrid.ts``

--------------

Stream Lifecycle (``hooks/useStreamLifecycle.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Shared hook for ZMS stream connection key management and cleanup.

**Features:**

- Generates unique connection keys per monitor
- Sends CMD_QUIT before regenerating keys (prevents orphaned server streams)
- Sends CMD_QUIT on component unmount
- Aborts in-flight image loads on unmount
- Accepts a logger function for component-specific logging

**Implementation:**

.. code:: typescript

   import { useStreamLifecycle } from '../hooks/useStreamLifecycle';

   const { connKey } = useStreamLifecycle({
     monitorId: monitor.Id,
     portalUrl: profile.portalUrl,
     accessToken: auth.accessToken,
     viewMode: 'streaming', // CMD_QUIT only fires in streaming mode
     mediaRef: imgRef,
     logFn: log.montageMonitor,
   });

**Used By:** ``useMonitorStream``, ``MontageMonitor.tsx``, ``MonitorWidget.tsx``

--------------

Reusable UI Components
----------------------

Located in ``src/components/ui/``, these are primitive components used
throughout the app.

Button (``ui/button.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Styled button component with variants.

**Variants:** default, destructive, outline, secondary, ghost, link

**Sizes:** default, sm, lg, icon

**Usage:**

.. code:: tsx

   <Button variant="destructive" size="sm" onClick={handleDelete}>
     Delete
   </Button>

**Used By:** All pages and components

--------------

Card (``ui/card.tsx``)
~~~~~~~~~~~~~~~~~~~~~~

Container component for content sections.

**Sub-components:** Card, CardHeader, CardTitle, CardContent, CardFooter

**Usage:**

.. code:: tsx

   <Card>
     <CardHeader>
       <CardTitle>Monitor Name</CardTitle>
     </CardHeader>
     <CardContent>
       <img src={streamUrl} />
     </CardContent>
     <CardFooter>
       <Button>View Details</Button>
     </CardFooter>
   </Card>

**Used By:** MonitorCard, EventCard, Dashboard widgets, Settings pages

--------------

Dialog (``ui/dialog.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Modal dialog for confirmations and forms.

**Sub-components:** Dialog, DialogTrigger, DialogContent, DialogHeader,
DialogTitle, DialogDescription, DialogFooter

**Usage:**

.. code:: tsx

   <Dialog open={isOpen} onOpenChange={setIsOpen}>
     <DialogContent>
       <DialogHeader>
         <DialogTitle>Confirm Delete</DialogTitle>
         <DialogDescription>
           Are you sure you want to delete this event?
         </DialogDescription>
       </DialogHeader>
       <DialogFooter>
         <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
         <Button variant="destructive" onClick={handleConfirm}>Delete</Button>
       </DialogFooter>
     </DialogContent>
   </Dialog>

**Used By:** Event deletion, profile deletion, widget editing, PTZ
presets

--------------

Popover (``ui/popover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Floating content container for filters and actions.

**Sub-components:** Popover, PopoverTrigger, PopoverContent

**Usage:**

.. code:: tsx

   <Popover>
     <PopoverTrigger asChild>
       <Button variant="outline">
         <Filter className="h-4 w-4" />
       </Button>
     </PopoverTrigger>
     <PopoverContent>
       {/* Filter controls */}
     </PopoverContent>
   </Popover>

**Used By:** Filters (Events, Monitors, Timeline), date range selectors

--------------

SecureImage (``ui/secure-image.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Image component that handles authenticated requests.

**Features:**

- Fetches images with credentials
- Converts to blob URL
- Automatic cleanup

**Implementation:**

.. code:: tsx

   <SecureImage
     src="https://zm.example.com/protected-image.jpg"
     alt="Monitor snapshot"
     className="w-full h-auto"
   />

**How it works:** 1. Fetches image with ``credentials: 'include'`` 2.
Converts response to Blob 3. Creates local blob URL 4. Cleans up on
unmount

**Used By:** Components that need authenticated images (rare - most use
stream URLs with tokens)

--------------

EventThumbnail (``events/EventThumbnail.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Event thumbnail with a user-configurable fallback chain. Receives an
ordered list of candidate URLs (``urls``) and a stable ``cacheKey``
(typically the event id). On ``<img>`` ``onError`` it advances to the
next URL. The image is rendered with ``opacity: 0`` until ``onLoad``
fires, so the browser never flashes its broken-image glyph while the
chain is walking. The winning index is kept in a session-scoped
``Map<cacheKey, index>`` so list re-renders don't re-probe the chain.

**Props:**

.. code:: ts

   interface EventThumbnailProps {
     urls: string[];           // candidate URLs in order
     cacheKey: string;         // stable per-event identifier
     alt?: string;
     objectFit?: CSSProperties['objectFit'];
     className?: string;
   }

**Usage:**

.. code:: tsx

   import { buildThumbnailChain } from '../../lib/thumbnail-chain';
   import { useCurrentProfile } from '../../hooks/useCurrentProfile';

   const { settings } = useCurrentProfile();
   const urls = buildThumbnailChain(portalUrl, event.Id, settings.thumbnailFallbackChain, {
     token: accessToken,
     width,
     height,
     minStreamingPort,
     monitorId: event.MonitorId,
   });

   <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} />

The chain itself comes from the per-profile ``thumbnailFallbackChain``
setting (see ``stores/settings.ts``). ``resolveFallbackFids`` and
``buildThumbnailChain`` in ``lib/thumbnail-chain.ts`` translate the
setting into ordered fids and full URLs. Disabled entries and empty
custom rows are skipped.

**Used By:** EventCard (via EventListView and EventMontageView),
TimelineScrubber thumbnails, NotificationHistory. The EventDetail hero
poster and EventPreviewPopover pick the first fid from the resolved
chain instead of hardcoding ``snapshot``/``alarm``.

--------------

VideoPlayer (``ui/video-player.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

HTML5 video wrapper with platform integration.

**Features:**

- Autoplay control
- Fullscreen support
- Error handling
- Play/pause callbacks

**Usage:**

.. code:: tsx

   <VideoPlayer
     src={videoUrl}
     autoplay={true}
     onPlay={() => console.log('Playing')}
     onPause={() => console.log('Paused')}
   />

**Used By:** EventDetail page (MP4 playback), MonitorDetail (live
streams)

--------------

PasswordInput (``ui/password-input.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Password input with show/hide toggle.

**Features:**

- Eye icon toggle
- Keyboard-accessible
- Standard input props

**Usage:**

.. code:: tsx

   <PasswordInput
     value={password}
     onChange={(e) => setPassword(e.target.value)}
     placeholder="Enter password"
   />

**Used By:** ProfileForm, Login components

--------------

EmptyState (``ui/empty-state.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Placeholder component for empty lists/states.

**Features:**

- Icon support
- Title and description
- Optional action button

**Usage:**

.. code:: tsx

   <EmptyState
     icon={<Inbox className="h-12 w-12" />}
     title="No events found"
     description="Try adjusting your filters"
     action={
       <Button onClick={clearFilters}>Clear Filters</Button>
     }
   />

**Used By:** Events page, Monitors page, Dashboard (when no widgets)

--------------

PullToRefresh (``ui/pull-to-refresh-indicator.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Visual indicator for pull-to-refresh gesture.

**Features:**

- Platform-aware (mobile only)
- Animated spinner
- Progress indication

**Usage:**

.. code:: tsx

   const { isRefreshing, onRefresh } = usePullToRefresh(refetch);

   <>
     <PullToRefreshIndicator isActive={isRefreshing} />
     <IonContent onIonRefresh={onRefresh}>
       {/* Content */}
     </IonContent>
   </>

**Used By:** Events page, Monitors page, Montage page

--------------

QuickDateRangeButtons (``ui/quick-date-range-buttons.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Quick date range selector buttons.

**Features:**

- Predefined ranges (24h, 48h, 1wk, 2wk, 1mo)
- Abbreviated labels with tooltips
- Responsive (hides text on mobile)

**Usage:**

.. code:: tsx

   <QuickDateRangeButtons
     onRangeSelect={({ start, end }) => {
       setStartDate(start);
       setEndDate(end);
     }}
   />

**Used By:** Events filter, Timeline filter, Dashboard widgets

--------------

Select (``ui/select.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Dropdown select component.

**Sub-components:** Select, SelectTrigger, SelectValue, SelectContent,
SelectItem

**Usage:**

.. code:: tsx

   <Select value={value} onValueChange={setValue}>
     <SelectTrigger>
       <SelectValue placeholder="Select option" />
     </SelectTrigger>
     <SelectContent>
       <SelectItem value="option1">Option 1</SelectItem>
       <SelectItem value="option2">Option 2</SelectItem>
     </SelectContent>
   </Select>

**Used By:** Settings pages, filters, dashboard widget config

--------------

Switch (``ui/switch.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Toggle switch component.

**Usage:**

.. code:: tsx

   <Switch
     checked={enabled}
     onCheckedChange={setEnabled}
   />

**Used By:** Settings pages, filters (favorites toggle)

--------------

Badge (``ui/badge.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~

Small status indicator.

**Variants:** default, secondary, destructive, outline

**Usage:**

.. code:: tsx

   <Badge variant="destructive">Offline</Badge>
   <Badge>5 events</Badge>

**Used By:** MonitorCard (status), EventCard (alarm frames), navigation
(counts)

--------------

Progress (``ui/progress.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Progress bar component.

**Usage:**

.. code:: tsx

   <Progress value={percentage} max={100} />

**Used By:** Background task drawer (download progress)

--------------

Shared Hooks (hooks/)
---------------------

useEventFilters (``hooks/useEventFilters.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages event filter state with auto-save persistence. Filter
selections are saved to the settings store immediately via wrapped
setters — no "Apply" button needed for persistence.

**Key concepts:**

- Local state (``selectedMonitorIds``, ``selectedTagIds``, etc.)
  drives the UI and the ``filters`` object for API queries
- Wrapped setters (e.g. ``setSelectedTagIds``) update local state
  AND call ``saveFilterField()`` to write to the settings store
- Restore effect reads from settings on mount/profile change using
  raw ``_set*`` functions (bypasses save wrappers to avoid loops)
- ``ALL_TAGS_FILTER_ID`` sentinel (``'__all_tags__'``) means
  "show events with any tag" — mutually exclusive with individual
  tag selections
- ``onlyDetectedObjects`` flag adds ``notesRegexp: 'detected:'``
  to the API filter (server-side Notes REGEXP filter)
- The "Filter" button syncs state to URL params for deep linking

**Used By:** Events page, EventsFilterPopover

Event Notes Display
~~~~~~~~~~~~~~~~~~~

ZoneMinder stores object detection results in the ``Notes`` field
(e.g. ``detected:car| Motion: All``), not in ``Cause``. The Notes
field is displayed in EventCard, EventMontageView, EventDetail, and
the dashboard EventsWidget. Everything after ``|`` is stripped in
the display (redundant with Cause) but preserved in the ``title``
attribute for hover.

Sidebar Navigation Reorder
~~~~~~~~~~~~~~~~~~~~~~~~~~

Users can reorder sidebar menu items via an edit mode (pencil icon
in the sidebar). Order is saved per profile in
``ProfileSettings.sidebarNavOrder`` (array of route paths). The
``SidebarContent`` component (``components/layout/SidebarContent.tsx``)
sorts ``navItems`` by saved order using a ``useMemo``. Reorder uses
pointer events for drag-and-drop with live swap on midpoint crossing.

``AppLayout.tsx`` is a thin shell that composes ``SidebarContent``
(navigation, reorder, user controls) and ``LanguageSwitcher``
(self-contained language dropdown). The bulk of sidebar logic lives in
``SidebarContent.tsx``.

--------------

Reusable Domain Components
--------------------------

Located in ``src/components/``, organized by domain.

MonitorFilterPopover (``filters/MonitorFilterPopover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Monitor selection filter with “All Monitors” toggle.

**Features:**

- Select individual monitors
- “All Monitors” checkbox
- Search/filter monitors
- Used in multiple contexts (Events, Timeline, Dashboard)

**Usage:**

.. code:: tsx

   <MonitorFilterPopoverContent
     monitors={monitors}
     selectedMonitorIds={selectedMonitorIds}
     onSelectionChange={setSelectedMonitorIds}
     idPrefix="events" // for unique checkbox IDs
   />

**Used By:** Events page, Timeline page, Dashboard widget config

--------------

EventsFilterPopover (``events/EventsFilterPopover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Comprehensive event filtering UI (extracted from Events page).

**Features:**

- Monitor selection via MonitorFilterPopover
- Favorites-only toggle
- Date range inputs
- Quick date range buttons
- Apply/Clear actions

**Usage:**

.. code:: tsx

   <EventsFilterPopover
     monitors={monitors}
     selectedMonitorIds={selectedMonitorIds}
     onMonitorSelectionChange={setSelectedMonitorIds}
     favoritesOnly={favoritesOnly}
     onFavoritesOnlyChange={setFavoritesOnly}
     startDateInput={startDate}
     onStartDateChange={setStartDate}
     endDateInput={endDate}
     onEndDateChange={setEndDate}
     onQuickRangeSelect={({ start, end }) => {
       setStartDate(formatLocalDateTime(start));
       setEndDate(formatLocalDateTime(end));
     }}
     onApplyFilters={applyFilters}
     onClearFilters={clearFilters}
   />

**Used By:** Events page

--------------

BackgroundTaskDrawer (``BackgroundTaskDrawer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Drawer UI for background tasks (downloads, uploads, syncs).

**Features:**

- Task progress bars
- Cancellation support
- Auto-expand/collapse states
- Completion badge

**States:**

- Hidden: No tasks
- Expanded: Shows progress bars
- Collapsed: Thin bar at bottom
- Badge: Floating count badge

**Usage:**

.. code:: tsx

   // Automatically rendered in App.tsx layout
   // Controlled by background task store

   // Adding a task
   const taskStore = useBackgroundTasks.getState();
   const taskId = taskStore.addTask({
     type: 'download',
     metadata: { title: 'Video.mp4', description: 'Event 123' },
     cancelFn: () => abortController.abort(),
   });

   // Update progress
   taskStore.updateProgress(taskId, percentage, bytesProcessed);

   // Complete
   taskStore.completeTask(taskId);

**Used By:** Download functions, upload functions (future)

--------------

Usage Matrix
------------

This table shows which components/pages use which shared services:

+---------------------------------------------+------------------------+
| Service/Utility                             | Used By                |
+=============================================+========================+
| **logger**                                  | All components,        |
|                                             | stores, API functions  |
+---------------------------------------------+------------------------+
| **http**                                    | All API functions,     |
|                                             | download utilities     |
+---------------------------------------------+------------------------+
| **download**                                | MonitorCard,           |
|                                             | EventDetail,           |
|                                             | EventCard, VideoPlayer |
+---------------------------------------------+------------------------+
| **proxy-utils**                             | API functions          |
|                                             | (monitors, events),    |
|                                             | download, http         |
+---------------------------------------------+------------------------+
| **url-builder**                             | API functions, hooks   |
|                                             | (useMonitorStream,     |
|                                             | useEventPlayer)        |
+---------------------------------------------+------------------------+
| **time**                                    | API functions, Events  |
|                                             | page, Timeline,        |
|                                             | Dashboard widgets      |
+---------------------------------------------+------------------------+
| **crypto**                                  | ProfileService, secure |
|                                             | storage (web)          |
+---------------------------------------------+------------------------+
| **secureStorage**                           | ProfileService         |
+---------------------------------------------+------------------------+
| **platform**                                | HTTP client, download, |
|                                             | proxy utilities        |
+---------------------------------------------+------------------------+
| **api-validator**                           | All API functions      |
+---------------------------------------------+------------------------+
| **grid-utils**                              | Montage, EventMontage, |
|                                             | Dashboard              |
+---------------------------------------------+------------------------+

--------------

+-----------------------------------------+----------------------------+
| UI Component                            | Used By                    |
+=========================================+============================+
| **Button**                              | All pages and components   |
+-----------------------------------------+----------------------------+
| **Card**                                | MonitorCard, EventCard,    |
|                                         | Dashboard widgets,         |
|                                         | Settings                   |
+-----------------------------------------+----------------------------+
| **Dialog**                              | Event deletion, Profile    |
|                                         | deletion, Widget editing,  |
|                                         | PTZ presets                |
+-----------------------------------------+----------------------------+
| **Popover**                             | Filters (Events, Monitors, |
|                                         | Timeline), date selectors  |
+-----------------------------------------+----------------------------+
| **SecureImage**                         | (Rare - authenticated      |
|                                         | images)                    |
+-----------------------------------------+----------------------------+
| **VideoPlayer**                         | EventDetail, MonitorDetail |
+-----------------------------------------+----------------------------+
| **PasswordInput**                       | ProfileForm                |
+-----------------------------------------+----------------------------+
| **EmptyState**                          | Events, Monitors,          |
|                                         | Dashboard                  |
+-----------------------------------------+----------------------------+
| **PullToRefresh**                       | Events, Monitors, Montage  |
+-----------------------------------------+----------------------------+
| **QuickDateRangeButtons**               | Events filter, Timeline,   |
|                                         | Dashboard widgets          |
+-----------------------------------------+----------------------------+
| **Select**                              | Settings pages, filters,   |
|                                         | widget config              |
+-----------------------------------------+----------------------------+
| **Switch**                              | Settings pages, favorites  |
|                                         | toggle                     |
+-----------------------------------------+----------------------------+
| **Badge**                               | MonitorCard, EventCard,    |
|                                         | navigation                 |
+-----------------------------------------+----------------------------+
| **Progress**                            | BackgroundTaskDrawer       |
+-----------------------------------------+----------------------------+

--------------

+----------------------------------------------+-----------------------+
| Domain Component                             | Used By               |
+==============================================+=======================+
| **MonitorFilterPopover**                     | Events page, Timeline |
|                                              | page, Dashboard       |
|                                              | widget config         |
+----------------------------------------------+-----------------------+
| **EventsFilterPopover**                      | Events page           |
+----------------------------------------------+-----------------------+
| **BackgroundTaskDrawer**                     | App layout            |
|                                              | (auto-rendered)       |
+----------------------------------------------+-----------------------+

--------------

Adding New Shared Services
--------------------------

When creating a new shared utility, follow these guidelines:

1. Choose the Right Location
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- ``lib/`` - Pure utilities (no React, no stores)
- ``hooks/`` - React-specific logic
- ``services/`` - Platform-specific bridges (Capacitor plugins)
- ``components/ui/`` - Primitive UI components
- ``components/domain/`` - Domain-specific reusable components

2. Document Usage
~~~~~~~~~~~~~~~~~

Update this file with:

- Description of the utility
- Code examples
- Platform considerations
- List of consumers

3. Follow Patterns
~~~~~~~~~~~~~~~~~~

Look at existing utilities for patterns:

- Consistent error handling
- Logging via component-specific loggers
- Platform detection where needed
- TypeScript types exported

4. Test
~~~~~~~

All shared utilities should have unit tests in ``__tests__/``
subdirectory.

--------------

Key Takeaways
-------------

1. **Logger is universal** - Use component-specific helpers (e.g.,
   ``log.api()``, ``log.download()``)
2. **HTTP abstraction is required** - Never use raw ``fetch()``, always
   use ``httpGet/httpPost/etc``
3. **Platform detection matters** - Different implementations for
   Web/Mobile/Desktop
4. **Proxy in development** - Use ``proxy-utils`` for external URLs in
   dev mode
5. **Shared components reduce duplication** - Extract common UI patterns
6. **Document consumers** - When adding shared code, document who uses
   it
7. **DRY principles** - If code appears in 2+ places, extract to shared
   utility
8. **Test shared code** - Shared utilities have higher reuse, deserve
   more testing

--------------

Navigation Service (``lib/navigation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Bridges non-React code (services, push notification handlers) with React
Router. Services cannot call ``useNavigate()`` directly, so they emit
navigation events through this singleton and ``NotificationHandler``
listens and forwards them to the router.

**API:**

.. code:: typescript

   import { navigationService } from '../lib/navigation';

   // Navigate to an event (e.g., from push notification tap)
   navigationService.navigateToEvent(eventId, {
     from: '/monitors',        // back-button destination
     fromNotification: true,   // skip lastRoute persistence
   });

   // Generic navigation
   navigationService.navigate('/monitors/5');

   // Listen in a React component
   useEffect(() => {
     const unsubscribe = navigationService.addListener((event) => {
       navigate(event.path, { replace: event.replace, state: event.state });
     });
     return unsubscribe;
   }, [navigate]);

**NavigationState properties:**

- ``from`` — explicit back-button destination (read by EventDetail/MonitorDetail
  via ``location.state?.from``)
- ``fromNotification`` — when ``true``, AppLayout skips saving the route as
  ``lastRoute`` so the app does not reopen to a transient event playback screen

**Used By:** pushNotifications.ts, NotificationHandler.tsx

--------------

Notification Services (services/)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The notification system spans three services that handle different delivery
mechanisms:

``services/notifications.ts`` — WebSocket connection to ZoneMinder Event
Server (ES mode). Handles real-time alarm events via ``zmeventnotification.pl``.

- Singleton via ``getNotificationService()``
- Exponential backoff reconnection with jitter (2s base, 2min cap)
- ``intentionalDisconnect`` flag prevents reconnect after user-initiated
  disconnect; network failures always retry
- ``checkAlive(timeoutMs)`` liveness probe used on app resume and tab
  visibility change
- ``reconnectNow()`` for immediate reconnect on network restore
- 60-second keepalive ping
- ``reconnectAttempts`` resets only after successful authentication

``services/pushNotifications.ts`` — FCM push notification handling for
iOS and Android.

- Singleton via ``getPushService()``
- Requests permission, obtains FCM token, registers with ZM server
- In ES mode: registers token via WebSocket; in Direct mode: via REST API
- Foreground notifications are processed and added to the notification store
  (but ignored if WebSocket is already connected, to avoid duplicates)
- Handles notification tap to navigate to event detail

``services/eventPoller.ts`` — Polls ZM events API for new events in
Direct notification mode on desktop/web.

- Singleton via ``getEventPoller()``
- Started by ``NotificationHandler`` when ``notificationMode === 'direct'``
  and ``Platform.isDesktopOrWeb`` (not used on mobile — FCM handles delivery)
- Uses recursive ``setTimeout`` so interval changes take effect on next tick
- Configurable polling interval per-profile (default 30s)
- Optional ``Notes REGEXP:detected:`` filter for object-detection-only events
- Maintains a seen-event set (capped at 500) to avoid duplicate notifications

``components/NotificationHandler.tsx`` — Headless component that
orchestrates the notification lifecycle:

- Auto-connects WebSocket (ES mode) or starts poller (Direct mode on desktop)
- Listens for ``window.online`` and ``@capacitor/network`` to trigger
  reconnect on network restore
- Desktop: ``visibilitychange`` listener checks WebSocket liveness on tab
  resume
- Mobile: ``appStateChange`` listener checks WebSocket liveness on app resume
- Displays toast notifications for new events
- Clears native badges on app resume (iOS/Android)
- Listens to ``navigationService`` events and forwards them to React Router
  (with state for back-button and lastRoute control)

--------------

Kiosk PIN Utility (``lib/kioskPin.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Handles hashing, storage, and verification of the kiosk mode PIN.
The PIN is never stored in plain text — it is hashed with SHA-256 and
a random 128-bit salt before being written to secure storage.

**Storage:** Uses ``secureStorage.ts`` (Keychain on iOS, Keystore on
Android, encrypted localStorage on web). Keys: ``kiosk_pin_hash`` and
``kiosk_pin_salt``.

**Functions:**

- ``hashPin(pin, salt): Promise<string>`` — returns hex-encoded SHA-256
  of ``salt + pin``. Exported for testing; not normally called directly.
- ``storePin(pin): Promise<void>`` — generates a random salt, hashes the
  PIN, and stores both hash and salt in secure storage.
- ``verifyPin(pin): Promise<boolean>`` — retrieves the stored hash and
  salt, hashes the candidate PIN, and compares.
- ``hasPinStored(): Promise<boolean>`` — returns ``true`` if a PIN hash
  is present in secure storage.
- ``clearPin(): Promise<void>`` — removes the hash and salt from secure
  storage (used when the user disables kiosk mode via settings).

**Usage:**

.. code:: typescript

   import { storePin, verifyPin, hasPinStored, clearPin } from '../lib/kioskPin';

   // First-time setup
   if (!(await hasPinStored())) {
     await storePin('1234');
   }

   // Unlock attempt
   const ok = await verifyPin(enteredPin);

   // Remove PIN
   await clearPin();

**Used By:** ``hooks/useKioskLock.ts`` (setup flow),
``components/kiosk/KioskOverlay.tsx`` (unlock verification),
``pages/Settings.tsx`` (PIN set/change/clear in Advanced section)

--------------

log-file (``lib/log-file/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors entries from ``useLogStore`` to a persistent file on disk.

**Capabilities and file locations by platform:**

- Capacitor (iOS / Android): NDJSON file at ``Directory.Data/zmninja-ng.log`` (sandboxed app data). Resolved at runtime to a ``file://`` URI on iOS and ``content://`` URI on Android. Share via the system share sheet — recipient receives the file as an attachment.
- Tauri (desktop): NDJSON file at ``BaseDirectory::AppLog/zmninja-ng.log``. Concrete paths:

  - macOS: ``~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log``
  - Windows: ``%LOCALAPPDATA%\com.zoneminder.zmNinjaNG\logs\zmninja-ng.log``
  - Linux: ``~/.local/share/com.zoneminder.zmNinjaNG/logs/zmninja-ng.log``

  The "Open" button in the Logs page calls ``revealItemInDir`` (``tauri-plugin-opener``) to open the enclosing folder in Finder / Explorer / file manager.

- Web: no-op fallback; Share reverts to today's blob download. ``getDisplayPath`` returns ``null`` and the status line is hidden.

**Format:** NDJSON, one ``LogEntry`` per line. ``Logger.formatMessage`` constructs the entry once and passes it to both ``useLogStore.addLog`` and ``LogFileStore.append``.

**Cap:** 10,000 entries. On overflow, the file is rewritten with the last 5,000 entries.

**Hydration:** On app start, ``hydrateLogStoreFromFile()`` reads the file and replaces ``useLogStore.logs`` so prior-session entries are visible in the Logs page.

**Used by:** ``lib/logger.ts``, ``pages/Logs.tsx``.

--------------

Token freshness gate
--------------------

``useFreshAccessToken`` (``hooks/useFreshAccessToken.ts``) returns ``{ token, isFresh }``
where ``isFresh`` is true only when the access token has more than
``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes) of validity remaining. While not
fresh, the hook returns ``token: null`` and asks the auth store to refresh in the
background. Any callsite that builds a token-bearing URL the browser or native
runtime loads directly (ZMS streams, event images and videos, push-notification
image backfills) gates URL construction on ``isFresh``. While not fresh, the
callsite emits an empty URL and the existing ``VideoOff`` placeholder shows
through.

For non-React async paths, call ``useAuthStore.getState().getFreshAccessToken()``
directly. The action dedupes concurrent callers, falls through from refresh to
credentials re-login on failure, and resolves with ``null`` if both fail.

--------------

Next Steps
----------

Continue to `Chapter 6: Testing Strategy <06-testing-strategy>`
to learn how to test shared services and components.
