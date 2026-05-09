Key Libraries
=============

This chapter documents the third-party libraries used in zmNinjaNg and
how they are used.

UI and Visualization
--------------------

react-grid-layout
~~~~~~~~~~~~~~~~~

Used for the **Dashboard** drag-and-drop interface.

- **Usage**: Enables movable, resizable widgets.
- **Key Concepts**: ``Layout`` objects (x, y, w, h),
  ``ResponsiveGridLayout`` for different screen sizes.
- **Gotchas**: Requires careful handling of drag events to prevent
  conflicts with interactive widget content (see ``DashboardWidget.tsx``).
- **Why**: It is the most mature and stable React library for grid-based
  dashboards with drag-and-drop resizing support.

vis-timeline & vis-data
~~~~~~~~~~~~~~~~~~~~~~~

Used for the **Timeline View** (``src/pages/Timeline.tsx``).

- **Usage**: Visualizes thousands of events on a zoomable, scrollable
  timeline.
- **Why**: DOM-based React timeline libraries struggle with thousands of
  event markers. ``vis-timeline`` uses Canvas plus targeted DOM diffing
  and stays interactive with large datasets.
- **Styling**: Custom CSS in ``src/styles/timeline.css``.

video.js
~~~~~~~~

Used for the **Video Player** (``src/components/ui/video-player.tsx``).

- **Usage**: Video playback for HLS and MP4 event streams.
- **Plugins**: ``videojs-markers`` for event points on the seek bar.
- **Why**: ZoneMinder streams vary in format (MJPEG, multiple MP4
  profiles). The native ``<video>`` element handles these inconsistently
  across browsers; video.js provides a unified API and plugin surface.

lucide-react
~~~~~~~~~~~~

The standard icon set for the application.

- **Usage**: ``<IconName className="h-4 w-4" />``
- **Style**: Consistent, clean SVG icons that scale well.

@radix-ui/\*
~~~~~~~~~~~~

Headless UI primitives for accessible components.

- **Usage**: Popovers, Dialogs, dropdowns, switches, etc.
- **Styling**: Styled with Tailwind CSS via ``shadcn/ui`` pattern.
- **Why**: Unstyled primitives leave visual design entirely to Tailwind
  while keeping keyboard navigation and screen-reader support correct.

Data and Logic
--------------

date-fns & date-fns-tz
~~~~~~~~~~~~~~~~~~~~~~

Date manipulation and formatting.

- **Usage**: Parsing dates, calculating relative times (“5 mins ago”),
  and timezone conversions.
- **Standard**: All date formatting should use ``date-fns``.
- **Why**: Lightweight and immutable compared to Moment.js. Used for
  ZoneMinder's timezone-aware timestamps.

react-hook-form & zod
~~~~~~~~~~~~~~~~~~~~~

Form handling and validation.

- **Usage**: Profile creation, settings forms.
- **Pattern**: Zod schemas define the data shape and validation rules;
  react-hook-form handles the state.
- **Why**: Zod schemas double as TypeScript types, giving the same shape
  for form input and API payloads.

@tanstack/react-query
~~~~~~~~~~~~~~~~~~~~~

Server state management (data fetching).

- **Usage**: Caching API responses, handling loading/error states,
  infinite scrolling (Events).
- **Key Config**: ``staleTime`` and ``refetchInterval`` are tuned for
  near-real-time monitoring.
- **Why**: Replaces manual ``useEffect`` fetching with built-in caching,
  deduplication, and background refetch — useful for a polling app.

Mobile and Platform
-------------------

@capacitor/\*
~~~~~~~~~~~~~

Native device feature access for iOS and Android.

- **Core**: Platform detection (``isNativePlatform``).
- **Filesystem**: Saving snapshots and logs.
- **PushNotifications**: Handling APNS/FCM tokens for event alerts.
- **Preferences**: Native storage for secure credentials (along with
  ``@aparajita/capacitor-secure-storage``).
- **Network**: Detects network status changes on native platforms
  (WiFi/cellular transitions). Used by ``NotificationHandler`` to
  trigger immediate WebSocket reconnect when connectivity is restored.
- **Why**: Build iOS/Android apps from the same web codebase. Drop into
  native plugins only for hardware access the web API doesn't provide.

Internationalization
--------------------

i18next & react-i18next
~~~~~~~~~~~~~~~~~~~~~~~

Translations and localization.

- **Usage**: ``const { t } = useTranslation();``
- **Files**: ``src/locales/`` contains JSON files for each language.
- **Rule**: No hardcoded strings in UI components.

Constants Organization
----------------------

zm-constants.ts
~~~~~~~~~~~~~~~

**ZoneMinder Protocol Constants** — Official protocol values defined by
the ZoneMinder streaming daemon.

.. code:: tsx

   import { ZMS_COMMANDS, ZMS_MODES, ZM_MONITOR_FUNCTIONS } from '../lib/zm-constants';

   // Stream control commands
   ZMS_COMMANDS.cmdQuit   // 17 - Close stream connection
   ZMS_COMMANDS.cmdPlay   // 1 - Start/resume playback
   ZMS_COMMANDS.cmdPause  // 2 - Pause playback

   // Stream modes
   ZMS_MODES.jpeg    // MJPEG streaming
   ZMS_MODES.single  // Single snapshot

**When to use**: Interacting with ZoneMinder’s streaming server (ZMS) or
monitor control APIs.

zmninja-ng-constants.ts
~~~~~~~~~~~~~~~~~~~~~~~

**Application Configuration** — zmNinjaNg-specific settings and tuning
parameters.

.. code:: tsx

   import { ZM_INTEGRATION, GRID_LAYOUT, TIMELINE } from '../lib/zmninja-ng-constants';

   // API timeouts and performance settings
   ZM_INTEGRATION.httpTimeout           // 10 seconds
   ZM_INTEGRATION.streamMaxFps          // 10 FPS for live streams
   ZM_INTEGRATION.accessTokenLeewayMs   // 30 minutes — refresh token before expiry

   // Grid layout configuration
   GRID_LAYOUT.cols                     // 12 columns
   GRID_LAYOUT.rowHeight               // 100px per row
   GRID_LAYOUT.montageRowHeight        // 1px (per-pixel precision for compact montage)

   // Timeline zoom limits
   TIMELINE.zoomMin  // 1 minute
   TIMELINE.zoomMax  // 1 week

**When to use**: Configuring application behavior, performance tuning,
UI layout.

**Separation rationale**:

- **zm-constants**: Never change (defined by ZoneMinder protocol)
- **zmninja-ng-constants**: Can be tuned for performance, UX, or
  platform differences

