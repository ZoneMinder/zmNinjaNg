/**
 * useNotificationPushSetup Hook
 *
 * Handles FCM initialization and token registration on mobile platforms.
 * Runs when notifications are enabled or the notification mode changes,
 * ensuring the FCM token is registered with the correct backend
 * (ES websocket vs ZM REST API).
 */

import { useEffect } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { useNotificationStore } from '../stores/notifications';
import { getPushService } from '../services/pushNotifications';
import type { Profile } from '../api/types';

interface PushSetupParams {
  currentProfile: Profile | null;
  settings: {
    enabled?: boolean;
    notificationMode?: string;
  } | null;
}

export function useNotificationPushSetup({
  currentProfile,
  settings,
}: PushSetupParams): void {
  useEffect(() => {
    if (!Platform.isNative || !settings?.enabled || !currentProfile) return;

    const mode = settings.notificationMode || 'es';

    // In direct mode, set currentProfileId so the push service knows which
    // profile to register against (there's no WebSocket connect to set it)
    if (mode === 'direct') {
      useNotificationStore.setState({ currentProfileId: currentProfile.id });
      // Sync badge count with server after setting profile
      useNotificationStore.getState()._updateBadge();
    }

    const pushService = getPushService();

    if (pushService.isReady()) {
      // Token already obtained — re-register with server for current mode
      log.notificationHandler('Re-registering FCM token for mode change', LogLevel.INFO, { mode });
      pushService.registerTokenWithServer().catch((error) => {
        log.notificationHandler('Failed to re-register FCM token', LogLevel.ERROR, error);
      });
    } else {
      // First time — initialize to get FCM token and register
      pushService.initialize().catch((error) => {
        log.notificationHandler('Failed to initialize push notifications', LogLevel.ERROR, error);
      });
    }
  }, [settings?.enabled, settings?.notificationMode, currentProfile]);
}
