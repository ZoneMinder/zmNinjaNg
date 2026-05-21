Project Architecture
====================

This chapter describes the overall structure of the zmNinjaNg project,
including non-component logic and the component hierarchy.

Directory Structure
-------------------

The ``src/`` directory is organized by responsibility:

::

   src/
   ├── api/             # API client functions (Zustand independence)
   ├── components/      # React components (Visuals)
   ├── hooks/           # Custom React hooks (Component logic)
   ├── lib/             # Pure utility functions and system wrappers
   ├── pages/           # Route-level views
   ├── services/        # Platform-specific services (Capacitor, etc.)
   ├── stores/          # Global state (Zustand)
   └── types/           # Shared TypeScript definitions

Key Directories Explained
~~~~~~~~~~~~~~~~~~~~~~~~~

- ``api/``: Contains raw fetch functions for ZoneMinder endpoints.
  These functions are stateless and should not depend on React or stores
  directly if possible (though some might need auth tokens).
- ``hooks/``: Reusable React logic.

  - ``useMonitorStream``: Manages video stream URLs and auth.
  - ``useStreamLifecycle``: Shared connKey lifecycle (CMD_QUIT, cleanup, media abort). Used by ``useMonitorStream``, ``MontageMonitor``, and ``MonitorWidget``.
  - ``useTokenRefresh``: Handles background token renewal.
  - ``useKioskLock``: PIN setup and lock-activation flow for kiosk mode.
  - ``useBiometricAuth``: Dynamic-import wrapper for biometric authentication.
  - ``useNotificationAutoConnect``: Auto-connects the notification WebSocket on profile load and network reconnection.
  - ``useNotificationPushSetup``: FCM token initialization on mobile.
  - ``useNotificationDelivered``: Processes delivered notifications on cold start and resume.
  - ``useServerUrls(serverId)``: Wraps ``server-resolver`` cache via ``useSyncExternalStore`` for reactive per-server URL resolution.
  - ``useMonitorStream({ monitorId, serverId })``: MJPEG stream with server-resolved URLs.
  - ``useGo2RTCStream({ go2rtcUrl, monitorId, channel, controls })``: Go2RTC streaming. ``channel`` accepts a string (the ``StreamChannel`` field, e.g. ``"CameraDirectPrimary"``).

  Note: ``usePTZControl`` lives in ``pages/hooks/usePTZControl.ts``, not
  in ``src/hooks/``.

- ``lib/``: “Library” code - helpers that could theoretically be in
  a separate npm package.

  - ``logger.ts``: Structured logging system. Each filtered entry is passed to
    the platform ``LogFileStore`` (see :doc:`12-shared-services-and-components`)
    for on-disk persistence. The same sanitized ``LogEntry`` reaches the
    in-memory store, the file, and the browser console, there is no separate
    filter path.
  - ``utils.ts``: String formatting, date helpers.
  - ``http.ts``: Fetch wrapper with error handling.

- ``services/``: Bridges between the web app and native platform
  features.

  - ``notifications.ts``: Event Server WebSocket notification handling.
  - ``pushNotifications.ts``: FCM push notification handling on iOS/Android.
  - ``eventPoller.ts``: Direct-mode event polling on desktop/web.
  - ``profile.ts``: Profile-related service helpers.

- ``stores/``: Global state management (see Chapter 3).

Component Structure
-------------------

Components are organized by domain in ``src/components/``:

::

   src/components/
   ├── dashboard/          # Dashboard-specific components
   ├── events/             # Event-related components
   ├── filters/            # Filter components
   ├── kiosk/              # Kiosk mode components
   ├── layout/             # App shell layout components
   ├── monitor-detail/     # Monitor detail page sub-components
   ├── monitors/           # Monitor-related components (MonitorCard, MonitorHoverPreview, MontageMonitor, PTZControls)
   ├── montage/            # Montage grid components and hooks
   ├── notifications/      # Notification settings sub-components
   ├── settings/           # Settings page section components
   ├── timeline/           # Event timeline components
   ├── tv/                 # TV-mode components
   ├── ui/                 # Reusable UI primitives (shadcn/ui + Tailwind)
   ├── BackgroundTaskDrawer.tsx
   ├── CertTrustDialog.tsx
   ├── ErrorBoundary.tsx
   ├── mode-toggle.tsx
   ├── NotificationBadge.tsx
   ├── NotificationHandler.tsx
   ├── profile-switcher.tsx
   ├── QRScanner.tsx       # QR code scanning for profile import
   ├── RouteErrorBoundary.tsx
   └── theme-provider.tsx

Monitor Components
------------------

MonitorCard
~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorCard.tsx``

The primary component for displaying a single monitor with live stream
preview, status, and actions.

**Key Features:**

- Live stream thumbnail (JPEG stream from ZoneMinder)
- Auto-regenerates connection keys on stream failure
- Download snapshot functionality
- Status badge (Live/Offline) with FPS
- Quick navigation to monitor detail and events
- Settings button for monitor configuration

**Implementation Details:**

.. code:: tsx

   export const MonitorCard = memo(function MonitorCardComponent({
     monitor,
     status,
     eventCount,
     onShowSettings,
     objectFit,
   }: MonitorCardComponentProps) {
     const navigate = useNavigate();
     const { t } = useTranslation();

     // Custom hook manages stream URL and connection state
     const {
       streamUrl,
       imageSrc,
       imgRef,
       regenerateConnection,
     } = useMonitorStream({ monitorId: monitor.Id });

     // Handles stream errors - regenerates connkey once, then shows placeholder
     const handleImageError = () => {
       const img = imgRef.current;
       if (!img) return;

       if (!img.dataset.retrying) {
         img.dataset.retrying = 'true';
         regenerateConnection();
         toast.error(t('monitors.stream_connection_lost', { name: monitor.Name }));

         setTimeout(() => {
           if (img) delete img.dataset.retrying;
         }, 5000);
       } else {
         // Show "No Signal" placeholder
         img.src = `data:image/svg+xml,...`;
       }
     };

     // Downloads current frame as snapshot
     const handleDownloadSnapshot = async (e: React.MouseEvent) => {
       e.stopPropagation();
       if (imgRef.current) {
         await downloadSnapshotFromElement(imgRef.current, monitor.Name);
         toast.success(t('monitors.snapshot_downloaded'));
       }
     };

     return (
       <Card data-testid="monitor-card">
         {/* Stream preview */}
         <div onClick={() => navigate(`/monitors/${monitor.Id}`)}>
           <img
             ref={imgRef}
             src={imageSrc}
             onError={handleImageError}
             style={{ objectFit: resolvedFit }}
           />
           <Badge variant={isRunning ? 'default' : 'destructive'}>
             {isRunning ? t('monitors.live') : t('monitors.offline')}
           </Badge>
         </div>

         {/* Info and actions */}
         <div>
           <div>{monitor.Name}</div>
           <div>{status?.CaptureFPS || '0'} FPS</div>
           <Button onClick={() => navigate(`/events?monitorId=${monitor.Id}`)}>
             Events {eventCount > 0 && <Badge>{eventCount}</Badge>}
           </Button>
           <Button onClick={handleShowSettings}>Settings</Button>
           <Button onClick={handleDownloadSnapshot}>Download</Button>
         </div>
       </Card>
     );
   });

Wrapped in ``React.memo()`` so the card only re-renders when its own
props change.

**useMonitorStream:**

- Generates authenticated stream URL with connection key
- Regenerates the key on stream failure
- Returns a ref to the ``<img>`` element for snapshot downloads
- Builds URLs via ``src/lib/url-builder.ts``
- Exposes ``imageSrc``, the value to bind to ``<img src>``. It equals
  ``streamUrl`` in every case except Tauri desktop snapshot mode, where it is a
  ``blob:`` object URL fetched through the Rust HTTP client (see below)

See :doc:`07-api-and-data-fetching` for cache busting (``_t``),
multi-port streaming, and the Tauri snapshot blob fetch.

MontageMonitor
~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MontageMonitor.tsx``

A simplified version of MonitorCard optimized for the montage grid.

**Differences from MonitorCard:**

- Minimal UI (header with name + status, stream image, no action buttons)
- Edge-to-edge styling: ``rounded-none``, ``shadow-none``, no hover ring
- Edit-mode indicator: yellow ring (``ring-2 ring-yellow-400/70``)
  when ``isEditing`` is true
- Default ``objectFit`` is ``cover``; overridable via prop
- Uses ``useStreamLifecycle`` directly for connKey management (CMD_QUIT, cleanup)

**Props:**

- ``monitor`` – monitor data object
- ``isFullscreen`` – whether the montage is in fullscreen mode
- ``isEditing`` – highlights the card with a yellow ring
- ``objectFit`` – CSS object-fit value (default ``cover``)
- ``onPress`` – click handler (navigates to monitor detail)

GridLayoutControls
~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/montage/GridLayoutControls.tsx``

Provides column presets (1–5) and saved layout management. Renders as a
``Sheet`` on mobile, ``DropdownMenu`` on desktop.

**Props:**

- ``isMobile`` – controls mobile vs desktop rendering
- ``gridCols`` – current display column count
- ``activeLayoutName`` – name of the loaded saved layout (or null)
- ``onApplyGridLayout(cols)`` – apply a preset column count
- ``savedLayouts`` – array of ``{ name, layout, displayCols }``
- ``onSaveLayout(name)`` / ``onLoadLayout(saved)`` /
  ``onDeleteLayout(index)`` – saved layout CRUD

Includes a ``SaveLayoutDialog`` for naming layouts before saving.

Montage Hooks
~~~~~~~~~~~~~

All hooks are exported from ``src/components/montage/index.ts``.

- **useMontageGrid** – layout state, column calculations, aspect-ratio
  height, saved layout persistence, layout migration. Returns layout
  array, handlers, and refs.
- **useContainerResize** – ``ResizeObserver`` wrapper with 500 ms
  debounce. First measurement fires immediately; subsequent width
  changes are debounced so height recalculation only runs after resizing
  stops.
- **useFullscreenMode** – toggles fullscreen via the Fullscreen API.
- **getMaxColsForWidth(width, minWidth, margin)** – utility that
  computes the maximum display columns that fit a given container width.

PTZControls
~~~~~~~~~~~

**Location**: ``src/components/monitors/PTZControls.tsx``

Pan-Tilt-Zoom control interface for controllable cameras.

**Features:**

- Directional pad for pan/tilt
- Zoom in/out controls
- Preset position buttons
- Auto-pause mode (move while pressed)

**API Integration:**

.. code:: tsx

   const handleMove = async (direction: PTZDirection) => {
     await api.ptzControl(monitor.Id, {
       command: direction,
       speed: zoomSpeed,
     });
   };

Dashboard Components
--------------------

DashboardWidget
~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardWidget.tsx``

Wrapper component that provides edit, delete, and drag functionality for
dashboard widgets.

**Implementation:**

.. code:: tsx

   export function DashboardWidget({
     id,
     title,
     children,
     profileId,
     'data-grid': dataGrid,  // From react-grid-layout
   }: DashboardWidgetProps) {
     const isEditing = useDashboardStore((state) => state.isEditing);
     const removeWidget = useDashboardStore((state) => state.removeWidget);
     const widgetRef = useRef<HTMLDivElement>(null);
     const [editDialogOpen, setEditDialogOpen] = useState(false);

     return (
       <Card ref={widgetRef} data-grid={dataGrid}>
         {/* Edit mode controls */}
         {isEditing && (
           <div className="absolute top-2 right-2 z-50 flex gap-2">
             <Button
               onClick={(e) => {
                 e.stopPropagation();  // Prevent drag
                 setEditDialogOpen(true);
               }}
               onMouseDown={(e) => e.stopPropagation()}  // Prevent drag
             >
               <Pencil />
             </Button>
             <Button
               onClick={(e) => {
                 e.stopPropagation();
                 removeWidget(profileId, id);
               }}
               onMouseDown={(e) => e.stopPropagation()}
             >
               <X />
             </Button>
           </div>
         )}

         {/* Drag handle */}
         {title && (
           <CardHeader className="drag-handle cursor-move">
             {isEditing && <GripVertical />}
             {title}
           </CardHeader>
         )}

         {/* Widget content */}
         <CardContent>{children}</CardContent>
       </Card>
     );
   }

``e.stopPropagation()`` (and the same handler on ``onMouseDown``)
prevents ``react-grid-layout`` from starting a drag when the edit/delete
buttons are clicked.

Widget Types
~~~~~~~~~~~~

All widgets follow the same pattern: they’re wrapped in
``DashboardWidget`` and receive configuration:

**MonitorWidget**
(``src/components/dashboard/widgets/MonitorWidget.tsx``): - Displays a
single monitor stream - Configuration: monitor ID, object-fit mode -
Uses ``useMonitorStream`` hook (which internally delegates connKey
lifecycle to ``useStreamLifecycle``)

**EventsWidget**
(``src/components/dashboard/widgets/EventsWidget.tsx``): - Shows recent
events list - Configuration: monitor filter, date range

**HeatmapWidget**
(``src/components/dashboard/widgets/HeatmapWidget.tsx``): - Event
frequency heatmap by day/hour - Configuration: date range, monitors

**TimelineWidget**
(``src/components/dashboard/widgets/TimelineWidget.tsx``): - Event
timeline visualization - Configuration: date range

**Usage:**

.. code:: tsx

   <DashboardWidget id="widget-1" title="Front Door" profileId={profileId}>
     <MonitorWidget monitorId="1" />
   </DashboardWidget>

Event Components
----------------

EventCard
~~~~~~~~~

**Location**: ``src/components/events/EventCard.tsx``

Displays a single event with thumbnail, details, and actions.

**Features:**

- Event thumbnail
- Cause/notes display
- Duration and timestamp
- Quick play button
- Delete/download actions
- Desktop hover preview of the thumbnail via
  ``EventThumbnailHoverPreview`` (see below)

EventThumbnailHoverPreview
~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/events/EventThumbnailHoverPreview.tsx``

Thin wrapper around the ``HoverPreview`` primitive
(``src/components/ui/hover-preview.tsx``) that renders an
``EventThumbnail`` as the preview content.

The hover preview consumes a separate ``largeThumbnailUrls`` chain that
``EventListView`` builds with ``buildThumbnailChain`` with no ``width``
or ``height`` set, the server returns the original image, and the view
scales it down to the preview size.

HoverPreview (primitive)
~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/ui/hover-preview.tsx``

Desktop-only hover primitive. Renders ``children`` as the trigger and
opens a 400px-wide portal next to the anchor after a 400 ms hover delay
(both configurable). ``renderPreview`` is only invoked while the
preview is open, so contents mount on hover and unmount on leave,
this is how ``MonitorHoverPreview`` spins up and tears down a fresh
stream connection. The portal uses ``pointer-events: none`` so the
trigger stays clickable, flips to the left when there is no room on
the right, and closes on mouse leave or window scroll/wheel.

MonitorHoverPreview
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorHoverPreview.tsx``

Wraps a monitor card or dashboard monitor widget. On hover, mounts an
inner ``MonitorLivePreview`` that calls ``useStreamLifecycle`` with
``viewMode: 'streaming'`` to generate a fresh ZMS connkey, then renders
an ``<img>`` pointed at ``getStreamUrl(..., { mode: 'jpeg', connkey })``.
When the hover ends the inner component unmounts, and
``useStreamLifecycle``'s cleanup effect sends ``CMD_QUIT`` for that
connkey, so the extra preview stream is torn down on the ZM server
instead of lingering as a zombie.

Used from ``MonitorCard`` (both compact and list layouts) and the
dashboard ``MonitorWidget``'s ``SingleMonitor``.

EventHeatmap
~~~~~~~~~~~~

**Location**: ``src/components/events/EventHeatmap.tsx``

Calendar heatmap showing event frequency by day and hour.

**Uses:**

- ``react-calendar-heatmap`` for visualization
- Queries event counts aggregated by time
- Color intensity based on event frequency

TagChip
~~~~~~~

**Location**: ``src/components/events/TagChip.tsx``

Displays event tags as small badge/chip elements.

**Features:**

- Compact visual representation of tags
- Used in EventCard to show assigned tags
- Styled to match the app’s design system

**Usage:**

.. code:: tsx

   <div className="flex gap-1">
     {tags.map(tag => (
       <TagChip key={tag.Id} tag={tag} />
     ))}
   </div>

Video Playback
--------------

Three players exist because there are three distinct delivery protocols.
Live monitor streams negotiate Go2RTC (WebRTC / MSE / HLS) and fall back
to MJPEG. Recorded events come in two shapes: either ZoneMinder produced
an MP4 (``Videoed === '1'``), in which case Video.js handles it as MP4
or HLS, or only JPEG frames are stored and the only way to play them
back is the ZMS streaming endpoint. EventDetail also exposes a user
toggle (TV mode defaults to on) that forces the ZMS path even when an
MP4 is available.

The three player files sit next to their consumers. Live playback lives
under ``components/monitors/``; event playback lives under
``components/events/``. The file name carries the protocol so the
selection at each call site is self-evident from the import.

LiveMonitorPlayer
~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/LiveMonitorPlayer.tsx``

Live monitor player. Picks between Go2RTC and MJPEG based on monitor
capabilities and user preference. Consumed by ``MonitorCard``,
``MontageMonitor``, the dashboard ``MonitorWidget``, and the
``MonitorDetail`` page.

**Props (from ``LiveMonitorPlayerProps``):**

.. code:: tsx

   export interface LiveMonitorPlayerProps {
     monitor: Monitor;
     profile: Profile | null;
     className?: string;
     objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
     showControls?: boolean;
     externalMediaRef?: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
     muted?: boolean;
     onLoad?: () => void;
     onProtocolChange?: (protocol: string) => void;
     forceViewMode?: 'streaming' | 'snapshot';
   }

**Protocol selection.** Go2RTC is used when the user's
``streamingMethod`` is not ``'mjpeg'``, ``monitor.Go2RTCEnabled`` is
true, and the profile has a ``go2rtcUrl``. A per-monitor override in
``monitorStreamingOverrides`` wins over the global setting. Otherwise
MJPEG. The Go2RTC hook (``useGo2RTCStream``) tries WebRTC then MSE then
HLS in order and reports the active protocol back via
``onProtocolChange``.

**Failure cache.** A module-level ``go2rtcFailureCache`` records the
last failure timestamp per ``monitor.Id``. While that entry is younger
than ``GO2RTC_RETRY_INTERVAL_MIN`` (5 minutes), the player skips Go2RTC
entirely and starts on MJPEG. This avoids montage grids re-attempting
WebRTC on every tile every render. The cache is cleared immediately
when the user explicitly switches a monitor's preference back to
Go2RTC, so a manual retry does not have to wait out the window.

**No-frame fallback.** After Go2RTC reports ``connected``, the player
arms an 8-second timer (``GO2RTC_VIDEO_TIMEOUT_S``). When it fires the
player inspects ``videoWidth`` / ``videoHeight`` on the underlying
``<video>``. Zero dimensions count as a soft failure: the monitor is
marked failed and MJPEG takes over. Nonzero dimensions with the video
paused triggers a single ``video.play()`` attempt to recover from
autoplay restrictions.

**Test IDs.** The outer wrapper carries
``data-testid="video-player"``. Internal states expose
``video-player-loading``, ``video-player-webrtc-container``,
``video-player-mjpeg``, ``video-player-error``, and
``video-player-retry``. E2E step definitions in
``tests/steps/monitor-detail.steps.ts`` and ``tests/steps/events.steps.ts``
bind to these IDs, so renaming any of them breaks the cross-platform
suite.

Mp4EventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/Mp4EventPlayer.tsx``

Video.js wrapper for recorded event playback. Consumed only by
``EventDetail``, on the MP4 / HLS branch.

**Props:**

.. code:: tsx

   interface Mp4EventPlayerProps {
     src: string;
     type?: string;
     poster?: string;
     className?: string;
     autoplay?: boolean | 'muted' | 'play' | 'any';
     controls?: boolean;
     muted?: boolean;
     aspectRatio?: string;
     markers?: VideoMarker[];
     onMarkerClick?: (marker: VideoMarker) => void;
     onReady?: (player: Player) => void;
     onError?: (error: unknown) => void;
     eventId?: string;
   }

Markers are rendered via ``videojs-markers``; the ``markers`` array
maps to alarm / max-score frames on the event timeline and
``onMarkerClick`` seeks to a frame. Source, poster, and autoplay
changes propagate through a separate update effect that diffs against
``player.currentSrc()`` before reassigning, so token refresh does not
restart playback on iOS WKWebView.

When ``eventId`` is set, the player participates in Picture-in-Picture
via ``usePip()`` from ``contexts/PipContext.tsx``: it adopts its
``<video>`` element into the root portal on PiP entry, reclaims it on
remount of the same event, and closes any existing PiP session if a
different event is opened. Android uses a custom control-bar button
that triggers native ExoPlayer PiP via ``Pip.enterAndroidPip``;
desktop and iOS use the browser ``enterpictureinpicture`` event.

ZmsEventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/ZmsEventPlayer.tsx``

Player for events backed by ZoneMinder's ZMS streaming endpoint
(``cgi-bin/nph-zms``). ZMS serves a progressive JPEG stream and accepts
control commands (PAUSE, PLAY, SEEK, FASTFWD, etc.) over a separate URL
keyed by ``connkey``. Consumed only by ``EventDetail``, on the
JPEG-only branch and on the user-forced-ZMS branch.

**Props:** ``portalUrl``, ``eventId``, ``token``, ``apiUrl``,
``totalFrames``, ``alarmFrames``, ``alarmFrameId``, ``maxScoreFrameId``,
``eventLength``, ``minStreamingPort``, ``monitorId``, ``className``.

The player exposes transport controls (start, seek back 5s, play /
pause, seek forward 5s, end), speed presets (0.25x, 0.5x, 1x, 2x, 4x),
a frame-position scrubber with alarm-frame markers, and jump buttons
for the first alarm frame and the max-score frame. Playback position
is tracked by polling ``ZM_CMD.QUERY`` at the bandwidth-aware
``zmsStatusInterval``; the poll is cancelled via an ``AbortController``
on unmount.

URL construction is gated on a fresh access token via
``useFreshAccessToken``. When the token is stale, ``zmsUrl`` evaluates
to ``''`` and the ``<img>`` does not render until the auth store
returns a refreshed value. See the access-token freshness gate in
:doc:`07-api-and-data-fetching` for why this gate exists and what
counts as fresh.

Player Selection in EventDetail
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The branch in ``src/pages/EventDetail.tsx`` reduces to:

.. code:: tsx

   {hasVideo ? (
     useZmsFallback ? (
       <ZmsEventPlayer ... />
     ) : (
       <Mp4EventPlayer src={videoUrl} ... />
     )
   ) : hasJPEGs ? (
     <ZmsEventPlayer ... />
   ) : (
     /* no media */
   )}

``hasVideo`` is ``event.Event.DefaultVideo || event.Event.Videoed === '1'``.
``hasJPEGs`` is true when ``event.Event.SaveJPEGs`` is set and nonzero.
``useZmsFallback`` defaults to ``true`` in TV mode and on Tauri, and is
toggleable from the EventDetail header.

Filter Components
-----------------

GroupFilterSelect
~~~~~~~~~~~~~~~~~

**Location**: ``src/components/filters/GroupFilterSelect.tsx``

Dropdown component for filtering monitors by group.

**Features:**

- Fetches groups from the groups API
- Supports “All Groups” option
- Updates filter state when selection changes

**Usage:**

.. code:: tsx

   <GroupFilterSelect
     value={selectedGroupId}
     onChange={(groupId) => setSelectedGroupId(groupId)}
   />

QR Scanner
----------

QRScanner
~~~~~~~~~

**Location**: ``src/components/QRScanner.tsx``

A dialog-based QR code scanner for importing server profiles.

**Platform Implementations:**

- **Native (iOS/Android)**: Uses ``capacitor-barcode-scanner`` for
  native camera access
- **Web (Desktop)**: Uses ``html5-qrcode`` library with browser camera
  API

**Features:**

- Scan QR codes with device camera
- Load QR codes from photo files (“Load from Photo” option)
- Graceful error handling for permission denied, camera not found
- Auto-cleanup of scanner resources on unmount

**Usage:**

.. code:: tsx

   <QRScanner
     open={scannerOpen}
     onOpenChange={setScannerOpen}
     onScan={(data) => {
       // data contains the decoded QR code content
       // Parse as JSON for profile data
       const profile = JSON.parse(data);
       importProfile(profile);
     }}
   />

**Implementation Notes:**

- The ``html5-qrcode`` library manipulates DOM directly, so the scanner
  container is created outside React’s virtual DOM to avoid
  reconciliation conflicts
- Native scanner launches a full-screen camera view; the dialog is
  hidden while scanning
- File scanning creates a temporary DOM element, scans the image, then
  cleans up

Common Components
-----------------

Shared UI building blocks used across pages, extracted to remove
duplication. They live in ``src/components/common/`` and have unit tests
alongside in ``src/components/common/__tests__/``.

RefreshButton
~~~~~~~~~~~~~

**Location**: ``src/components/common/RefreshButton.tsx``

Replaces the ``Button`` + ``RefreshCw`` icon pattern that page headers
re-implemented for every data page.

.. code:: tsx

   export type RefreshButtonShowLabel = 'always' | 'never' | 'sm-and-up';

   export interface RefreshButtonProps {
     onRefresh: () => void;
     isLoading?: boolean;
     disabled?: boolean;
     label?: string;
     showLabel?: RefreshButtonShowLabel;
     size?: 'sm' | 'icon';
     className?: string;
     'data-testid'?: string;
     'aria-label'?: string;
   }

The icon gets ``animate-spin`` whenever ``isLoading`` is true, and the
button is disabled while loading or when ``disabled`` is set. The label
defaults to the ``common.refresh`` translation key (present in all five
locales: ``en``, ``de``, ``es``, ``fr``, ``zh``) and doubles as the
button ``title`` and ``aria-label`` when no explicit ``aria-label`` is
passed. The ``showLabel`` variants control label visibility:
``'never'`` (default) wraps the text in ``sr-only``, ``'always'``
renders it inline with an ``mr-2`` icon gap, and ``'sm-and-up'`` hides
it below the ``sm`` breakpoint via ``hidden sm:inline``.

The default ``data-testid`` is ``'refresh-button'``; pages override it
when multiple refresh buttons can be on screen at once (for example
``monitors-refresh-button``).

.. code:: tsx

   // src/pages/Monitors.tsx
   <RefreshButton
     onRefresh={() => refetch()}
     isLoading={isFetching}
     className="h-8 w-8 sm:h-9 sm:w-9"
     data-testid="monitors-refresh-button"
   />

PageContainer
~~~~~~~~~~~~~

**Location**: ``src/components/common/PageContainer.tsx``

Replaces the ``<div className="p-3 sm:p-4 md:p-6 space-y-...">`` wrapper
that every page used to inline.

.. code:: tsx

   export type PageContainerSpacing = 'tight' | 'normal' | 'loose' | 'none';

   export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
     children: ReactNode;
     spacing?: PageContainerSpacing;
     className?: string;
   }

The wrapper always emits ``p-3 sm:p-4 md:p-6``. The ``spacing`` prop
maps to one fixed vertical-gap class:

- ``'none'`` emits no ``space-y-*`` class (use this when the page needs
  its own responsive variant, then pass it via ``className``)
- ``'tight'`` emits ``space-y-3``
- ``'normal'`` (default) emits ``space-y-4``
- ``'loose'`` emits ``space-y-6``

The component is wrapped in ``forwardRef`` and spreads remaining props
onto the underlying ``<div>``, so ``ref`` and ``data-testid`` flow
through. The ``className`` prop is additive: extra utility classes are
merged via ``cn()`` and win on conflict.

.. code:: tsx

   // src/pages/Settings.tsx
   <PageContainer spacing="loose">
     <div>
       <div className="flex items-center gap-2">
         <h1 className="text-base sm:text-lg font-bold tracking-tight">
           {t('settings.title')}
         </h1>
         <NotificationBadge />
       </div>
       {/* ... */}
     </div>
   </PageContainer>

For pages that need a responsive vertical gap, pair ``spacing="none"``
with a custom ``className``:

.. code:: tsx

   // src/pages/Monitors.tsx
   <PageContainer className="space-y-4 sm:space-y-6" spacing="none">
     {/* ... */}
   </PageContainer>

UI Components
-------------

Located in ``src/components/ui/``, these are reusable primitives:

SecureImage
~~~~~~~~~~~

**Location**: ``src/components/ui/secure-image.tsx``

An image component that handles authenticated requests (for servers
requiring auth).

**Implementation:**

.. code:: tsx

   export function SecureImage({ src, alt, ...props }: SecureImageProps) {
     const [blobUrl, setBlobUrl] = useState<string | null>(null);

     useEffect(() => {
       if (!src) return;

       // Fetch with credentials
       fetch(src, { credentials: 'include' })
         .then(res => res.blob())
         .then(blob => {
           const url = URL.createObjectURL(blob);
           setBlobUrl(url);
         });

       return () => {
         if (blobUrl) URL.revokeObjectURL(blobUrl);
       };
     }, [src]);

     return <img src={blobUrl || ''} alt={alt} {...props} />;
   }

Fetches the image with credentials, converts to a blob, and creates a
local URL. Used for servers that require auth on every request.

PipContext
~~~~~~~~~~

**Location**: ``src/contexts/PipContext.tsx``

Provides ``PipProvider`` and ``usePip()`` hook for Picture-in-Picture
video that survives route changes.

**API:**

- ``adoptForPip(player, videoEl, eventId)``: moves the video element
  to a root portal so it persists outside the component tree.
- ``reclaimFromPip()``: reclaims the element for inline resume in the
  original component.
- ``closePip()``: ends PiP and cleans up resources.
- ``activePipEventId``: tracks which event is currently in PiP.

**Integration:**

``PipProvider`` wraps the app in ``App.tsx`` and renders a hidden portal
``div`` as a sibling of the router. VideoPlayer uses ``usePip()`` to
adopt/reclaim its player element during PiP transitions.

PasswordInput
~~~~~~~~~~~~~

**Location**: ``src/components/ui/password-input.tsx``

Text input with show/hide password toggle.

**Implementation:**

.. code:: tsx

   export function PasswordInput({ ...props }: PasswordInputProps) {
     const [showPassword, setShowPassword] = useState(false);

     return (
       <div className="relative">
         <input
           type={showPassword ? 'text' : 'password'}
           {...props}
         />
         <button
           onClick={() => setShowPassword(!showPassword)}
           className="absolute right-2 top-2"
         >
           {showPassword ? <EyeOff /> : <Eye />}
         </button>
       </div>
     );
   }

CollapsibleCard
~~~~~~~~~~~~~~~

**Location**: ``src/components/ui/collapsible-card.tsx``

A Card with a clickable header that collapses/expands the content.
Uses Radix Collapsible. Optionally persists open/closed state to
localStorage via ``storageKey``.

**Usage:**

.. code:: tsx

   <CollapsibleCard
     storageKey="settings-video"
     header={
       <>
         <CardTitle>Video Settings</CardTitle>
         <CardDescription>Configure video options</CardDescription>
       </>
     }
   >
     {/* Card body content */}
   </CollapsibleCard>

Used by all Settings page sections.

NotificationBadge
~~~~~~~~~~~~~~~~~

**Location**: ``src/components/NotificationBadge.tsx``

Inline bell icon with unread count badge. Only renders when there are
unread notifications. Rings (CSS animation) when new notifications
arrive. Uses a module-level variable to track the last known count
across component mount/unmount cycles, so page navigation doesn't
re-trigger the animation.

**Usage:** Place next to page titles:

.. code:: tsx

   <div className="flex items-center gap-2">
     <h1>Events</h1>
     <NotificationBadge />
   </div>

Added to all page headers (Dashboard, Events, Monitors, etc.).

Kiosk Mode
----------

Kiosk mode locks the UI so that the current view stays visible and
live-updating while all navigation and interaction is blocked. It is
activated from the sidebar lock icon or the fullscreen montage controls.

KioskOverlay
~~~~~~~~~~~~

**Location**: ``src/components/kiosk/KioskOverlay.tsx``

Full-screen transparent overlay rendered on top of the entire app when
``kioskStore.isLocked`` is ``true``. The underlying view continues to
update (streams, event counts, etc.), only interaction is blocked.

**Behaviour:**

- Covers the viewport with ``z-index: 9999`` and ``pointer-events: auto``
- Intercepts browser back navigation (pushState trick) so the user cannot
  leave the locked view
- On Android, swallows the hardware back button via ``@capacitor/app``
  listener (dynamic import, native platforms only)
- Blocks keyboard shortcuts while locked (but not when the PIN pad is open,
  so keyboard input reaches the PinPad)
- Shows a small unlock button (bottom-right, semi-transparent glass style)
- On tap: tries biometrics first; on failure or cancellation falls through
  to the PIN pad
- After a successful unlock, calls the ``onUnlock`` prop callback
- Watches ``unlockRequested`` from the kiosk store. When another UI element
  (e.g. the sidebar lock button) calls ``requestUnlock()``, KioskOverlay
  picks it up, clears the flag via ``clearUnlockRequest()``, and starts
  the unlock flow (biometrics then PIN) automatically.

**Props:**

- ``onUnlock``: callback called after the store is unlocked

**Key test IDs:** ``kiosk-overlay``, ``kiosk-unlock-button``,
``kiosk-pin-pad``

**Renders** ``null`` **when** ``isLocked`` **is** ``false``.

PinPad
~~~~~~

**Location**: ``src/components/kiosk/PinPad.tsx``

4-digit numeric keypad rendered in a modal. Used for both PIN setup
(first-time) and unlock.

**Modes** (``PinPadMode``):

- ``'set'``: prompts the user to choose a PIN (first-time setup)
- ``'confirm'``: prompts the user to re-enter the PIN to verify it
- ``'unlock'``: prompts for the PIN to unlock the session

Auto-submits on the 4th digit (100 ms delay to allow the filled dot to
render). PIN state resets when ``mode`` or ``error`` props change.

**Keyboard support:** PinPad listens for ``keydown`` events on ``window``
(capture phase). Number keys (0-9) add digits, Backspace deletes the last
digit, and Escape cancels. All three key types call ``preventDefault`` and
``stopPropagation`` so they do not bubble to the KioskOverlay keyboard
blocker. Keyboard input is disabled during cooldown.

**Props:**

- ``mode``: one of ``'set'``, ``'confirm'``, ``'unlock'``
- ``onSubmit(pin)``: called with the 4-digit PIN string
- ``onCancel``: called when the user taps Cancel
- ``error``: optional error string shown below the PIN dots
- ``cooldownSeconds``: when > 0, shows a countdown and disables digit
  buttons

**Key test IDs:** ``kiosk-pin-pad``, ``kiosk-pin-input``,
``kiosk-pin-digit-{0-9}``, ``kiosk-pin-cancel``, ``kiosk-pin-delete``

Kiosk Hooks
~~~~~~~~~~~

useKioskLock
^^^^^^^^^^^^

**Location**: ``src/hooks/useKioskLock.ts``

Shared lock-activation logic used by the sidebar and the fullscreen
montage controls. Encapsulates the first-time PIN setup flow so neither
call site needs to duplicate it.

**Behaviour:**

1. On ``handleLockToggle``: checks whether a PIN is already stored
   (``hasPinStored()``).
2. If no PIN exists, opens a ``PinPad`` in ``'set'`` mode, then
   ``'confirm'`` mode, stores the PIN via ``storePin()``, then activates
   kiosk mode.
3. If a PIN is already stored, activates kiosk mode immediately.
4. On lock, enables insomnia (keep-screen-on) if it was off, so the
   display stays active.

**Returns:**

- ``isLocked``: current lock state from the kiosk store
- ``showSetPin``: whether the PIN setup pad should be shown
- ``setPinMode``: current ``PinPadMode`` (``'set'`` or ``'confirm'``)
- ``pinError``: error string for the PIN pad (or ``null``)
- ``handleLockToggle``: call to initiate locking
- ``handleChangePin``: opens the set/confirm flow to replace the existing
  PIN (without activating kiosk mode afterwards)
- ``handleSetPinSubmit(pin)``: pass digits from the PIN pad
- ``handleSetPinCancel``: dismiss the PIN setup pad

**Usage:**

.. code:: tsx

   const {
     isLocked,
     showSetPin,
     setPinMode,
     pinError,
     handleLockToggle,
     handleChangePin,
     handleSetPinSubmit,
     handleSetPinCancel,
   } = useKioskLock({ onLocked: () => closeSidebar() });

useBiometricAuth
^^^^^^^^^^^^^^^^

**Location**: ``src/hooks/useBiometricAuth.ts``

Platform-aware biometric authentication. Exports two async functions (not a
React hook) that support multiple backends:

- **Tauri (macOS)**: calls a native Rust command that invokes LAContext for
  Touch ID. The Tauri environment is detected via ``@tauri-apps/api/core``
  (``isTauri()``).
- **Capacitor (iOS/Android)**: uses ``@aparajita/capacitor-biometric-auth``
  (Touch ID, Face ID).
- **Web**: not supported, falls back gracefully (returns ``false`` /
  ``{ success: false }``).

Falls back gracefully when biometrics are unavailable on any platform.

- ``checkBiometricAvailability(): Promise<boolean>``: returns ``true``
  if the device has enrolled biometrics and the plugin is available.
- ``authenticateWithBiometrics(reason): Promise<{ success, error? }>``
 , prompts the system biometric UI. Returns ``{ success: true }`` on
  success or ``{ success: false, error }`` on failure/cancellation.

Both functions catch all errors and return a safe value so callers never
need their own try/catch.

PIN Management in Settings
^^^^^^^^^^^^^^^^^^^^^^^^^^

PIN set, change, and clear actions live in the **Settings** page (Advanced
section). The Settings page renders a "Kiosk PIN" row with Set/Change and
Clear buttons (``data-testid="settings-kiosk-change-pin"`` and
``data-testid="settings-kiosk-clear-pin"``).

- **Set**: opens PinPad in ``'set'`` then ``'confirm'`` mode (same flow as
  first-time setup during lock activation).
- **Change**: verifies identity first, biometrics if available, otherwise
  the current PIN, then runs the set/confirm flow to store the new PIN.
- **Clear**: verifies identity (biometrics or current PIN), then calls
  ``clearPin()`` from ``lib/kioskPin.ts``.

**Usage:**

.. code:: typescript

   import {
     checkBiometricAvailability,
     authenticateWithBiometrics,
   } from '../hooks/useBiometricAuth';

   const available = await checkBiometricAvailability();
   if (available) {
     const result = await authenticateWithBiometrics(t('kiosk.biometric_prompt'));
     if (result.success) { /* unlock */ }
   }

Component Composition
---------------------

Components are designed to be composable. Example: building a monitor
view:

.. code:: tsx

   function MonitorDetailPage() {
     const { id } = useParams();
     const { currentProfile, settings } = useCurrentProfile();

     return (
       <div className="flex flex-col h-full bg-background">
         <div className="flex items-center justify-between p-3 border-b">
           <Button variant="ghost" size="icon" onClick={goBack}>
             <ArrowLeft className="h-4 w-4" />
           </Button>
           <h1>{monitor.Name}</h1>
         </div>
         <div className="flex-1 p-3">
           <LiveMonitorPlayer monitor={monitor} profile={currentProfile} />
           {monitor.Controllable === '1' && (
             <PTZControls onCommand={handlePTZCommand} />
           )}
           <EventTimeline monitorId={id} />
         </div>
       </div>
     );
   }

Testing Data Attributes
-----------------------

All interactive components have ``data-testid`` attributes for E2E
tests:

.. code:: tsx

   <Card data-testid="monitor-card">
     <img data-testid="monitor-player" />
     <Badge data-testid="monitor-status" />
     <div data-testid="monitor-name">{monitor.Name}</div>
     <Button data-testid="monitor-events-button">Events</Button>
     <Button data-testid="monitor-settings-button">Settings</Button>
     <Button data-testid="monitor-download-button">Download</Button>
   </Card>

These are used in E2E tests:

.. code:: gherkin

   When I click on the first monitor card
   Then I should see the monitor player
   And the monitor status should be "Live"

Implementation in ``tests/steps.ts``:

.. code:: tsx

   When('I click on the first monitor card', async ({ page }) => {
     await page.locator('[data-testid="monitor-card"]').first().click();
   });

   Then('the monitor status should be {string}', async ({ page }, status) => {
     await expect(page.locator('[data-testid="monitor-status"]')).toHaveText(status);
   });

Key Patterns
------------

1. Memo for List Items
~~~~~~~~~~~~~~~~~~~~~~

Components rendered in lists are memoized to prevent unnecessary
re-renders:

.. code:: tsx

   export const MonitorCard = memo(MonitorCardComponent);
   export const EventCard = memo(EventCardComponent);

2. Custom Hooks for Complex Logic
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Complex logic is extracted into hooks:

- ``useCurrentProfile()`` - Current profile and settings (stable
  references, prevents re-render loops)
- ``useMonitorStream()`` - Stream URL and connection management
- ``usePTZControl()`` - PTZ command handling (in ``pages/hooks/``)
- ``useEventNavigation()`` - Adjacent event navigation (see below)

useEventNavigation
^^^^^^^^^^^^^^^^^^

**Location**: ``src/hooks/useEventNavigation.ts``

Fetches adjacent events on demand via the ``getAdjacentEvent()`` API.
Uses server-side filters passed through router navigation state to
maintain filter context when navigating between events.

**Returns:**

- ``goToPrevEvent`` / ``goToNextEvent``: callbacks that navigate to
  the previous or next event.
- Loading states for each direction.

**Behaviour:**

- Triggers directional slide animations (``event-slide-left``,
  ``event-slide-right`` CSS classes, 300 ms).
- Used in the EventDetail header with ChevronLeft/ChevronRight buttons.

3. Refs for DOM Access
~~~~~~~~~~~~~~~~~~~~~~

Components that need DOM access (screenshots, video, etc.) use refs:

.. code:: tsx

   const imgRef = useRef<HTMLImageElement>(null);

   const downloadSnapshot = () => {
     if (imgRef.current) {
       downloadSnapshotFromElement(imgRef.current, monitor.Name);
     }
   };

4. Stop Propagation for Nested Interactions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

When components have nested clickable areas:

.. code:: tsx

   <Card onClick={openDetails}>
     <Button onClick={(e) => {
       e.stopPropagation();  // Don't trigger card click
       handleDelete();
     }}>Delete</Button>
   </Card>

Component Communication
-----------------------

Props Down
~~~~~~~~~~

Parent components pass data and callbacks to children:

.. code:: tsx

   <MonitorCard
     monitor={monitor}
     status={status}
     eventCount={eventCount}
     onShowSettings={(m) => setSelectedMonitor(m)}
   />

Events Up
~~~~~~~~~

Children notify parents via callbacks:

.. code:: tsx

   function MonitorCard({ onShowSettings }) {
     return (
       <Button onClick={() => onShowSettings(monitor)}>
         Settings
       </Button>
     );
   }

Global State via Zustand
~~~~~~~~~~~~~~~~~~~~~~~~

Components access global state directly:

.. code:: tsx

   const isEditing = useDashboardStore((state) => state.isEditing);
   const removeWidget = useDashboardStore((state) => state.removeWidget);

Platform Integrations (``src/services/``)
-----------------------------------------

The ``src/services/`` directory bridges the React app to native device
features provided by Capacitor. UI code stays platform-agnostic.

Storage Service (``lib/secureStorage.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Hybrid storage:

- **Web**: ``localStorage``
- **Native (iOS/Android)**: ``SecureStorage`` via
  ``@aparajita/capacitor-secure-storage``: backed by Keychain (iOS) and
  Keystore (Android), so auth tokens are not plaintext on disk.

Connection Settings
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Self-signed certificate support (TOFU, Trust On First Use certificate
pinning) is implemented in the **Settings page** (Advanced section) and
in ``components/CertTrustDialog.tsx``.

- Reads/writes ``allowSelfSignedCerts`` and ``trustedCertFingerprint``
  from profile-scoped settings
- On enable (native): fetches the server cert, shows ``CertTrustDialog``
  with SHA-256 fingerprint, stores fingerprint on trust
- On disable: clears the stored fingerprint
- Shows the pinned fingerprint when enabled (with a "Re-verify" button
  to check for certificate changes)
- Shows a warning when enabled
- Shows a desktop-specific note on non-native platforms
- ``data-testid="settings-self-signed-certs-switch"``
- ``data-testid="cert-reverify-button"``

The same toggle also appears in ``ProfileForm.tsx`` (below the password
field). During profile setup, the TOFU cert-fetch runs after URL discovery
succeeds (using the confirmed portal URL), and the fingerprint is saved
alongside the profile settings.

Feature Deep Dive: Notifications
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The notification system supports two modes and involves native plugins,
REST API calls, WebSocket connections, and local state management.

**1. Notification Modes**

- **ES (Event Server)**: WebSocket connection to zmeventnotification
  server for real-time events. FCM push on iOS/Android. Default mode.
- **Direct**: Uses ZoneMinder's Notifications REST API. FCM push on
  iOS/Android (server sends directly). Event polling on desktop/web.
  No Event Server required.

**2. The Stack**

- **Native Layer**: Firebase Cloud Messaging (FCM) via
  ``@capacitor-firebase/messaging``
- **WebSocket Service**: ``src/services/notifications.ts`` (ES mode)
- **Push Service**: ``src/services/pushNotifications.ts`` (FCM on
  iOS/Android)
- **Event Poller**: ``src/services/eventPoller.ts`` (Direct mode on
  desktop/web)
- **Notifications API**: ``src/api/notifications.ts`` (Direct mode
  token registration)
- **Store**: ``src/stores/notifications.ts``
- **Orchestrator**: ``src/components/NotificationHandler.tsx`` (delegates to
  ``useNotificationAutoConnect``, ``useNotificationPushSetup``, and
  ``useNotificationDelivered``)
- **UI**: ``src/pages/NotificationSettings.tsx`` (composes
  ``NotificationModeSection``, ``ServerConfigSection``, and
  ``MonitorFilterSection`` from ``components/notifications/``)

**3. The Registration Flow**

ES mode:

1. User enables notifications and selects Event Server mode.
2. App connects to ES via WebSocket and authenticates.
3. On mobile, ``MobilePushService`` requests FCM permission and obtains
   a token.
4. Token is sent to ES via the WebSocket ``push`` command.

Direct mode:

1. User enables notifications and selects Direct mode.
2. On mobile, ``MobilePushService`` requests FCM permission and obtains
   a token.
3. Token is registered with ZoneMinder via
   ``POST /api/notifications.json`` (includes platform, monitor list,
   and push state).
4. On desktop/web, the event poller starts polling
   ``/api/events.json`` at the configured interval.

**4. Handling Incoming Notifications**

- **Foreground (WebSocket/ES mode)**: Events arrive via WebSocket.
  ``NotificationHandler`` watches the store and shows toast
  notifications. FCM duplicates are suppressed (guard checks
  ``isConnected``).
- **Foreground (Push/Direct mode)**: FCM ``notificationReceived``
  fires. ``MobilePushService`` parses the payload (supports both ES
  and ZM field formats) and calls ``addEvent``. The store update
  triggers a toast via ``NotificationHandler``.
- **Foreground (Poller/Direct desktop)**: The event poller adds new
  events to the store. Toasts are shown by ``NotificationHandler``.
- **Background/Closed**: Tapping a system notification triggers
  ``notificationActionPerformed``. The handler calls
  ``navigationService.navigateToEvent()`` with state
  ``{ from: '/monitors', fromNotification: true }`` so that the back
  button navigates to monitors (instead of an empty history stack)
  and the route is not persisted as ``lastRoute``.

**5. Deduplication**

``addEvent`` in the store replaces any existing event with the same
``EventId``, preventing duplicate entries when the same event arrives
from multiple sources (e.g., WebSocket and FCM).
