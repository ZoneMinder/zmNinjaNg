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
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { getEventCauseIcon } from '../lib/event-icons';
import { buildThumbnailChain } from '../lib/thumbnail-chain';
import { EventThumbnail } from './events/EventThumbnail';
import { log, LogLevel } from '../lib/logger';
import { navigationService } from '../lib/navigation';
import { useTranslation } from 'react-i18next';
import {
  onProfileSwitchRequest,
  clearPendingProfileSwitch,
  type PendingProfileSwitch,
} from '../lib/notification-profile';
import { useNotificationAutoConnect } from '../hooks/useNotificationAutoConnect';
import { useNotificationPushSetup } from '../hooks/useNotificationPushSetup';
import { useNotificationDelivered } from '../hooks/useNotificationDelivered';

/**
 * NotificationHandler component.
 * This component does not render any visible UI itself but manages
 * side effects related to notifications (toasts, sounds, connection).
 */
export function NotificationHandler() {
  const navigate = useNavigate();
  const { currentProfile, settings: profileSettings } = useCurrentProfile();
  const getDecryptedPassword = useProfileStore((state) => state.getDecryptedPassword);
  const switchProfile = useProfileStore((state) => state.switchProfile);
  const { t } = useTranslation();

  const {
    getProfileSettings,
    getEvents,
    isConnected,
    connectionState,
    currentProfileId,
    connect,
    disconnect,
    reconnect,
  } = useNotificationStore();

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

  // Get settings and events for current profile
  const settings = currentProfile ? getProfileSettings(currentProfile.id) : null;
  const events = currentProfile ? getEvents(currentProfile.id) : [];

  // --- Delegated hooks ---

  useNotificationAutoConnect({
    currentProfile,
    settings,
    isConnected,
    connectionState,
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
              minStreamingPort: currentProfile.minStreamingPort,
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
            <div className="text-xs text-muted-foreground mt-1">
              {t('events.event_id')}: {latestEvent.EventId}
            </div>
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

  // Render profile switch confirmation dialog when a cross-profile notification is tapped
  return (
    <ProfileSwitchDialog
      pending={pendingSwitch}
      onConfirm={handleConfirmSwitch}
      onCancel={handleCancelSwitch}
    />
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

/**
 * Plays a notification sound using the Web Audio API.
 * Generates a simple beep tone.
 */
function playNotificationSound() {
  try {
    // Create a simple beep sound using Web Audio API
    const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // 800 Hz tone
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    log.notifications('Failed to play notification sound', LogLevel.ERROR, error);
  }
}
