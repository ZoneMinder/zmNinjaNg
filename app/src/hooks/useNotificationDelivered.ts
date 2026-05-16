/**
 * useNotificationDelivered Hook
 *
 * Processes delivered (unread) push notifications on mobile platforms.
 * Handles two scenarios:
 * - Cold start: reads delivered notifications when the profile first loads
 * - App resume: reads notifications that arrived while the app was backgrounded,
 *   clears native badges, and syncs badge count with the server
 */

import { useEffect } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { resolveProfileForNotification } from '../lib/notification-profile';
import type { Profile } from '../api/types';

interface DeliveredParams {
  currentProfile: Profile | null;
}

/**
 * Parse a single delivered notification and add it to the notification store.
 */
function ingestDeliveredNotification(
  notif: { data?: unknown; title?: string | null; body?: string | null },
  profileId: string,
  store: ReturnType<typeof useNotificationStore.getState>,
  profiles: Profile[],
): void {
  const data = notif.data as Record<string, string> | undefined;
  const mid = data?.mid || data?.MonitorId;
  const eid = data?.eid || data?.EventId;

  // Resolve which profile this notification belongs to
  const resolved = resolveProfileForNotification(data?.profile, profileId);
  const eventProfileId: string = resolved.targetProfileId || profileId;
  const profile = profiles.find(p => p.id === eventProfileId);

  // Only construct image URL for current profile's notifications
  let imageUrl: string | undefined;
  if (eid && eventProfileId === profileId && profile) {
    imageUrl = `${profile.portalUrl}/index.php?view=image&eid=${eid}&fid=snapshot&width=600`;
  }

  const monitorName = data?.monitorName || data?.MonitorName || notif.title?.replace(/\s*Alarm.*$/, '') || 'Unknown';
  const cause = data?.cause || data?.Cause || notif.body || 'Motion detected';

  store.addEvent(eventProfileId, {
    MonitorId: mid ? parseInt(String(mid), 10) : 0,
    MonitorName: monitorName,
    EventId: eid ? parseInt(String(eid), 10) : Date.now(),
    Cause: cause,
    Name: monitorName,
    ImageUrl: imageUrl,
  }, 'push');
}

export function useNotificationDelivered({
  currentProfile,
}: DeliveredParams): void {
  // Process delivered notifications on cold start / profile load.
  // Uses currentProfile (persisted, available immediately) instead of
  // currentProfileId (runtime-only, null on cold start).
  useEffect(() => {
    if (!Platform.isNative || !currentProfile) return;

    const profileId = currentProfile.id;

    const processDelivered = async () => {
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        const { notifications } = await FirebaseMessaging.getDeliveredNotifications();

        if (notifications.length > 0) {
          const store = useNotificationStore.getState();
          const { profiles } = useProfileStore.getState();

          for (const notif of notifications) {
            ingestDeliveredNotification(notif, profileId, store, profiles);
          }
          log.notificationHandler('Added delivered notifications to history', LogLevel.INFO, { count: notifications.length });
        }

        await FirebaseMessaging.removeAllDeliveredNotifications();
      } catch (err) {
        log.notificationHandler('Failed to process delivered notifications', LogLevel.ERROR, err);
      }
    };

    processDelivered();
  }, [currentProfile]);

  // Clear native badge and sync badge count when app comes to foreground (iOS/Android)
  useEffect(() => {
    if (!Platform.isNative) return;

    let listenerCleanup: (() => void) | undefined;

    const setup = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

        const listener = await CapApp.addListener('appStateChange', async ({ isActive }) => {
          if (isActive) {
            const store = useNotificationStore.getState();
            const profileId = store.currentProfileId;

            // Only process and clear delivered notifications if we have an active profile.
            // On cold start, currentProfileId may still be null — the processDelivered
            // effect (which depends on currentProfile) will handle those instead.
            if (!profileId) return;

            // Read delivered notifications that arrived while backgrounded
            try {
              const { notifications } = await FirebaseMessaging.getDeliveredNotifications();
              if (notifications.length > 0) {
                const { profiles } = useProfileStore.getState();

                for (const notif of notifications) {
                  ingestDeliveredNotification(notif, profileId, store, profiles);
                }
                log.notificationHandler('Added delivered notifications to history on resume', LogLevel.INFO, { count: notifications.length });
              }
            } catch (err) {
              log.notificationHandler('Failed to read delivered notifications on resume', LogLevel.ERROR, err);
            }

            await FirebaseMessaging.removeAllDeliveredNotifications();
            log.notificationHandler('Cleared delivered notifications on app resume', LogLevel.DEBUG);

            // Sync badge count with server
            store._updateBadge();
          }
        });

        listenerCleanup = () => { listener.remove(); };
      } catch (e) {
        log.notificationHandler('Failed to setup badge clearing on resume', LogLevel.ERROR, e);
      }
    };

    setup();
    return () => { listenerCleanup?.(); };
  }, []);
}
