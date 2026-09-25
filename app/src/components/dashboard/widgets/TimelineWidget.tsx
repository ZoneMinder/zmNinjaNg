import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getEvents } from '../../../api/events';
import { getSession } from '../../../services/sessions';
import { staggeredRefetchInterval } from '../../../lib/query/stagger-interval';
import { ErrorBanner } from '../../ui/query-state';
import { resolveQueryError } from '../../../lib/query/query-error';
import type { EventData, ProfileId } from '../../../api/types';
import type { ProfileError } from '../../../api/scoped-types';
import { formatForServer, formatLocalDateTime } from '../../../lib/time';
import {
    subHours,
    subDays,
    startOfHour,
    endOfHour,
    startOfDay,
    endOfDay,
    eachHourOfInterval,
    eachDayOfInterval,
    differenceInHours
} from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../theme-provider';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../../hooks/useDateTimeFormat';
import { Button } from '../../ui/button';
import { useBandwidthSettings } from '../../../hooks/useBandwidthSettings';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { useGroupByServerScope } from '../../../hooks/useGroupByServerScope';
import { queryKeys } from '../../../lib/query/query-keys';
import { eventInstant } from '../../../lib/event/event-instant';

type TimeRange = '24h' | '48h' | '1w' | '2w' | '1m';

const THEME_TOOLTIP_COLORS = {
    cream: { background: '#ece5d8', border: '#d4c9b8' },
    light: { background: '#ffffff', border: '#e5e7eb' },
    slate: { background: '#1e293b', border: '#334155' },
    amber: { background: '#262320', border: '#3d3731' },
    dark: { background: '#1f2937', border: '#374151' },
    system: { background: '#1f2937', border: '#374151' },
} as const;

const getTooltipColors = (theme: string) =>
    THEME_TOOLTIP_COLORS[theme as keyof typeof THEME_TOOLTIP_COLORS] ?? THEME_TOOLTIP_COLORS.dark;

export const TimelineWidget = memo(function TimelineWidget() {
    const { theme } = useTheme();
    const { t } = useTranslation();
    const { fmtDate, fmtWeekday, fmtTimeShort, fmtDateTimeShort } = useDateTimeFormat();
    const navigate = useNavigate();
    const bandwidth = useBandwidthSettings();
    const scope = useProfileScope();
    const profiles = scope?.profiles ?? [];
    const groupByServer = !!useGroupByServerScope('eventsGroupByServer');
    const [start, setStart] = useState(() => subHours(new Date(), 24));
    const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Use ref for "now" to avoid infinite re-renders - updated when range changes
    const nowRef = useRef(new Date());
    const now = nowRef.current;

    // Track container resize to force chart re-render (debounced to prevent infinite loops)
    useEffect(() => {
        if (!containerRef.current) return;

        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const resizeObserver = new ResizeObserver((entries) => {
            // Debounce resize events to prevent rapid state updates
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    setContainerSize(prev => {
                        // Only update if size actually changed
                        if (prev.width === width && prev.height === height) return prev;
                        return { width, height };
                    });
                }
            }, 100);
        });

        resizeObserver.observe(containerRef.current);

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            resizeObserver.disconnect();
        };
    }, []);

    // One query per profile in scope - single mode's array of one shares the
    // exact key+session the old single query used (byte-identical). All
    // mode merges raw events across profiles for the bucket counts below;
    // each event keeps its owner's id so group-by-server can stack the
    // counts per server.
    // Partial-failure tolerant: one profile's error never blanks the chart
    // once another profile has data (mirrors useScopedEvents' anyHasData) -
    // but zero data AND at least one error still needs the error branch
    // below (zero-data suppression, same rule Montage.tsx applies).
    const { events: mergedEvents, errors } = useQueries({
        queries: profiles.map((p, i) => ({
            queryKey: queryKeys.eventsTimelineWidget(p.id, start.getTime()),
            queryFn: () => getEvents(getSession(p.id).client, p.id, {
                startDateTime: formatForServer(start),
                limit: 1000,
            }),
            refetchInterval: staggeredRefetchInterval(i, profiles.length, bandwidth.timelineHeatmapInterval),
        })),
        combine: (results) => {
            // Tag each event with its OWNING profile's timezone so the hour/day
            // buckets below use the real chronological instant (eventInstant),
            // not a naive local Date parse of the server wall-clock string -
            // required once All mode can merge events from more than one
            // profile/timezone (refs #337).
            const events: { item: EventData; timezone: string; profileId: ProfileId }[] = [];
            const errors: ProfileError[] = [];
            profiles.forEach((p, i) => {
                const q = results[i];
                if (!q) return;
                if (q.data) events.push(...q.data.events.map((item) => ({ item, timezone: p.timezone ?? 'UTC', profileId: p.id })));
                if (q.error) errors.push({ profileId: p.id, profileName: p.name, error: q.error });
            });
            return { events, errors };
        },
    });

    // Quick range handlers - update nowRef when range changes
    const setRange = useCallback((hours: number, range: TimeRange) => {
        nowRef.current = new Date();
        setStart(subHours(nowRef.current, hours));
        setSelectedRange(range);
    }, []);

    const setRangeDays = useCallback((days: number, range: TimeRange) => {
        nowRef.current = new Date();
        setStart(subDays(nowRef.current, days));
        setSelectedRange(range);
    }, []);

    // Intelligently aggregate events and format x-axis based on time range and widget width
    const { data, tickFormatter, tickInterval } = useMemo(() => {
        const hoursDiff = differenceInHours(now, start);
        const widthInPixels = containerSize.width || 400;

        // Calculate how many labels we can fit based on widget width
        const avgLabelWidth = 60; // pixels per label
        const maxLabels = Math.floor(widthInPixels / avgLabelWidth);

        if (hoursDiff <= 24) {
            // 24 hours: Show hours, mark with time
            const intervals = eachHourOfInterval({ start, end: now });
            const chartData = intervals.map(interval => {
                const intervalStart = startOfHour(interval);
                const intervalEnd = endOfHour(interval);
                const count = mergedEvents.filter(e => {
                    const eventTime = new Date(eventInstant(e.item, e.timezone));
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                const hour = interval.getHours();
                let timeLabel: string;
                // Show hour, and mark midnight/noon
                if (hour === 0) {
                    timeLabel = fmtDate(interval);
                } else if (hour === 12) {
                    timeLabel = '12pm';
                } else {
                    timeLabel = fmtTimeShort(interval);
                }

                return {
                    time: timeLabel,
                    fullTime: fmtDateTimeShort(interval),
                    count,
                    intervalStart,
                    intervalEnd,
                    rawTime: interval,
                };
            });

            const tickInterval = Math.max(1, Math.floor(intervals.length / Math.min(maxLabels, 12)));
            const tickFormatter = (value: string) => value;

            return { data: chartData, tickFormatter, tickInterval };

        } else if (hoursDiff <= 72) {
            // 48-72 hours: Show hours with day names
            const intervals = eachHourOfInterval({ start, end: now });
            const chartData = intervals.map(interval => {
                const intervalStart = startOfHour(interval);
                const intervalEnd = endOfHour(interval);
                const count = mergedEvents.filter(e => {
                    const eventTime = new Date(eventInstant(e.item, e.timezone));
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                const hour = interval.getHours();
                let timeLabel: string;
                // Mark day boundaries prominently
                if (hour === 0) {
                    timeLabel = fmtDate(interval);
                } else if (hour === 12) {
                    timeLabel = '12pm';
                } else {
                    timeLabel = fmtTimeShort(interval);
                }

                return {
                    time: timeLabel,
                    fullTime: fmtDateTimeShort(interval),
                    count,
                    intervalStart,
                    intervalEnd,
                    rawTime: interval,
                };
            });

            // Show more frequent ticks for 48-72 hours to ensure day markers are visible
            const tickInterval = Math.max(1, Math.floor(intervals.length / Math.min(maxLabels, 12)));
            const tickFormatter = (value: string) => value;

            return { data: chartData, tickFormatter, tickInterval };

        } else if (hoursDiff <= 168) {
            // 1 week: Show days
            const intervals = eachDayOfInterval({ start, end: now });
            const chartData = intervals.map(interval => {
                const intervalStart = startOfDay(interval);
                const intervalEnd = endOfDay(interval);
                const count = mergedEvents.filter(e => {
                    const eventTime = new Date(eventInstant(e.item, e.timezone));
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                return {
                    time: fmtWeekday(interval),
                    fullTime: fmtDate(interval),
                    count,
                    intervalStart,
                    intervalEnd,
                    rawTime: interval,
                };
            });

            const tickInterval = Math.max(0, Math.floor(intervals.length / Math.min(maxLabels, 7)));
            const tickFormatter = (value: string) => value;

            return { data: chartData, tickFormatter, tickInterval };

        } else if (hoursDiff <= 336) {
            // 2 weeks: Show dates, emphasize Mondays
            const intervals = eachDayOfInterval({ start, end: now });
            const chartData = intervals.map(interval => {
                const intervalStart = startOfDay(interval);
                const intervalEnd = endOfDay(interval);
                const count = mergedEvents.filter(e => {
                    const eventTime = new Date(eventInstant(e.item, e.timezone));
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                const dayOfWeek = interval.getDay();
                let timeLabel: string;
                // Show Mondays prominently, other days with just the date
                if (dayOfWeek === 1) {
                    timeLabel = fmtDate(interval); // Monday
                } else {
                    timeLabel = String(interval.getDate()).padStart(2, '0');
                }

                return {
                    time: timeLabel,
                    fullTime: fmtDate(interval),
                    count,
                    intervalStart,
                    intervalEnd,
                    rawTime: interval,
                };
            });

            const tickInterval = Math.max(0, Math.floor(intervals.length / Math.min(maxLabels, 10)));
            const tickFormatter = (value: string) => value;

            return { data: chartData, tickFormatter, tickInterval };

        } else {
            // 1 month: Show weeks (Mondays) and month boundaries
            const intervals = eachDayOfInterval({ start, end: now });
            const chartData = intervals.map(interval => {
                const intervalStart = startOfDay(interval);
                const intervalEnd = endOfDay(interval);
                const count = mergedEvents.filter(e => {
                    const eventTime = new Date(eventInstant(e.item, e.timezone));
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                const dayOfWeek = interval.getDay();
                const dayOfMonth = interval.getDate();
                let timeLabel: string;
                // Show week starts (Mondays) and month boundaries
                if (dayOfMonth === 1) {
                    timeLabel = fmtDate(interval); // First of month
                } else if (dayOfWeek === 1) {
                    timeLabel = String(interval.getDate()).padStart(2, '0'); // Monday
                } else {
                    timeLabel = '';
                }

                return {
                    time: timeLabel,
                    fullTime: fmtDate(interval),
                    count,
                    intervalStart,
                    intervalEnd,
                    rawTime: interval,
                };
            });

            const tickInterval = Math.max(0, Math.floor(intervals.length / Math.min(maxLabels, 8)));
            const tickFormatter = (value: string) => value;

            return { data: chartData, tickFormatter, tickInterval };
        }
    // Use mergedEvents (the array) for more stable dependency - only recalc when events actually change
    }, [start, now, mergedEvents, containerSize.width, fmtDate, fmtWeekday, fmtTimeShort, fmtDateTimeShort]);

    // Grouped by server: each bucket also counts every server's own events
    // under server_<index>, one stacked series per server in scope order.
    const chartData = useMemo(() => {
        if (!groupByServer || !scope) return data;
        return data.map((bucket) => ({
            ...bucket,
            ...Object.fromEntries(scope.profiles.map((p, i) => [`server_${i}`, mergedEvents.filter((e) => {
                const eventTime = new Date(eventInstant(e.item, e.timezone));
                return e.profileId === p.id && eventTime >= bucket.intervalStart && eventTime <= bucket.intervalEnd;
            }).length])),
        }));
    }, [groupByServer, data, scope, mergedEvents]);

    // Memoize tooltip styles to prevent re-renders
    const tooltipContentStyle = useMemo(() => {
        const colors = getTooltipColors(theme);
        return {
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderRadius: '0.5rem',
            fontSize: '12px'
        };
    }, [theme]);

    const tooltipLabelFormatter = useCallback((value: string, payload: readonly any[]) => {
        if (payload && payload[0]) {
            return payload[0].payload.fullTime;
        }
        return value;
    }, []);

    // Handle bar click - navigate to events with time filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts onClick payload is untyped
    const handleBarClick = useCallback((data: any) => {
        if (data && data.intervalStart && data.intervalEnd) {
            navigate(`/events?startDateTime=${formatLocalDateTime(data.intervalStart)}&endDateTime=${formatLocalDateTime(data.intervalEnd)}`, {
                state: { from: '/dashboard' }
            });
        }
    }, [navigate]);

    return (
        <div ref={containerRef} className="w-full h-full flex flex-col p-2 gap-2">
            <div className="flex flex-wrap gap-1 shrink-0">
                <Button
                    variant={selectedRange === '24h' ? 'default' : 'outline'}
                    aria-pressed={selectedRange === '24h'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRange(24, '24h')}
                >
                    {t('events.past_24_hours')}
                </Button>
                <Button
                    variant={selectedRange === '48h' ? 'default' : 'outline'}
                    aria-pressed={selectedRange === '48h'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRange(48, '48h')}
                >
                    {t('events.past_48_hours')}
                </Button>
                <Button
                    variant={selectedRange === '1w' ? 'default' : 'outline'}
                    aria-pressed={selectedRange === '1w'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(7, '1w')}
                >
                    {t('events.past_week')}
                </Button>
                <Button
                    variant={selectedRange === '2w' ? 'default' : 'outline'}
                    aria-pressed={selectedRange === '2w'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(14, '2w')}
                >
                    {t('events.past_2_weeks')}
                </Button>
                <Button
                    variant={selectedRange === '1m' ? 'default' : 'outline'}
                    aria-pressed={selectedRange === '1m'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(30, '1m')}
                >
                    {t('events.past_month')}
                </Button>
            </div>
            {mergedEvents.length === 0 && errors.length > 0 ? (
                <ErrorBanner message={resolveQueryError(errors[0].error, t)} className="m-2" />
            ) : (
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                    <XAxis
                        dataKey="time"
                        stroke="#888888"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        interval={tickInterval}
                        tickFormatter={tickFormatter}
                        angle={0}
                        textAnchor="middle"
                        height={30}
                    />
                    <YAxis
                        stroke="#888888"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                    />
                    <Tooltip
                        contentStyle={tooltipContentStyle}
                        labelFormatter={tooltipLabelFormatter}
                    />
                    {groupByServer ? (
                        // One segment per server, told apart by shade and
                        // named in the tooltip; only the top one is rounded.
                        profiles.map((p, i) => (
                            <Bar
                                key={p.id}
                                dataKey={`server_${i}`}
                                name={p.name}
                                stackId="servers"
                                fill="currentColor"
                                fillOpacity={1 - (i % 4) * 0.2}
                                radius={i === profiles.length - 1 ? [4, 4, 0, 0] : undefined}
                                className="fill-primary cursor-pointer"
                                onClick={handleBarClick}
                            />
                        ))
                    ) : (
                        <Bar
                            dataKey="count"
                            fill="currentColor"
                            radius={[4, 4, 0, 0]}
                            className="fill-primary cursor-pointer"
                            onClick={handleBarClick}
                        />
                    )}
                </BarChart>
            </ResponsiveContainer>
            </div>
            )}
        </div>
    );
});
