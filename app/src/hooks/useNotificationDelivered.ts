/**
 * useNotificationDelivered Hook
 *
 * Processes delivered (unread) push notifications on mobile platforms.
 * Handles two scenarios:
 * - Cold start: reads delivered notifications when the profile first loads
 * - App resume: reads notifications that arrived while the app was backgrounded,
 *   clears native badges, and syncs badge count with the server
 *
 * The plugin's delivered notifications carry no delivery time (iOS's
 * UNNotification.date and Android's postTime are not passed through), so each
 * entry is timed by its event's start, looked up by id; a push is sent at that
 * start. Without an id, or when the lookup fails, it falls back to now
 * (issue #615). The tray is cleared as soon as it is read, before the
 * lookups, so a push arriving during them stays in the tray for the next read.
 */

import { useEffect } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { resolveProfileForNotification } from '../lib/profile/notification-profile';
import { getEventImageUrl } from '../lib/zm/url-builder';
import { getEvent } from '../api/events';
import { getSession } from '../services/sessions';
import { eventInstant } from '../lib/event/event-instant';
import { asProfileId, isAggregateProfileId } from '../api/types';
import { parseEidFromPushTag } from '../lib/event/push-tag';
import { useCapacitorListener } from './useCapacitorListener';
import type { Profile } from '../api/types';

interface DeliveredParams {
  currentProfile: Profile | null;
}

type DeliveredNotification = { data?: unknown; title?: string | null; body?: string | null; tag?: string | null };

/**
 * Epoch ms the event started, from the server, or undefined when there is no
 * id, no single-server profile, or the lookup fails.
 */
async function eventStartMs(profileId: string, eventId: number): Promise<number | undefined> {
  if (!(eventId > 0) || isAggregateProfileId(profileId)) return undefined;
  try {
    const session = getSession(asProfileId(profileId));
    const event = await getEvent(session.client, String(eventId));
    const ms = eventInstant(event, session.timezone);
    return Number.isFinite(ms) ? ms : undefined;
  } catch (err) {
    log.notificationHandler('Could not look up a delivered notification\'s event time', LogLevel.WARN, { eventId, err });
    return undefined;
  }
}

/**
 * Parse a single delivered notification and add it to the notification store,
 * timed by its event's start when that can be found. An event already in
 * history keeps its entry, so it needs no lookup.
 */
async function ingestDeliveredNotification(
  notif: DeliveredNotification,
  profileId: string,
  profiles: Profile[],
): Promise<void> {
  const data = notif.data as Record<string, string> | undefined;
  const mid = data?.mid || data?.MonitorId;
  // On Android getDeliveredNotifications drops the FCM data payload, so fall back
  // to the eid the ES encodes in the notification tag (issue #242). iOS keeps data.
  const eid = data?.eid || data?.EventId || parseEidFromPushTag(notif.tag) || undefined;

  // Resolve which profile this notification belongs to
  const resolved = resolveProfileForNotification(data?.profile, profileId);
  const eventProfileId: string = resolved.targetProfileId || profileId;
  const profile = profiles.find(p => p.id === eventProfileId);

  // Only construct image URL for current profile's notifications
  let imageUrl: string | undefined;
  if (eid && eventProfileId === profileId && profile) {
    imageUrl = getEventImageUrl(profile.portalUrl, String(eid), 'snapshot', { width: 600 });
  }

  const monitorName = data?.monitorName || data?.MonitorName || notif.title?.replace(/\s*Alarm.*$/, '') || 'Unknown';
  const cause = data?.cause || data?.Cause || notif.body || 'Motion detected';
  // 0 means "no ZM event". Tray-read delivered notifications lose their FCM
  // data payload, so eid is absent here; fabricating one would drive a bogus
  // image request (issue #242).
  const eventId = eid ? parseInt(String(eid), 10) : 0;
  const known = useNotificationStore.getState().getEvents(eventProfileId).some((e) => e.EventId === eventId);
  const startedAt = profile && !known ? await eventStartMs(eventProfileId, eventId) : undefined;

  useNotificationStore.getState().addEvent(eventProfileId, {
    MonitorId: mid ? parseInt(String(mid), 10) : 0,
    MonitorName: monitorName,
    EventId: eventId,
    Cause: cause,
    Name: monitorName,
    ImageUrl: imageUrl,
  }, 'push', startedAt);
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
        await FirebaseMessaging.removeAllDeliveredNotifications();

        if (notifications.length > 0) {
          const { profiles } = useProfileStore.getState();

          await Promise.all(notifications.map((notif) => ingestDeliveredNotification(notif, profileId, profiles)));
          log.notificationHandler('Added delivered notifications to history', LogLevel.INFO, { count: notifications.length });
        }
      } catch (err) {
        log.notificationHandler('Failed to process delivered notifications', LogLevel.ERROR, err);
      }
    };

    processDelivered();
  }, [currentProfile]);

  // Clear native badge and sync badge count when app comes to foreground (iOS/Android)
  useCapacitorListener(
    async () => {
      const { App: CapApp } = await import('@capacitor/app');
      // The handler needs the messaging plugin; import it up front so the
      // listener is only registered when both plugins are available.
      await import('@capacitor-firebase/messaging');
      return { plugin: CapApp };
    },
    'appStateChange',
    async ({ isActive }: { isActive: boolean }) => {
      if (!isActive) return;

      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      const store = useNotificationStore.getState();
      const profileId = store.currentProfileId;

      // Only process and clear delivered notifications if we have an active profile.
      // On cold start, currentProfileId may still be null. The processDelivered
      // effect (which depends on currentProfile) will handle those instead.
      if (!profileId) return;

      // Read delivered notifications that arrived while backgrounded
      let delivered: DeliveredNotification[] = [];
      try {
        ({ notifications: delivered } = await FirebaseMessaging.getDeliveredNotifications());
      } catch (err) {
        log.notificationHandler('Failed to read delivered notifications on resume', LogLevel.ERROR, err);
      }

      await FirebaseMessaging.removeAllDeliveredNotifications();
      log.notificationHandler('Cleared delivered notifications on app resume', LogLevel.DEBUG);

      if (delivered.length > 0) {
        try {
          const { profiles } = useProfileStore.getState();

          await Promise.all(delivered.map((notif) => ingestDeliveredNotification(notif, profileId, profiles)));
          log.notificationHandler('Added delivered notifications to history on resume', LogLevel.INFO, { count: delivered.length });
        } catch (err) {
          log.notificationHandler('Failed to add delivered notifications to history on resume', LogLevel.ERROR, err);
        }
      }

      // Sync badge count with server
      store._updateBadge(profileId);
    },
    {
      enabled: Platform.isNative,
      onError: (e) => log.notificationHandler('Failed to setup badge clearing on resume', LogLevel.ERROR, e),
    },
  );
}
