/**
 * Events Widget Component
 *
 * Displays recent events in a scrollable list.
 * Features:
 * - Auto-refresh every 30 seconds
 * - Clickable events navigate to event detail
 * - Optional monitor filtering
 * - Server-side "Only Detected Objects" filter
 * - Client-side tag filtering (All Tagged or specific tags)
 * - Tag chips displayed per event
 * - Configurable event limit
 * - Loading and empty states
 * - All mode: fans out per profile in scope (single mode's array of one
 *   shares the exact query key/session the old single query used) and
 *   merges by true chronological instant, with a profile chip per row.
 */

import { memo, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getEvents } from '../../../api/events';
import { getSession } from '../../../services/sessions';
import { useDateTimeFormat } from '../../../hooks/useDateTimeFormat';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getEventCauseIcon } from '../../../lib/event/event-icons';
import { useBandwidthSettings } from '../../../hooks/useBandwidthSettings';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { useGroupByServerScope } from '../../../hooks/useGroupByServerScope';
import { groupByOwningProfile } from '../../../lib/profile/profile-sections';
import { ProfileSectionList } from '../../profiles/ProfileSectionList';
import { queryKeys } from '../../../lib/query/query-keys';
import { useEventTagMapping } from '../../../hooks/useEventTags';
import { TagChipList } from '../../events/TagChip';
import { ALL_TAGS_FILTER_ID } from '../../../hooks/useEventFilters';
import { activateOnEnterOrSpace } from '../../../lib/utils';
import { staggeredRefetchInterval } from '../../../lib/query/stagger-interval';
import { eventInstant } from '../../../lib/event/event-instant';
import { ErrorBanner } from '../../ui/query-state';
import { ProfileChip } from '../../ui/profile-chip';
import { resolveQueryError } from '../../../lib/query/query-error';
import type { Scoped, ProfileError } from '../../../api/scoped-types';
import type { EventData } from '../../../api/types';

interface EventsWidgetProps {
    /** Optional monitor IDs to filter events */
    monitorIds?: string[];
    /** Maximum number of events to display (default: 5) */
    limit?: number;
    /** Override auto-refresh interval in milliseconds (default: uses bandwidth settings) */
    refreshInterval?: number;
    /** Only show events with object detection results (server-side filter) */
    onlyDetectedObjects?: boolean;
    /** Tag IDs to filter by (client-side). Use ALL_TAGS_FILTER_ID for "any tagged" */
    tagIds?: string[];
}

export const EventsWidget = memo(function EventsWidget({
    monitorIds,
    limit = 5,
    refreshInterval,
    onlyDetectedObjects = false,
    tagIds = [],
}: EventsWidgetProps) {
    const { t } = useTranslation();
    const { fmtDateTimeShort } = useDateTimeFormat();
    const navigate = useNavigate();
    const bandwidth = useBandwidthSettings();
    const scope = useProfileScope();
    const profiles = scope?.profiles ?? [];
    // scope.mode, not profiles.length > 1: a single remaining profile after
    // deleting down to one WHILE still in All mode must keep chips/deep-links
    // (profiles.length > 1 collapses to the single-mode branch there, refs
    // #337).
    const isAllMode = scope?.mode === 'all';
    const groupScopeId = useGroupByServerScope('eventsGroupByServer');
    const monitorIdFilter = monitorIds?.length ? monitorIds.join(',') : undefined;
    const refetchMs = refreshInterval ?? bandwidth.eventsWidgetInterval;

    // One query per profile in scope - single mode's array of one uses the
    // exact key+session the old single useQuery used, so it shares that
    // cache entry (byte-identical). All mode's monitor id filter, if set,
    // applies identically to every profile - same v1 precedent as
    // useScopedEvents (a bare id only ever means something on one server).
    const { events, isLoading, errors } = useQueries({
        queries: profiles.map((p, i) => ({
            queryKey: queryKeys.eventsWidget(p.id, monitorIdFilter, limit, onlyDetectedObjects),
            queryFn: () => getEvents(getSession(p.id).client, p.id, {
                monitorId: monitorIdFilter,
                limit,
                sort: 'StartTime',
                direction: 'desc',
                notesRegexp: onlyDetectedObjects ? 'detected:' : undefined,
            }),
            refetchInterval: staggeredRefetchInterval(i, profiles.length, refetchMs),
        })),
        combine: (results) => {
            const scoped: Scoped<EventData>[] = [];
            const errors: ProfileError[] = [];
            let anyData = false;
            profiles.forEach((p, i) => {
                const q = results[i];
                if (!q) return;
                if (q.data) {
                    anyData = true;
                    for (const item of q.data.events) scoped.push({ profileId: p.id, profileName: p.name, item });
                }
                if (q.error) errors.push({ profileId: p.id, profileName: p.name, error: q.error });
            });
            const tzById = new Map(profiles.map((p) => [p.id, p.timezone ?? 'UTC']));
            scoped.sort((a, b) =>
                eventInstant(b.item, tzById.get(b.profileId) ?? 'UTC') - eventInstant(a.item, tzById.get(a.profileId) ?? 'UTC')
            );
            return { events: scoped.slice(0, limit), isLoading: !anyData, errors };
        },
    });

    // Fetch tags for displayed events - single-profile-only. useEventTagMapping
    // takes one profileId for the whole batch; All mode can mix event ids
    // from different servers under the same numeric id, so a shared lookup
    // risks querying the wrong server for the wrong id. ponytail:
    // cross-profile tag lookups stay out of v1 scope (refs #337), same line
    // as the spec's other stated aggregation gaps.
    const eventIds = useMemo(
        () => (isAllMode ? [] : events.map((e) => e.item.Event.Id)),
        [isAllMode, events]
    );
    const { eventTagMap } = useEventTagMapping({
        eventIds,
        enabled: eventIds.length > 0,
        profileId: profiles[0]?.id,
    });

    // Apply client-side tag filter
    const filteredEvents = useMemo(() => {
        if (tagIds.length === 0 || eventTagMap.size === 0) return events;
        const isAllTagsFilter = tagIds.includes(ALL_TAGS_FILTER_ID);
        return events.filter((e) => {
            const eTags = eventTagMap.get(e.item.Event.Id) || [];
            if (isAllTagsFilter) return eTags.length > 0;
            return eTags.some((tag) => tagIds.includes(tag.Id));
        });
    }, [events, tagIds, eventTagMap]);

    // The event rows, for the flat list or one server's section of it.
    const renderRows = (list: Scoped<EventData>[]) => (
        <div className="divide-y">
            {list.map((scopedEvent) => {
                const event = scopedEvent.item;
                const tags = eventTagMap.get(event.Event.Id) || [];
                const detailPath = isAllMode
                    ? `/all/events/${scopedEvent.profileId}/${event.Event.Id}`
                    : `/events/${event.Event.Id}`;
                return (
                    <div
                        key={`${scopedEvent.profileId}-${event.Event.Id}`}
                        className="p-3 hover:bg-muted/50 cursor-pointer transition-colors flex items-center gap-3"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(detailPath, { state: { from: '/dashboard' } })}
                        onKeyDown={activateOnEnterOrSpace(() => navigate(detailPath, { state: { from: '/dashboard' } }))}
                    >
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-sm truncate">{event.Event.Name}</span>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                    {fmtDateTimeShort(new Date(event.Event.StartDateTime.replace(' ', 'T')))}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                {(() => {
                                    const CauseIcon = getEventCauseIcon(event.Event.Cause);
                                    return (
                                        <span className="flex items-center gap-1">
                                            <CauseIcon className="h-3 w-3" />
                                            {event.Event.Cause}
                                        </span>
                                    );
                                })()}
                                <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">
                                    {event.Event.Length}s
                                </span>
                            </div>
                            {event.Event.Notes && (
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={event.Event.Notes}>
                                    {event.Event.Notes.split('|')[0].trim()}
                                </p>
                            )}
                            {(isAllMode || tags.length > 0) && (
                                <div className="flex items-center gap-1 flex-wrap mt-1">
                                    {isAllMode && (
                                        <ProfileChip
                                            name={scopedEvent.profileName}
                                            testId="widget-profile-chip"
                                        />
                                    )}
                                    {tags.length > 0 && <TagChipList tags={tags} maxVisible={3} size="sm" />}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    if (isLoading && errors.length === 0) {
        return (
            <div className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
                ))}
            </div>
        );
    }

    if (events.length === 0 && errors.length > 0) {
        return <ErrorBanner message={resolveQueryError(errors[0].error, t)} className="m-4" />;
    }

    if (!filteredEvents.length) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4">
                {t('dashboard.no_recent_events')}
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {groupScopeId ? (
                <div className="p-2">
                    <ProfileSectionList
                        sections={groupByOwningProfile(filteredEvents.map((e) => ({ ...e, profileChip: e.profileName })))}
                        surface="dashboard-events-group"
                        scopeId={groupScopeId}
                        className="space-y-3"
                        renderItems={renderRows}
                    />
                </div>
            ) : (
                renderRows(filteredEvents)
            )}
        </div>
    );
});