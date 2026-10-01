/**
 * Quick Date Range Buttons Component
 *
 * Reusable component for selecting common date ranges (24h, 48h, week, etc.)
 * Used across Events, Timeline, EventMontage, and widget components.
 */

import { Button } from './button';
import { useTranslation } from 'react-i18next';
import { quickRangeDates } from '../../lib/time';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface QuickDateRangeButtonsProps {
  /** Callback when a date range is selected */
  onRangeSelect: (range: DateRange & { hours: number }) => void;
  /** Currently active range in hours (highlights the button) */
  activeHours?: number | null;
  /** Button variant (default: 'outline') */
  variant?: 'outline' | 'default';
  /** Button size (default: 'sm') */
  size?: 'sm' | 'default';
  /** Additional className for buttons */
  className?: string;
  /** Grid layout classes (default: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2') */
  gridClassName?: string;
}

/**
 * Renders a grid of buttons for quick date range selection.
 */
export function QuickDateRangeButtons({
  onRangeSelect,
  activeHours,
  variant = 'outline',
  size = 'sm',
  className = 'text-xs h-7 px-3',
  gridClassName = 'flex flex-wrap gap-1.5',
}: QuickDateRangeButtonsProps) {
  const { t } = useTranslation();

  const ranges = [
    {
      hours: 0,
      label: t('events.today_short'),
      fullLabel: t('events.today')
    },
    {
      hours: 4,
      label: t('events.past_4_hours_short'),
      fullLabel: t('events.past_4_hours')
    },
    {
      hours: 8,
      label: t('events.past_8_hours_short'),
      fullLabel: t('events.past_8_hours')
    },
    {
      hours: 12,
      label: t('events.past_12_hours_short'),
      fullLabel: t('events.past_12_hours')
    },
    {
      hours: 24,
      label: t('events.past_24_hours_short'),
      fullLabel: t('events.past_24_hours')
    },
    {
      hours: 48,
      label: t('events.past_48_hours_short'),
      fullLabel: t('events.past_48_hours')
    },
    {
      hours: 168,
      label: t('events.past_week_short'),
      fullLabel: t('events.past_week')
    },
    {
      hours: 336,
      label: t('events.past_2_weeks_short'),
      fullLabel: t('events.past_2_weeks')
    },
    {
      hours: 720,
      label: t('events.past_month_short'),
      fullLabel: t('events.past_month')
    },
  ];

  const handleRangeClick = (hours: number) => {
    onRangeSelect({ ...quickRangeDates(hours), hours });
  };

  return (
    <div className={gridClassName}>
      {ranges.map(({ hours, label, fullLabel }) => {
        const isActive = activeHours === hours;
        return (
          <Button
            key={hours}
            variant={isActive ? 'default' : variant}
            size={size}
            className={className}
            onClick={() => handleRangeClick(hours)}
            title={fullLabel}
            data-testid={`quick-range-${hours}`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
