/**
 * Notification Settings Page
 *
 * Configures notification preferences, including server connection,
 * monitor filters, and push notification settings.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNotificationStore } from '../stores/notifications';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { getMonitors } from '../api/monitors';
import { useAuthStore } from '../stores/auth';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import {
  Bell,
  BellOff,
  History,
  WifiOff,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Platform } from '../lib/platform';
import { useTranslation } from 'react-i18next';
import { log, LogLevel } from '../lib/logger';
import { checkNotificationsApiSupport } from '../api/notifications';
import { getEventPoller } from '../services/eventPoller';
import type { NotificationMode } from '../types/notifications';
import { NotificationBadge } from '../components/NotificationBadge';
import { NotificationModeSection } from '../components/notifications/NotificationModeSection';
import { ServerConfigSection } from '../components/notifications/ServerConfigSection';
import { MonitorFilterSection } from '../components/notifications/MonitorFilterSection';

export default function NotificationSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useCurrentProfile();
  const getDecryptedPassword = useProfileStore((state) => state.getDecryptedPassword);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const {
    getProfileSettings,
    updateProfileSettings,
    setMonitorFilter,
    connect,
    disconnect,
    connectionState,
    isConnected,
    getUnreadCount,
  } = useNotificationStore();

  // Get settings for current profile
  const settings = currentProfile ? getProfileSettings(currentProfile.id) : null;
  const unreadCount = currentProfile ? getUnreadCount(currentProfile.id) : 0;

  // Fetch monitors
  const { data: monitorsData } = useQuery({
    queryKey: ['monitors', currentProfile?.id],
    queryFn: getMonitors,
    enabled: !!currentProfile && isAuthenticated,
  });

  const monitors = monitorsData?.monitors || [];

  const [isConnecting, setIsConnecting] = useState(false);
  const [directModeAvailable, setDirectModeAvailable] = useState<boolean | null>(null);

  // Feature detection: check if ZM server supports Notifications API
  useEffect(() => {
    if (!currentProfile || !isAuthenticated) return;

    checkNotificationsApiSupport()
      .then((supported) => {
        setDirectModeAvailable(supported);
        log.notificationSettings('ZM Notifications API support check', LogLevel.INFO, { supported });
      })
      .catch(() => {
        setDirectModeAvailable(false);
      });
  }, [currentProfile?.id, isAuthenticated]);

  const handleEnableToggle = async (enabled: boolean) => {
    if (!currentProfile) {
      toast.error(t('notification_settings.no_profile'));
      return;
    }

    updateProfileSettings(currentProfile.id, { enabled });

    if (enabled) {
      // Auto-detect host from current profile if not set
      if (!settings?.host && currentProfile) {
        try {
          const url = new URL(currentProfile.portalUrl);
          // Use wss:// scheme for the notification server
          const wsHost = url.hostname;
          updateProfileSettings(currentProfile.id, { host: wsHost });
          log.notificationSettings('Auto-populated notification host from profile', LogLevel.INFO, { host: wsHost, });
        } catch (error) {
          log.notificationSettings('Failed to parse portal URL', LogLevel.ERROR, error);
        }
      }

      toast.info(t('notification_settings.notifications_enabled'));
    } else {
      // Deregister push notifications on mobile platforms
      if (Platform.isNative) {
        try {
          const { getPushService } = await import('../services/pushNotifications');
          const pushService = getPushService();
          await pushService.deregister(currentProfile.id);
          log.notificationSettings('Deregistered from push notifications', LogLevel.INFO);
        } catch (error) {
          log.notificationSettings('Failed to deregister from push notifications', LogLevel.ERROR, error);
        }
      }

      disconnect();
      toast.info(t('notification_settings.notifications_disabled'));
    }
  };

  const handleConnect = async () => {
    if (!currentProfile) {
      toast.error(t('notification_settings.no_profile'));
      return;
    }

    if (!settings?.host) {
      toast.error(t('notification_settings.enter_host'));
      return;
    }

    if (!currentProfile.username || !currentProfile.password) {
      toast.error(t('notification_settings.profile_credentials_required'));
      return;
    }

    setIsConnecting(true);

    try {
      // Get decrypted password
      const password = await getDecryptedPassword(currentProfile.id);
      if (!password) {
        throw new Error('Failed to get password');
      }

      await connect(currentProfile.id, currentProfile.username, password, currentProfile.portalUrl);
      toast.success(t('notification_settings.connected_success'));

      // Push token will be registered automatically by the connect method
    } catch (error) {
      log.notificationSettings('Connection failed', LogLevel.ERROR, error);
      toast.error(t('notification_settings.connect_failed', { error: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info(t('notification_settings.disconnected'));
  };

  const handleModeChange = async (mode: NotificationMode) => {
    if (!currentProfile) return;

    const currentMode = settings?.notificationMode || 'es';
    if (mode === currentMode) return;

    log.notificationSettings('Switching notification mode', LogLevel.INFO, { from: currentMode, to: mode });

    if (currentMode === 'es' && mode === 'direct') {
      // Switching from ES to Direct: disconnect websocket, start poller on desktop
      disconnect();
      updateProfileSettings(currentProfile.id, { notificationMode: 'direct' });

      if (Platform.isDesktopOrWeb) {
        // Desktop (Tauri) or web browser: start event poller
        log.notificationSettings('Starting event poller from mode switch', LogLevel.INFO);
        const poller = getEventPoller();
        poller.start(currentProfile.id);
      }

      toast.info(t('notification_settings.mode_switched_direct'));
    } else if (currentMode === 'direct' && mode === 'es') {
      // Switching from Direct to ES: stop poller, connect websocket
      const poller = getEventPoller();
      if (poller.isRunning()) {
        poller.stop();
      }

      updateProfileSettings(currentProfile.id, { notificationMode: 'es' });

      // Auto-connect websocket if host is configured
      if (settings?.host && currentProfile.username && currentProfile.password) {
        try {
          const password = await getDecryptedPassword(currentProfile.id);
          if (password) {
            await connect(currentProfile.id, currentProfile.username, password, currentProfile.portalUrl);
          }
        } catch (error) {
          log.notificationSettings('Failed to connect after switching to ES mode', LogLevel.ERROR, error);
        }
      }

      toast.info(t('notification_settings.mode_switched_es'));
    }
  };

  const handleAllMonitorsToggle = (allMonitors: boolean) => {
    if (!currentProfile) return;
    updateProfileSettings(currentProfile.id, { allMonitors });
  };

  const handleMonitorToggle = (monitorId: number, enabled: boolean) => {
    if (!currentProfile) return;

    if (enabled) {
      setMonitorFilter(currentProfile.id, monitorId, true, 60); // Default 60 second interval
    } else {
      setMonitorFilter(currentProfile.id, monitorId, false);
    }
  };

  const handleIntervalChange = (monitorId: number, interval: number) => {
    if (!currentProfile || !settings) return;

    const filter = settings.monitorFilters.find((f) => f.monitorId === monitorId);
    if (filter) {
      setMonitorFilter(currentProfile.id, monitorId, filter.enabled, interval);
    }
  };

  const handlePollingIntervalRestart = () => {
    if (!currentProfile) return;
    const poller = getEventPoller();
    if (poller.isRunning()) {
      poller.start(currentProfile.id);
    }
  };

  const getConnectionBadge = () => {
    const mode = settings?.notificationMode || 'es';

    // Direct mode doesn't use a WebSocket -- show mode-specific status
    if (mode === 'direct' && settings?.enabled) {
      return (
        <Badge variant="default" className="gap-1.5 bg-blue-500">
          <CheckCircle className="h-3 w-3" />
          {t('notifications.status.direct_active')}
        </Badge>
      );
    }

    switch (connectionState) {
      case 'connected':
        return (
          <Badge variant="default" className="gap-1.5">
            <CheckCircle className="h-3 w-3" />
            {t('notification_settings.status_connected')}
          </Badge>
        );
      case 'connecting':
      case 'authenticating':
        return (
          <Badge variant="secondary" className="gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('notification_settings.status_connecting')}
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1.5">
            <XCircle className="h-3 w-3" />
            {t('notification_settings.status_error')}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1.5">
            <WifiOff className="h-3 w-3" />
            {t('notification_settings.status_disconnected')}
          </Badge>
        );
    }
  };

  // Early return if no profile
  if (!currentProfile || !settings) {
    return (
      <div className="p-6 md:p-8" data-testid="notification-settings-empty">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-semibold">{t('notification_settings.no_profile')}</h2>
            <p className="text-muted-foreground">{t('notification_settings.select_profile_first')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-5" data-testid="notification-settings">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('notification_settings.title')}</h1>
            <NotificationBadge />
          </div>
          <p className="text-muted-foreground mt-1">
            {t('notification_settings.subtitle')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/notifications/history')}
          data-testid="notification-history-button"
        >
          <History className="h-4 w-4 mr-2" />
          {t('notification_settings.view_history')}
        </Button>
      </div>

      <div className="grid gap-4">
        {/* Enable/Disable */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {settings.enabled ? (
                  <Bell className="h-5 w-5 text-primary shrink-0" />
                ) : (
                  <BellOff className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <CardTitle className="text-lg sm:text-xl">{t('notification_settings.status_title')}</CardTitle>
              </div>
              <div className="self-start sm:self-auto">
                {getConnectionBadge()}
              </div>
            </div>
            <CardDescription className="mt-1.5">
              {t('notification_settings.status_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
              <div className="flex-1 space-y-1">
                <Label htmlFor="enable-notifications" className="text-base font-semibold">
                  {t('notification_settings.enable_notifications')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('notification_settings.enable_notifications_desc')}
                </p>
              </div>
              <Switch
                id="enable-notifications"
                checked={settings.enabled}
                onCheckedChange={handleEnableToggle}
                data-testid="notification-enable-toggle"
              />
            </div>

            {unreadCount > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <AlertCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {t('notification_settings.unread_count', { count: unreadCount })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notification Mode Selector + Direct Mode Options */}
        {settings.enabled && (
          <NotificationModeSection
            settings={settings}
            directModeAvailable={directModeAvailable}
            profileId={currentProfile.id}
            onModeChange={handleModeChange}
            onUpdateSettings={updateProfileSettings}
            onPollingIntervalRestart={handlePollingIntervalRestart}
          />
        )}

        {/* Server Configuration (ES mode only) */}
        {settings.enabled && (settings.notificationMode || 'es') === 'es' && (
          <ServerConfigSection
            settings={settings}
            profileId={currentProfile.id}
            isConnected={isConnected}
            isConnecting={isConnecting}
            onUpdateSettings={updateProfileSettings}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        )}

        {/* Monitor Filters */}
        {settings.enabled && monitors.length > 0 && (
          <MonitorFilterSection
            settings={settings}
            monitors={monitors}
            onAllMonitorsToggle={handleAllMonitorsToggle}
            onMonitorToggle={handleMonitorToggle}
            onIntervalChange={handleIntervalChange}
          />
        )}
      </div>
    </div>
  );
}
