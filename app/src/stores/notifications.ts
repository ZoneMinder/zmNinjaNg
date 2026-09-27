import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getNotificationService,
  resetNotificationService,
  resetAllNotificationServices,
} from '../services/notifications';
import { getEventPoller, stopAllEventPollers, type EventPollerDeps } from '../services/eventPoller';
import {
  type ZMEventServerConfig,
  type ZMNotificationProviders,
  type ZMAlarmEvent,
  type ConnectionState,
  type NotificationSettings,
  type MonitorNotificationConfig,
  type NotificationSource,
} from '../types/notifications';
import { log, LogLevel } from '../lib/logger';
import { Platform } from '../lib/platform';
import { getAppVersion } from '../lib/version';
import { getEventImageUrl } from '../lib/zm/url-builder';
import { getEffectiveMinStreamingPort } from '../lib/monitor/multiport';
import { updateNotification } from '../api/notifications';
import { getSession } from '../services/sessions';
import { useProfileStore } from './profile';
import { useAuthStore, getAuthSlice } from './auth';
import { useSettingsStore } from './settings';
import { asProfileId, ALL_PROFILES_ID, isVirtualProfileId } from '../api/types';
import { setPushServiceStoreGates } from '../services/pushNotifications';
import { getBandwidthSettings, NOTIFICATIONS_SERVICE, STORAGE_KEYS, type BandwidthMode } from '../lib/zmninja-ng-constants';

// The settings shapes live in types/notifications.ts so a service can describe
// them without importing this store, which would close a cycle (refs #281).
// Re-exported here for the components that already import them from the store.
export type { NotificationSettings, MonitorNotificationConfig, NotificationSource };

export interface NotificationEvent extends ZMAlarmEvent {
  receivedAt: number; // Timestamp when received
  read: boolean; // Whether user has seen it
  source: NotificationSource; // How the event was delivered
}

interface NotificationState {
  // Settings per profile ID
  profileSettings: Record<string, NotificationSettings>;

  // Per-profile connection state (runtime only, not persisted). Every
  // enabled profile can hold its own live ES connection in All mode
  // (refs #337), so this is keyed by profile id instead of one flag.
  connections: Record<string, ConnectionState>;
  // Anchor profile for mobile push/badge bookkeeping (FCM token
  // registration is device-wide, not per-connection - see
  // registerPushToken/deregisterPushToken and _registerWithServer in
  // services/pushNotifications.ts). NOT a substitute for `connections`:
  // never read this to decide whether a *specific* profile is connected.
  currentProfileId: string | null;

  // Events per profile ID
  profileEvents: Record<string, NotificationEvent[]>;

  // Internal runtime state (not persisted), keyed by profile id so
  // disconnecting one profile's listeners never touches another's.
  _cleanupFunctions: Record<string, (() => void)[]>;

  // Actions - Settings
  getProfileSettings: (profileId: string) => NotificationSettings;
  updateProfileSettings: (profileId: string, updates: Partial<NotificationSettings>) => void;
  setMonitorFilter: (profileId: string, monitorId: number, enabled: boolean, checkInterval?: number) => void;
  removeMonitorFilter: (profileId: string, monitorId: number) => void;

  // Actions - Connection
  connect: (profileId: string, username: string, password: string, portalUrl: string) => Promise<void>;
  disconnect: (profileId: string) => void;
  /** Disconnect every profile that currently holds a connection, and stop
   *  every direct-mode poller (which isn't tracked in `connections`). Used
   *  on full logout (refs #337 I5). */
  disconnectAll: () => void;
  /** @param force - reconnect even while the service still reports connected */
  reconnect: (profileId: string, force?: boolean) => Promise<void>;

  // Actions - Events
  addEvent: (profileId: string, event: ZMAlarmEvent, source?: NotificationSource) => void;
  markEventRead: (profileId: string, eventId: number) => void;
  markAllRead: (profileId: string) => void;
  clearEvents: (profileId: string) => void;
  getUnreadCount: (profileId: string) => number;
  getEvents: (profileId: string) => NotificationEvent[];

  // Actions - Push (Mobile)
  registerPushToken: (token: string, platform: 'ios' | 'android') => Promise<void>;
  deregisterPushToken: (token: string, platform: 'ios' | 'android') => Promise<void>;

  // Internal
  _initialize: (profileId: string) => void;
  _cleanup: (profileId: string) => void;
  _syncMonitorFilters: (profileId: string) => Promise<void>;
  _updateBadge: (profileId: string, count?: number) => Promise<void>;
  _clearNativeBadge: () => void;
  _registerPushTokenIfAvailable: () => Promise<void>;
}

/** Whether a profile's badge/filter sync should run: it's the mobile push
 *  anchor profile, or it holds a live ES connection. Preserves the exact
 *  pre-#337 behaviour (native direct mode syncs via the anchor; ES mode
 *  syncs via the connection) while adding independent per-profile ES sync
 *  for All-mode fan-out. */
function _isProfileActive(state: Pick<NotificationState, 'currentProfileId' | 'connections'>, profileId: string): boolean {
  return state.currentProfileId === profileId || state.connections[profileId] === 'connected';
}

/** Whether the app's current scope still owns `profileId`'s connection: it IS
 *  that profile, or it is a virtual profile listing it as a member. Anything
 *  else means no connector is left behind the socket. The All Servers clause
 *  is legacy: the sentinel is retired and migrated away on rehydrate, so it
 *  can only be current for the frames before that runs - dropping the clause
 *  would tear down live connections in those frames. Refs #337. */
function _aggregateOwnsConnection(appCurrentProfileId: string, profileId: string): boolean {
  if (appCurrentProfileId === profileId || appCurrentProfileId === ALL_PROFILES_ID) return true;
  if (!isVirtualProfileId(appCurrentProfileId)) return false;
  const group = (useProfileStore.getState().virtualProfiles ?? []).find(
    (v) => v.id === appCurrentProfileId
  );
  return !!group?.memberProfileIds.includes(asProfileId(profileId));
}

/**
 * Helper for state updaters that modify a profile's event list and badge count.
 *
 * Reads the current events for `profileId`, applies `updater` to produce the
 * new list, recalculates `unreadCount`, and returns the merged state slice for
 * both `profileEvents` and `profileSettings`.
 */
function _updateProfileEvents(
  state: Pick<NotificationState, 'profileEvents' | 'profileSettings'>,
  profileId: string,
  updater: (current: NotificationEvent[]) => NotificationEvent[]
): Pick<NotificationState, 'profileEvents' | 'profileSettings'> {
  const currentEvents = state.profileEvents[profileId] || [];
  const events = updater(currentEvents);
  const unreadCount = events.filter((e) => !e.read).length;
  const profileSettings = state.profileSettings[profileId] || DEFAULT_SETTINGS;
  return {
    profileEvents: {
      ...state.profileEvents,
      [profileId]: events,
    },
    profileSettings: {
      ...state.profileSettings,
      [profileId]: {
        ...profileSettings,
        badgeCount: unreadCount,
      },
    },
  };
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  notificationMode: 'es',
  notificationId: null,
  notificationToken: null,
  host: '',
  port: NOTIFICATIONS_SERVICE.defaultPort,
  ssl: true,
  allMonitors: true,
  monitorFilters: [],
  onlyDetectedEvents: false,
  pollingInterval: 30,
  showToasts: true,
  playSound: false,
  badgeCount: 0,
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      // Initial state
      profileSettings: {},
      connections: {},
      currentProfileId: null,
      profileEvents: {},
      _cleanupFunctions: {},

      // ========== Settings Actions ==========

      getProfileSettings: (profileId) => {
        const settings = get().profileSettings[profileId];
        return { ...DEFAULT_SETTINGS, ...settings };
      },

      updateProfileSettings: (profileId, updates) => {
        log.notifications('Updating notification settings', LogLevel.INFO, { profileId, updates });

        set((state) => ({
          profileSettings: {
            ...state.profileSettings,
            [profileId]: {
              ...(state.profileSettings[profileId] || DEFAULT_SETTINGS),
              ...updates,
            },
          },
        }));

        // If enabled state changed to false, disconnect this profile.
        // disconnect() is a no-op for a profile with no active connection.
        if ('enabled' in updates && !updates.enabled) {
          get().disconnect(profileId);
        }

        // If monitor filters changed and this profile is ES-connected, update server
        if ('monitorFilters' in updates && get().connections[profileId] === 'connected') {
          get()._syncMonitorFilters(profileId);
        }
      },

      setMonitorFilter: (profileId, monitorId, enabled, checkInterval = 60) => {
        log.notifications('Setting monitor filter', LogLevel.INFO, { profileId,
          monitorId,
          enabled,
          checkInterval, });

        set((state) => {
          const profileSettings = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const existing = profileSettings.monitorFilters.find((f) => f.monitorId === monitorId);
          const filters = existing
            ? profileSettings.monitorFilters.map((f) =>
              f.monitorId === monitorId ? { ...f, enabled, checkInterval } : f
            )
            : [
              ...profileSettings.monitorFilters,
              { monitorId, enabled, checkInterval },
            ];

          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profileSettings,
                monitorFilters: filters,
              },
            },
          };
        });

        // Update server if this profile is ES-connected
        if (get().connections[profileId] === 'connected') {
          get()._syncMonitorFilters(profileId);
        }
      },

      removeMonitorFilter: (profileId, monitorId) => {
        log.notifications('Removing monitor filter', LogLevel.INFO, { profileId, monitorId });

        set((state) => {
          const profileSettings = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profileSettings,
                monitorFilters: profileSettings.monitorFilters.filter(
                  (f) => f.monitorId !== monitorId
                ),
              },
            },
          };
        });

        // Update server if this profile is ES-connected
        if (get().connections[profileId] === 'connected') {
          get()._syncMonitorFilters(profileId);
        }
      },

      // ========== Connection Actions ==========

      connect: async (profileId: string, username: string, password: string, portalUrl: string) => {
        const settings = get().getProfileSettings(profileId);

        if (!settings.enabled) {
          log.notifications('Notifications not enabled for this profile', LogLevel.WARN, { profileId });
          return;
        }

        if (!settings.host) {
          log.notifications('No notification server host configured', LogLevel.WARN, { profileId });
          return;
        }

        log.notifications('Connecting to notification server', LogLevel.INFO, { profileId,
          host: settings.host,
          port: settings.port,
          ssl: settings.ssl, });

        const config: ZMEventServerConfig = {
          host: settings.host,
          port: settings.port,
          ssl: settings.ssl,
          username,
          password,
          appVersion: getAppVersion(),
        };

        // Every enabled profile gets its own service instance (refs #337),
        // so connecting profile A never touches profile B's connection.
        const service = getNotificationService(profileId);

        // Setup this profile's listeners before connecting
        get()._initialize(profileId);

        try {
          await service.connect(config, _buildServiceProviders(profileId, portalUrl));

          const appCurrentProfileId = useProfileStore.getState().currentProfileId;

          // The user switched away while this connect() was in flight: the
          // switch-teardown effect already ran and found this profile not yet
          // connected (it wasn't - the handshake was still in progress), so
          // nothing will ever disconnect it. Do it here instead of leaking a
          // fully connected, anchor-less websocket (refs #337 round 2 minor
          // #2).
          //
          // The question is whether anything in the NEW scope still owns this
          // connection. A real profile owns only its own. All Servers spans
          // every enabled profile, so it owns them all. A virtual profile
          // owns exactly its members - for a non-member (or a group id with
          // no group behind it) nothing owns the socket, and exempting every
          // aggregate id unconditionally would leave it streaming events for
          // the rest of the session. null is not a switch-away at all (no
          // app-level current profile yet), so there is nothing to tear down.
          if (appCurrentProfileId && !_aggregateOwnsConnection(appCurrentProfileId, profileId)) {
            log.notifications('Profile switched away while connecting - disconnecting the now-ownerless socket', LogLevel.INFO, {
              profileId,
              appCurrentProfileId,
            });
            get().disconnect(profileId);
            return;
          }

          // Anchor push/badge bookkeeping only when this IS the app's real
          // current profile (single mode). Under an aggregate the app's
          // currentProfileId is a sentinel or group id, which never
          // equals any real profileId, so no connector's connect() call here
          // ever races to overwrite the anchor with "whichever profile
          // connected last" - it simply keeps whatever it was before All
          // mode was entered (refs #337 I4). Push registration isn't a thing
          // in All mode on web anyway (no FCM there), so that pre-All value
          // is never actually read for push purposes while aggregating.
          if (appCurrentProfileId === profileId) {
            set({ currentProfileId: profileId });
          }

          // Sync monitor filters after connection
          get()._syncMonitorFilters(profileId);

          log.notifications('Successfully connected to notification server', LogLevel.INFO, { profileId, });

          // Register push token if on mobile and token is available
          get()._registerPushTokenIfAvailable();

          // Sync badge count with server after connect
          get()._updateBadge(profileId);
        } catch (error) {
          log.notifications('Failed to connect to notification server', LogLevel.ERROR, { profileId, error });
          throw error;
        }
      },

      disconnect: (profileId: string) => {
        log.notifications('Disconnecting from notification server', LogLevel.INFO, { profileId });

        get()._cleanup(profileId);
        resetNotificationService(profileId);

        set((state) => ({
          connections: { ...state.connections, [profileId]: 'disconnected' },
          currentProfileId: state.currentProfileId === profileId ? null : state.currentProfileId,
        }));
      },

      disconnectAll: () => {
        // Per-profile disconnect() first: cleans up this store's own state
        // (listener unsubscribes, connections map, anchor) for every profile
        // it knows about.
        Object.keys(get().connections).forEach((profileId) => get().disconnect(profileId));
        // Then sweep the service registry directly: a service can exist
        // there without ever appearing in `connections` (e.g. a lazily
        // created instance from a checkAlive() call that never went through
        // connect()/_initialize), and `connections` alone would miss it
        // (refs #337 round 2 minor #3).
        resetAllNotificationServices();
        // Direct-mode pollers aren't tracked in `connections` either, so
        // sweep them separately.
        stopAllEventPollers();
      },

      reconnect: async (profileId: string, force = false) => {
        log.notifications('Triggering reconnect', LogLevel.INFO, { profileId, force });
        const service = getNotificationService(profileId);
        service.reconnectNow(force);
      },

      // ========== Event Actions ==========

      getEvents: (profileId) => {
        return get().profileEvents[profileId] || [];
      },

      getUnreadCount: (profileId) => {
        const events = get().profileEvents[profileId] || [];
        return events.filter((e) => !e.read).length;
      },

      /**
       * Add notification event to history
       * Events can come from WebSocket (when connected) or FCM push notifications
       * Duplicate prevention: if an event with the same ID already exists, it will be replaced
       */
      addEvent: (profileId: string, event: ZMAlarmEvent, source: NotificationSource = 'websocket') => {
        log.notifications('Adding notification event', LogLevel.INFO, { profileId,
          monitor: event.MonitorName,
          eventId: event.EventId,
          source, });

        const notificationEvent: NotificationEvent = {
          ...event,
          receivedAt: Date.now(),
          read: false,
          source,
        };

        set((state) =>
          _updateProfileEvents(state, profileId, (current) => {
            // Remove any existing event with the same ID to avoid duplicates.
            // This prevents duplicate entries when receiving the same event from both WebSocket and FCM.
            // EventId 0 means "no ZM event" (issue #242): those are distinct
            // notifications, not duplicates, so never collapse them together.
            const otherEvents = event.EventId > 0
              ? current.filter((e) => e.EventId !== event.EventId)
              : current;
            return [notificationEvent, ...otherEvents].slice(0, NOTIFICATIONS_SERVICE.maxEvents);
          })
        );

        // Sync badge count with server so future push notifications use the correct number
        if (_isProfileActive(get(), profileId)) {
          get()._updateBadge(profileId);
        }
      },

      markEventRead: (profileId: string, eventId: number) => {
        set((state) =>
          _updateProfileEvents(state, profileId, (current) =>
            current.map((e) => (e.EventId === eventId ? { ...e, read: true } : e))
          )
        );

        // Update badge on server if this profile is active
        if (_isProfileActive(get(), profileId)) {
          get()._updateBadge(profileId);
        }
      },

      _clearNativeBadge: () => {
        // Clear native badge and delivered notifications on mobile
        if (!Platform.isNative) return;
        import('@capacitor-firebase/messaging').then(({ FirebaseMessaging }) => {
          FirebaseMessaging.removeAllDeliveredNotifications();
        }).catch((error) => {
          // Non-blocking: stale delivered notifications stay in the tray
          log.notifications('Failed to clear delivered notifications', LogLevel.WARN, error);
        });
      },

      markAllRead: (profileId: string) => {
        set((state) =>
          _updateProfileEvents(state, profileId, (current) =>
            current.map((e) => ({ ...e, read: true }))
          )
        );

        get()._clearNativeBadge();

        // Update badge on server if this profile is active
        if (_isProfileActive(get(), profileId)) {
          get()._updateBadge(profileId);
        }
      },

      clearEvents: (profileId: string) => {
        log.notifications('Clearing all notification events', LogLevel.INFO, { profileId });

        set((state) =>
          _updateProfileEvents(state, profileId, () => [])
        );

        get()._clearNativeBadge();

        // Update badge on server if this profile is active
        if (_isProfileActive(get(), profileId)) {
          get()._updateBadge(profileId);
        }
      },

      // ========== Push Token Actions ==========

      registerPushToken: async (token: string, platform: 'ios' | 'android') => {
        const { currentProfileId, connections } = get();
        const isConnected = !!currentProfileId && connections[currentProfileId] === 'connected';

        if (!isConnected || !currentProfileId) {
          log.notifications('Cannot register push token - not connected', LogLevel.WARN);
          return;
        }

        log.notifications('Registering push token', LogLevel.INFO, { platform, profileId: currentProfileId });

        const service = getNotificationService(currentProfileId);
        const settings = get().getProfileSettings(currentProfileId);
        const { monitorFilters } = settings;

        const enabledFilters = monitorFilters.filter((f) => f.enabled);
        const monitorIds = enabledFilters.map((f) => f.monitorId);
        const intervals = enabledFilters.map((f) => f.checkInterval);

        const profile = useProfileStore.getState().profiles.find(p => p.id === currentProfileId);
        await service.registerPushToken(token, platform, monitorIds, intervals, profile?.name);
      },

      deregisterPushToken: async (token: string, platform: 'ios' | 'android') => {
        const { currentProfileId, connections } = get();
        const isConnected = !!currentProfileId && connections[currentProfileId] === 'connected';

        if (!isConnected || !currentProfileId) {
          log.notifications('Cannot deregister push token - not connected', LogLevel.WARN);
          return;
        }

        log.notifications('Deregistering push token', LogLevel.INFO, { platform, profileId: currentProfileId });

        const service = getNotificationService(currentProfileId);
        const profile = useProfileStore.getState().profiles.find(p => p.id === currentProfileId);
        await service.deregisterPushToken(token, platform, profile?.name);
      },

      // ========== Internal Methods ==========

      _initialize: (profileId: string) => {
        // Drop any stale listeners from a previous _initialize(profileId)
        // that was never matched by a _cleanup - otherwise the service's
        // onEvent/onStateChange Sets (services/notifications.ts) accumulate
        // duplicate callbacks and every event/state change fires twice
        // (refs #337 #10).
        get()._cleanup(profileId);

        const service = getNotificationService(profileId);

        // Listen for connection state changes - scoped to this profile only
        const unsubscribeState = service.onStateChange((state) => {
          log.notifications('Connection state changed', LogLevel.INFO, { profileId, state });
          set((s) => ({ connections: { ...s.connections, [profileId]: state } }));
        });

        // Listen for alarm events. Each connection's callback binds its OWN
        // profileId - never read a shared "current" profile here, or an
        // event from profile B's socket could land in profile A's history
        // once more than one profile is connected at once (refs #337).
        const unsubscribeEvents = service.onEvent((event) => {
          get().addEvent(profileId, event);
          // Toast display and sound playback are handled by NotificationHandler,
          // which reacts to the added event and reads showToasts/playSound itself.
        });

        // Store cleanup functions per profile instead of window object
        set((s) => ({
          _cleanupFunctions: {
            ...s._cleanupFunctions,
            [profileId]: [unsubscribeState, unsubscribeEvents],
          },
        }));
      },

      _cleanup: (profileId: string) => {
        const fns = get()._cleanupFunctions[profileId];
        if (fns && fns.length > 0) {
          fns.forEach((fn) => fn());
          set((s) => {
            const _cleanupFunctions = { ...s._cleanupFunctions };
            delete _cleanupFunctions[profileId];
            return { _cleanupFunctions };
          });
        }
      },

      _syncMonitorFilters: async (profileId: string) => {
        const settings = get().getProfileSettings(profileId);
        const { monitorFilters } = settings;
        const enabledFilters = monitorFilters.filter((f) => f.enabled);

        if (settings.notificationMode === 'direct') {
          // Direct mode: sync via ZM REST API
          const notifId = settings.notificationId;
          if (!notifId) {
            log.notifications('Cannot sync filters in direct mode - no notification ID', LogLevel.WARN);
            return;
          }

          const monitorList = settings.allMonitors ? '' : enabledFilters.map(f => f.monitorId).join(',');
          const interval = settings.allMonitors ? 0 : Math.max(0, ...enabledFilters.map(f => f.checkInterval));

          log.notifications('Syncing monitor filters via ZM API', LogLevel.INFO, {
            profileId,
            notificationId: notifId,
            monitorList: monitorList || '(all)',
            interval,
          });

          try {
            await updateNotification(getSession(asProfileId(profileId)).client, notifId, {
              monitorList: monitorList || undefined,
              interval,
            });
          } catch (error) {
            // Non-blocking: the next settings change retries the sync
            log.notifications('Failed to sync monitor filters via ZM API', LogLevel.WARN, { profileId, error });
          }
        } else {
          // ES mode: sync via websocket
          // When allMonitors is on, don't send a filter: ES treats empty monlist as "all monitors"
          if (settings.allMonitors) {
            log.notifications('All monitors enabled, skipping filter sync', LogLevel.INFO, { profileId });
            return;
          }

          if (enabledFilters.length === 0) {
            log.notifications('No enabled monitor filters to sync', LogLevel.INFO, { profileId });
            return;
          }

          const monitorIds = enabledFilters.map((f) => f.monitorId);
          const intervals = enabledFilters.map((f) => f.checkInterval);

          log.notifications('Syncing monitor filters with server', LogLevel.INFO, { profileId,
            monitors: monitorIds,
            intervals, });

          try {
            const service = getNotificationService(profileId);
            await service.setMonitorFilter(monitorIds, intervals);
          } catch (error) {
            // Non-blocking: the next settings change retries the sync
            log.notifications('Failed to sync monitor filters', LogLevel.WARN, { profileId, error });
          }
        }
      },

      _updateBadge: async (profileId: string, count?: number) => {
        const settings = get().getProfileSettings(profileId);
        const badgeCount = count ?? settings.badgeCount;

        // Set the iOS/Android app icon badge locally
        if (Platform.isNative) {
          try {
            const { Badge } = await import('@capawesome/capacitor-badge');
            await Badge.set({ count: badgeCount });
            log.notifications('Set native app badge', LogLevel.DEBUG, { badgeCount });
          } catch {
            // Badge plugin not available: non-fatal
          }
        }

        try {
          if (settings.notificationMode === 'direct') {
            // Direct mode: update badge count via ZM REST API
            const notifId = settings.notificationId;
            if (notifId) {
              await updateNotification(getSession(asProfileId(profileId)).client, notifId, { badgeCount });
              log.notifications('Updated badge count via ZM API', LogLevel.DEBUG, { badgeCount, notifId });
            } else {
              log.notifications('Cannot update badge - no notification ID (token not registered)', LogLevel.WARN);
            }
          } else {
            // ES mode: update badge count via WebSocket
            const service = getNotificationService(profileId);
            await service.updateBadgeCount(badgeCount);
          }
        } catch (error) {
          // Non-blocking: the badge resyncs on the next event or read action
          log.notifications('Failed to update badge count', LogLevel.WARN, { profileId, error });
        }
      },

      _registerPushTokenIfAvailable: async () => {
        // Only runs on mobile platforms
        if (typeof window === 'undefined') {
          return;
        }

        if (!Platform.isNative) {
          return;
        }

        try {
          const { getPushService } = await import('../services/pushNotifications');
          const pushService = getPushService();

          if (pushService.isReady()) {
            log.notifications('Registering FCM token after connection', LogLevel.INFO);
            await pushService.registerTokenWithServer();
          } else {
            log.notifications('FCM token not yet available - will register when received', LogLevel.INFO);
          }
        } catch (error) {
          log.notifications('Failed to register push token', LogLevel.ERROR, error);
        }
      },
    }),
    {
      name: STORAGE_KEYS.notificationsStore,
      // Only persist settings and events, not connection state
      partialize: (state) => ({
        profileSettings: state.profileSettings,
        profileEvents: state.profileEvents,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const profileCount = Object.keys(state.profileSettings || {}).length;
          const eventCounts = Object.entries(state.profileEvents || {}).map(
            ([id, events]) => `${id}: ${events.length}`
          );
          log.notifications('Notification store rehydrated', LogLevel.INFO, { profileCount,
            eventCounts, });
        }
      },
    }
  )
);

// ========== Service Wiring ==========
//
// The notification services (websocket, event poller) have no zustand
// imports. The store assembles their store-derived dependencies here and
// injects them at connect/start time.

/** Bandwidth mode is selection-scoped: every connection follows the current
 *  selection's choice, not the bucket of the profile it serves (refs #536). */
function selectionBandwidthMode(): BandwidthMode {
  const currentProfileId = useProfileStore.getState().currentProfileId ?? '';
  return useSettingsStore.getState().getProfileSettings(currentProfileId).bandwidthMode;
}

/**
 * Build the providers injected into ZMNotificationService.connect.
 */
function _buildServiceProviders(profileId: string, portalUrl: string): ZMNotificationProviders {
  return {
    getFreshAccessToken: () => useAuthStore.getState().getFreshAccessToken(asProfileId(profileId)),
    buildEventImageUrl: (eventId, token) =>
      getEventImageUrl(portalUrl, String(eventId), 'snapshot', {
        token: token ?? undefined,
        width: NOTIFICATIONS_SERVICE.snapshotImageWidth,
      }),
    getKeepaliveIntervalMs: () => getBandwidthSettings(selectionBandwidthMode()).wsKeepaliveInterval,
  };
}

/**
 * Poll cadence for direct mode. The user's per-profile `pollingInterval`
 * (Notification settings) is their explicit choice and wins, but low-bandwidth
 * mode floors it so the mode can never be made faster than its own interval
 * (rule 8). A missing or nonsensical stored value falls back to the bandwidth
 * default rather than polling in a tight loop. `floorKey` names which
 * bandwidth interval acts as the floor, because bandwidth mode stays
 * authoritative regardless of which feature is polling.
 */
export function resolvePollIntervalMs(
  bandwidthMode: BandwidthMode,
  pollingIntervalSeconds: number | undefined,
  floorKey: 'eventPollerInterval' | 'alarmStatusInterval' = 'eventPollerInterval'
): number {
  const bandwidthMs = getBandwidthSettings(bandwidthMode)[floorKey];
  const userMs = (pollingIntervalSeconds ?? 0) * 1000;
  if (!Number.isFinite(userMs) || userMs <= 0) return bandwidthMs;
  return bandwidthMode === 'low' ? Math.max(userMs, bandwidthMs) : userMs;
}

/**
 * Start the direct-mode event poller for a profile, wiring its
 * store-derived dependencies. Stop/isRunning stay on getEventPoller().
 */
export function startEventPoller(profileId: string): Promise<void> {
  const deps: EventPollerDeps = {
    onEvent: (event) => useNotificationStore.getState().addEvent(profileId, event, 'poll'),
    getOnlyDetectedEvents: () =>
      useNotificationStore.getState().getProfileSettings(profileId).onlyDetectedEvents,
    getFreshAccessToken: () => useAuthStore.getState().getFreshAccessToken(asProfileId(profileId)),
    getPollIntervalMs: () => {
      const { pollingInterval } = useNotificationStore.getState().getProfileSettings(profileId);
      return resolvePollIntervalMs(selectionBandwidthMode(), pollingInterval);
    },
    getPortalUrl: () => {
      // This profile's own portal, not the app's currently-viewed profile:
      // in All mode a poller can run for a profile other than the picked
      // one (refs #337).
      const { profiles } = useProfileStore.getState();
      return profiles.find((p) => p.id === profileId)?.portalUrl;
    },
    getMinStreamingPort: () => getEffectiveMinStreamingPort(profileId),
  };
  return getEventPoller(profileId).start(profileId, deps);
}

// services/pushNotifications.ts has no zustand imports; this store assembles
// its store-derived dependencies from all three stores it already has access
// to and registers them here at module load, breaking the services -> stores
// static import cycle. Refs #217.
setPushServiceStoreGates({
  notifications: {
    getCurrentProfileId: () => useNotificationStore.getState().currentProfileId,
    getProfileSettings: (profileId) => useNotificationStore.getState().getProfileSettings(profileId),
    isConnected: () => {
      const { currentProfileId, connections } = useNotificationStore.getState();
      return !!currentProfileId && connections[currentProfileId] === 'connected';
    },
    updateProfileSettings: (profileId, updates) =>
      useNotificationStore.getState().updateProfileSettings(profileId, updates),
    deregisterPushToken: (token, platform) =>
      useNotificationStore.getState().deregisterPushToken(token, platform),
    registerPushToken: (token, platform) =>
      useNotificationStore.getState().registerPushToken(token, platform),
    addEvent: (profileId, event, source) => useNotificationStore.getState().addEvent(profileId, event, source),
    markEventRead: (profileId, eventId) => useNotificationStore.getState().markEventRead(profileId, eventId),
  },
  profile: {
    getProfiles: () => useProfileStore.getState().profiles,
    getDecryptedPassword: (profileId) => useProfileStore.getState().getDecryptedPassword(profileId),
    getCurrentProfileId: () => useProfileStore.getState().currentProfileId,
  },
  auth: {
    getAccessToken: () => getAuthSlice(useProfileStore.getState().currentProfileId).accessToken,
  },
});
