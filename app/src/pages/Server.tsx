/**
 * Server Page
 *
 * Displays all servers in the cluster, their health metrics, storage areas,
 * version info, and ZoneMinder run state controls.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile, useProfileById } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAuthSlice } from '../stores/auth';
import type { ProfileId } from '../api/types';
import { ProfilePicker } from '../components/profile-picker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { PageContainer } from '../components/common/PageContainer';
import { RefreshButton } from '../components/common/RefreshButton';
import {
  Server as ServerIcon,
  Activity,
  HardDrive,
  Cpu,
  Info,
  PlayCircle,
  Loader2,
  Play,
  Square,
  RotateCw,
  Database,
  MemoryStick,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getServers, getLoad, getLatestServerStat, getDaemonCheck, getStorages } from '../api/server';
import { formatForServerInTz, resolveProfileTimezone } from '../lib/time';
import { SERVER_STATS_WINDOW_MINUTES } from '../lib/zmninja-ng-constants';
import {
  ZM_STORAGE_USAGE_DANGER_PERCENT,
  ZM_STORAGE_USAGE_WARN_PERCENT,
  ZM_SWAP_USAGE_DANGER_PERCENT,
  ZM_SWAP_USAGE_WARN_PERCENT,
} from '../lib/zm/zm-constants';
import { zmHumanFilesize, zmUsageLevel } from '../lib/zm/server-stats';
import { getServerTimeZone } from '../api/time';
import { getStates, changeState } from '../api/states';
import { usePermissions } from '../hooks/usePermissions';
import { canChangeRunState, canViewSystem } from '../lib/permissions/zm-permissions';
import { useDeniedControl } from '../hooks/useDeniedControl';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import { markPermissionDenied, useIsPermissionDenied } from '../stores/permissions';
import { AccountPermissionsCard } from '../components/settings/AccountPermissionsCard';
import { getSession } from '../services/sessions';
import { useToast } from '../hooks/use-toast';
import { log, LogLevel } from '../lib/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { NotificationBadge } from '../components/NotificationBadge';

export default function Server() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentProfile: singleProfile } = useCurrentProfile();
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  const [pickedProfileId, setPickedProfileId] = useState<ProfileId | undefined>(undefined);
  const defaultPickedId = isAllMode ? (pickedProfileId ?? scope.profiles[0]?.id) : undefined;
  const { profile: allModeProfile } = useProfileById(defaultPickedId);
  // Single mode: the page's own current profile, byte-identical to before.
  // All mode: the picked profile (defaults to the first one in scope).
  const currentProfile = isAllMode ? allModeProfile : singleProfile;
  const bandwidth = useBandwidthSettings();
  const authSlice = useAuthSlice(currentProfile?.id ?? null);
  const version = authSlice.version;
  const apiVersion = authSlice.apiVersion;
  const isAuthenticated = authSlice.isAuthenticated;
  const [selectedAction, setSelectedAction] = useState<string>('');

  // Fetch server information
  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: queryKeys.servers(currentProfile?.id),
    queryFn: () => getServers(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Fetch daemon status
  const { data: isDaemonRunning, isLoading: daemonLoading } = useQuery({
    queryKey: queryKeys.daemonCheck(currentProfile?.id),
    queryFn: () => getDaemonCheck(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.daemonCheckInterval,
  });

  // The newest Server_Stats row: where ZoneMinder's console reads Load, Cpu
  // and Swap, so these match what the web portal shows.
  const { data: serverStat, isLoading: statLoading } = useQuery({
    queryKey: queryKeys.serverStats(currentProfile?.id),
    queryFn: () => getLatestServerStat(
      getSession(currentProfile!.id).client,
      formatForServerInTz(
        new Date(Date.now() - SERVER_STATS_WINDOW_MINUTES * 60_000),
        resolveProfileTimezone(currentProfile!.timezone),
      ),
    ),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Live load average, only when the server has no recent stats row (zmstats
  // not running, or a ZoneMinder older than the stats filter).
  const { data: loadData, isLoading: loadLoading } = useQuery({
    queryKey: queryKeys.serverLoad(currentProfile?.id),
    queryFn: () => getLoad(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated && !statLoading && serverStat?.CpuLoad === undefined,
  });

  // Fetch states
  const { data: states, isLoading: statesLoading } = useQuery({
    queryKey: queryKeys.states(currentProfile?.id),
    queryFn: () => getStates(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Fetch timezone
  const { data: timezone } = useQuery({
    queryKey: queryKeys.timezone(currentProfile?.id),
    queryFn: () => getServerTimeZone(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Fetch storages
  const { data: storages } = useQuery({
    queryKey: queryKeys.storages(currentProfile?.id),
    queryFn: () => getStorages(getSession(currentProfile!.id).client),
    enabled: !!currentProfile && isAuthenticated,
  });

  // Mutation for state change
  const changeStateMutation = useMutation({
    mutationFn: (stateName: string) => changeState(getSession(currentProfile!.id).client, stateName),
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: t('server.state_applied'),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.states(currentProfile?.id) });
      log.server('State/action applied', LogLevel.INFO, { action: effectiveAction });
    },
    onError: (error) => {
      // System View can read the states but not change them, and an account
      // that cannot read its own permissions is not gated in advance at all -
      // so this refusal is the only thing that can explain itself (refs #344).
      const refused = isPermissionDenied(error) && !!currentProfile;
      if (refused) markPermissionDenied(currentProfile.id, 'run-state');
      toast({
        title: t('common.error'),
        description: refused
          ? t('server.run_state_permission_denied')
          : t('server.state_apply_failed'),
        variant: 'destructive',
      });
      log.server('Failed to apply state/action', LogLevel.ERROR, error);
    },
  });

  // Find active state
  const activeState = states?.find((s) => s.IsActive === '1');

  // The dropdown defaults to the active state until the user picks something.
  // Derived rather than synced through an effect, which cost a second render
  // on every states fetch (refs #281).
  const effectiveAction = selectedAction || activeState?.Name || '';

  const handleApply = () => {
    if (effectiveAction) {
      changeStateMutation.mutate(effectiveAction);
    }
  };

  // Changing the run state needs System: Edit (StatesController). Greyed rather
  // than hidden: a System View account may legitimately read the current state,
  // and the greyed button is what tells an administrator why it is inert
  // (refs #344).
  const { permissions } = usePermissions(currentProfile?.id);
  const runStateRefused = useIsPermissionDenied(currentProfile?.id, 'run-state');
  const applyProps = useDeniedControl({
    denied: canChangeRunState(permissions) === 'denied' || runStateRefused,
    message: t('server.run_state_permission_denied'),
    onClick: handleApply,
    className: 'flex items-center gap-2',
  });

  const formatMemory = (bytes: number | undefined) => {
    if (!bytes) return t('common.unknown');
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const isMultiServer = servers && servers.length > 1;
  const liveLoad = Array.isArray(loadData?.load) ? loadData.load[0] : loadData?.load;
  const load = serverStat?.CpuLoad ?? liveLoad;
  const swapTotal = serverStat?.TotalSwap;
  const swapUsed = swapTotal && serverStat?.FreeSwap !== undefined ? swapTotal - serverStat.FreeSwap : undefined;
  // The console truncates the swap percentage and rounds the storage one.
  const swapPercent = swapTotal && swapUsed !== undefined ? Math.trunc((100 * swapUsed) / swapTotal) : undefined;
  const swapLevel = swapPercent !== undefined
    ? zmUsageLevel(swapPercent, ZM_SWAP_USAGE_WARN_PERCENT, ZM_SWAP_USAGE_DANGER_PERCENT)
    : undefined;
  const levelClass = { danger: 'text-destructive', warning: 'text-orange-600 dark:text-orange-400' };

  return (
    <PageContainer spacing="none" className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">
              {t('server.title')}
            </h1>
            <NotificationBadge />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
            {t('server.subtitle')}
          </p>
        </div>
        <RefreshButton
          size="sm"
          data-testid="server-refresh-button"
        />
      </div>

      {isAllMode && (
        <ProfilePicker
          profiles={scope?.profiles ?? []}
          value={defaultPickedId}
          onChange={setPickedProfileId}
        />
      )}

      {/* Version Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            <CardTitle>{t('server.version_info')}</CardTitle>
          </div>
          <CardDescription>{t('server.version_info_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/50 border">
              <div className="text-sm font-medium text-muted-foreground">
                {t('server.zm_version')}
              </div>
              <div className="text-lg font-bold mt-1">{version || t('common.unknown')}</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50 border">
              <div className="text-sm font-medium text-muted-foreground">
                {t('server.api_version')}
              </div>
              <div className="text-lg font-bold mt-1">{apiVersion || t('common.unknown')}</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50 border">
              <div className="text-sm font-medium text-muted-foreground">
                {t('server.timezone')}
              </div>
              <div className="text-lg font-bold mt-1 break-words">{timezone || t('common.unknown')}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Server Metrics: the same figures, rules and warning colours as
          ZoneMinder's console navbar, for the server answering the API. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Load Average */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">{t('server.load_average')}</CardTitle>
              </div>
              {(statLoading || loadLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-load">
              {load !== undefined ? load.toFixed(2) : '--'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t('server.load_desc')}</p>
          </CardContent>
        </Card>

        {/* CPU */}
        {serverStat?.CpuUsagePercent !== undefined && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">{t('server.cpu_load')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-cpu">
                {serverStat.CpuUsagePercent.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        )}

        {/* Storage: one line per enabled area */}
        {storages && storages.some((s) => s.Enabled) && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">{t('server.storage_title')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {storages.filter((s) => s.Enabled).map((storage) => {
                const total = storage.DiskTotalSpace;
                const used = storage.DiskUsedSpace;
                const percent = total && used != null ? Math.round((used / total) * 100) : undefined;
                const level = percent !== undefined
                  ? zmUsageLevel(percent, ZM_STORAGE_USAGE_WARN_PERCENT, ZM_STORAGE_USAGE_DANGER_PERCENT)
                  : undefined;
                return (
                  <div key={storage.Id} className="min-w-0">
                    <div
                      className={`text-sm font-semibold truncate ${level ? levelClass[level] : ''}`}
                      title={storage.Name}
                      data-testid={`stat-storage-${storage.Id}`}
                    >
                      {storage.Name}: {percent !== undefined ? `${percent}%` : '--'}
                    </div>
                    {total && used != null && (
                      <div className="text-xs text-muted-foreground" data-testid={`stat-storage-detail-${storage.Id}`}>
                        {t('server.used_of_total', { used: zmHumanFilesize(used), total: zmHumanFilesize(total) })}
                      </div>
                    )}
                    {storage.DiskSpace != null && storage.DiskSpace >= 0 && storage.DiskSpace !== used && (
                      <div className="text-xs text-muted-foreground" data-testid={`stat-storage-events-${storage.Id}`}>
                        {t('server.used_by_events', { size: zmHumanFilesize(storage.DiskSpace) })}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Swap: hidden when the server has none, as in the console */}
        {swapPercent !== undefined && swapTotal && swapUsed !== undefined && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{t('server.swap')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${swapLevel ? levelClass[swapLevel] : ''}`} data-testid="stat-swap">
                  {swapPercent}%
                </div>
                <p className="text-xs text-muted-foreground mt-1" data-testid="stat-swap-detail">
                  {t('server.used_of_total', { used: zmHumanFilesize(swapUsed), total: zmHumanFilesize(swapTotal) })}
                </p>
              </CardContent>
            </Card>
        )}

        {/* Server Status: multi-server installs list each server below */}
        {!isMultiServer && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{t('server.status')}</CardTitle>
                </div>
                {(serversLoading || daemonLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={isDaemonRunning ? 'default' : 'destructive'}>
                    {isDaemonRunning ? t('common.running') : t('common.stopped')}
                  </Badge>
                </div>
                {servers?.[0]?.Hostname && (
                  <p className="text-xs text-muted-foreground">
                    {t('server.hostname')}: {servers[0].Hostname}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Server Details: all servers */}
      {servers && servers.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5 text-primary" />
              <CardTitle>
                {isMultiServer ? t('server.servers_title') : t('server.details')}
              </CardTitle>
            </div>
            <CardDescription>
              {isMultiServer ? t('server.servers_desc') : t('server.details_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4" data-testid="server-details-list">
              {servers.map((srv) => {
                const statusRunning = srv.Status === 'Running';
                return (
                  <div
                    key={srv.Id}
                    className="p-4 rounded-lg bg-muted/50 border"
                    data-testid={`server-card-${srv.Id}`}
                  >
                    {/* Header row: name + status */}
                    <div className="flex items-center justify-between mb-3 min-w-0">
                      <div className="min-w-0">
                        <div className="font-semibold text-base truncate" title={srv.Name}>
                          {srv.Name}
                        </div>
                        {srv.Hostname && (
                          <div className="text-xs text-muted-foreground truncate" title={srv.Hostname}>
                            {srv.Hostname}
                          </div>
                        )}
                      </div>
                      <Badge
                        variant={statusRunning ? 'default' : 'destructive'}
                        className="ml-2 flex-shrink-0"
                      >
                        {srv.Status || t('common.unknown')}
                      </Badge>
                    </div>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* CPU */}
                      {srv.CpuUsagePercent !== undefined && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Cpu className="h-3 w-3" />
                            <span>{t('server.cpu_load')}</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {srv.CpuUsagePercent.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      {srv.CpuUsagePercent === undefined && srv.CpuLoad !== undefined && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Cpu className="h-3 w-3" />
                            <span>{t('server.cpu_load')}</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {(srv.CpuLoad * 100).toFixed(1)}%
                          </div>
                        </div>
                      )}

                      {/* Total Memory */}
                      {srv.TotalMem !== undefined && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MemoryStick className="h-3 w-3" />
                            <span>{t('server.total_memory')}</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {formatMemory(srv.TotalMem)}
                          </div>
                        </div>
                      )}

                      {/* Free Memory */}
                      {srv.FreeMem !== undefined && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            {t('server.free_memory')}
                          </div>
                          <div className="text-sm font-semibold">
                            {formatMemory(srv.FreeMem)}
                          </div>
                        </div>
                      )}

                      {/* Swap */}
                      {srv.TotalSwap !== undefined && srv.FreeSwap !== undefined && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">{t('server.swap')}</div>
                          <div className="text-sm font-semibold">
                            {formatMemory(srv.FreeSwap)} / {formatMemory(srv.TotalSwap)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ZM service badges */}
                    {(srv.zmstats !== undefined || srv.zmaudit !== undefined ||
                      srv.zmtrigger !== undefined || srv.zmeventnotification !== undefined) && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {srv.zmstats !== undefined && (
                          <Badge variant={srv.zmstats ? 'default' : 'secondary'} className="text-xs">
                            zmstats
                          </Badge>
                        )}
                        {srv.zmaudit !== undefined && (
                          <Badge variant={srv.zmaudit ? 'default' : 'secondary'} className="text-xs">
                            zmaudit
                          </Badge>
                        )}
                        {srv.zmtrigger !== undefined && (
                          <Badge variant={srv.zmtrigger ? 'default' : 'secondary'} className="text-xs">
                            zmtrigger
                          </Badge>
                        )}
                        {srv.zmeventnotification !== undefined && (
                          <Badge variant={srv.zmeventnotification ? 'default' : 'secondary'} className="text-xs">
                            zmeventnotificationNg
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storage Areas */}
      {storages && storages.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <CardTitle>{t('server.storage_title')}</CardTitle>
            </div>
            <CardDescription>{t('server.storage_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" data-testid="storage-list">
              {storages.filter((s) => s.Enabled).map((storage) => {
                const serverName = servers?.find((s) => s.Id === storage.ServerId)?.Name;
                const totalGB = storage.DiskTotalSpace
                  ? (storage.DiskTotalSpace / (1024 * 1024 * 1024)).toFixed(1)
                  : null;
                // Free, not used: ZoneMinder's DiskUsedSpace is total minus
                // available, so it counts the filesystem's root-reserved blocks
                // (5% on ext4) as used. Free matches df's Avail (refs #539).
                const freeGB = storage.DiskTotalSpace && storage.DiskUsedSpace
                  ? ((storage.DiskTotalSpace - storage.DiskUsedSpace) / (1024 * 1024 * 1024)).toFixed(1)
                  : null;
                const usagePercent =
                  storage.DiskTotalSpace && storage.DiskUsedSpace
                    ? ((storage.DiskUsedSpace / storage.DiskTotalSpace) * 100).toFixed(0)
                    : null;

                return (
                  <div
                    key={storage.Id}
                    className="p-3 rounded-lg bg-muted/50 border"
                    data-testid={`storage-card-${storage.Id}`}
                  >
                    <div className="flex items-center justify-between mb-1 min-w-0">
                      <div className="font-medium text-sm truncate min-w-0" title={storage.Name}>
                        {storage.Name}
                      </div>
                      {serverName && (
                        <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
                          {serverName}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate" title={storage.Path ?? undefined}>
                      {storage.Path}
                    </div>
                    {/* DiskSpace is ZoneMinder's running total of event sizes, not
                        a live sum, so it can drift below zero; zmaudit resyncs it
                        (refs #539). */}
                    {storage.DiskSpace != null && (storage.DiskSpace < 0 ? (
                      <div className="text-xs text-orange-600 dark:text-orange-400 mt-1" data-testid={`storage-events-drifted-${storage.Id}`}>
                        {t('server.storage_events_drifted')}
                      </div>
                    ) : (
                      <div className="text-xs mt-1" data-testid={`storage-events-${storage.Id}`}>
                        {t('server.storage_events')}: {zmHumanFilesize(storage.DiskSpace)}
                      </div>
                    ))}
                    {totalGB && freeGB && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span data-testid={`storage-free-${storage.Id}`}>
                            {freeGB} GB {t('server.storage_free')}
                          </span>
                          <span data-testid={`storage-total-${storage.Id}`}>
                            {totalGB} GB {t('server.storage_total')}
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              Number(usagePercent) > 90
                                ? 'bg-red-500'
                                : Number(usagePercent) > 75
                                  ? 'bg-yellow-500'
                                  : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min(Number(usagePercent), 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ZoneMinder Control */}
      <AccountPermissionsCard profileId={currentProfile?.id} />

      {/* ZoneMinder control. states.json needs System View, so an account
          without it has nothing to show here rather than an empty picker
          (refs #344). */}
      {canViewSystem(permissions) !== 'denied' && (
      <Card data-testid="server-zm-control-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            <CardTitle>{t('server.zm_control')}</CardTitle>
          </div>
          <CardDescription>{t('server.zm_control_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  {t('server.current_state')}
                </div>
                <div className="flex items-center gap-2">
                  {statesLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : activeState ? (
                    <Badge variant="outline" className="text-base px-3 py-1">
                      {activeState.Name}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-base px-3 py-1">
                      {t('common.unknown')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                {t('server.select_action')}
              </div>
              <div className="flex gap-2">
                <Select value={effectiveAction} onValueChange={setSelectedAction}>
                  <SelectTrigger className="flex-1 [&>span]:!block [&>span]:!overflow-visible" data-testid="server-state-select">
                    <SelectValue placeholder={t('server.select_state_or_action')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="start">
                      <div className="flex items-center gap-2 w-full">
                        <Play className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{t('server.start')}</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="stop">
                      <div className="flex items-center gap-2 w-full">
                        <Square className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{t('server.stop')}</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="restart">
                      <div className="flex items-center gap-2 w-full">
                        <RotateCw className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{t('server.restart')}</span>
                      </div>
                    </SelectItem>
                    {states && states.length > 0 && states.map((state) => (
                      <SelectItem key={state.Id} value={state.Name}>
                        <div className="flex items-center gap-2 w-full">
                          <span className="flex-1 truncate">{state.Name}</span>
                          {state.IsActive === '1' && (
                            <Badge variant="secondary" className="text-xs whitespace-nowrap">
                              {t('server.active')}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  {...applyProps}
                  disabled={!effectiveAction || changeStateMutation.isPending}
                  data-testid="server-apply-button"
                >
                  {changeStateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                  {t('server.apply')}
                </Button>
              </div>
              {changeStateMutation.isPending && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('server.executing_action')}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}
    </PageContainer>
  );
}
