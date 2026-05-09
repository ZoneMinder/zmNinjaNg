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
    in-memory store, the file, and the browser console — there is no separate
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
   ├── video/              # VideoPlayer (smart streaming) and overlays
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
       displayedImageUrl,
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
             src={displayedImageUrl || streamUrl}
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

**Why it’s memoized:**

The component is wrapped in ``React.memo()`` to prevent unnecessary
re-renders when the monitor list updates but this specific monitor’s
data hasn’t changed.

**The useMonitorStream Hook:**

Encapsulates stream URL generation and connection key management:

- Generates authenticated stream URL with connection key
- Watches for failures and regenerates keys
- Returns ref for the ``<img>`` element for snapshot downloads
- **See** `Chapter 7: Streaming
  Mechanics <07-api-and-data-fetching>`__ for
  details on cache busting (``_t``), multi-port streaming, and snapshot
  preloading.
- Uses ``src/lib/url-builder.ts`` for centralized URL construction.

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

**Key Point: Preventing Drag on Buttons**

Notice the ``e.stopPropagation()`` and
``onMouseDown={(e) => e.stopPropagation()}`` on the buttons. This
prevents ``react-grid-layout`` from initiating a drag when you click the
buttons.

Without this, clicking “Delete” would start dragging the widget instead
of deleting it.

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
or ``height`` set — the server returns the original image, and the view
scales it down to the preview size.

HoverPreview (primitive)
~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/ui/hover-preview.tsx``

Generic desktop-only hover primitive. Renders ``children`` as the
trigger and opens a 400px-wide portal next to the anchor after a 400 ms
hover delay (both configurable). The ``renderPreview`` render prop is
only invoked while the preview is open, so components mounted inside
are created on hover and torn down on leave — this is what lets
``MonitorHoverPreview`` spin up a fresh stream connection and kill it
cleanly. The portal uses ``pointer-events: none`` so the underlying
trigger stays clickable, flips to the left side of the anchor when
there is no room on the right, and closes on mouse leave or window
scroll / wheel events.

MonitorHoverPreview
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorHoverPreview.tsx``

Wraps a monitor card or dashboard monitor widget. On hover, mounts an
inner ``MonitorLivePreview`` that calls ``useStreamLifecycle`` with
``viewMode: 'streaming'`` to generate a fresh ZMS connkey, then renders
an ``<img>`` pointed at ``getStreamUrl(..., { mode: 'jpeg', connkey })``.
When the hover ends the inner component unmounts, and
``useStreamLifecycle``'s cleanup effect sends ``CMD_QUIT`` for that
connkey — so the extra preview stream is torn down on the ZM server
instead of lingering as a zombie.

Used from ``MonitorCard`` (both compact and list layouts) and the
dashboard ``MonitorWidget``'s ``SingleMonitor``.

ZmsEventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/ZmsEventPlayer.tsx``

Video player for event playback using ZoneMinder’s zms streaming.

**Controls layout:** ``|<`` (start), ``< 5s`` (seek back), Play/Pause,
``5s >`` (seek forward), ``>|`` (end). Seek operations use 5-second
increments via ``ZM_CMD.SEEK``.

**Features:**

- Play/pause and seek controls (5-second increments)
- Speed control (0.25x - 2x)
- Progress bar displays time (``m:ss``) when duration is provided,
  falls back to frame numbers otherwise
- Polls ZMS stream status via ``ZM_CMD.QUERY`` to track playback
  position; uses bandwidth-aware interval via ``zmsStatusInterval``
- Auto-pauses at end of event to prevent looping
- Fullscreen support

**Implementation Detail:**

The player generates a progressive stream URL:

.. code:: tsx

   const streamUrl = `${profile.portalUrl}/cgi-bin/nph-zms?mode=jpeg&event=${eventId}&frame=1&scale=100&rate=100&maxfps=30&connkey=${connkey}`;

Parameters: - ``mode=jpeg``: JPEG stream (vs MPEG) - ``event``: Event ID
- ``frame``: Starting frame - ``rate``: Playback speed (100 = 1x, 200 =
2x, 50 = 0.5x) - ``maxfps``: Frame rate cap - ``connkey``:
Authentication token

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

This fetches the image with credentials, converts to a blob, and creates
a local URL. Necessary for servers that require authentication on all
requests.

VideoPlayer (Smart Streaming Component)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/video/VideoPlayer.tsx``

Unified player that selects Go2RTC (WebRTC/MSE/HLS) or MJPEG based on
monitor capabilities and user settings.

**Props:**

- ``monitor`` — monitor data object
- ``profile`` — active profile
- ``showControls`` — enables native video controls (used on MonitorDetail)
- ``onProtocolChange`` — callback when streaming protocol changes
- ``externalMediaRef`` — external ref for the video/img element

**Streaming selection:** VideoPlayer checks the user's streaming method
preference, whether Go2RTC is available, and per-monitor overrides
(``monitorStreamingOverrides`` in settings store) to decide between
Go2RTC and MJPEG.

**Go2RTC failure cache:** Monitors that fail Go2RTC connection are
cached and skipped for 5 minutes to avoid repeated connection attempts
in montage views.

**Video frame timeout:** 8 seconds after reaching "connected" state,
VideoPlayer checks ``videoWidth``/``videoHeight``. If no frames have
arrived, it falls back to MJPEG.

**Autoplay handling:** If the video element reports paused but has valid
dimensions, VideoPlayer calls ``video.play()`` to recover from
browser autoplay restrictions.

**Controls:** When ``showControls`` is true (MonitorDetail only), native
video controls are enabled with
``controlsList='nodownload noplaybackrate'`` and
``disablePictureInPicture=true``. Click on the video element calls
``stopPropagation`` to prevent navigation.

**Picture-in-Picture integration:**

- Accepts an ``eventId`` prop to enable PiP persistence across route
  changes.
- When PiP activates, VideoPlayer adopts the player element to the
  ``PipProvider`` portal so the video stays alive outside the component
  tree.
- On unmount, skips ``dispose()`` if PiP is active so the stream
  continues.
- On remount with the same ``eventId``, reclaims the player from the
  portal for inline resume.
- On remount with a different ``eventId``, closes the existing PiP
  session first.

VideoPlayer (Event Playback)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/ui/video-player.tsx``

Wrapper around Video.js for event playback (HLS streams, markers,
PiP integration). Separate from the live streaming VideoPlayer above.

**Features:**

- Autoplay control
- Play/pause callbacks
- Error handling
- Fullscreen support
- Timeline markers for alarm frames (``videojs-markers``)
- PiP persistence via ``PipContext`` when an ``eventId`` prop is provided

PipContext
~~~~~~~~~~

**Location**: ``src/contexts/PipContext.tsx``

Provides ``PipProvider`` and ``usePip()`` hook for Picture-in-Picture
video that survives route changes.

**API:**

- ``adoptForPip(player, videoEl, eventId)`` — moves the video element
  to a root portal so it persists outside the component tree.
- ``reclaimFromPip()`` — reclaims the element for inline resume in the
  original component.
- ``closePip()`` — ends PiP and cleans up resources.
- ``activePipEventId`` — tracks which event is currently in PiP.

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
update (streams, event counts, etc.) — only interaction is blocked.

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

- ``onUnlock`` — callback called after the store is unlocked

**Key test IDs:** ``kiosk-overlay``, ``kiosk-unlock-button``,
``kiosk-pin-pad``

**Renders** ``null`` **when** ``isLocked`` **is** ``false``.

PinPad
~~~~~~

**Location**: ``src/components/kiosk/PinPad.tsx``

4-digit numeric keypad rendered in a modal. Used for both PIN setup
(first-time) and unlock.

**Modes** (``PinPadMode``):

- ``'set'`` — prompts the user to choose a PIN (first-time setup)
- ``'confirm'`` — prompts the user to re-enter the PIN to verify it
- ``'unlock'`` — prompts for the PIN to unlock the session

Auto-submits on the 4th digit (100 ms delay to allow the filled dot to
render). PIN state resets when ``mode`` or ``error`` props change.

**Keyboard support:** PinPad listens for ``keydown`` events on ``window``
(capture phase). Number keys (0-9) add digits, Backspace deletes the last
digit, and Escape cancels. All three key types call ``preventDefault`` and
``stopPropagation`` so they do not bubble to the KioskOverlay keyboard
blocker. Keyboard input is disabled during cooldown.

**Props:**

- ``mode`` — one of ``'set'``, ``'confirm'``, ``'unlock'``
- ``onSubmit(pin)`` — called with the 4-digit PIN string
- ``onCancel`` — called when the user taps Cancel
- ``error`` — optional error string shown below the PIN dots
- ``cooldownSeconds`` — when > 0, shows a countdown and disables digit
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

- ``isLocked`` — current lock state from the kiosk store
- ``showSetPin`` — whether the PIN setup pad should be shown
- ``setPinMode`` — current ``PinPadMode`` (``'set'`` or ``'confirm'``)
- ``pinError`` — error string for the PIN pad (or ``null``)
- ``handleLockToggle`` — call to initiate locking
- ``handleChangePin`` — opens the set/confirm flow to replace the existing
  PIN (without activating kiosk mode afterwards)
- ``handleSetPinSubmit(pin)`` — pass digits from the PIN pad
- ``handleSetPinCancel`` — dismiss the PIN setup pad

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
- **Web**: not supported — falls back gracefully (returns ``false`` /
  ``{ success: false }``).

Falls back gracefully when biometrics are unavailable on any platform.

- ``checkBiometricAvailability(): Promise<boolean>`` — returns ``true``
  if the device has enrolled biometrics and the plugin is available.
- ``authenticateWithBiometrics(reason): Promise<{ success, error? }>``
  — prompts the system biometric UI. Returns ``{ success: true }`` on
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
- **Change**: verifies identity first — biometrics if available, otherwise
  the current PIN — then runs the set/confirm flow to store the new PIN.
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
           <VideoPlayer monitor={monitor} profile={currentProfile} />
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

- ``goToPrevEvent`` / ``goToNextEvent`` — callbacks that navigate to
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

Key Takeaways
-------------

1. **Components organized by domain**: dashboard/, monitors/, events/,
   ui/
2. **Memoize list items**: Prevent unnecessary re-renders
3. **Data attributes for testing**: All interactive elements have
   ``data-testid``
4. **Custom hooks extract logic**: ``useMonitorStream``,
   ``usePTZControl``, etc.
5. **Refs for DOM access**: Screenshots, video playback, scroll position
6. **Stop propagation**: Nested clickable areas need
   ``e.stopPropagation()``
7. **Composition over inheritance**: Build complex UIs from simple
   components
8. **Stream URL management**: useMonitorStream hook handles
   authentication and regeneration

Platform Integrations (``src/services/``)
-----------------------------------------

The ``src/services/`` directory allows the React application to interact
with native device features provided by Capacitor. This layer acts as a
bridge, ensuring the UI code remains platform-agnostic.

Storage Service (``lib/secureStorage.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

We use a hybrid storage approach: - **Web**: Standard ``localStorage``.
- **Native (iOS/Android)**: Encrypted ``SecureStorage`` (via
``@aparajita/capacitor-secure-storage``).

**Why?** Storing authentication tokens in plaintext ``localStorage`` on
a shared device (or even a phone) is a security risk. SecureStorage uses
the device’s hardware-backed keystore (Keychain on iOS, Keystore on
Android).

Connection Settings
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Self-signed certificate support (TOFU — Trust On First Use certificate
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

Next Steps
----------

Continue to `Chapter 6: Testing Strategy <06-testing-strategy>`
to learn how to test these components.
