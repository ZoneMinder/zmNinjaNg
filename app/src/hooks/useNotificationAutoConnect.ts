/**
 * useNotificationAutoConnect Hook
 *
 * Manages automatic connection to the notification server when a profile
 * loads. Handles:
 * - Resetting auto-connect state when settings change
 * - Disconnecting when the profile switches
 * - Auto-connecting WebSocket (ES mode) or starting the event poller (direct mode)
 * - Stopping the event poller on cleanup
 * - Network change reconnection (web + native)
 * - Tab visibility / app resume liveness checks
 */

import { useEffect, useRef } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { useNotificationStore, startEventPoller } from '../stores/notifications';
import { stopEventPoller } from '../services/eventPoller';
import { getNotificationService } from '../services/notifications';
import { useCapacitorListener } from './useCapacitorListener';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import type { Profile } from '../api/types';

interface AutoConnectParams {
  currentProfile: Profile | null;
  settings: {
    enabled?: boolean;
    notificationMode?: string;
    host?: string;
  } | null;
  isConnected: boolean;
  /** Whether `currentProfileId` (the profile this hook was PREVIOUSLY bound
   *  to, before the current render) still has a live connection. Distinct
   *  from `isConnected`, which is scoped to the NEW `currentProfile` after a
   *  switch and so can never answer "is the profile I'm switching AWAY FROM
   *  still connected" (refs #337 C1). */
  isPreviousProfileConnected: boolean;
  currentProfileId: string | null;
  connect: (profileId: string, username: string, password: string, portalUrl: string) => Promise<void>;
  disconnect: () => void;
  reconnect: (force?: boolean) => void;
  getDecryptedPassword: (profileId: string) => Promise<string | null | undefined>;
}

export function useNotificationAutoConnect({
  currentProfile,
  settings,
  isConnected,
  isPreviousProfileConnected,
  currentProfileId,
  connect,
  disconnect,
  reconnect,
  getDecryptedPassword,
}: AutoConnectParams): void {
  const hasAttemptedAutoConnect = useRef(false);
  const lastProfileId = useRef<string | null>(null);

  // Always-fresh ref for the ES auto-connect effect below. Bootstrap
  // routinely writes a NEW profile object with the SAME id (e.g. after a
  // token refresh) - reading currentProfile through this ref lets that
  // effect depend on currentProfile's PRIMITIVE fields instead of the
  // object itself, so identity-only churn doesn't re-run it (refs #337
  // round 2 critical).
  const currentProfileRef = useRef(currentProfile);
  currentProfileRef.current = currentProfile;

  // Reset auto-connect flag when notifications are disabled
  useEffect(() => {
    if (!settings?.enabled) {
      hasAttemptedAutoConnect.current = false;
    }
  }, [settings?.enabled]);

  // Reset auto-connect flag when notification mode changes
  useEffect(() => {
    hasAttemptedAutoConnect.current = false;
  }, [settings?.notificationMode]);

  // Handle profile switching: disconnect from previous profile
  useEffect(() => {
    if (currentProfile?.id !== lastProfileId.current) {
      lastProfileId.current = currentProfile?.id || null;
      hasAttemptedAutoConnect.current = false;

      // Disconnect from previous profile if it's still connected to a
      // different one. Must check isPreviousProfileConnected, not
      // isConnected: the latter is scoped to the NEW currentProfile after a
      // switch, so it's already wrong by the time this effect runs
      // (refs #337 C1).
      if (isPreviousProfileConnected && currentProfileId !== currentProfile?.id) {
        log.notifications('Profile changed - disconnecting from previous profile', LogLevel.INFO, { previousProfile: currentProfileId,
          newProfile: currentProfile?.id, });
        disconnect();
      }
    }
  }, [currentProfile?.id, isPreviousProfileConnected, currentProfileId, disconnect]);

  // Auto-connect when profile loads (if enabled)
  // In ES mode: connects websocket. In Direct mode on desktop: starts event poller.
  useEffect(() => {
    const profile = currentProfileRef.current;
    if (
      !settings?.enabled ||
      !profile ||
      !profile.username ||
      !profile.password ||
      hasAttemptedAutoConnect.current
    ) {
      return;
    }

    const mode = settings.notificationMode || 'es';

    if (mode === 'direct') {
      if (Platform.isDesktopOrWeb) {
        // Desktop (Electron) or web browser: start event poller.
        // The poller's start() emits its own "Starting event poller" log,
        // so we don't duplicate it here.
        hasAttemptedAutoConnect.current = true;
        startEventPoller(profile.id);
      }
      // Native mobile (iOS/Android): push notifications handle everything via FCM
      return;
    }

    // ES mode: auto-connect websocket (existing behavior). Read the live
    // connection state from the store here, not an isConnected/
    // connectionState prop: connection-state changes must not be a reactive
    // dep on this effect (see the dependency array below) - reading live
    // instead costs nothing, since attemptConnect below re-checks the same
    // store immediately before connecting anyway.
    if (
      !settings.host ||
      (useNotificationStore.getState().connections[profile.id] ?? 'disconnected') !== 'disconnected'
    ) {
      return;
    }

    hasAttemptedAutoConnect.current = true;

    log.notifications('Auto-connecting to notification server', LogLevel.INFO, { profileId: profile.id, });

    // Unmounting (or a dep change re-running this effect) while the delay or
    // getDecryptedPassword is still in flight must not connect an ownerless
    // socket nobody will ever disconnect (refs #337 I3).
    let cancelled = false;

    const attemptConnect = async () => {
      // Re-read the ref, not the `profile` captured above: bootstrap can
      // swap in a new (same-id) profile object while this is in flight.
      const p = currentProfileRef.current;
      if (!p) return;

      try {
        const password = await getDecryptedPassword(p.id);
        if (cancelled) return;

        // Check state again right before connecting to avoid race conditions
        // This is crucial because getDecryptedPassword is async and state might have changed
        const currentState = useNotificationStore.getState().connections[p.id] ?? 'disconnected';
        if (currentState !== 'disconnected') {
           log.notifications('Skipping auto-connect - already connected or connecting', LogLevel.INFO, { state: currentState,
             profileId: p.id, });
           return;
        }

        if (password) {
          await connect(p.id, p.username!, password, p.portalUrl);
          log.notifications('Auto-connected to notification server', LogLevel.INFO, { profileId: p.id, });
        } else {
          log.notifications('Auto-connect failed - could not decrypt password', LogLevel.ERROR, {
            profileId: p.id,
          });
        }
      } catch (error) {
        // The service handles reconnection internally via exponential backoff
        log.notifications('Auto-connect failed, service will retry automatically', LogLevel.ERROR, {
          profileId: p.id,
          error,
        });
      }
    };

    // Small delay to ensure store initialization is complete
    const timerId = setTimeout(() => attemptConnect(), NOTIFICATIONS_SERVICE.autoConnectInitDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timerId);
      // Bootstrap replacing the profile object (same id, e.g. after a token
      // refresh) re-runs this effect via the primitive deps below; without
      // resetting this flag, the guard at the top of the next run sees it
      // still true and returns without rescheduling, permanently stranding
      // this profile un-connected for the session. Harmless on a true
      // unmount - nothing reads it again (refs #337 round 2 critical).
      hasAttemptedAutoConnect.current = false;
    };
    // Depend on currentProfile's PRIMITIVE fields, not the object itself -
    // see the currentProfileRef comment above. Connection state is
    // deliberately NOT a dep (read live above instead): this effect's only
    // job is the ONE initial auto-connect attempt for a newly loaded/enabled
    // profile. Letting connection-state churn (e.g. a drop) re-run it
    // re-armed the timer on every disconnect - on top of duplicating, that
    // fights the service's own exponential backoff (refs #274), which is
    // what actually owns reconnection after the first attempt (refs #337
    // round 3 important).
  }, [
    settings?.enabled,
    settings?.notificationMode,
    settings?.host,
    currentProfile?.id,
    currentProfile?.username,
    currentProfile?.password,
    currentProfile?.portalUrl,
    connect,
    getDecryptedPassword,
  ]);

  // Stop event poller on cleanup or when mode/profile changes. stopEventPoller
  // is a no-op when this profile never had a poller (never creates a phantom
  // registry entry just to immediately stop it - refs #337 I5).
  useEffect(() => {
    const profileId = currentProfile?.id;
    return () => {
      if (!profileId) return;
      stopEventPoller(profileId);
    };
  }, [currentProfile?.id, settings?.notificationMode, settings?.enabled]);

  // Gate for the ES-mode listeners below. Recomputed each render; the
  // listener hooks re-register only when the resulting boolean changes.
  const esModeEnabled = !!settings?.enabled && (settings?.notificationMode || 'es') === 'es';

  // Network change listener: reconnect when connectivity is restored
  useEffect(() => {
    if (!esModeEnabled) return;

    const handleOnline = () => {
      log.notificationHandler('Network restored, triggering reconnect', LogLevel.INFO);
      reconnect();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [esModeEnabled, reconnect]);

  // On native platforms, also use Capacitor's Network plugin for faster detection
  useCapacitorListener(
    () => import('@capacitor/network').then((m) => ({ plugin: m.Network })),
    'networkStatusChange',
    (status: { connected: boolean }) => {
      if (status.connected) {
        log.notificationHandler('Native network restored, triggering reconnect', LogLevel.INFO);
        reconnect();
      }
    },
    { enabled: Platform.isNative && esModeEnabled },
  );

  // Visibility change listener (desktop/web): check liveness when tab becomes visible
  useEffect(() => {
    const mode = settings?.notificationMode || 'es';
    if (!settings?.enabled || mode !== 'es' || Platform.isNative) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;

      // A hidden tab gets its timers frozen, so a scheduled reconnect can be
      // arbitrarily late (up to the 2 minute backoff cap) or not have run at
      // all. Retry now instead of waiting it out (refs #274).
      if (!isConnected) {
        log.notificationHandler('Tab visible while disconnected, reconnecting now', LogLevel.INFO);
        reconnect();
        return;
      }

      if (!currentProfile) return;

      log.notificationHandler('Tab visible, checking WebSocket liveness', LogLevel.DEBUG);
      const service = getNotificationService(currentProfile.id);
      const alive = await service.checkAlive(5000);

      if (!alive) {
        log.notificationHandler('WebSocket not responding after tab resume, reconnecting', LogLevel.WARN);
        reconnect(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [settings?.enabled, settings?.notificationMode, isConnected, reconnect, currentProfile]);

  // App resume liveness check (mobile): verify WebSocket is alive when app returns to foreground
  useCapacitorListener(
    () => import('@capacitor/app').then((m) => ({ plugin: m.App })),
    'appStateChange',
    async ({ isActive }: { isActive: boolean }) => {
      if (!isActive) return;

      // Suspending the app kills the socket and freezes the WebView's timers,
      // so the backoff reconnect either fired into a dead network or never ran.
      // Resuming is the moment to retry, not to wait for a stale timer (#274).
      if (!isConnected) {
        log.notificationHandler('App resumed while disconnected, reconnecting now', LogLevel.INFO);
        reconnect();
        return;
      }

      if (!currentProfile) return;

      log.notificationHandler('App resumed, checking WebSocket liveness', LogLevel.DEBUG);
      const service = getNotificationService(currentProfile.id);
      const alive = await service.checkAlive(5000);

      if (!alive) {
        log.notificationHandler('WebSocket not responding after app resume, reconnecting', LogLevel.WARN);
        reconnect(true);
      }
    },
    {
      enabled: Platform.isNative && esModeEnabled,
      onError: (e) => log.notificationHandler('Failed to setup app resume liveness check', LogLevel.ERROR, e),
    },
  );
}
