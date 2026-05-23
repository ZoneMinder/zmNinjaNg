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
export const ZM_INTEGRATION = {
  // HTTP timeouts for ZM API calls
  httpTimeout: 10000, // 10 seconds - standard API calls
  largeHttpTimeout: 30000, // 30 seconds - large responses (events, etc.)

  // Streaming and video performance
  defaultFps: 3, // Default FPS for event playback
  maxFps: 30, // Maximum FPS allowed
  streamMaxFps: 10, // Max FPS for live monitor streams (to reduce bandwidth)

  // Timeout for a single snapshot frame fetched via the Rust HTTP client on
  // Tauri desktop (WebKitGTK socket-leak workaround). One frame is small, so a
  // short timeout keeps a stalled request from blocking the next refresh.
  snapshotFrameFetchTimeoutMs: 10000, // 10 seconds

  // Reconnect backoff for the Tauri Rust MJPEG stream when the connection drops
  // or ends (server restart, network blip). Exponential from base, capped, with
  // a bounded attempt count before surfacing the stream-error state. Refs #155.
  mjpegReconnectBaseDelayMs: 1000, // 1 second
  mjpegReconnectMaxDelayMs: 15000, // 15 seconds
  mjpegReconnectMaxAttempts: 6,

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
  accessTokenLeewayMs: 30 * 60 * 1000, // 30 minutes in milliseconds — gates URL construction; refresh fires when below this threshold
  tokenCheckInterval: 60 * 1000, // Check token status every minute
  loginInterval: 1800000, // 30 minutes - re-login interval
} as const;

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

  // Montage row height in pixels — 1px for pixel-level precision (no black bars with contain)
  montageRowHeight: 1,

  // Grid calculation frequencies
  montageScaleFrequency: 300, // How often to recalculate montage scales (ms)
  packeryTimer: 500, // Delay for packery layout recalculation (ms)
  resizeDebounceMs: 500, // Debounce window for ResizeObserver in montage container
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
} as const;

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

  // Web crypto fallback salt (versioned — bump suffix to invalidate)
  cryptoSalt: 'zmng_crypto_salt_v1',
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
} as const;

/**
 * Montage Grid Constants
 *
 * Internal grid sizing for the Montage view.
 */
export const MONTAGE_GRID = {
  // Internal grid column count for fine-grained positioning
  internalCols: 12,

  // h-8 header bar height with monitor name + buttons (px)
  cardHeaderHeightPx: 32,
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
 * Valid ZoneMinder Monitor Functions
 *
 * NOTE: These are duplicated from zm-constants for backward compatibility.
 * New code should import from zm-constants.ts instead.
 *
 * @deprecated Use ZM_MONITOR_FUNCTIONS from zm-constants.ts
 */
export const MONITOR_FUNCTIONS = ['None', 'Monitor', 'Modect', 'Record', 'Mocord', 'Nodect'] as const;

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
  /** Console events polling interval (ms) */
  consoleEventsInterval: number;
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
    consoleEventsInterval: 60000, // 60 sec
    daemonCheckInterval: 30000, // 30 sec
    imageScale: 100, // 100%
    imageQuality: 100, // 100%
    streamMaxFps: 10, // 10 FPS
    zmsStatusInterval: 3000, // 3 sec
    eventPollerInterval: 30000, // 30 sec
    wsKeepaliveInterval: 60000, // 60 sec
    timelineNowRefreshInterval: 30000, // 30 sec
  },
  low: {
    monitorStatusInterval: 40000, // 40 sec
    alarmStatusInterval: 10000, // 10 sec
    snapshotRefreshInterval: 10, // 10 sec
    eventsWidgetInterval: 60000, // 60 sec
    timelineHeatmapInterval: 120000, // 120 sec
    consoleEventsInterval: 60000, // 60 sec
    daemonCheckInterval: 60000, // 60 sec
    imageScale: 50, // 50%
    imageQuality: 50, // 50%
    streamMaxFps: 5, // 5 FPS
    zmsStatusInterval: 5000, // 5 sec
    eventPollerInterval: 60000, // 60 sec (2x slower)
    wsKeepaliveInterval: 120000, // 120 sec (2x slower)
    timelineNowRefreshInterval: 60000, // 60 sec (2x slower)
  },
} as const;

/**
 * Get bandwidth settings for a given mode
 */
export function getBandwidthSettings(mode: BandwidthMode): BandwidthSettings {
  return BANDWIDTH_SETTINGS[mode];
}
