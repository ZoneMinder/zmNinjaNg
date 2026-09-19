/**
 * Event Timeline Heatmap Component
 *
 * Displays event density over time as a color-coded heatmap.
 * Features:
 * - Color gradient based on event density (low to high)
 * - Clickable bars to filter events by time range
 * - Responsive design with smart time bucketing
 * - Collapsible to save space
 * - Legend showing density scale
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { startOfHour, startOfDay, differenceInDays, addHours, addDays } from 'date-fns';
import type { EventData } from '../../api/types';
import { activateOnEnterOrSpace } from '../../lib/utils';
import { eventInstant } from '../../lib/event/event-instant';
import { HEATMAP_MAX_BUCKETS } from '../../lib/zmninja-ng-constants';

/** One event tagged with its OWNING profile's IANA timezone, so bucketing
 * uses the real chronological instant (eventInstant) rather than a naive
 * local Date parse of the server wall-clock string - required once events
 * from more than one profile/timezone can be merged into one heatmap
 * (refs #337). */
export interface TzEvent {
  item: EventData;
  timezone: string;
}

interface EventHeatmapProps {
  events: TzEvent[];
  startDate?: Date;
  endDate?: Date;
  onTimeRangeClick?: (startDateTime: string, endDateTime: string) => void;
  /** Whether the heatmap is collapsible (default: true). Set to false for widget mode. */
  collapsible?: boolean;
  /** Whether to show the card wrapper (default: true). Set to false for widget mode. */
  showCard?: boolean;
}

interface HeatmapBucket {
  time: Date;
  count: number;
  intensity: number; // 0-1
}

export function EventHeatmap({
  events,
  startDate,
  endDate,
  onTimeRangeClick,
  collapsible = true,
  showCard = true,
}: EventHeatmapProps) {
  const { t } = useTranslation();
  const { fmtDate, fmtTimeShort } = useDateTimeFormat();
  const [isExpanded, setIsExpanded] = useState(!collapsible);

  // Calculate time buckets and event density
  const { buckets } = useMemo(() => {
    if (!startDate || !endDate || events.length === 0) {
      return { buckets: [], maxCount: 0 };
    }

    const daysDiff = differenceInDays(endDate, startDate);

    // Determine bucket size based on time range
    const useDailyBuckets = daysDiff > 7;

    // A date filter mid-edit hands this an unusable range: a backwards one, an
    // unparseable one, or a year like 0002 from a part-typed 2026. Bucketing
    // that made hundreds of thousands of entries and crashed the page, so draw
    // nothing until the range is one a person could read (refs #495).
    const spanMs = endDate.getTime() - startDate.getTime();
    const bucketMs = useDailyBuckets ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (!Number.isFinite(spanMs) || spanMs < 0 || spanMs / bucketMs > HEATMAP_MAX_BUCKETS) {
      return { buckets: [], maxCount: 0 };
    }

    // Create buckets
    const bucketMap = new Map<string, number>();
    let current = useDailyBuckets ? startOfDay(startDate) : startOfHour(startDate);
    const end = useDailyBuckets ? startOfDay(endDate) : startOfHour(endDate);

    while (current <= end) {
      const key = current.toISOString();
      bucketMap.set(key, 0);
      current = useDailyBuckets ? addDays(current, 1) : addHours(current, 1);
    }

    // Count events in each bucket, bucketed by real chronological instant
    // (the owning profile's timezone), not a naive local Date parse.
    events.forEach(({ item, timezone }) => {
      const eventTime = new Date(eventInstant(item, timezone));
      const bucketTime = useDailyBuckets ? startOfDay(eventTime) : startOfHour(eventTime);
      const key = bucketTime.toISOString();
      if (bucketMap.has(key)) {
        bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
      }
    });

    // Find max count for normalization. Folded rather than spread into
    // Math.max: the spread passes one argument per bucket and overflows the
    // stack on a long range (refs #495).
    let maxCount = 1;
    for (const count of bucketMap.values()) {
      if (count > maxCount) maxCount = count;
    }

    // Create bucket objects
    const buckets: HeatmapBucket[] = Array.from(bucketMap.entries()).map(([key, count]) => ({
      time: new Date(key),
      count,
      intensity: count / maxCount,
    }));

    return { buckets, maxCount };
  }, [events, startDate, endDate]);

  // Get color for intensity
  const getColor = (intensity: number): string => {
    if (intensity === 0) return 'rgb(226, 232, 240)'; // slate-200
    if (intensity < 0.2) return 'rgb(191, 219, 254)'; // blue-200
    if (intensity < 0.4) return 'rgb(147, 197, 253)'; // blue-300
    if (intensity < 0.6) return 'rgb(96, 165, 250)'; // blue-400
    if (intensity < 0.8) return 'rgb(59, 130, 246)'; // blue-500
    return 'rgb(37, 99, 235)'; // blue-600
  };

  // Format time label - show ~5 labels
  const formatTimeLabel = (time: Date, index: number): string => {
    const total = buckets.length;
    if (total === 0) return '';

    // Always show first and last
    if (index === 0 || index === total - 1) {
      const daysDiff = startDate && endDate ? differenceInDays(endDate, startDate) : 0;
      return daysDiff > 7 ? fmtDate(time) : fmtTimeShort(time);
    }

    // Show 3 intermediate labels
    const step = Math.floor(total / 4);
    if (step > 0 && index % step === 0 && index !== total - 1) {
      const daysDiff = startDate && endDate ? differenceInDays(endDate, startDate) : 0;
      return daysDiff > 7 ? fmtDate(time) : fmtTimeShort(time);
    }

    return '';
  };

  const handleBarClick = (bucket: HeatmapBucket) => {
    if (!onTimeRangeClick) return;

    const daysDiff = startDate && endDate ? differenceInDays(endDate, startDate) : 0;
    const useDailyBuckets = daysDiff > 7;

    const rangeStart = bucket.time;
    const rangeEnd = useDailyBuckets ? addDays(bucket.time, 1) : addHours(bucket.time, 1);

    onTimeRangeClick(rangeStart.toISOString(), rangeEnd.toISOString());
  };

  if (buckets.length === 0) {
    return null;
  }

  const heatmapContent = (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t('events.heatmap_title', 'Event Density')}</h3>
          <span className="text-xs text-muted-foreground">
            ({t('events.heatmap_total', { count: events.length })})
          </span>
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
            title={isExpanded ? t('common.collapse') : t('common.expand')}
            aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {isExpanded && (
        <>
          <div className="relative h-12 mb-3">
            <div className="flex items-end h-full gap-px">
              {buckets.map((bucket) => (
                <div
                  key={bucket.time.toISOString()}
                  className="relative group cursor-pointer transition-opacity hover:opacity-80 h-full"
                  style={{
                    flex: '1 1 0',
                    minWidth: '4px',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${fmtDate(bucket.time)}: ${bucket.count} ${t('events.heatmap_events', 'events')}`}
                  onClick={() => handleBarClick(bucket)}
                  onKeyDown={activateOnEnterOrSpace(() => handleBarClick(bucket))}
                >
                  <div
                    className="w-full h-full rounded-sm transition-all"
                    style={{
                      backgroundColor: getColor(bucket.intensity),
                    }}
                  >
                    {/* Tooltip */}
                    {bucket.count > 0 && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {bucket.count} {t('events.heatmap_events', 'events')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* X-axis labels */}
          <div className="relative h-4 text-xs text-muted-foreground">
            <div className="relative">
              {buckets.map((bucket, bucketIndex) => {
                const label = formatTimeLabel(bucket.time, bucketIndex);
                if (!label) return null;
                const leftPercent = (bucketIndex / Math.max(buckets.length - 1, 1)) * 100;
                return (
                  <span
                    key={bucket.time.toISOString()}
                    className="absolute whitespace-nowrap text-[10px]"
                    style={{
                      left: `${leftPercent}%`,
                      transform: bucketIndex === 0 ? 'translateX(0)' : bucketIndex === buckets.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <span>{t('events.heatmap_low', 'Low')}</span>
            <div className="flex gap-1">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity) => (
                <div
                  key={intensity}
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: getColor(intensity) }}
                />
              ))}
            </div>
            <span>{t('events.heatmap_high', 'High')}</span>
          </div>
        </>
      )}
    </>
  );

  if (showCard) {
    return <Card className="p-4 mb-4">{heatmapContent}</Card>;
  }

  return <div className="w-full h-full overflow-hidden">{heatmapContent}</div>;
}
