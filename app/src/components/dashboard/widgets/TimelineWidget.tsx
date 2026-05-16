import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getEvents } from '../../../api/events';
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
    const { fmtDate, fmtTimeShort, fmtDateTimeShort } = useDateTimeFormat();
    const navigate = useNavigate();
    const bandwidth = useBandwidthSettings();
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

    const { data: events } = useQuery({
        queryKey: ['events', 'timeline-widget', start.getTime()],
        queryFn: () => getEvents({
            startDateTime: formatForServer(start),
            limit: 1000,
        }),
        refetchInterval: bandwidth.timelineHeatmapInterval,
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
                const count = events?.events.filter(e => {
                    const eventTime = new Date(e.Event.StartDateTime);
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
                const count = events?.events.filter(e => {
                    const eventTime = new Date(e.Event.StartDateTime);
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
                const count = events?.events.filter(e => {
                    const eventTime = new Date(e.Event.StartDateTime);
                    return eventTime >= intervalStart && eventTime <= intervalEnd;
                }).length || 0;

                return {
                    time: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(interval),
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
                const count = events?.events.filter(e => {
                    const eventTime = new Date(e.Event.StartDateTime);
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
                const count = events?.events.filter(e => {
                    const eventTime = new Date(e.Event.StartDateTime);
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
    // Use events?.events (the array) for more stable dependency - only recalc when events actually change
    }, [start, now, events?.events, containerSize.width, fmtDate, fmtTimeShort, fmtDateTimeShort]);

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
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRange(24, '24h')}
                >
                    {t('events.past_24_hours')}
                </Button>
                <Button
                    variant={selectedRange === '48h' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRange(48, '48h')}
                >
                    {t('events.past_48_hours')}
                </Button>
                <Button
                    variant={selectedRange === '1w' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(7, '1w')}
                >
                    {t('events.past_week')}
                </Button>
                <Button
                    variant={selectedRange === '2w' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(14, '2w')}
                >
                    {t('events.past_2_weeks')}
                </Button>
                <Button
                    variant={selectedRange === '1m' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setRangeDays(30, '1m')}
                >
                    {t('events.past_month')}
                </Button>
            </div>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
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
                    <Bar
                        dataKey="count"
                        fill="currentColor"
                        radius={[4, 4, 0, 0]}
                        className="fill-primary cursor-pointer"
                        onClick={handleBarClick}
                    />
                </BarChart>
            </ResponsiveContainer>
            </div>
        </div>
    );
});
