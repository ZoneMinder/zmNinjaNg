/**
 * Notification Handler Component
 *
 * A headless component that manages the notification system.
 * It listens to the notification store and displays toast notifications
 * for new events. It also handles auto-connecting to the notification
 * server when a profile is loaded.
 *
 * Connection, push setup, and delivered-notification processing are
 * delegated to focused hooks under src/hooks/useNotification*.ts.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notifications';
import { useShallow } from 'zustand/react/shallow';
import { Platform } from '../lib/platform';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useCurrentProfile, useProfileById } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useProfileStore } from '../stores/profile';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { getEventCauseIcon } from '../lib/event/event-icons';
import { buildThumbnailChain } from '../lib/event/thumbnail-chain';
import { playNotificationSound } from '../lib/event/notification-sound';
import { EventThumbnail } from './events/EventThumbnail';
import { log, LogLevel } from '../lib/logger';
import { navigationService } from '../lib/navigation';
import { useTranslation } from 'react-i18next';
import {
  onProfileSwitchRequest,
  clearPendingProfileSwitch,
  type PendingProfileSwitch,
} from '../lib/profile/notification-profile';
import { useNotificationAutoConnect } from '../hooks/useNotificationAutoConnect';
import { useNotificationPushSetup } from '../hooks/useNotificationPushSetup';
import { useNotificationDelivered } from '../hooks/useNotificationDelivered';
import { useNotificationBadgeNudge } from '../hooks/useNotificationBadgeNudge';
import { useNotificationAllModeToasts } from '../hooks/useNotificationAllModeToasts';
import { ProfileNotificationConnector } from './notifications/ProfileNotificationConnector';

/**
 * NotificationHandler component.
 * This component does not render any visible UI itself but manages
 * side effects related to notifications (toasts, sounds, connection).
 */
export function NotificationHandler() {
  const navigate = useNavigate();
  const { currentProfile } = useCurrentProfile();
  // The toast path below serves the current profile's own events, so its
  // server-scoped thumbnail settings come from that profile (refs #536).
  const { settings: profileSettings } = useProfileById(currentProfile?.id);
  const scope = useProfileScope();
  const getDecryptedPassword = useProfileStore((state) => state.getDecryptedPassword);
  const switchProfile = useProfileStore((state) => state.switchProfile);
  const { t } = useTranslation();

  const {
    getProfileSettings,
    isConnected,
    isPreviousProfileConnected,
    currentProfileId,
    connect,
  } = useNotificationStore(
    useShallow((state) => ({
      getProfileSettings: state.getProfileSettings,
      isConnected: currentProfile ? state.connections[currentProfile.id] === 'connected' : false,
      // The anchor profile (state.currentProfileId) is whichever profile
      // this hook was bound to BEFORE the current render - distinct from
      // `isConnected` above, which is scoped to the NEW currentProfile
      // after a switch (refs #337 C1).
      isPreviousProfileConnected: state.currentProfileId
        ? state.connections[state.currentProfileId] === 'connected'
        : false,
      currentProfileId: state.currentProfileId,
      connect: state.connect,
    }))
  );

  // disconnect() tears down whichever profile's connection is currently
  // anchored (mirrors the pre-#337 singleton's "disconnect whatever's
  // connected"); reconnect() always targets this component's own profile.
  const disconnect = useCallback(() => {
    const prevId = useNotificationStore.getState().currentProfileId;
    if (prevId) useNotificationStore.getState().disconnect(prevId);
  }, []);
  const reconnect = useCallback((force?: boolean) => {
    if (currentProfile) useNotificationStore.getState().reconnect(currentProfile.id, force);
  }, [currentProfile]);

  // Events for the current profile, subscribed via selector so addEvent
  // re-renders this component. The store's websocket listener only calls
  // addEvent (see stores/notifications.ts); the toast effect below relies
  // on this subscription to fire for live events.
  const events = useNotificationStore(
    useShallow((state) => (currentProfile ? state.profileEvents[currentProfile.id] ?? [] : []))
  );

  const lastEventId = useRef<number | null>(null);
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();

  // Profile switch confirmation state
  const [pendingSwitch, setPendingSwitch] = useState<PendingProfileSwitch | null>(null);

  // Handle profile switch confirmation from push notification taps
  const handleConfirmSwitch = useCallback(async () => {
    if (!pendingSwitch) return;

    const { targetProfileId, eventId } = pendingSwitch;
    setPendingSwitch(null);
    clearPendingProfileSwitch();

    log.notificationHandler('User confirmed profile switch from notification', LogLevel.INFO, {
      targetProfileId,
      eventId,
    });

    try {
      await switchProfile(targetProfileId);
      navigationService.navigateToEvent(eventId, { from: '/monitors', fromNotification: true });
    } catch (error) {
      log.notificationHandler('Profile switch failed', LogLevel.ERROR, error);
      toast.error(t('notifications.profile_switch_failed'));
    }
  }, [pendingSwitch, switchProfile, t]);

  const handleCancelSwitch = useCallback(() => {
    log.notificationHandler('User declined profile switch from notification', LogLevel.INFO, {
      targetProfileId: pendingSwitch?.targetProfileId,
    });
    setPendingSwitch(null);
    clearPendingProfileSwitch();
  }, [pendingSwitch]);

  // Listen for profile switch requests from the push notification service
  useEffect(() => {
    const unsubscribe = onProfileSwitchRequest((pending) => {
      setPendingSwitch(pending);
    });
    return unsubscribe;
  }, []);

  // Subscribe to the settings slice so enabling/disabling notifications
  // re-renders this component. Direct mode opens no websocket, so nothing in
  // `connections` changes: without this, the delegated hooks below keep the
  // settings object from the render before the toggle and FCM registration
  // never runs. Selecting the raw slice (not a mapped object) keeps the
  // subscription stable; getProfileSettings spreads a fresh object per call.
  useNotificationStore((state) => state.profileSettings);
  const settings = currentProfile ? getProfileSettings(currentProfile.id) : null;

  // --- Delegated hooks ---

  useNotificationAutoConnect({
    currentProfile,
    settings,
    isConnected,
    isPreviousProfileConnected,
    currentProfileId,
    connect,
    disconnect,
    reconnect,
    getDecryptedPassword,
  });

  useNotificationPushSetup({
    currentProfile,
    settings,
  });

  useNotificationDelivered({
    currentProfile,
  });

  // Refreshes the monitor/montage "new events" badge as soon as a
  // notification arrives, independent of the toast setting below.
  useNotificationBadgeNudge(currentProfile?.id, events);

  // All-mode toast display (own-profile settings, burst coalescing, mute
  // toggle). No-ops in single mode; the effect below stays the single/
  // current-profile toast path, unchanged (refs #337).
  useNotificationAllModeToasts();

  // Listen to navigation events from services (e.g., push notifications)
  useEffect(() => {
    const unsubscribe = navigationService.addListener((event) => {
      log.notificationHandler('Navigating from service event', LogLevel.INFO, { path: event.path,
        replace: event.replace, });

      if (event.replace) {
        navigate(event.path, { replace: true, state: event.state });
      } else {
        navigate(event.path, { state: event.state });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [navigate]);

  // Listen for new events and show toasts
  useEffect(() => {
    if (!settings?.showToasts || events.length === 0) {
      return;
    }

    const latestEvent = events[0];

    // Only show toast if this is a new event we haven't seen
    if (latestEvent.EventId !== lastEventId.current) {
      lastEventId.current = latestEvent.EventId;

      const toastThumbnailUrls = currentProfile && latestEvent.EventId
        ? buildThumbnailChain(
            currentProfile.portalUrl,
            String(latestEvent.EventId),
            profileSettings.thumbnailFallbackChain,
            {
              token: isAccessTokenFresh ? accessToken ?? undefined : undefined,
              minStreamingPort: resolveMinStreamingPort(currentProfile.minStreamingPort, profileSettings.forceDisableMultiPort),
            }
          )
        : [];

      // Show toast notification
      toast(
        <div className="flex items-start gap-3">
          {toastThumbnailUrls.length > 0 ? (
            <div className="flex-shrink-0 h-16 w-16 rounded border overflow-hidden bg-muted/30">
              <EventThumbnail
                urls={toastThumbnailUrls}
                cacheKey={`toast-${latestEvent.EventId}`}
                alt={latestEvent.MonitorName}
                className="h-full w-full"
                objectFit="cover"
              />
            </div>
          ) : (
            <div className="flex-shrink-0 mt-0.5">
              <Bell className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{latestEvent.MonitorName}</div>
            {currentProfile && (
              <div className="text-xs text-muted-foreground/70">{currentProfile.name}</div>
            )}
            {(() => {
              const CauseIcon = getEventCauseIcon(latestEvent.Cause);
              return (
                <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                  <CauseIcon className="h-3 w-3" />
                  {latestEvent.Cause}
                </div>
              );
            })()}
            {latestEvent.EventId > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {t('events.event_id')}: {latestEvent.EventId}
              </div>
            )}
          </div>
        </div>,
        {
          duration: 5000,
          action: latestEvent.EventId
            ? {
                label: t('common.view'),
                onClick: () => {
                  // Navigate to event detail
                  navigate(`/events/${latestEvent.EventId}`);
                },
              }
            : undefined,
        }
      );

      // Play sound if enabled
      if (settings?.playSound) {
        playNotificationSound();
      }

      log.notifications('Showed notification toast', LogLevel.INFO, { profileId: currentProfile?.id,
        monitor: latestEvent.MonitorName,
        eventId: latestEvent.EventId, });
    }
  }, [events, settings?.showToasts, settings?.playSound, currentProfile?.id, t, navigate, accessToken, isAccessTokenFresh]);

  // Render profile switch confirmation dialog when a cross-profile
  // notification is tapped, plus one connector per All-mode profile so
  // every enabled profile gets its own live connection while aggregating
  // (refs #337). Single mode is untouched: `scope.mode` is 'single' there,
  // so no connectors mount and this component's own hook calls above
  // (bound to the real current profile) are the only connection.
  //
  // Desktop/web only (refs #337 I4): on mobile, FCM already delivers every
  // profile's events server-side regardless of which one is foregrounded,
  // so N extra websockets would only cost battery with no gap to close.
  // Native keeps today's deterministic single-connection + FCM-anchor
  // semantics unchanged.
  //
  // allModeNotifications === 'off' (refs #337): no connector mounts at all,
  // so zero All-mode websockets/pollers exist and nothing accumulates from
  // live paths. 'muted' still mounts every connector - only toast/sound
  // display is suppressed, at the useNotificationAllModeToasts seam.
  return (
    <>
      <ProfileSwitchDialog
        pending={pendingSwitch}
        onConfirm={handleConfirmSwitch}
        onCancel={handleCancelSwitch}
      />
      {Platform.isDesktopOrWeb && scope?.mode === 'all' && scope.settings.allModeNotifications !== 'off' &&
        scope.profiles.map((profile) => (
          <ProfileNotificationConnector key={profile.id} profile={profile} />
        ))}
    </>
  );
}

/**
 * Profile switch confirmation dialog.
 * Shown when the user taps a notification from a different profile.
 */
function ProfileSwitchDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingProfileSwitch | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      data-testid="profile-switch-dialog"
    >
      <div className="w-full max-w-sm mx-4 rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">
          {t('notifications.switch_profile_title')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('notifications.switch_profile_desc', { profile: pending.targetProfileName })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
            onClick={onCancel}
            data-testid="profile-switch-cancel"
          >
            {t('common.cancel')}
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            onClick={onConfirm}
            data-testid="profile-switch-confirm"
          >
            {t('notifications.switch_profile_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
