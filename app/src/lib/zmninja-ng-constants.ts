/**
 * zmNinjaNg Application Constants
 *
 * Centralized configuration values for the zmNinjaNg application.
 * Many values are derived from the original zmNinja application
 * to ensure consistent behavior and performance.
 *
 * For ZoneMinder protocol constants (commands, modes, etc.),
 * see zm-constants.ts
 */

/**
 * ZoneMinder Integration Constants
 *
 * Configuration values for interacting with ZoneMinder servers.
 * These are zmNinjaNg-specific settings, not ZM protocol values.
 */
export const API_REQUEST = {
  // Default per-request timeout (seconds) applied to REST API calls when the
  // caller doesn't set an explicit one. Overridable per profile via the
  // apiTimeoutSeconds setting; 0 disables the timeout. Caps how long a request
  // can hang (e.g. when the HTTP connection pool is saturated) so the UI can
  // error and retry instead of stalling forever.
  defaultTimeoutSeconds: 15,
  // Bounds for the user-facing setting (seconds).
  minTimeoutSeconds: 0,
  maxTimeoutSeconds: 120,
  // CMD_QUIT is fire-and-forget teardown, not a data read, so it uses its own
  // short timeout instead of apiTimeoutSeconds. A profile switch awaits every
  // stream's CMD_QUIT before it flips SSL trust (refs #188), and a wedged zms
  // (ZM answers 503 once its streaming daemon is saturated) never replies, so
  // inheriting the 15s API timeout stalled the switch for 15 seconds. The
  // request has already reached the server by the time we abort; aborting only
  // stops us waiting for the reply, it does not cancel the quit.
  cmdQuitTimeoutSeconds: 3,
} as const;

/**
 * Maximum number of retries for a failed React Query query (the app-wide
 * default, equivalent to `retry: 1`). Auth errors (401/403) are never
 * retried; see shouldRetryQuery in stores/query-cache.ts.
 */
export const MAX_QUERY_RETRIES = 1;

/**
 * App-wide default React Query `staleTime` (ms). Keeps the last successful
 * response visible and "fresh" for this long instead of re-flagging it stale
 * (and re-fetching / erroring) the instant a component using it mounts or a
 * network blip hits. Queries with their own `refetchInterval` (monitor
 * status, etc.) still refetch on that schedule regardless; this only affects
 * queries relying on mount/reconnect-triggered refetches (states, groups,
 * tags, server info). Chosen shorter than the shortest bandwidth-mode
 * refetch interval (monitorStatusInterval, 20s in normal mode) so it never
 * masks a legitimate periodic refresh. refs #217
 */
export const DEFAULT_QUERY_STALE_TIME_MS = 15000;

export const ZM_INTEGRATION = {
  // HTTP timeouts for ZM API calls
  httpTimeout: 10000, // 10 seconds - standard API calls
  largeHttpTimeout: 30000, // 30 seconds - large responses (events, etc.)

  // Streaming and video performance
  defaultFps: 3, // Default FPS for event playback
  maxFps: 30, // Maximum FPS allowed
  streamMaxFps: 10, // Max FPS for live monitor streams (to reduce bandwidth)

  // Reconnect backoff for the MJPEG stream when the connection drops or ends
  // (server restart, network blip). Exponential from base, capped, with a
  // bounded attempt count before surfacing the stream-error state.
  mjpegReconnectBaseDelayMs: 1000, // 1 second
  mjpegReconnectMaxDelayMs: 15000, // 15 seconds
  mjpegReconnectMaxAttempts: 6,

  // A stream that fails in its first seconds is usually looking at a server
  // still freeing the slots a profile switch just quit, which answers 503 and
  // then recovers. It retries at this flat interval for this long, and those
  // tries do not spend the attempt budget - see lib/monitor/reconnect-backoff.
  mjpegEarlyRetryWindowMs: 12000,
  mjpegEarlyRetryDelayMs: 2000,

  // How long a planned restart (the requested scale changed, e.g. the user
  // zoomed in) may keep showing the frame already on screen while the new
  // stream connects. Past it the tile admits it is waiting rather than keep
  // presenting an old picture as a live one.
  plannedRestartHoldMs: 5000,

  // Grace delay before a scheduled CMD_QUIT fires. Lets React StrictMode's
  // dev double-mount cancel the quit instead of killing a stream the
  // surviving mount is still using. See lib/zm/zms-quit.ts.
  cmdQuitGraceMs: 150,

  // Image quality settings
  safeImageQuality: 10, // Safe quality setting for bandwidth-constrained scenarios
  defaultMontageQuality: 50, // Default JPEG quality for montage view
  maxMontageQuality: 70, // Maximum quality for montage (balance quality/bandwidth)

  // Stream scale percentages
  montageStreamScale: 50, // Scale % for montage streams (reduces bandwidth)
  monitorStreamScale: 40, // Scale % for single monitor detail view

  // Image dimensions
  thumbWidth: 200, // Thumbnail width for event cards
  eventImageWidth: 320, // Event snapshot width
  eventImageHeight: 240, // Event snapshot height
  eventMontageImageWidth: 300, // Event montage tile width
  eventMontageImageHeight: 200, // Event montage tile height

  // Token management
  accessTokenLeewayMin: 5, // Minutes before token expiry to refresh
  refreshTokenLeewayMin: 10, // Minutes before refresh token expiry
  accessTokenLeewayMs: 30 * 60 * 1000, // 30 minutes in milliseconds. Gates URL construction; refresh fires when below this threshold
  tokenCheckInterval: 60 * 1000, // Check token status every minute
  loginInterval: 1800000, // 30 minutes - re-login interval
} as const;

/**
 * Auto-restart (desktop only): periodically relaunch the app to release WebKit's
 * process-level memory that no in-process flush reclaims. Interval is in minutes.
 */

/**
 * Grid Layout Constants
 *
 * Used by Dashboard and Montage views for responsive grid layouts.
 * Based on react-grid-layout configuration.
 */
export const GRID_LAYOUT = {
  // Grid columns (12-column system for responsive layout)
  cols: 12,

  // Row height in pixels (dashboard cards)
  rowHeight: 100,

  // Margin between grid items in pixels (dashboard)
  margin: 16,

  // Margin between montage grid items in pixels (tighter for monitor feeds)
  montageMargin: 4,

  // Minimum card width in grid units
  minCardWidth: 50,

  // Montage row height in pixels: 1px for pixel-level precision (no black bars with contain)
  montageRowHeight: 1,

  // Grid calculation frequencies
  montageScaleFrequency: 300, // How often to recalculate montage scales (ms)
  packeryTimer: 500, // Delay for packery layout recalculation (ms)
  resizeDebounceMs: 500, // Debounce window for ResizeObserver in montage container
} as const;

/**
 * Montage Scroll Pad
 *
 * The edit-mode pad that scrolls the grid when every tile is a drag surface
 * (refs #321).
 */
export const SCROLL_PAD = {
  // Fraction of the visible height one up/down tap moves. Short of a full page
  // so a row stays on screen as a reference point.
  stepFraction: 0.8,
} as const;

/**
 * Sidebar Navigation Constants
 *
 * Dimensions and behavior for the collapsible sidebar navigation.
 */
export const SIDEBAR_NAV = {
  // Minimum width when collapsed (icon-only mode)
  minWidth: 60,

  // Maximum width when expanded
  maxWidth: 256,

  // Default width on first load
  defaultWidth: 180,
} as const;

/**
 * Timeline Widget Constants
 *
 * Configuration for the timeline view zoom and display.
 */
export const TIMELINE = {
  // Minimum zoom level (1 minute)
  zoomMin: 60000,

  // Maximum zoom level (1 week)
  zoomMax: 7 * 24 * 60 * 60 * 1000,

  // Pulse halo duration (ms) for newly arrived live events
  pulseDurationMs: 5000,

  // Max events for a single (non-fanned-out) timeline query
  eventsLimit: 2000,

  // Per-monitor cap when a cause filter fans the query out across monitors,
  // so one busy camera can't consume the whole budget
  perMonitorEventsLimit: 100,

  // Max monitors queried in parallel during cause-filter fan-out
  fanoutConcurrency: 6,

  // Delay (ms) between a live notification arriving and the events refetch, so ZM can index the event
  liveRefetchDebounceMs: 2000,

  // Live-event arrival timestamps older than this (ms) are pruned
  liveArrivalTtlMs: 5000,
} as const;

/**
 * Notification Service Constants
 *
 * Configuration for the WebSocket notification service.
 */
export const NOTIFICATIONS_SERVICE = {
  // Default port for ZM notification server
  defaultPort: 9000,

  // Maximum events to keep in notification history
  maxEvents: 100,

  // Delay before attempting reconnection (ms)
  reconnectDelay: 5000,

  // Width (px) requested for event snapshot images in notifications
  snapshotImageWidth: 600,

  // Minimum gap between event-poller reloads of the monitor name map, after an
  // event names a monitor the map does not know. The startup load can lose a
  // race with authentication and leave the map empty, which used to strand
  // every notification title on "Monitor 4" for the session. An unknown id can
  // also just be a deleted monitor, so the retry is rate limited rather than
  // firing on every poll.
  monitorNamesReloadMs: 60000, // 60 sec

  // Delay before the first ES-mode auto-connect attempt, to let profile/auth
  // store rehydration finish (ms)
  autoConnectInitDelayMs: 500,

  // Ceiling for the reconnect backoff while the app is in the foreground (ms).
  // Backgrounded, the backoff is free to climb to its 2 minute cap; in the
  // foreground the user is watching a disconnected badge, so retries stay
  // frequent enough to recover on their own (refs #274).
  foregroundMaxReconnectDelayMs: 15000,

  // All mode only: events arriving within this window of each other collapse
  // into one summary toast instead of one toast per event, so aggregating
  // several busy servers doesn't flood the screen (refs #337). The DEFAULT for
  // the editable `allModeBurstSeconds` setting, which is what the hook reads.
  allModeBurstWindowMs: 3000,
} as const;

/**
 * Bootstrap and Initialization Timeouts
 *
 * Timeouts for profile initialization and server connection.
 */
export const BOOTSTRAP_TIMEOUTS = {
  // Timeout for each bootstrap step (auth, timezone, etc.)
  stepTimeoutMs: 8000,

  // Total timeout for entire bootstrap process
  totalTimeoutMs: 20000,

  // Fallback timeout for profile store initialization in App.tsx.
  // Forces isInitialized=true if rehydration hasn't completed in time.
  initFallbackMs: 5000,
} as const;

/**
 * API Pagination Limits
 *
 * Limits for paginated API responses to prevent excessive data fetching.
 */
export const API_PAGINATION = {
  // Maximum pages to fetch for events (prevents infinite loops)
  maxEventPages: 10,

  // Events per page (ZM API default)
  eventsPerPage: 100,

  // Total max events = maxEventPages * eventsPerPage = 1000

  // Max event IDs per "Id IN:" filter request. ZM's Apache caps the request
  // line near 8 KB; ~500 IDs (4.8 KB) was the verified ceiling on ZM 1.36, so
  // 200 leaves headroom for the token and other filter segments in the URL.
  eventIdFilterChunkSize: 200,
} as const;

/**
 * Recent-events list shown under the live view on the monitor detail page.
 * Count is a per-profile setting; these are its default and clamp bounds.
 */
export const MONITOR_DETAIL_RECENT_EVENTS = {
  defaultCount: 20,
  minCount: 1,
  maxCount: 50,
} as const;

/**
 * The most monitors a server can have before continuous MJPEG streaming stops
 * being a sane default. Browsers and WebViews keep only about six connections
 * open to one host, and streaming holds one per tile; the count stops at five
 * so one connection is left for the app's ordinary API calls, which would
 * otherwise queue behind the streams. Multi-port streaming spreads tiles
 * across ports and lifts the limit entirely, so it overrides this count
 * (lib/monitor/view-mode-recommendation.ts).
 */
export const STREAMING_MONITOR_LIMIT = 5;

/**
 * The app shell's single scroll container (AppLayout's <main>). Pages without
 * their own overflow container scroll this element, so scroll restoration for
 * those pages targets it.
 */
export const MAIN_SCROLL_SELECTOR = '[data-tv-region="main"]';

/**
 * How long to keep re-applying a restored scroll offset while a page's async
 * content is still growing (ms). Restoration stops early once the target is
 * reached or the user scrolls.
 */
export const SCROLL_RESTORE_MAX_MS = 1000;

/**
 * How long (ms) to flag the event row a user just returned from, with a blinking
 * arrow and a soft highlight, in the recent-events and main event lists.
 */
export const RETURN_FLASH_MS = 4000;

/**
 * Event List View Constants
 *
 * Configuration for the events list display.
 */
export const EVENT_LIST = {
  // Only virtualize lists larger than this threshold.
  // Smaller lists render directly to avoid scroll margin calculation complexity
  // when there's content above the list (header, heatmap, etc.)
  virtualizationThreshold: 100,
} as const;

/** How long the scrub bar waits after the last drag movement before seeking, so
 *  a continuous back-and-forth drag does not flood the ZMS stream. A seek also
 *  always fires on release (refs #196). */
export const EVENT_SCRUB_SEEK_DEBOUNCE_MS = 200;

/**
 * Delay before a settled ZMS seek is repeated to the same offset (refs #196).
 *
 * MJPEG in an <img> renders a multipart part only when the next part's boundary
 * begins to arrive, and a paused or idle zms only emits its next frame on the
 * MAX_STREAM_DELAY (5s) keepalive. So a lone seek to a stopped stream shows its
 * frame ~5s late. Newer zms fixes this server-side by sending the sought frame
 * twice; on older servers (ZM 1.36) we emulate that by repeating the seek so a
 * second frame flushes the first. The delay must exceed one zms loop tick so
 * the two seeks are not drained into a single frame send. 400ms clears the
 * paused tick for any event above ~2 fps while staying well under the 5s fallback.
 */
export const EVENT_SEEK_FLUSH_DELAY_MS = 400;

/**
 * How long (ms) the "ZMS Playback" badge stays on the event player before it
 * fades out (issue #340). The badge exists to tell the user this event is a ZMS
 * stream rather than a recorded video, which is a one-time fact - once read, it
 * only covers the picture on a phone.
 */
export const ZMS_PLAYBACK_BADGE_MS = 5000;

/**
 * Consecutive status polls without playback state before an event stream is
 * treated as gone. zms still answers a query for a connkey it no longer has a
 * process for, so a run of stateless answers is the only signal that it exited -
 * which it does after painting an error such as "Failed getting frame" into the
 * stream. Two polls debounce one dropped or slow answer.
 */
export const ZMS_STREAM_DEAD_POLLS = 2;

/**
 * How many times the event player restarts a stream zms dropped. A server that
 * fails on the same frame every time would otherwise restart forever; once the
 * cap is reached the play button starts a fresh stream on demand.
 */
export const ZMS_STREAM_MAX_RESTARTS = 3;

/**
 * Significant frames ZoneMinder can serve for an event (issue #272), in the
 * order the event frame carousel shows them: most informative first, so the
 * annotated detection image leads, then the frame that triggered the alarm,
 * then the plain snapshot. ZoneMinder has no API that reports which of these
 * exist for a given event, so the carousel renders each one and drops the ones
 * whose image fails to load.
 */
export const EVENT_FRAME_TYPES = ['objdetect', 'alarm', 'snapshot'] as const;

/** Width requested for carousel thumbnails, in pixels. */
export const EVENT_FRAME_THUMB_WIDTH = 240;

/** localStorage key holding the event frame carousel's expanded state. */
export const EVENT_FRAMES_OPEN_STORAGE_KEY = 'zmninja-event-frames-open';

/**
 * Relative time labels on events (issue #210).
 * List chip only renders for events within this many days; older events read
 * fine from the absolute date. Below the just-now threshold we show "just now".
 */
export const RELATIVE_TIME_LIST_WINDOW_DAYS = 7;
export const RELATIVE_TIME_JUST_NOW_MS = 60_000;

/**
 * Development Proxy Server Configuration
 *
 * DEVELOPMENT ONLY: Used by the local proxy server for CORS bypass during development.
 * Not used in production builds.
 */
export const DEV_PROXY = {
  // Local proxy server port (only used in dev mode)
  port: 3001,

  // Mock notification server port (for testing without ZM)
  mockNotificationPort: 9000,
} as const;

/**
 * Monitor Status Color Mappings
 *
 * Color codes for monitor status indicators in the UI.
 */
export const MONITOR_STATUS_COLORS = {
  checking: '#03A9F4', // Blue - checking status
  notRunning: '#F44336', // Red - monitor not running
  pending: '#FF9800', // Orange - pending state
  running: '#4CAF50', // Green - running normally
  error: '#795548', // Brown - error state
} as const;

/**
 * Logging and Debugging Constants
 *
 * Configuration for application logging and debug output.
 */
export const LOGGING = {
  // Maximum log entries to retain in the logs screen
  maxLogEntries: 1000,
  // Maximum stack trace characters logged by the global error handlers
  maxStackLength: 4000,
} as const;

/**
 * Persistent Storage Keys
 *
 * Keys for localStorage / Capacitor Preferences entries owned by zmNinjaNg.
 * Centralized to prevent collisions and make migrations searchable.
 */
export const STORAGE_KEYS = {
  // UI section open/closed state
  hoverPreviewOpen: 'zmng-hover-preview-open',
  thumbnailChainOpen: 'zmng-thumbnail-chain-open',
  // Prefix, completed with a settings section id (see CollapsibleSection).
  settingsSectionOpenPrefix: 'zmng-settings-section-open-',

  // Web crypto fallback salt (versioned: bump suffix to invalidate)
  cryptoSalt: 'zmng_crypto_salt_v1',

  // Developer Notice: per-device list of read notice IDs (versioned)
  developerNoticeRead: 'zmng_developer_notice_read_v1',

  // Developer Notice: per-device dismissed-critical-banner ids
  developerNoticeBannerDismissed: 'zmng_developer_notice_banner_dismissed_v1',

  // Persisted Zustand store keys. These strings are existing on-disk keys:
  // changing a value orphans every current user's persisted state, so the
  // historical (inconsistently namespaced) names are kept verbatim.
  authStore: 'zmng-auth',
  profilesStore: 'zmng-profiles',
  settingsStore: 'zmng-settings',
  notificationsStore: 'zmng-notifications',
  eventFavoritesStore: 'zmng-event-favorites',
  monitorSeenStore: 'zmng-monitor-seen',
  dashboardStore: 'dashboard-storage',
  monitorStore: 'zm-monitor-store',

  // Secure-storage key for the auth refresh token (Capacitor SecureStorage / web fallback)
  authRefreshToken: 'auth_refresh_token',

  // In-app assistant: dev-only flag to force a deterministic stub provider
  // instead of loading WebLLM (issue #246)
  assistantTestMode: 'zmng-assistant-test-mode',

  // Floating assistant window: persisted zustand store key (only the
  // resizable panel's width/height are persisted, see stores/assistantPanel.ts)
  assistantPanelStore: 'zmng-assistant-panel',
} as const;

/**
 * Developer Notice Feed
 *
 * One-way broadcast channel from the maintainer to all users. The app fetches
 * a static JSON feed from the repo (no backend, no telemetry). New notices
 * surface as a slow-pulsing dot in the sidebar and, when severity is
 * "critical", as a global dismissible banner. Per-device read state lives in
 * localStorage under STORAGE_KEYS.developerNoticeRead.
 */
export const DEVELOPER_NOTICES = {
  // Public raw URL of the notice feed (GitHub serves with ~5min CDN TTL)
  feedUrl: 'https://raw.githubusercontent.com/ZoneMinder/zmNinjaNg/main/docs/notices.json',

  // Background refetch interval. React Query handles the actual polling.
  // Notices change rarely, so poll once per day.
  pollIntervalMs: 24 * 60 * 60 * 1000,

  // How long fetched data stays "fresh" before a refetch is allowed. Matches the
  // poll interval so a window-focus refetch does not check more often than daily.
  staleTimeMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Background Tasks
 *
 * Limits for the in-memory background task store (downloads, exports).
 */
export const BACKGROUND_TASKS = {
  // Maximum completed/failed/cancelled tasks kept in the store. Oldest
  // terminal tasks beyond this are evicted so long-lived sessions (kiosk
  // mode, repeated downloads) do not grow memory without bound. Active
  // tasks are never evicted.
  maxRetainedTerminalTasks: 50,
} as const;

/**
 * UI Interaction Timings
 *
 * Pointer/touch timing knobs shared across hover previews, hold-to-repeat
 * buttons (zoom, PTZ), and long-press detection.
 */
export const UI_INTERACTIONS = {
  // Hold-to-repeat: delay before the first repeat fires (ms)
  holdInitialDelayMs: 400,

  // Hold-to-repeat: interval between repeats while held (ms)
  holdRepeatIntervalMs: 100,

  // PTZ hold-to-move repeat for non-continuous drivers (ms).
  // Tuned to keep the race window between a queued step and the
  // release-stop small while still feeling continuous.
  ptzHoldRepeatMs: 400,

  // Mouse hover delay before a preview opens (ms)
  hoverDelayMs: 700,

  // Touch long-press threshold for opening a preview (ms)
  longPressMs: 500,

  // Hover preview enter/exit animation duration (ms)
  previewAnimationMs: 200,

  // Default hover preview width (px)
  previewWidthPx: 400,

  // Hover preview minimum margin from viewport edges (px)
  previewEdgeMarginPx: 12,

  // Pointer movement threshold to cancel a long-press (px)
  moveCancelPx: 8,

  // How long a long-press hint toast stays up (ms). Long enough to read a
  // short label, short enough that it is gone before the next tap.
  hintDurationMs: 1500,
} as const;

/**
 * Overlay Z-Index Layers
 *
 * Stacking contract for fullscreen overlays rendered above the app.
 * In-page elements use small Tailwind utilities (z-10, z-50); these
 * values are for portal or fixed overlays that must sit above all of
 * them. Backdrops sit one step below the content they belong to.
 */
export const Z_INDEX = {
  // Fullscreen blocking backdrops (hover preview backdrop, app init blocker)
  overlayBackdrop: 9998,

  // Overlay content above a backdrop (hover preview card, kiosk lock overlay)
  overlay: 9999,

  // Kiosk PIN pad: must sit above the kiosk lock overlay
  kioskPinPad: 10000,

  // TV mode cursor: above every other layer in this group
  tvCursor: 99999,
} as const;

/**
 * Notification Badge UI
 *
 * Visual feedback timing for the notification bell.
 */
export const NOTIFICATION_UI = {
  // Total ring animation duration after a new notification (ms).
  // Includes CSS animation plus a settle window.
  badgeRingDurationMs: 3500,
} as const;

/**
 * Monitor UI Visual Effects
 */
export const MONITOR_UI = {
  // Alarm pulse duration on a monitor tile after a new event (ms)
  alarmPulseMs: 6000,

  // Shape a tile falls back to when ZoneMinder reports dimensions nothing can
  // be derived from (zero, blank, or non-numeric). A tile sized from an
  // unusable ratio would have no height at all, so it is better to be wrong
  // about the shape than to render an invisible camera.
  fallbackAspectRatio: '16 / 9',
} as const;

/**
 * Kiosk (Lock) Mode Constants
 *
 * PIN attempt and cooldown configuration for kiosk lock mode.
 */
export const KIOSK = {
  // Maximum failed PIN attempts before cooldown engages
  maxPinAttempts: 5,

  // Cooldown duration after exceeding max attempts (ms)
  cooldownMs: 30_000,

  // How often the kiosk overlay's cooldown countdown re-renders (ms)
  cooldownTickIntervalMs: 1000,

  // Delay between the 4th PIN digit being entered and auto-submit, so the
  // filled-in last digit is visible before the pad reacts (ms)
  pinAutoSubmitDelayMs: 100,
} as const;

/**
 * Android hardware back button.
 */
export const ANDROID_BACK = {
  // At a root view, a second back press within this window exits the app.
  exitConfirmWindowMs: 2000,
} as const;

/**
 * Global keyboard shortcuts.
 */
export const KEYBOARD_SHORTCUTS = {
  // Idle delay before a typed monitor number commits and navigates.
  monitorJumpCommitMs: 1000,
  // Cap on digits buffered for the monitor jump.
  maxMonitorDigits: 4,
} as const;

/**
 * Event playback speed multipliers offered in the event player speed menus
 * (MP4 video.js menu and ZMS/JPEG presets). The persisted eventPlaybackRate
 * setting stores one of these. ZMS converts to its percentage convention
 * (multiplier * 100). Issue #250.
 */
export const EVENT_PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4] as const;
export const DEFAULT_EVENT_PLAYBACK_RATE = 1;
export const CONTINUOUS_PLAYBACK_TOAST_DURATION_MS = 4000;

/**
 * In-app assistant (Ask). Model runs on-device via WebGPU. Issue #246.
 * webllmModels ids are the exact WebLLM prebuilt registry ids, fixed in Phase 2.
 */
export const ASSISTANT = {
  maxToolIterations: 6,
  maxHistoryMessages: 40,
  // Whole exchanges, counted alongside the message and character caps above.
  // Those two bound SIZE, and a long thread of small turns slips under both:
  // one transcript replayed six previous question/answer pairs, including two
  // answers that were wrong at the time, and the model read its own past
  // mistakes as precedent. Older turns are also the least likely to be
  // relevant, since each new question usually re-queries what it needs.
  maxHistoryTurns: 3,
  // Sized against the context window, which is 8192: the system prompt and
  // tool catalog take ~1870 tokens and generation reserves 2048, leaving room
  // for roughly 15000 characters of history. The previous 6000 was inherited
  // from when the window was believed to be 4096, and with tool results now
  // ~2750 characters each it fit barely two of them before it began discarding
  // the conversation mid-turn.
  maxHistoryCharacters: 12000,
  // Ceiling on ONE tool result. The value is inherited (it arrived paired with
  // maxHistoryCharacters, with no derivation) and is not a measured fit: a full
  // 25-row list_events came to 7430 characters and blew straight past it, and
  // safeExecute then swapped the whole payload for a truncation notice that the
  // model read as "no events". Tools that can produce many rows must now fit
  // themselves inside this budget by dropping ROWS and saying so, rather than
  // letting their output be cut mid-JSON (see list_events).
  maxToolResultCharacters: 6000,
  // Per side (sent, received) of ONE captured exchange, and generous on
  // purpose: the point of the transcript is to show what the model actually
  // saw, and the WebLLM request carries the tool catalog and few-shot
  // block inline, which is several thousand characters before any history.
  // These strings live in the conversation for as long as the thread does, so
  // they are bounded rather than unbounded, but truncating below a full
  // request would defeat the feature.
  maxExchangeCharacters: 20000,
  // Per tool result inside the verification prompt. Smaller than
  // `maxToolResultCharacters` on purpose: the check is about whether the
  // answer matches the question and the shape of the data, and a verifier that
  // re-reads every row costs as much as the turn it is checking.
  maxVerifyDataCharacters: 2000,
  // How many recent events are read to learn which object labels this install
  // writes. One page: enough to cover the labels a site produces day to day,
  // and the tool still reports the labels present when a filter matches
  // nothing, so a miss here is recoverable rather than final.
  objectLabelSampleSize: 100,
  // Vocabulary changes when someone reconfigures a detector, which is rare, so
  // this is cached for a whole session rather than per turn.
  objectLabelCacheMs: 30 * 60 * 1000,
  // Monitor names change when someone renames a camera, which is rarer still;
  // same session-length cache as the object vocabulary (monitor-stage.ts).
  monitorRosterCacheMs: 30 * 60 * 1000,
  // Each turn of the previous exchange is trimmed to this many characters
  // before riding the parse and coverage calls as context (refs #440): a
  // hint, not a transcript.
  parseContextCharacters: 240,
  // A parsed question fans out one list_events per window x monitor
  // (plan.ts); past this many calls the free tool loop's judgment beats a
  // mechanical fan-out.
  maxPlannedToolCalls: 6,
  maxTokens: 1024,
  // The remote path needs its own budget for the same reason the native one
  // above does, and neither of `maxTokens`'s constraints applies here: an
  // Ollama server is not decoding at 10-20 tokens/second and is not boxed into
  // web-llm's 4096-token window.
  //
  // A reasoning model spends this budget before it writes anything the user
  // sees, and Ollama bills that against max_tokens even though it returns the
  // chain of thought in a SEPARATE `reasoning` field rather than in `content`.
  // Measured on qwen3:30b-a3b answering "summarize today" over six events:
  // ~900 of 1024 tokens went to reasoning, so the reply was cut off mid-word
  // at 179 characters, and the same turn with the model's `/no_think`
  // directive produced an EMPTY answer (that toggle no longer applies to
  // current Qwen3 builds). At 4096 the same turn finishes with
  // `finish_reason: "stop"` and a complete answer.
  //
  // Not raised further: this is a cap, not an allocation, so a non-reasoning
  // model still stops when it is done and pays nothing for the headroom.
  // The cap stays sized for reasoning even with `ollamaReasoningEffort`
  // below: the effort field is only sent to CONFIRMED Ollama servers, so a
  // turn against anything else still pays for a chain of thought.
  ollamaMaxTokens: 4096,
  // Sent as `reasoning_effort` to confirmed Ollama servers (>= 0.32 maps it
  // to think-off; older builds ignore it, and non-thinking models ignore it
  // everywhere). Measured on qwen3:8b over the full prompt-eval suite
  // (refs #259): identical scores with reasoning on and off (33/33 native,
  // 24/24 envelope contract plain and constrained), at 62s against 321s for
  // the same suite with thinking. The model's own `/no_think` soft switch is
  // NOT equivalent: on Ollama 0.32 it only hides the tag while the hidden
  // reasoning still burns the same latency.
  ollamaReasoningEffort: 'none',
  // Sampling temperature, pinned rather than left to each runtime's default
  // (Ollama's is 0.8). Measured against this app's own prompt and tools, 66
  // graded cases per run: at the default the SAME prompt scored 57/66 and
  // 66/66 on consecutive runs, and at 0 it scored 66/66 twice. Every failure
  // that variance produced was a real one, including reading matchCount (5
  // events) when asked how many people came (4).
  //
  // This assistant reports facts from tool results. There is nothing for
  // sampling to be creative about, and a wrong sample is a wrong answer about
  // someone's cameras. Two prompt rewrites measured within noise of each other
  // at the default; this single number moved more than either.
  //
  // Measured per model (app/scripts/prompt-eval.mts):
  //   llama3.2   default 57/66 and 61/66; at 0, 66/66 twice
  //   gemma4     33/33 at both, so it loses nothing, and it is ~10x slower
  //   WebLLM     18/24 vs 19/24, i.e. no effect: that path describes its tools
  //              in prose instead of calling them natively, and its misses are
  //              the model answering without a tool at all (the loop's
  //              live-data requirement catches those), not bad sampling.
  // No model measured worse at 0, so it is pinned for all of them.
  assistantTemperature: 0,
  // Used from the SECOND parse attempt onward, never the first. Both providers
  // retry a reply they could not parse, and that retry only works if the
  // sampler can take a different path: at temperature 0 it would return the
  // identical unparseable text and burn the attempts for nothing. Small enough
  // to stay grounded, large enough to escape a degenerate reply.
  assistantRetryTemperature: 0.3,
  // Bounds for the Settings dials (AssistantAdvancedSection). Wide enough to be
  // useful, narrow enough that a typo cannot wedge the assistant: a 1-second
  // timeout or a 200-turn history would look like a broken app, not a setting.
  assistantTemperatureMax: 1,
  assistantTimeoutSecMin: 10,
  assistantTimeoutSecMax: 600,
  assistantHistoryTurnsMax: 20,
  // Attempts ANY backend gets to produce a usable reply before the panel shows
  // the parse-error apology. Models occasionally emit degenerate output (an
  // empty ```code fence```, a blank, or non-JSON prose); sampling is
  // non-deterministic (temperature > 0), so a fresh attempt usually recovers,
  // and a degenerate reply is only a few tokens so retrying it is cheap.
  //
  // Was WebLLM-only, which left Ollama single-shot: one degenerate reply there
  // surfaced the apology directly, the exact failure this retry exists to
  // prevent. A remote retry costs a network round trip rather than local
  // decode, but only on a reply that was going to be thrown away anyway.
  maxParseAttempts: 3,
  // How many tool calls the apple backend's NATIVE loop may bridge in one turn
  // (refs #270). `maxToolIterations` cannot bound that loop: the framework owns
  // the iteration and the agent only sees the finished turn. Observed live: the
  // model called list_events roughly fifteen times with small argument variants,
  // ignoring the duplicate-call guard text it was handed each time, until the
  // accumulated results overflowed the window (CONTEXT_FULL) and the turn died
  // with the data already in hand. Eight is above any legitimate turn seen (a
  // multi-monitor comparison runs three to five calls) and well under what the
  // window can hold, so it stops a retry storm without cutting real work short.
  appleNativeToolCallBudget: 8,
  // Ollama's non-streaming /chat/completions gives no progress signal, so a cold
  // server-side model load just looks like a slow request. Past this, show an honest
  // "still working, the server may be loading" note that ticks elapsed seconds (refs #270).
  assistantServerSlowMs: 8000,
  // Below this prefill suffix the KV reuse makes the first-fill fast enough that a status
  // note would just flicker; only larger (re)fills are worth surfacing (refs #270).
  assistantPrefillNoteMinTokens: 256,
  // web-llm's prebuilt registry entries cap context_window_size at 4096 for
  // every model (ModelRecord.overrides in @mlc-ai/web-llm's prebuiltAppConfig;
  // all 165 entries are 4096 or lower), well under what the models support
  // natively. Our prompt (system rules + few-shot + tool schemas + history +
  // tool results) plus the generated output can exceed 4096,
  // throwing ContextWindowSizeExceededError, so each model below carries its
  // own `contextWindowSize`, passed as a ChatOptions override to
  // CreateMLCEngine's third argument (see model-download.ts createEngineOnce)
  // and merged in AFTER the prebuilt cap.
  //
  // Each value is min(the model's native window, contextWindowCap). NOT the
  // native window: the KV cache is allocated up front and grows linearly with
  // this number, on top of the weights, so Llama 3.2's native 128K would need
  // GBs of VRAM by itself and OOM on any phone. The cap is the ceiling that
  // keeps that bounded; a model whose native window is lower (Gemma 2: 8192)
  // gets its native value instead, since asking for more than a model was
  // trained for degrades output rather than helping.
  contextWindowCap: 16384,
  // Fraction of a turn's context window that, once the prompt exceeds it,
  // triggers the auto-clear notice in AskPanel. Below 1.0 by enough to fit the
  // NEXT turn's answer (maxTokens) plus its tool results: clearing only once
  // the window is already full means the turn that discovers it has already
  // failed.
  contextClearThreshold: 0.75,

  maxListEventsLimit: 25,
  // Monitors a truncated list_events result will count individually to report
  // the window's real per-monitor breakdown (refs #337). One request each, run
  // in parallel, and only on the truncated path. Past this many the page tally
  // is reported instead, qualified as such: a server with dozens of monitors
  // would spend more requests on the breakdown than on the answer.
  maxMonitorTotalQueries: 24,
  // How many distinct detected-object labels list_events names back when an
  // objectType filter matched nothing. Enough to cover a normal install's
  // vocabulary (person, car, dog, truck, ...) without pasting a long tail of
  // rare labels into a context window this assistant is already tight on.
  objectLabelHintLimit: 12,
  // Monitor result cards render a LIVE preview (refs #264), and each one is
  // a real stream with real bandwidth and server cost. Above this many
  // monitor cards in one answer, cards fall back to text: "show me the
  // garage" wants a stream, "list my 12 cameras" wants a list.
  maxLiveMonitorCards: 4,
  requestTimeoutMs: 120000,
  // A "Test connection" click only needs to know the server answers, not run a
  // full chat turn: `requestTimeoutMs` (120s) covers the WORST case (a slow
  // local model actually generating), so reusing it here left the button
  // reading "Testing…" for up to two minutes against an unreachable host. This
  // is a plain reachability probe (AssistantOllamaSection.tsx's
  // handleTestConnection), so it gets its own short budget.
  testConnectionTimeoutMs: 8000,
  // Testing a MODEL is not testing a connection. The first request against a
  // model Ollama has not loaded yet pays the load cost before it generates a
  // token, and a multi-gigabyte model can spend well over a minute there. The
  // 8s reachability budget above turned that into "the server answered but the
  // model did not", which blamed the model for what was really a stopwatch.
  modelProbeTimeoutMs: 90000,
  // Max characters of an event's Notes field kept in a list_events row (rule
  // 11: truncate long text); get_event still returns the full Notes.
  notesPreviewChars: 200,
  // Max characters of a tool call's JSON-stringified input shown inline next
  // to an activity step in AskPanel (rule 11: truncate long text).
  activityInputPreviewChars: 40,
  // On-device only runs on desktop (web/Electron); mobile is gated off for
  // memory (see AssistantSection). So the default targets a desktop. Qwen3 4B
  // after a WebGPU device pass confirmed the MLC build with thinking off
  // (refs #265); it beat the llama class across the eval suite (see
  // webllmModels). Existing installs keep their saved model choice.
  defaultModelId: 'Qwen3-4B-q4f16_1-MLC',
  // Ordered smallest first: the top of the picker is the safest thing to load
  // on a phone, and `approxSizeMb` is web-llm's own `vram_required_MB` for the
  // record (measured at ITS 4096 window, so the real figure at the
  // `contextWindowSize` below is higher; treat it as a floor, not a budget).
  // `Qwen2.5-3B-Instruct-q4f16_1-MLC` was dropped here in favour of Qwen3;
  // migrateSettings (stores/settings.ts) rewrites saved copies of that id.
  // Each `contextWindowSize` is min(the model's native window, contextWindowCap),
  // where "native" is the model's real trained limit, NOT the value in its
  // mlc-chat-config.json (MLC ships conservative defaults there: Llama 3.2's
  // config says 131072, Gemma 2's says 4096). Values cross-checked against the
  // configs at huggingface.co/mlc-ai/<id>/resolve/main/mlc-chat-config.json,
  // which is also the only place `sliding_window_size` appears (rule 41).
  // `gemma3-1b-it-q4f16_1-MLC` is deliberately absent: it does not work on
  // web-llm 0.2.84 in any configuration, verified on device. Its config ships
  // `sliding_window_size: 512` (the only model here that does), which makes the
  // stock registry entry unloadable at all (registry ctx 4096 + config slide
  // 512 => both positive => WindowSizeConfigurationError). Pinning
  // `sliding_window_size: -1` loads it, but forces full-KV attention on a wasm
  // compiled for sliding-window attention: it then answered empty at ctx 16384
  // and emitted token soup ("//\n$$ }}!!\n'''\nperlport's...") at ctx 8192.
  // Its own 512-token window is the only untried mode and is far smaller than
  // this app's system prompt, so the model would never see the tool contract.
  // Do not re-add without checking a newer web-llm first.
  // A short list, not a menu: a picker of six was six prompt-compatibility
  // surfaces to keep working. Qwen3 4B is the default (`defaultModelId`);
  // Llama 3.2 3B stays as the smaller option and the retired-id target.
  //
  // These sizes because this list only ever serves desktop and web: the
  // assistant's on-device backend is not offered on phones or tablets at all,
  // so there is no memory-tight device to size down for here.
  webllmModels: [
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', approxSizeMb: 2264, contextWindowSize: 16384 },
    // Candidate upgrade (refs #246): qwen family led every server-side eval,
    // and the 4B-class proxy (qwen3:4b-instruct, temp 0, 3 runs/case) scored
    // tool 36/42, answer 12/12, interpret 48/51, triage 42/45 vs the llama3.2
    // class's 30/42 tool. Thinking is disabled for real via WebLLM's
    // enable_thinking:false (providers/webllm.ts). Not the default until a
    // WebGPU device pass confirms the MLC build.
    { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B', approxSizeMb: 3432, contextWindowSize: 16384 },
  ],
  /** Saved `assistantModelId` values no longer in `webllmModels`, mapped to
   *  their replacement. Consumed by migrateSettings (stores/settings.ts).
   *  Adding an entry here means bumping the settings store's persist `version`,
   *  or the rewrite never runs for anyone already on the current version. */
  retiredModelIds: {
    // Everything the picker used to offer now maps to the single supported
    // model. A saved id that is no longer in `webllmModels` would otherwise
    // leave the panel pointing at a model it cannot describe or re-download.
    'Qwen2.5-3B-Instruct-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'gemma3-1b-it-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Qwen3-0.6B-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'gemma-2-2b-it-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Qwen3-1.7B-q4f16_1-MLC': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  } as Record<string, string>,
  // The native (llama.cpp bridge) on-device model, refs #270.
  //
  // `url` points at unsloth's GGUF conversion, not a `Qwen/...-GGUF` repo:
  // Qwen does not publish an official GGUF repo for this model (verified via
  // the HF API model list for "Qwen3-4B-Instruct-2507-GGUF" on 2026-07-22 --
  // no `Qwen/` owner in the results). unsloth is the same quantizer already
  // trusted for `webllmModels`' MLC conversions elsewhere in this app.
  nativeLlmModel: {
    id: 'Qwen3-4B-Instruct-2507-Q4_K_M',
    // Nominal max window JS asks for; native (NativeLlmPlugin.isSupported/chat) derives the real
    // window from device RAM and caps down to it, reporting the adopted value back via isSupported.
    contextSize: 8192,
    // No "(native)" suffix: the backend picker calls this option "On-device
    // (Download model)" and the chat header already appends the on-device mode,
    // so the engine name only ever read as jargon here.
    label: 'Qwen 3 4B Instruct',
    url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    approxSizeMb: 2500,
  },
  // Apple Foundation Models (`AppleIntelligence` bridge, refs #270): the OS owns the model, so
  // there is no id to download or select. This fixed label is only the `model` field stamped onto
  // captured exchanges so a transcript names which backend answered.
  appleIntelligenceModelId: 'apple-intelligence',
  // Gemini Nano through AICore (`GeminiNano` bridge, refs #270). Same reasoning as the Apple id
  // above: AICore owns the model, so this fixed label only stamps captured exchanges. The name
  // is the family, not the build; `getBaseModelName()` reports the build (nano-v3 on a Pixel 10)
  // and it changes under the app with a system update, so pinning it here would go stale.
  geminiNanoModelId: 'gemini-nano',
  // Ollama's default local HTTP address, OpenAI-compatible endpoint (refs #246).
  // On a phone this must be replaced with the Ollama server's LAN address:
  // "localhost" from the app's own process never reaches a server on another
  // host, and (on native) not even the desktop this profile was created on.
  defaultOllamaBaseUrl: 'http://localhost:11434/v1',
  // Measured against this app's own system prompt and tool schemas, four
  // questions run twice each ("summarize today", "how many vehicles came
  // yesterday", "is the server ok", "what cameras do I have"), scoring the
  // tool chosen AND whether its arguments were usable as sent:
  //
  //   gemma4          8/8  clean arguments        ~4.6s/call
  //   qwen3-coder:30b 8/8  clean arguments        ~2.1s/call
  //   qwen3:30b-a3b   8/8  clean arguments        ~6.3s/call
  //   gpt-oss:20b     7/8  fills unused args null ~5.0s/call
  //   llama3.2        6/8  stringifies arrays     ~0.5s/call
  //   qwen2.5-coder   0/8  never emits a tool call
  //   gemma2:9b       0/8  server: "does not support tools"
  //
  // Treat that table as a spot check, not a verdict. It is eight data points
  // per model, single-round, and it scored only the tool call. A later
  // full-turn transcript contradicted two of its readings for gemma4: it null
  // fills every unused argument, and its rounds ran 6-17s rather than 4.6s,
  // putting a single question near 45s. It also emitted undecoded
  // byte-fallback tokens into user-visible text (see sanitize.ts).
  //
  // The re-measurement that table asked for happened (refs #259; full
  // prompt-eval suite, 3 runs/case, temp 0, plus live agent-loop runs):
  //
  //   qwen3:8b   33/33 native, 24/24 envelope   62s suite with
  //              `ollamaReasoningEffort` applied (~2s/turn); 321s without
  //   llama3.2   33/33 native, 21/24 envelope   15s suite (~0.5s/turn)
  //   qwen3:4b   same scores as 8b, but dense: 747s suite
  //   qwen3:30b  same scores as 8b, 18GB, nothing extra
  //   qwen3:1.7b 21/33 native, 12/24 envelope
  //
  // qwen3:8b with reasoning disabled matches the 30B model's perfect scores
  // at ~2s a turn, and unlike llama3.2 it never reaches for a tool on small
  // talk (6/6 restraint) and never drops objectType on "how many <thing>"
  // questions. llama3.2 remains the fast fallback; its misses are covered by
  // the loop's guards rather than the model.
  recommendedOllamaModel: 'qwen3:8b',
  // Prefix for the secure-storage key holding the optional Ollama/OpenAI
  // Bearer API key, suffixed with the profile id (lib/security/secureStorage.ts).
  // Never held in profile settings (rule 7 settings are plaintext-persisted).
  apiKeyStoragePrefix: 'assistant-api-key-',
} as const;

/**
 * Floating assistant window (refs #246).
 *
 * Desktop is a resizable card anchored bottom-right (AssistantDesktopPanel): a
 * top-left drag handle sets its width/height, persisted to
 * `stores/assistantPanel.ts` on release. Mobile is a share-the-screen bottom
 * sheet (AssistantMobileSheet). The `mobile*` fields below drive the sheet.
 */
export const ASSISTANT_PANEL = {
  defaultWidth: 400,
  defaultHeight: 560,
  minWidth: 320,
  minHeight: 400,
  maxWidth: 720,
  maxHeight: 960,
  // Tailwind's default `sm` breakpoint (not overridden in tailwind.config.js):
  // `useIsMobile` matches below this to pick the sheet over the card.
  mobileBreakpointPx: 640,
  // Mobile bottom-sheet (refs #246). The sheet shares the screen with the app
  // instead of covering it. Its height is a fraction of the visible viewport
  // (rotation-proof: 0.6 stays 0.6 after a rotate, where a pixel height would
  // clip or overflow), clamped between a bar minimum and a full maximum.
  mobileSheetBarMinPx: 112, // slim peek bar: drag grip + input row + safe area
  mobileSheetMaxFraction: 0.92, // "full", leaving a sliver of app visible on top
  // A drag released this far BELOW the bar minimum collapses the sheet to the
  // floating button (a flick-to-dismiss without a snap-point system).
  mobileSheetDismissPx: 40,
  // Fraction the sheet grows to when the input is focused from the bar, so the
  // conversation is visible above the keyboard (the visible viewport is already
  // keyboard-reduced by then, so this fills most of what remains).
  mobileSheetFocusFraction: 0.9,
} as const;

/**
 * Monitor Detail Navigation
 *
 * Swipe/prev-next navigation between monitors on the monitor detail page.
 */
export const MONITOR_NAVIGATION = {
  // How long the slide-transition state stays active after switching monitors,
  // matching the CSS slide animation duration (ms)
  slideAnimationMs: 450,
} as const;

/**
 * Montage Grid Constants
 *
 * Internal grid sizing for the Montage view.
 */
export const MONTAGE_GRID = {
  // Sub-units per display column. The internal react-grid-layout grid spans
  // (displayColumns * colSubdivision) units, so any column count renders
  // exactly, while tiles still resize in fractions of a column.
  colSubdivision: 12,

  // h-8 header bar height with monitor name + buttons (px)
  cardHeaderHeightPx: 32,

  // The same header under compact display mode, which shrinks h-8 rows to
  // 1.75rem (index.css .compact-mode .h-8). Layout math must use the value
  // that actually renders or the difference letterboxes the video (refs #359).
  cardHeaderHeightCompactPx: 28,

  // All-mode only cap on total tiles (== streams) rendered across every
  // profile's monitors combined. Single mode has no cap (unchanged,
  // unlimited) - this only guards the aggregate view, where N profiles each
  // contributing every enabled monitor could otherwise open dozens of
  // simultaneous MJPEG/WebRTC connections across independent servers at
  // once (refs #337, Phase 4 Task 1). The DEFAULT for the editable
  // `allModeMaxStreams` setting, which is what the page reads.
  allModeMaxStreams: 16,

  // What a montage tile asks ZM for while All-mode stream tuning is set to
  // "reduced" (`allModeStreamTuning`). Both are ceilings, never floors: a
  // server the user has already throttled below them keeps its own values, so
  // reducing never turns into raising. Frames per second, and scale as the
  // percentage ZMS crops the image to - a quarter-size tile is a sixteenth of
  // the pixels the server has to encode and the client has to decode, which is
  // where the saving on a wall of cameras actually comes from.
  reducedMaxFps: 5,
  reducedScale: 25,

  // How long All Servers mode must be out of sight before montage tiles stop
  // streaming (`allModePauseHidden`). Long enough that switching tabs to check
  // something and coming back leaves the streams alone: a teardown and
  // reconnect of every tile across every server costs more than the half
  // minute of streaming it saves (ms).
  pauseHiddenGraceMs: 30_000,

  // Shortest gap between two activity events that both count towards the
  // All-mode idle downgrade (`allModeIdleMinutes`). A pointer dragged across
  // the montage fires hundreds of events a second and every one of them would
  // otherwise rebuild the idle timer (ms).
  idleActivityThrottleMs: 1_000,

  // How far beyond the montage's scroll container a tile still counts as
  // worth a connection while viewport gating is on (`allModeViewportGating`),
  // as an IntersectionObserver rootMargin. One container height either way:
  // the row about to be scrolled to is already streaming when it arrives, so
  // gating costs no visible connect delay in ordinary scrolling.
  viewportGatingRootMargin: '100%',

  // How long a tile keeps its connection after leaving that margin. Scrolling
  // from the top of a tall montage to the bottom passes every tile in
  // between, and without this each one would quit and remint a connkey on the
  // way past - more server work than the streaming it saves. Coming back into
  // view is not debounced; only leaving is (ms).
  viewportGatingLingerMs: 1_500,
} as const;

/**
 * Go2RTC Live Streaming Constants
 *
 * Timing for the go2rtc (MSE/WebRTC) live stream path used by the live monitor
 * player and montage tiles.
 */

/**
 * Seconds to wait for decoded video frames after go2rtc reports "connected"
 * before giving up and falling back to MJPEG. In montage every tile connects
 * at once, so this is generous enough to cover the resulting burst.
 */
export const GO2RTC_VIDEO_TIMEOUT_S = 15;

/** Base delay before connecting, to survive React Strict Mode double-invoke (ms) */
export const GO2RTC_CONNECT_DELAY_MS = 100;

/**
 * How often to poll the go2rtc <video> for decoded frames while the MJPEG-first
 * placeholder is showing, so the player swaps to MSE as soon as frames arrive
 * instead of waiting for the full GO2RTC_VIDEO_TIMEOUT_S deadline.
 */
export const GO2RTC_FRAME_POLL_MS = 250;

/** How often to check a playing MSE stream for freeze after the first frame (ms) */
export const GO2RTC_LIVENESS_CHECK_MS = 3000;

/** Seconds of no video.currentTime advance (or stuck readyState) before treating an MSE stream as frozen */
export const GO2RTC_FREEZE_THRESHOLD_S = 7;

/** Freeze recoveries (retries) per monitor before giving up on MSE and falling back to MJPEG */
export const GO2RTC_MAX_FREEZE_RETRIES = 2;

/** Seconds an MSE stream must advance healthily before the freeze-retry counter resets */
export const GO2RTC_FREEZE_RESET_S = 60;

/** Minutes before retrying go2rtc on a monitor that previously failed */
export const GO2RTC_RETRY_INTERVAL_MIN = 5;

/**
 * STUN servers applied to the browser-side go2rtc RTCPeerConnection when the
 * per-profile `webrtcUseStun` setting is on. These mirror the servers
 * video-rtc.js hardcodes. STUN is only needed to reach go2rtc directly across
 * the public internet without a portal/VPN, where NAT traversal needs a
 * server-reflexive candidate.
 *
 * When the setting is off (the default), useGo2RTCStream applies an empty ICE
 * list instead. On a LAN (and via a portal/VPN reverse proxy) the pc connects on
 * host candidates, so STUN is never on the path. An empty list also stops
 * Chromium from starting a STUN hostname lookup that it would cancel when
 * video-rtc tears the pc down (WebRTC/MSE race, or tile rotation), which
 * otherwise logs "Failed to resolve address for stun... errorcode: -105" even
 * though DNS resolves fine.
 */
export const GO2RTC_STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

/**
 * Downloads
 *
 * Timing for browser-triggered file downloads (web platform).
 */
export const DOWNLOAD = {
  // Delay before removing the temporary anchor element used to trigger a
  // data-URL download, so the browser has time to start the download (ms)
  webLinkCleanupDelayMs: 100,
} as const;

/**
 * Discovery Timeouts
 *
 * Network discovery retries and platform permission delays.
 */
export const DISCOVERY_TIMEOUTS = {
  // Retry delay after first discovery failure to wait for the iOS local
  // network permission dialog. The first request fails while the dialog
  // is showing, but succeeds after the user grants access.
  iosPermissionRetryMs: 3000,
} as const;

/**
 * Bandwidth Mode Types
 */
export type BandwidthMode = 'normal' | 'low';

/**
 * Bandwidth Settings Interface
 */
export interface BandwidthSettings {
  /** Monitor status polling interval (ms) */
  monitorStatusInterval: number;
  /** Alarm status polling interval (ms) */
  alarmStatusInterval: number;
  /** Snapshot refresh interval (seconds) */
  snapshotRefreshInterval: number;
  /** Events widget polling interval (ms) */
  eventsWidgetInterval: number;
  /** Timeline/Heatmap widget polling interval (ms) */
  timelineHeatmapInterval: number;
  /** Monitor new events polling interval (ms) */
  monitorNewEventsInterval: number;
  /** Daemon check polling interval (ms) */
  daemonCheckInterval: number;
  /** Image scale percentage (1-100) */
  imageScale: number;
  /** Image quality percentage (1-100) */
  imageQuality: number;
  /** Stream max FPS */
  streamMaxFps: number;
  /** ZMS playback status polling interval (ms) */
  zmsStatusInterval: number;
  /** Event poller interval for direct notification mode (ms) */
  eventPollerInterval: number;
  /** WebSocket keepalive ping interval (ms) */
  wsKeepaliveInterval: number;
  /** Timeline now-line refresh interval (ms) */
  timelineNowRefreshInterval: number;
  /** Monitor-detail recent-events list polling interval (ms) */
  monitorRecentEventsInterval: number;
  /** Assistant Ollama reachability probe interval (ms), while the panel is open */
  assistantHealthInterval: number;
}

/**
 * Bandwidth Settings by Mode
 *
 * Configurable polling intervals and image quality settings
 * to balance between responsiveness and bandwidth usage.
 */
export const BANDWIDTH_SETTINGS: Record<BandwidthMode, BandwidthSettings> = {
  normal: {
    monitorStatusInterval: 20000, // 20 sec
    alarmStatusInterval: 5000, // 5 sec
    snapshotRefreshInterval: 3, // 3 sec (stored in seconds for settings compatibility)
    eventsWidgetInterval: 30000, // 30 sec
    timelineHeatmapInterval: 60000, // 60 sec
    monitorNewEventsInterval: 60000, // 60 sec
    daemonCheckInterval: 30000, // 30 sec
    imageScale: 100, // 100%
    imageQuality: 100, // 100%
    streamMaxFps: 10, // 10 FPS
    zmsStatusInterval: 3000, // 3 sec
    eventPollerInterval: 30000, // 30 sec
    wsKeepaliveInterval: 60000, // 60 sec
    timelineNowRefreshInterval: 30000, // 30 sec
    monitorRecentEventsInterval: 30000, // 30 sec
    assistantHealthInterval: 30000, // 30 sec
  },
  low: {
    monitorStatusInterval: 40000, // 40 sec
    alarmStatusInterval: 10000, // 10 sec
    snapshotRefreshInterval: 10, // 10 sec
    eventsWidgetInterval: 60000, // 60 sec
    timelineHeatmapInterval: 120000, // 120 sec
    monitorNewEventsInterval: 120000, // 120 sec
    daemonCheckInterval: 60000, // 60 sec
    imageScale: 50, // 50%
    imageQuality: 50, // 50%
    streamMaxFps: 5, // 5 FPS
    zmsStatusInterval: 5000, // 5 sec
    eventPollerInterval: 60000, // 60 sec (2x slower)
    wsKeepaliveInterval: 120000, // 120 sec (2x slower)
    timelineNowRefreshInterval: 60000, // 60 sec (2x slower)
    monitorRecentEventsInterval: 60000, // 60 sec
    assistantHealthInterval: 60000, // 60 sec (2x slower)
  },
} as const;

/**
 * Get bandwidth settings for a given mode
 */
export function getBandwidthSettings(mode: BandwidthMode): BandwidthSettings {
  return BANDWIDTH_SETTINGS[mode];
}

/**
 * Live Activity page.
 *
 * A monitor stays on the page for `dwellSeconds` after its alarm clears. That
 * is not cosmetic: every tile that enters or leaves mounts or unmounts a
 * MontageMonitor, which mints a ZMS connection key and sends CMD_QUIT, so a
 * flickering monitor thrashes nph-zms processes on the server.
 */
export const LIVE_ACTIVITY = {
  defaultPollSeconds: 5,
  defaultDwellSeconds: 30,
  defaultMaxTiles: 30,
  minPollSeconds: 2,
  maxPollSeconds: 60,
  // Not 0: the dwell window is what stops a monitor flickering in and out of
  // the grid, and every entry and exit mints or quits a ZMS connection. A
  // floor of zero lets a user turn off the exact damping that protects the
  // nph-zms processes on their own server.
  minDwellSeconds: 5,
  maxDwellSeconds: 300,
  // How long a resident monitor must stay quiet before its next alarm counts
  // as a new episode and re-sorts it to the top. ZoneMinder walks a winding
  // down event through `alarm` -> `alert` -> `tape`/`idle` and back, so a
  // monitor drops out of the alarming set and returns to it repeatedly across
  // one event's tail, a second or two at a time. Without this window every one
  // of those blips restamps the sort key and the grid reorders once a second
  // for the length of the tail. Comfortably longer than that flapping and
  // shorter than the default dwell window, so a real second alarm on a monitor
  // that had genuinely gone quiet still takes the top tile.
  episodeGraceSeconds: 15,
  minTiles: 1,
  maxTiles: 40,
  // Height of one row of the tile grid. The grid packs tiles by row span
  // rather than by shared rows (see lib/monitor/live-activity-layout.ts), so
  // this is a measuring unit, not a gap: one pixel is the finest a tile's
  // computed height can be expressed in.
  rowUnitPx: 1,
  // purpose: it exists so activity does not vanish without trace, not to
  // become a second, unbounded list competing with the grid for the page. A
  // few minutes covers "what did I just miss" and nothing longer.
  //
  // All mode only (refs #337, #341): the page aggregates every scope
  // profile's alarm fanout instead of gating All mode out entirely.
  // Single mode is unaffected by both guardrails below.
  //
  // Cap on total (profile, monitor) pairs watched across every profile
  // combined, applied round-robin so one busy server cannot crowd out the
  // rest (see capWatchedRoundRobin, lib/monitor/live-activity.ts). The alarm
  // endpoint is per-monitor, so this bounds query fan-out the same way
  // MONTAGE_GRID.allModeMaxStreams bounds stream fan-out. Both of the two
  // values below are DEFAULTS for the editable settings of the same name,
  // which is what useLiveActivityAllMode reads.
  allModeMaxWatched: 24,
  // Floor under the configured alarm poll interval. Live hints
  // (applyLiveAlarmHints) carry the fast path when a profile's connection is
  // Live; polling only confirms, so All mode does not need single mode's
  // tighter floor while fanning its poll out across every scope profile.
  allModePollFloorSeconds: 10,
} as const;

/**
 * All Servers Performance Bounds
 *
 * Range each All-mode tuning knob may be edited within (Settings > All Servers
 * performance, All mode only). The DEFAULTS are not here: each one stays with
 * the subsystem it guards (MONTAGE_GRID.allModeMaxStreams,
 * LIVE_ACTIVITY.allModeMaxWatched / allModePollFloorSeconds,
 * NOTIFICATIONS_SERVICE.allModeBurstWindowMs), and DEFAULT_SETTINGS references
 * those. Only the editable range lives here, because a range is a property of
 * the setting rather than of the subsystem.
 *
 * The bounds exist so a stored value can never take a fan-out guardrail
 * somewhere absurd: the minimums keep every aggregate surface able to show at
 * least something, and the maximums keep a hand-edited storage blob from
 * opening hundreds of simultaneous connections across servers (refs #337).
 */
export const ALL_MODE_PERFORMANCE = {
  // Montage tiles (== live streams) across every profile combined. One tile is
  // still a usable montage; 64 is past what any browser opens happily and is a
  // ceiling rather than a recommendation.
  minStreams: 1,
  maxStreams: 64,
  // (profile, monitor) pairs the Live Activity page watches. The alarm endpoint
  // is one request per monitor per poll, so this bounds concurrent requests.
  minWatched: 1,
  maxWatched: 128,
  // Floor under the Live Activity alarm poll interval in All mode. Same range
  // as the poll interval it floors (LIVE_ACTIVITY.min/maxPollSeconds): a floor
  // outside that range would either not floor anything or pin every poll to
  // the ceiling regardless of what the user set.
  minPollFloorSeconds: LIVE_ACTIVITY.minPollSeconds,
  maxPollFloorSeconds: LIVE_ACTIVITY.maxPollSeconds,
  // Window that collapses simultaneous events from several servers into one
  // summary toast. Below a second there is nothing left to coalesce; above
  // half a minute a toast arrives long after the event that caused it.
  minBurstSeconds: 1,
  maxBurstSeconds: 30,
  // Idle timeout before All mode stands its connections down. 0 is a real
  // value here (off), not a floor that disables the feature by accident.
  minIdleMinutes: 0,
  maxIdleMinutes: 120,
} as const;
