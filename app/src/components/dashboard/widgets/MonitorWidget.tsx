/**
 * Monitor Widget Component
 *
 * Displays live monitor streams in dashboard widgets.
 * Features:
 * - Single or multiple monitor display
 * - Automatic grid layout for multiple monitors
 * - Respects user streaming vs snapshot preferences
 * - Periodic refresh in snapshot mode
 * - Error handling and offline states
 * - Stream URL generation with auth tokens
 * - Hover overlay with monitor name
 */

import { useMemo, memo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getMonitor, getMonitors } from '../../../api/monitors';
import { getSession } from '../../../services/sessions';
import { queryKeys } from '../../../lib/query/query-keys';
import type { MonitorFeedFit } from '../../../stores/settings';
import type { ProfileId } from '../../../api/types';
import type { MonitorRef } from '../../../stores/dashboard';
import { monitorCacheKey } from '../../../stores/monitors';
import { LiveMonitorPlayer } from '../../monitors/LiveMonitorPlayer';
import { MonitorHoverPreview } from '../../monitors/MonitorHoverPreview';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '../../ui/skeleton';
import { useTranslation } from 'react-i18next';
import { calculateGridDimensions } from '../../../lib/grid-utils';
import { filterEnabledMonitors } from '../../../lib/monitor/filters';
import { activateOnEnterOrSpace } from '../../../lib/utils';

interface MonitorWidgetProps {
    /** Single profile: monitor ids on the current profile. */
    monitorIds?: string[];
    /** Aggregate: each pick with the server that owns it (refs #529). */
    monitorRefs?: MonitorRef[];
    objectFit?: MonitorFeedFit;
}

/** A monitor to show. No profileId means the current profile, single mode. */
type WidgetPick = { profileId?: ProfileId; monitorId: string };

/**
 * Single Monitor Display Component
 * Renders a single monitor stream with error handling
 * Respects streaming vs snapshot settings from user preferences
 */
function SingleMonitor({ monitorId, objectFit, profileId }: { monitorId: string; objectFit: MonitorFeedFit; profileId?: ProfileId }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { profile: currentProfile, settings } = useProfileById(profileId);
    const [protocol, setProtocol] = useState('MJPEG');
    const { data: monitor, isLoading, error } = useQuery({
        queryKey: queryKeys.monitor(currentProfile?.id, monitorId),
        queryFn: () => getMonitor(getSession(currentProfile!.id).client, monitorId),
        enabled: !!monitorId && !!currentProfile,
    });

    if (isLoading) {
        return <Skeleton className="w-full h-full" />;
    }

    if (error || !monitor) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/30 p-4 text-center">
                <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs">{t('dashboard.offline')}</span>
            </div>
        );
    }

    if (monitor.Monitor.Deleted === true) {
        return null;
    }

    const monitorPath = profileId ? `/all/monitors/${profileId}/${monitor.Monitor.Id}` : `/monitors/${monitor.Monitor.Id}`;

    return (
        <div
            className="w-full h-full bg-black relative group overflow-hidden cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={monitor.Monitor.Name}
            onClick={() => navigate(monitorPath, { state: { from: '/dashboard' } })}
            onKeyDown={activateOnEnterOrSpace(() => navigate(monitorPath, { state: { from: '/dashboard' } }))}
        >
            {settings.hoverPreview.dashboard ? (
                <MonitorHoverPreview monitor={monitor.Monitor} profileId={profileId}>
                    <LiveMonitorPlayer
                        monitor={monitor.Monitor}
                        profile={currentProfile}
                        profileId={profileId}
                        className="w-full h-full"
                        objectFit={objectFit}
                        onProtocolChange={setProtocol}
                    />
                </MonitorHoverPreview>
            ) : (
                <LiveMonitorPlayer
                    monitor={monitor.Monitor}
                    profile={currentProfile}
                    profileId={profileId}
                    className="w-full h-full"
                    objectFit={objectFit}
                    onProtocolChange={setProtocol}
                />
            )}
            {settings.showProtocolLabel && (
                <span className="absolute bottom-1 right-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
                    {protocol}
                </span>
            )}
            {profileId && currentProfile && (
                <span
                    className="absolute top-1 left-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium truncate max-w-[100px] pointer-events-none"
                    title={currentProfile.name}
                    data-testid="widget-profile-chip"
                >
                    {currentProfile.name}
                </span>
            )}
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <p className="text-white text-xs font-medium truncate">{monitor.Monitor.Name}</p>
            </div>
        </div>
    );
}

export const MonitorWidget = memo(function MonitorWidget({ monitorIds, monitorRefs, objectFit = 'contain' }: MonitorWidgetProps) {
    const { t } = useTranslation();
    const scope = useProfileScope();

    // Picks from a server that left the scope (disabled, or dropped from the
    // group) are not shown.
    const picks = useMemo<WidgetPick[]>(() => {
        if (!monitorRefs) return (monitorIds ?? []).map((monitorId) => ({ monitorId }));
        const inScope = new Set(scope?.profiles.map((p) => p.id));
        return monitorRefs.filter((ref) => inScope.has(ref.profileId));
    }, [monitorIds, monitorRefs, scope]);

    // Single mode's one profile in scope is the current one.
    const currentId = scope?.profiles[0]?.id;
    const ownerIds = useMemo(
        () => [...new Set(picks.map((p) => p.profileId ?? currentId))].filter((id): id is ProfileId => !!id),
        [picks, currentId]
    );

    // Each owning server's monitor list, to drop deleted monitors. Arrays,
    // not Sets, so combine's structural sharing keeps them stable.
    const { enabledKeys, loadedIds } = useQueries({
        queries: ownerIds.map((id) => ({
            queryKey: queryKeys.monitors(id),
            queryFn: () => getMonitors(getSession(id).client, id),
        })),
        combine: (results) => {
            const enabledKeys: string[] = [];
            const loadedIds: ProfileId[] = [];
            results.forEach((q, i) => {
                if (!q.data) return;
                loadedIds.push(ownerIds[i]);
                for (const m of filterEnabledMonitors(q.data.monitors)) enabledKeys.push(monitorCacheKey(ownerIds[i], m.Monitor.Id));
            });
            return { enabledKeys, loadedIds };
        },
    });

    // A pick is judged only once its own server's list has arrived.
    const activePicks = useMemo(() => {
        const enabled = new Set(enabledKeys);
        const loaded = new Set(loadedIds);
        return picks.filter((p) => {
            const owner = p.profileId ?? currentId;
            return !owner || !loaded.has(owner) || enabled.has(monitorCacheKey(owner, p.monitorId));
        });
    }, [picks, enabledKeys, loadedIds, currentId]);

    if (picks.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('dashboard.no_monitors_selected')}
            </div>
        );
    }

    if (activePicks.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('dashboard.no_monitors_available')}
            </div>
        );
    }

    if (activePicks.length === 1) {
        return <SingleMonitor monitorId={activePicks[0].monitorId} objectFit={objectFit} profileId={activePicks[0].profileId} />;
    }

    // Calculate optimal grid layout for multiple monitors
    const { cols, rows } = calculateGridDimensions(activePicks.length);

    return (
        <div
            className="w-full h-full flex flex-wrap bg-black"
        >
            {activePicks.map((pick) => (
                <div
                    key={monitorCacheKey(pick.profileId, pick.monitorId)}
                    className="relative overflow-hidden"
                    style={{
                        width: `${100 / cols}%`,
                        height: `${100 / rows}%`,
                    }}
                >
                    <SingleMonitor monitorId={pick.monitorId} objectFit={objectFit} profileId={pick.profileId} />
                </div>
            ))}
        </div>
    );
});
