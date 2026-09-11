import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout, Layouts } from 'react-grid-layout';
import { LogLevel } from '../lib/log-level';
import { Platform } from '../lib/platform';
import type { BandwidthMode } from '../lib/zmninja-ng-constants';
import {
  API_REQUEST,
  ASSISTANT,
  DEFAULT_EVENT_PLAYBACK_RATE,
  LIVE_ACTIVITY,
  MONTAGE_GRID,
  NOTIFICATIONS_SERVICE,
  STORAGE_KEYS,
} from '../lib/zmninja-ng-constants';
import type { AssistantBackend } from '../lib/assistant/types';
import type { DateFormatPreset, TimeFormatPreset } from '../lib/format-date-time';
import type { ThumbnailFallbackType, ThumbnailFallbackEntry } from '../lib/event/thumbnail-chain';
import type { ProfileId } from '../api/types';
import {
  ALL_MODE_STREAM_TUNING_VALUES,
  coerceAllModePerformance,
  type AllModeStreamTuning,
} from './settings-coercion';

export type ViewMode = 'snapshot' | 'streaming';
export type DisplayMode = 'normal' | 'compact';
export type MonitorFeedFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type MonitorsLayoutMode = MonitorFeedFit | 'flex';
export type MonitorsViewMode = 'list' | 'grid';
export type EventsViewMode = 'list' | 'montage';
export type ThemePreference = 'amber' | 'cream' | 'dark' | 'light' | 'slate' | 'system';
export type StreamingMethod = 'auto' | 'mjpeg';
export type WebRTCProtocol = 'webrtc' | 'mse' | 'hls';
/** All mode only: whether every scope profile's live connection is on. */
export type AllModeNotifications = 'live' | 'muted' | 'off';
/** All mode's Streaming Mode: one of the two real modes imposed on every
 *  server, or 'per-server' to leave each server's own choice alone. */
export type AllModeViewMode = ViewMode | 'per-server';
export const ALL_MODE_NOTIFICATIONS_VALUES: readonly AllModeNotifications[] = ['live', 'muted', 'off'] as const;


// Declared by the modules that consume them, so those modules do not import
// this store (refs #281). Re-exported for the existing callers.
export type { AllModeStreamTuning };
export { ALL_MODE_STREAM_TUNING_VALUES };
export type { DateFormatPreset, TimeFormatPreset };
export type { ThumbnailFallbackType, ThumbnailFallbackEntry };

export interface HoverPreviewSettings {
  eventsList: boolean;
  eventsGrid: boolean;
  monitorsList: boolean;
  monitorsGrid: boolean;
  dashboard: boolean;
  timeline: boolean;
  notifications: boolean;
  /** Event cards in an assistant answer (refs #270). */
  assistant: boolean;
  /** Alarm tiles on Live Activity. */
  liveActivity: boolean;
}

export const DEFAULT_HOVER_PREVIEW: HoverPreviewSettings = {
  eventsList: true,
  eventsGrid: false,
  monitorsList: true,
  monitorsGrid: false,
  dashboard: true,
  timeline: true,
  notifications: true,
  assistant: true,
  // Off by default: a Live Activity tile is already streaming this camera at
  // size, so a hover preview opens a second connection for a bigger copy of
  // what is on screen. Worth having on a wall of small tiles, not by default.
  liveActivity: false,
};

/** ZMS rate parameter (percentage). 100 = 1x real time. */
export type HoverPreviewPlaybackRate = 50 | 100 | 150 | 200 | 400;

export const HOVER_PREVIEW_PLAYBACK_RATES: readonly HoverPreviewPlaybackRate[] = [50, 100, 150, 200, 400] as const;

export const DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE: HoverPreviewPlaybackRate = 200;

export const DEFAULT_THUMBNAIL_FALLBACK_CHAIN: ThumbnailFallbackEntry[] = [
  { type: 'alarm', enabled: true },
  { type: 'snapshot', enabled: true },
  { type: 'objdetect', enabled: true },
  { type: 'custom', enabled: false, customFid: '' },
];

/** Sentinel group key for the "no group / All monitors" montage bucket. */
export const ALL_GROUPS_KEY = '__all__';

export interface MontageSavedLayout {
  name: string;
  layout: Layout[];
  displayCols: number;
}

/** Per-group live montage state. Keyed by group ID or ALL_GROUPS_KEY. */
export interface MontageGroupLayout {
  workingLayout: Layout[];
  savedLayouts: MontageSavedLayout[];
  activeLayoutName: string | null;
  gridCols: number;
  hiddenMonitorIds: string[];
}

/** Per-group event montage state. Event montage is a uniform grid, so only the
 * column count needs scoping. */
export interface EventMontageGroupLayout {
  gridCols: number;
}

export const DEFAULT_MONTAGE_GROUP_LAYOUT: MontageGroupLayout = {
  workingLayout: [],
  savedLayouts: [],
  activeLayoutName: null,
  gridCols: 2,
  hiddenMonitorIds: [],
};

export const DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT: EventMontageGroupLayout = {
  gridCols: 2,
};

export interface ProfileSettings {
  viewMode: ViewMode;
  /**
   * Set once viewMode has been chosen, by the user's toggle or by
   * bootstrapViewMode. Deliberately absent from DEFAULT_SETTINGS: any write
   * to a fresh bucket copies the defaults in, so viewMode itself can never
   * tell "chosen" from "defaulted" (refs #385).
   */
  viewModeChosen?: boolean;
  displayMode: DisplayMode;
  theme: ThemePreference;
  logLevel: LogLevel;
  snapshotRefreshInterval: number; // in seconds
  streamMaxFps: number; // Max FPS for live streams
  streamScale: number; // Scale percentage for live streams (1-100)
  defaultEventLimit: number; // Default number of events to fetch when no filters applied
  /** Number of recent events shown under the live view on the monitor detail page. */
  monitorDetailRecentEventsCount: number;
  /** Monitor IDs whose recent-events list is collapsed/hidden on the detail page. */
  monitorDetailRecentEventsHidden: string[];
  dashboardRefreshInterval: number; // in seconds, for dashboard widgets (events/timeline)
  // Per-group live montage layout state. Key = group ID or ALL_GROUPS_KEY.
  montageByGroup: Record<string, MontageGroupLayout>;
  // Per-group event montage state (column count). Key = group ID or ALL_GROUPS_KEY.
  eventMontageByGroup: Record<string, EventMontageGroupLayout>;
  montageIsFullscreen: boolean; // Fullscreen state for Montage page
  montageFeedFit: MonitorFeedFit; // Object-fit for montage feeds
  montageShowToolbar: boolean; // Show/hide montage toolbar row
  eventsViewMode: EventsViewMode; // List vs montage view for Events page
  monitorsFeedFit: MonitorsLayoutMode; // Layout mode for monitor list
  monitorsViewMode: MonitorsViewMode; // List or grid view
  /** All mode only: section the Monitors grid by owning server instead of a
   *  flat list. Stored under the active aggregate's own settings bucket. */
  monitorsGroupByServer: boolean;
  /** All mode only: profiles to include in the aggregated Events list.
   *  null = every profile in scope (default). Stored under the active
   *  aggregate's own settings bucket. */
  eventsServerFilter: ProfileId[] | null;
  /** Aggregating only: 'live' runs every scope profile's connection and
   *  shows toasts/sound; 'muted' keeps every connection running but
   *  suppresses toasts/sound (badge counts and history still update); 'off'
   *  tears down every aggregate connection so nothing live runs. Stored under
   *  the active aggregate's own settings bucket (refs #337). */
  allModeNotifications: AllModeNotifications;
  /** All mode only: which Streaming Mode aggregated tiles follow.
   *  'per-server' (the default) leaves every tile on its OWNING profile's
   *  viewMode, so switching into All mode never changes how anything streams;
   *  'streaming'/'snapshot' impose one mode on every tile from every server.
   *
   *  A key of its own rather than reusing `viewMode` in the aggregate's
   *  bucket: that would need "unset" to mean per-server, and the first write
   *  of ANY key to a bucket materializes the whole DEFAULT_SETTINGS shape, so
   *  unset is not a state any bucket can stay in. Stored under the active
   *  aggregate's own settings bucket (refs #337). */
  allModeViewMode: AllModeViewMode;
  /** All mode only: how many montage tiles (== live streams) render across
   *  every profile's monitors combined before the rest collapse into an
   *  overflow notice. Single mode is uncapped and ignores this. Stored under
   *  the active aggregate's own settings bucket (refs #337). */
  allModeMaxStreams: number;
  /** All mode only: how many (profile, monitor) pairs the Live Activity page
   *  watches at once, drawn round-robin so one busy server cannot crowd out
   *  the rest. Stored under the active aggregate's own settings bucket (refs #337). */
  allModeMaxWatched: number;
  /** All mode only: floor under the Live Activity alarm poll interval, in
   *  seconds. It CLAMPS the bandwidth-derived interval rather than replacing
   *  it, so a slower configured poll stays slower. Stored under the active
   *  aggregate's own settings bucket (refs #337). */
  allModePollFloorSeconds: number;
  /** All mode only: how long, in seconds, events from different servers keep
   *  collapsing into one summary toast instead of one toast each. Stored
   *  under the active aggregate's own settings bucket (refs #337). */
  allModeBurstSeconds: number;
  /** All mode only: whether aggregated tiles stream at reduced frame rate and
   *  scale. Stored under the active aggregate's own settings bucket (refs #337). */
  allModeStreamTuning: AllModeStreamTuning;
  /** All mode only: whether streams stop while the app is in the background or
   *  the tab is hidden. Stored under the active aggregate's own settings bucket (refs #337). */
  allModePauseHidden: boolean;
  /** All mode only: minutes of no interaction before aggregated streams stand
   *  down. 0 means never. Stored under the active aggregate's own settings bucket (refs #337). */
  allModeIdleMinutes: number;
  /** All mode only: whether montage tiles scrolled out of view stop streaming
   *  until they come back. Applies to the tiles the stream budget already
   *  allowed, never to which tiles exist. Stored under the ALL settings
   *  bucket (refs #337). */
  allModeViewportGating: boolean;
  monitorGridCols: number; // Grid columns for Monitors page grid view
  monitorDetailFeedFit: MonitorFeedFit; // Object-fit for monitor detail feed
  eventsThumbnailFit: MonitorFeedFit; // Object-fit for event thumbnails
  monitorDetailCycleSeconds: number; // Auto-cycle interval for single monitor view (0 = off)
  /** Open the Monitor Detail page maximized for every monitor ("Open live view
   *  in fullscreen" under Settings > Live Streaming). `fullscreenMonitorIds`
   *  is the per-monitor form (refs #462, #463). */
  monitorDetailFullscreen: boolean;
  insomnia: boolean; // Global: Keep screen awake across all pages
  monitorDetailInsomnia: boolean; // @deprecated - use global insomnia instead
  montageInsomnia: boolean; // @deprecated - use global insomnia instead
  eventMontageFilters: {
    monitorIds: string[];
    cause: string;
    startDate: string;
    endDate: string;
  };
  eventsPageFilters: {
    monitorIds: string[];
    tagIds: string[];
    startDateTime: string;
    endDateTime: string;
    favoritesOnly: boolean;
    archivedOnly: boolean;
    onlyDetectedObjects: boolean;
    activeQuickRange: number | null;
  };
  disableLogRedaction: boolean;
  lastRoute: string; // Last visited route for this profile
  // Streaming method: 'auto' tries WebRTC/MSE/HLS for Go2RTC-enabled monitors, 'mjpeg' forces MJPEG for all
  streamingMethod: StreamingMethod;
  // Which protocols to try for WebRTC streaming (video-rtc runs them in parallel)
  webrtcProtocols: WebRTCProtocol[];
  // Whether to advertise STUN servers on the WebRTC peer connection. Off by
  // default: LAN and portal/VPN reach go2rtc on host candidates, so STUN is
  // unused and only adds console noise. Turn on only for go2rtc reached directly
  // over the public internet without a portal/VPN, where NAT traversal needs it.
  webrtcUseStun: boolean;
  // Bandwidth mode: 'normal' for default intervals, 'low' for reduced bandwidth usage
  bandwidthMode: BandwidthMode;
  /** Live Activity: alarm-status poll interval in seconds, floored by bandwidth mode. */
  liveActivityPollSeconds: number;
  /** Live Activity: how long a monitor stays listed after its alarm clears, in seconds. */
  liveActivityDwellSeconds: number;
  /** Live Activity: how many tiles render before the rest collapse into an overflow row. */
  liveActivityMaxTiles: number;
  /** Live Activity: monitors that never appear on that page. Separate from the
   *  profile-wide monitor exclusion, which hides a monitor everywhere. */
  liveActivityIgnoredMonitorIds: string[];
  /** Live Activity: fullscreen state for that page. Separate from
   *  montageIsFullscreen so the two pages do not share one fullscreen flag. */
  liveActivityIsFullscreen: boolean;
  // Selected group ID for filtering monitors (null = show all monitors)
  selectedGroupId: string | null;
  // Monitor IDs excluded from this profile. Excluded monitors and their events
  // are dropped at the API boundary so they behave as if they don't exist.
  excludedMonitorIds: string[];
  // Allow self-signed HTTPS certificates for this profile's server
  allowSelfSignedCerts: boolean;
  // SHA-256 fingerprint of the trusted TLS certificate (TOFU pinning)
  trustedCertFingerprint: string | null;
  // Custom sidebar nav order (array of route paths). Empty = default order.
  sidebarNavOrder: string[];
  // Timeline page persisted filters
  timelinePageFilters: {
    monitorIds: string[];
    startDateTime: string;
    endDateTime: string;
    onlyDetectedObjects: boolean;
    causeFilter: string;
    activeQuickRange: number | null;
  };
  // Date/time display format
  dateFormat: DateFormatPreset;
  timeFormat: TimeFormatPreset;
  customDateFormat: string; // used when dateFormat === 'custom'
  customTimeFormat: string; // used when timeFormat === 'custom'
  // Auto-play video when opening event detail
  eventVideoAutoplay: boolean;
  // Continuous event playback (#250): when true, reaching the end of an event
  // video auto-advances to the next event (newer StartDateTime, honoring the
  // active filters). Persists per profile.
  eventContinuousPlay: boolean;
  // Event playback speed multiplier (one of EVENT_PLAYBACK_RATES). Honored by
  // both the MP4 and ZMS players and reused across a continuous run.
  eventPlaybackRate: number;
  /** Whether the MP4 event player starts muted. Flipping the player's own
   *  volume control updates this, so the choice carries to every later event
   *  on the profile (refs #463). ZMS playback has no audio. */
  eventPlaybackMuted: boolean;
  /** Whether the MP4 event player opens fullscreen. Set by "Open events in
   *  fullscreen" under Settings > Playback, and nowhere else: entering
   *  fullscreen on the player is a session change (refs #462, #463, #476). */
  eventPlaybackFullscreen: boolean;
  // Desktop sidebar width in pixels (60–320, persisted across sessions)
  sidebarWidth: number;
  // TV mode: enables D-pad navigation and larger UI
  tvMode: boolean;
  // Show protocol label (MJPEG/MSE/WebRTC) on video streams
  showProtocolLabel: boolean;
  /** Serve ZoneMinder's analysis image (motion overlay, zone boxes) on live
   *  views instead of the captured frame. MJPEG streaming only: go2rtc has no
   *  command socket and zms ignores the frame type for single images. */
  showAnalysisFrames: boolean;
  // Per-monitor streaming method overrides (monitorId → 'auto' | 'mjpeg')
  // When absent, the monitor uses the profile-level streamingMethod.
  monitorStreamingOverrides: Record<string, StreamingMethod>;
  /** Monitors whose events always play through ZMS. Some cameras record in a
   *  container the app cannot play, and the reactive recovery costs a failed
   *  request and an error toast on every visit. Listing the monitor here skips
   *  the MP4 attempt entirely. App-local, not a ZoneMinder monitor field. */
  forceZmsMonitorIds: string[];
  /** Go2RTC monitors the user unmuted on a live tile. Tiles start muted so
   *  a grid does not open as a cacophony; listing a monitor here restores
   *  its last choice across remounts (refs #463). */
  unmutedMonitorIds: string[];
  /** Monitors whose detail page opens fullscreen. Set by "Open in fullscreen"
   *  in the monitor's settings dialog, and nowhere else: maximizing the page
   *  is a session change (refs #462, #463, #476). */
  fullscreenMonitorIds: string[];
  // Force-disable multi-port streaming. When true, the app ignores the server's
  // ZM_MIN_STREAMING_PORT and uses the portal's default port for all streams.
  // Default false = auto (use the server config when present).
  forceDisableMultiPort: boolean;
  // Default timeout (seconds) for REST API requests. Caps how long a request
  // can hang before it is aborted so the UI can error/retry instead of stalling
  // forever (e.g. when the connection pool is saturated). 0 disables the timeout.
  apiTimeoutSeconds: number;
  // Per-component log level overrides (component name → LogLevel)
  // When absent, the component uses the global logLevel.
  componentLogLevels: Record<string, number>;
  // Ordered fallback chain for event thumbnails. Disabled entries (and custom
  // entries with an empty customFid) are skipped at URL build time.
  thumbnailFallbackChain: ThumbnailFallbackEntry[];
  // Hover preview toggles for events/monitors/dashboard/timeline
  hoverPreview: HoverPreviewSettings;
  /**
   * Whether the scroll pad is on screen. Remembered per profile: a tablet
   * where the video owns every drag wants it on for good, and should not have
   * to ask again on each visit.
   */
  showScrollPad: boolean;
  // Playback speed for event hover/longpress preview (ZMS rate percentage).
  // Only affects EventZmsHoverPlayer; live monitor previews are real-time.
  hoverPreviewPlaybackRate: HoverPreviewPlaybackRate;
  // In-app assistant (Ask): on/off, which backend, and per-backend config.
  // The optional API key for the ollama/OpenAI-compatible backend is never
  // stored here (rule 7 settings are plaintext-persisted); it lives in
  // secureStorage under `${ASSISTANT.apiKeyStoragePrefix}${profileId}`.
  assistantEnabled: boolean;
  /** Show Ninjii in each page's toolbar, beside the view menu (refs #246). */
  assistantInToolbar: boolean;
  assistantBackend: AssistantBackend;
  assistantModelId: string;
  assistantOllamaBaseUrl: string;
  assistantOllamaModel: string;
  /** Sampling temperature. 0 is greedy and measured best; see the note beside
   *  the field in Settings and `ASSISTANT.assistantTemperature`. */
  assistantTemperature: number;
  /** How long to wait for one model reply, in seconds. Exposed because the
   *  right value is a property of the user's hardware, not of this app. */
  assistantTimeoutSec: number;
  /** How many previous question/answer exchanges the model is shown. */
  assistantHistoryTurns: number;
}

interface SettingsState {
  // Settings per profile ID
  profileSettings: Record<string, ProfileSettings>;

  // Get settings for a specific profile (with defaults)
  getProfileSettings: (profileId: string) => ProfileSettings;

  // Update settings for a specific profile
  updateProfileSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;

  // Drop a profile's whole settings bucket (the profile itself is gone)
  removeProfileSettings: (profileId: string) => void;

  // Merge a patch into a group's montage bucket
  updateMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<MontageGroupLayout>
  ) => void;

  // Merge a patch into a group's event montage bucket
  updateEventMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<EventMontageGroupLayout>
  ) => void;
}

// Compact is the default for all devices
const getDefaultDisplayMode = (): DisplayMode => {
  return 'compact';
};

const getDefaultLogLevel = (): LogLevel => (
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? LogLevel.DEBUG : LogLevel.INFO
);

export const getDefaultViewMode = (): ViewMode => 'snapshot';

export const DEFAULT_SETTINGS: ProfileSettings = {
  viewMode: getDefaultViewMode(),
  displayMode: getDefaultDisplayMode(),
  theme: 'slate',
  logLevel: getDefaultLogLevel(),
  snapshotRefreshInterval: 3,
  streamMaxFps: 10,
  streamScale: 50,
  defaultEventLimit: 100,
  monitorDetailRecentEventsCount: 20,
  monitorDetailRecentEventsHidden: [],
  dashboardRefreshInterval: 30,
  montageByGroup: {},
  eventMontageByGroup: {},
  montageIsFullscreen: false,
  montageFeedFit: 'cover',
  montageShowToolbar: true,
  eventsViewMode: 'list',
  monitorsFeedFit: 'contain',
  monitorsViewMode: 'list' as const,
  monitorsGroupByServer: false,
  eventsServerFilter: null,
  allModeNotifications: 'live',
  allModeViewMode: 'per-server',
  // Each All-mode guardrail starts at the value its consumer used to hardcode,
  // so a profile that never opens the performance section behaves exactly as
  // it did before the knobs existed (refs #337).
  allModeMaxStreams: MONTAGE_GRID.allModeMaxStreams,
  allModeMaxWatched: LIVE_ACTIVITY.allModeMaxWatched,
  allModePollFloorSeconds: LIVE_ACTIVITY.allModePollFloorSeconds,
  allModeBurstSeconds: NOTIFICATIONS_SERVICE.allModeBurstWindowMs / 1000,
  // Connection optimizations ship opt-in: the defaults below leave All mode
  // streaming exactly as it does today until a user turns one on.
  allModeStreamTuning: 'off',
  allModePauseHidden: false,
  allModeIdleMinutes: 0,
  allModeViewportGating: false,
  monitorGridCols: 2,
  monitorDetailFeedFit: 'contain',
  eventsThumbnailFit: 'contain',
  monitorDetailCycleSeconds: 0,
  monitorDetailFullscreen: false,
  insomnia: false,
  monitorDetailInsomnia: false,
  montageInsomnia: false,
  eventMontageFilters: {
    monitorIds: [],
    cause: 'all',
    startDate: '',
    endDate: '',
  },
  eventsPageFilters: {
    monitorIds: [],
    tagIds: [],
    startDateTime: '',
    endDateTime: '',
    favoritesOnly: false,
    archivedOnly: false,
    onlyDetectedObjects: false,
    activeQuickRange: null,
  },
  disableLogRedaction: false,
  lastRoute: '/monitors',
  // Auto mode: use WebRTC/MSE/HLS for Go2RTC-enabled monitors, MJPEG for others
  streamingMethod: 'auto',
  // Default: try all protocols (video-rtc runs them in parallel, first to produce video wins)
  webrtcProtocols: ['webrtc', 'mse', 'hls'],
  // STUN off by default: unused on LAN/portal and avoids the -105 console log
  webrtcUseStun: false,
  // Normal bandwidth mode by default
  bandwidthMode: 'normal',
  liveActivityPollSeconds: LIVE_ACTIVITY.defaultPollSeconds,
  liveActivityDwellSeconds: LIVE_ACTIVITY.defaultDwellSeconds,
  liveActivityMaxTiles: LIVE_ACTIVITY.defaultMaxTiles,
  liveActivityIgnoredMonitorIds: [],
  liveActivityIsFullscreen: false,
  // No group filter by default (show all monitors)
  selectedGroupId: null,
  // No monitors excluded by default
  excludedMonitorIds: [],
  // Self-signed certs disabled by default (secure default)
  allowSelfSignedCerts: false,
  // No pinned certificate by default
  trustedCertFingerprint: null,
  // Default sidebar order (empty = use hardcoded order)
  sidebarNavOrder: [],
 timelinePageFilters: {
    monitorIds: [],
    startDateTime: '',
    endDateTime: '',
    onlyDetectedObjects: false,
    causeFilter: '',
    activeQuickRange: null,
  },
  dateFormat: 'MMM d',
  timeFormat: '12h',
  customDateFormat: 'EEE, MMM d yyyy',
  customTimeFormat: 'h:mm:ss a',
  eventVideoAutoplay: true,
  eventContinuousPlay: false,
  eventPlaybackRate: DEFAULT_EVENT_PLAYBACK_RATE,
  eventPlaybackMuted: true,
  eventPlaybackFullscreen: false,
  sidebarWidth: 256,
  tvMode: false,
  showProtocolLabel: true,
  showAnalysisFrames: false,
  monitorStreamingOverrides: {},
  forceZmsMonitorIds: [],
  unmutedMonitorIds: [],
  fullscreenMonitorIds: [],
  // Auto by default: honor the server's ZM_MIN_STREAMING_PORT when present
  forceDisableMultiPort: false,
  apiTimeoutSeconds: API_REQUEST.defaultTimeoutSeconds,
  componentLogLevels: {},
  thumbnailFallbackChain: DEFAULT_THUMBNAIL_FALLBACK_CHAIN,
  hoverPreview: DEFAULT_HOVER_PREVIEW,
  showScrollPad: false,
  hoverPreviewPlaybackRate: DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE,
  assistantEnabled: false,
  // Off by default: the assistant already answers from the command palette and
  // the keyboard, and a toolbar it shares with per-page controls is the one
  // place a global tool has to earn its spot.
  assistantInToolbar: false,
  assistantBackend: 'on-device',
  assistantModelId: ASSISTANT.defaultModelId,
  // Empty, not localhost: an unset URL is resolved against the profile's own
  // ZoneMinder host at use time (see `suggestOllamaBaseUrl`). localhost is the
  // wrong guess on a phone, where it means the phone itself.
  assistantOllamaBaseUrl: '',
  assistantOllamaModel: '',
  assistantTemperature: ASSISTANT.assistantTemperature,
  assistantTimeoutSec: Math.round(ASSISTANT.requestTimeoutMs / 1000),
  assistantHistoryTurns: ASSISTANT.maxHistoryTurns,
};

/**
 * Merge a profile's stored (partial) settings over the defaults. The single
 * resolver for every consumer, reactive (`useCurrentProfile`) and imperative
 * (`getProfileSettings`) alike, so the coercions below apply everywhere.
 *
 * On-device (WebGPU/WebLLM) has no runtime on phones/tablets, so a native
 * profile must never sit on it: the chat would read 'on-device', find no
 * runtime, and report "not configured" even though Settings only exposes Ollama
 * there. moveNativeOffOnDevice() rewrites profiles that already stored
 * 'on-device'; this also covers ones that only inherit it from the default
 * merged in here. Platform.isNative is read at call time, not module load, to
 * avoid a temporal-dead-zone on the mocked Platform in tests (refs #246).
 */
export function mergeProfileSettings(raw: Partial<ProfileSettings> | undefined): ProfileSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  if (Platform.isNative && merged.assistantBackend === 'on-device') {
    merged.assistantBackend = 'ollama';
  }
  // allModeMuteToasts (boolean) -> allModeNotifications migration (refs #337).
  const legacyRaw = raw as (Partial<ProfileSettings> & { allModeMuteToasts?: boolean }) | undefined;
  if (legacyRaw && 'allModeMuteToasts' in legacyRaw && !('allModeNotifications' in legacyRaw)) {
    merged.allModeNotifications = legacyRaw.allModeMuteToasts ? 'muted' : 'live';
  } else if (!ALL_MODE_NOTIFICATIONS_VALUES.includes(merged.allModeNotifications)) {
    merged.allModeNotifications = 'live';
  }
  coerceAllModePerformance(merged, DEFAULT_SETTINGS);
  return merged;
}

/**
 * Persisted shape version. BUMP THIS whenever `ASSISTANT.retiredModelIds`
 * gains an entry: zustand only calls `migrate` when the stored version is below
 * this number, so a retirement added without a bump never reaches anyone who
 * already ran the app.
 */
export const SETTINGS_VERSION = 10;

/**
 * Migrate persisted settings:
 *  - v0 -> v1: flat montage fields to group-keyed maps.
 *  - any -> current: retired `assistantModelId` values to their replacements,
 *    and `hoverPreview` surfaces added since the profile was written.
 *
 * The steps run in sequence, not exclusively: a v0 blob gets both, which is
 * why v0->v1 no longer returns early. The model-id rewrite is idempotent and
 * runs for every version below `SETTINGS_VERSION`, so each new retirement
 * reaches stores that already migrated for an earlier one.
 */
export function migrateSettings(persistedState: unknown, version: number): unknown {
  const state = version >= 1 ? persistedState : migrateV0ToV1(persistedState);
  return moveNativeOffOnDevice(fillHoverPreviewSurfaces(normalizeRetiredModelIds(state)));
}

/** Fills `hoverPreview` keys added after a profile was last written, so a new
 *  surface starts at its default instead of reading as undefined (off).
 *
 *  Done here rather than in `mergeProfileSettings`: that runs on every read,
 *  and rebuilding the nested object there would hand a fresh identity to the
 *  `useShallow(getProfileSettings(...))` selectors (MontageMonitor.tsx), which
 *  then re-render forever. A migration writes the keys once. */
function fillHoverPreviewSurfaces(persistedState: unknown): unknown {
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  if (!state.profileSettings) return persistedState;

  const migrated: Record<string, unknown> = {};
  for (const [profileId, raw] of Object.entries(state.profileSettings)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    migrated[profileId] = s.hoverPreview
      ? { ...s, hoverPreview: { ...DEFAULT_HOVER_PREVIEW, ...(s.hoverPreview as object) } }
      : s;
  }
  return { ...state, profileSettings: migrated };
}

/** Moves a phone or tablet off the on-device backend.
 *
 *  On-device now means WebGPU, which mobile does not have; the native runtime
 *  that used to back it was removed. A profile still holding `'on-device'`
 *  there would sit on a backend with no implementation and simply never
 *  answer, and hiding the option in Settings does not fix a value already
 *  stored. Desktop and web are untouched.
 *
 *  Per device, not per profile sync: settings are local, so this asks the
 *  platform it is actually running on. */
function moveNativeOffOnDevice(persistedState: unknown): unknown {
  if (!Platform.isNative) return persistedState;
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  if (!state.profileSettings) return persistedState;

  const migrated: Record<string, unknown> = {};
  for (const [profileId, raw] of Object.entries(state.profileSettings)) {
    const settings = (raw ?? {}) as Record<string, unknown>;
    migrated[profileId] =
      settings.assistantBackend === 'on-device' ? { ...settings, assistantBackend: 'ollama' } : settings;
  }
  return { ...state, profileSettings: migrated };
}

/** Rewrites `assistantModelId` values dropped from `ASSISTANT.webllmModels`.
 *  A retired id is still a valid web-llm registry id, so leaving it would not
 *  throw: it would load an unlisted model while the settings picker, bound to
 *  the same value, matched no option and rendered blank. */
function normalizeRetiredModelIds(persistedState: unknown): unknown {
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  if (!state.profileSettings) return persistedState;

  const migrated: Record<string, unknown> = {};
  for (const [profileId, raw] of Object.entries(state.profileSettings)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const replacement =
      typeof s.assistantModelId === 'string' ? ASSISTANT.retiredModelIds[s.assistantModelId] : undefined;
    migrated[profileId] = replacement ? { ...s, assistantModelId: replacement } : s;
  }
  return { ...state, profileSettings: migrated };
}

function migrateV0ToV1(persistedState: unknown): unknown {
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  const profileSettings = state.profileSettings ?? {};
  const migrated: Record<string, unknown> = {};

  for (const [profileId, raw] of Object.entries(profileSettings)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const {
      montageLayouts,
      montageSavedLayouts,
      montageActiveLayoutName,
      montageGridCols,
      montageGridRows: _montageGridRows,
      montageHiddenMonitorIds,
      eventMontageGridCols,
      eventMontageLayouts: _eventMontageLayouts,
      ...rest
    } = s;

    const lgLayout = (montageLayouts as Layouts | undefined)?.lg ?? [];

    migrated[profileId] = {
      ...rest,
      montageByGroup: {
        [ALL_GROUPS_KEY]: {
          workingLayout: lgLayout,
          savedLayouts: (montageSavedLayouts as MontageSavedLayout[] | undefined) ?? [],
          activeLayoutName: (montageActiveLayoutName as string | null | undefined) ?? null,
          gridCols: (montageGridCols as number | undefined) ?? DEFAULT_MONTAGE_GROUP_LAYOUT.gridCols,
          hiddenMonitorIds: (montageHiddenMonitorIds as string[] | undefined) ?? [],
        },
      },
      eventMontageByGroup: {
        [ALL_GROUPS_KEY]: {
          gridCols:
            (eventMontageGridCols as number | undefined) ??
            DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols,
        },
      },
    };
  }

  return { ...state, profileSettings: migrated };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      profileSettings: {},

      getProfileSettings: (profileId) => mergeProfileSettings(get().profileSettings[profileId]),

      updateProfileSettings: (profileId, updates) => {
        set((state) => ({
          profileSettings: {
            ...state.profileSettings,
            [profileId]: {
              ...(state.profileSettings[profileId] || DEFAULT_SETTINGS),
              ...updates,
            },
          },
        }));
      },

      /**
       * Delete a profile's bucket outright, for when the profile it belongs to
       * no longer exists (deleting a virtual profile, refs #337). Not a reset:
       * writing defaults back would leave an orphaned bucket behind, which is
       * exactly what this avoids. No coercion runs here - removal has no value
       * to coerce, and getProfileSettings on a missing key already merges the
       * defaults for any later reader.
       */
      removeProfileSettings: (profileId) => {
        set((state) => {
          if (!(profileId in state.profileSettings)) return state;
          const profileSettings = { ...state.profileSettings };
          delete profileSettings[profileId];
          return { profileSettings };
        });
      },

      updateMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket = profile.montageByGroup?.[groupKey] || DEFAULT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                montageByGroup: {
                  ...profile.montageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },

      updateEventMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket =
            profile.eventMontageByGroup?.[groupKey] || DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                eventMontageByGroup: {
                  ...profile.eventMontageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },
    }),
    {
      name: STORAGE_KEYS.settingsStore,
      version: SETTINGS_VERSION,
      migrate: migrateSettings,
    }
  )
);
