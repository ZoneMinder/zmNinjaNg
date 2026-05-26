import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout, Layouts } from 'react-grid-layout';
import { LogLevel } from '../lib/log-level';
import type { BandwidthMode } from '../lib/zmninja-ng-constants';
import { AUTO_RESTART_DEFAULT_MINUTES } from '../lib/zmninja-ng-constants';
import { Platform } from '../lib/platform';

export type ViewMode = 'snapshot' | 'streaming';
export type DisplayMode = 'normal' | 'compact';
export type MonitorFeedFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type MonitorsLayoutMode = MonitorFeedFit | 'flex';
export type MonitorsViewMode = 'list' | 'grid';
export type EventsViewMode = 'list' | 'montage';
export type ThemePreference = 'amber' | 'cream' | 'dark' | 'light' | 'slate' | 'system';
export type StreamingMethod = 'auto' | 'mjpeg';
export type WebRTCProtocol = 'webrtc' | 'mse' | 'hls';
export type DateFormatPreset = 'MMM d, yyyy' | 'MMM d' | 'dd/MM/yyyy' | 'dd/MM' | 'custom';
export type TimeFormatPreset = '12h' | '24h' | 'custom';
export type ThumbnailFallbackType = 'alarm' | 'snapshot' | 'objdetect' | 'custom';

export interface ThumbnailFallbackEntry {
  type: ThumbnailFallbackType;
  enabled: boolean;
  customFid?: string;
}

export interface HoverPreviewSettings {
  eventsList: boolean;
  eventsGrid: boolean;
  monitorsList: boolean;
  monitorsGrid: boolean;
  dashboard: boolean;
  timeline: boolean;
  notifications: boolean;
}

export const DEFAULT_HOVER_PREVIEW: HoverPreviewSettings = {
  eventsList: true,
  eventsGrid: false,
  monitorsList: true,
  monitorsGrid: false,
  dashboard: true,
  timeline: true,
  notifications: true,
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

export interface ProfileSettings {
  viewMode: ViewMode;
  displayMode: DisplayMode;
  theme: ThemePreference;
  logLevel: LogLevel;
  snapshotRefreshInterval: number; // in seconds
  streamMaxFps: number; // Max FPS for live streams
  streamScale: number; // Scale percentage for live streams (1-100)
  defaultEventLimit: number; // Default number of events to fetch when no filters applied
  dashboardRefreshInterval: number; // in seconds, for dashboard widgets (events/timeline)
  montageLayouts: Layouts; // Store montage layouts per profile
  eventMontageLayouts: Layouts; // Store event montage layouts per profile
  montageGridRows: number; // Grid rows for Montage page
  montageGridCols: number; // Grid columns for Montage page
  eventMontageGridCols: number; // Grid columns for EventMontage page
  montageIsFullscreen: boolean; // Fullscreen state for Montage page
  montageFeedFit: MonitorFeedFit; // Object-fit for montage feeds
  montageShowToolbar: boolean; // Show/hide montage toolbar row
  eventsViewMode: EventsViewMode; // List vs montage view for Events page
  monitorsFeedFit: MonitorsLayoutMode; // Layout mode for monitor list
  monitorsViewMode: MonitorsViewMode; // List or grid view
  monitorGridCols: number; // Grid columns for Monitors page grid view
  monitorDetailFeedFit: MonitorFeedFit; // Object-fit for monitor detail feed
  eventsThumbnailFit: MonitorFeedFit; // Object-fit for event thumbnails
  monitorDetailCycleSeconds: number; // Auto-cycle interval for single monitor view (0 = off)
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
    onlyDetectedObjects: boolean;
    activeQuickRange: number | null;
  };
  disableLogRedaction: boolean;
  // Desktop only: periodically restart the app to release WebKit's process-level
  // memory (decoded frames, allocator high-water) that no in-process flush reclaims.
  autoRestartEnabled: boolean;
  autoRestartIntervalMinutes: number;
  lastRoute: string; // Last visited route for this profile
  // Streaming method: 'auto' tries WebRTC/MSE/HLS for Go2RTC-enabled monitors, 'mjpeg' forces MJPEG for all
  streamingMethod: StreamingMethod;
  // Whether to enable fallback from WebRTC to MSE to HLS when protocols fail
  webrtcFallbackEnabled: boolean;
  // Which protocols to try for WebRTC streaming (video-rtc runs them in parallel)
  webrtcProtocols: WebRTCProtocol[];
  // Bandwidth mode: 'normal' for default intervals, 'low' for reduced bandwidth usage
  bandwidthMode: BandwidthMode;
  // Selected group ID for filtering monitors (null = show all monitors)
  selectedGroupId: string | null;
  // Monitor IDs excluded from this profile. Excluded monitors and their events
  // are dropped at the API boundary so they behave as if they don't exist.
  excludedMonitorIds: string[];
  // Monitor IDs hidden from the Montage view only. Profile-scoped. AND-combined
  // with the group filter on the Montage page. Does not affect dashboard,
  // monitor list, or monitor detail.
  montageHiddenMonitorIds: string[];
  // Allow self-signed HTTPS certificates for this profile's server
  allowSelfSignedCerts: boolean;
  // SHA-256 fingerprint of the trusted TLS certificate (TOFU pinning)
  trustedCertFingerprint: string | null;
  // Custom sidebar nav order (array of route paths). Empty = default order.
  sidebarNavOrder: string[];
  // Named saved montage layouts
  montageSavedLayouts: Array<{ name: string; layout: Layout[]; displayCols: number }>;
  // Name of the currently active saved layout (null = using a preset column count)
  montageActiveLayoutName: string | null;
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
  // Desktop sidebar width in pixels (60–320, persisted across sessions)
  sidebarWidth: number;
  // TV mode — enables D-pad navigation and larger UI
  tvMode: boolean;
  // Show protocol label (MJPEG/MSE/WebRTC) on video streams
  showProtocolLabel: boolean;
  // Per-monitor streaming method overrides (monitorId → 'auto' | 'mjpeg')
  // When absent, the monitor uses the profile-level streamingMethod.
  monitorStreamingOverrides: Record<string, StreamingMethod>;
  // Per-component log level overrides (component name → LogLevel)
  // When absent, the component uses the global logLevel.
  componentLogLevels: Record<string, number>;
  // Ordered fallback chain for event thumbnails. Disabled entries (and custom
  // entries with an empty customFid) are skipped at URL build time.
  thumbnailFallbackChain: ThumbnailFallbackEntry[];
  // Hover preview toggles for events/monitors/dashboard/timeline
  hoverPreview: HoverPreviewSettings;
  // Playback speed for event hover/longpress preview (ZMS rate percentage).
  // Only affects EventZmsHoverPlayer; live monitor previews are real-time.
  hoverPreviewPlaybackRate: HoverPreviewPlaybackRate;
}

interface SettingsState {
  // Settings per profile ID
  profileSettings: Record<string, ProfileSettings>;

  // Get settings for a specific profile (with defaults)
  getProfileSettings: (profileId: string) => ProfileSettings;

  // Update settings for a specific profile
  updateProfileSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;

  // Save montage layout for current profile
  saveMontageLayout: (profileId: string, layout: Layouts) => void;

  // Save event montage layout for current profile
  saveEventMontageLayout: (profileId: string, layout: Layouts) => void;
}

// Compact is the default for all devices
const getDefaultDisplayMode = (): DisplayMode => {
  return 'compact';
};

const getDefaultLogLevel = (): LogLevel => (
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? LogLevel.DEBUG : LogLevel.INFO
);

export const getDefaultViewMode = (): ViewMode =>
  (Platform.isTauri || Platform.isElectron) ? 'streaming' : 'snapshot';

export const DEFAULT_SETTINGS: ProfileSettings = {
  viewMode: getDefaultViewMode(),
  displayMode: getDefaultDisplayMode(),
  theme: 'slate',
  logLevel: getDefaultLogLevel(),
  snapshotRefreshInterval: 3,
  streamMaxFps: 10,
  streamScale: 50,
  defaultEventLimit: 100,
  dashboardRefreshInterval: 30,
  montageLayouts: {},
  eventMontageLayouts: {},
  montageGridRows: 2,
  montageGridCols: 2,
  eventMontageGridCols: 2,
  montageIsFullscreen: false,
  montageFeedFit: 'cover',
  montageShowToolbar: true,
  eventsViewMode: 'list',
  monitorsFeedFit: 'contain',
  monitorsViewMode: 'list' as const,
  monitorGridCols: 2,
  monitorDetailFeedFit: 'contain',
  eventsThumbnailFit: 'contain',
  monitorDetailCycleSeconds: 0,
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
    onlyDetectedObjects: false,
    activeQuickRange: null,
  },
  disableLogRedaction: false,
  autoRestartEnabled: true,
  autoRestartIntervalMinutes: AUTO_RESTART_DEFAULT_MINUTES,
  lastRoute: '/monitors',
  // Auto mode: use WebRTC/MSE/HLS for Go2RTC-enabled monitors, MJPEG for others
  streamingMethod: 'auto',
  // Enable fallback through protocols when one fails
  webrtcFallbackEnabled: true,
  // Default: try all protocols (video-rtc runs them in parallel, first to produce video wins)
  webrtcProtocols: ['webrtc', 'mse', 'hls'],
  // Normal bandwidth mode by default
  bandwidthMode: 'normal',
  // No group filter by default (show all monitors)
  selectedGroupId: null,
  // No monitors excluded by default
  excludedMonitorIds: [],
  montageHiddenMonitorIds: [],
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
  montageSavedLayouts: [],
  montageActiveLayoutName: null,
  sidebarWidth: 256,
  tvMode: false,
  showProtocolLabel: true,
  monitorStreamingOverrides: {},
  componentLogLevels: {},
  thumbnailFallbackChain: DEFAULT_THUMBNAIL_FALLBACK_CHAIN,
  hoverPreview: DEFAULT_HOVER_PREVIEW,
  hoverPreviewPlaybackRate: DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      profileSettings: {},

      getProfileSettings: (profileId) => {
        const settings = get().profileSettings[profileId];
        return { ...DEFAULT_SETTINGS, ...settings };
      },

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

      saveMontageLayout: (profileId, layout) => {
        get().updateProfileSettings(profileId, { montageLayouts: layout });
      },

      saveEventMontageLayout: (profileId, layout) => {
        get().updateProfileSettings(profileId, { eventMontageLayouts: layout });
      },
    }),
    {
      name: 'zmng-settings',
    }
  )
);
