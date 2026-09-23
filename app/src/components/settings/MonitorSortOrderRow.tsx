/**
 * "Monitor order" (refs #527).
 *
 * Its own file rather than another thirty lines inside LiveStreamingSection,
 * which is already at the 400-line limit (C2), matching MonitorsPerPageRow.
 */

import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsRow, RowLabel } from './SettingsLayout';
import type { MonitorSortOrder } from '../../stores/settings';

const OPTIONS: Array<{ value: MonitorSortOrder; labelKey: string }> = [
  { value: 'unsorted', labelKey: 'settings.monitor_sort_unsorted' },
  { value: 'id', labelKey: 'settings.monitor_sort_id' },
  { value: 'name', labelKey: 'settings.monitor_sort_name' },
];

export function MonitorSortOrderRow({
  value,
  onChange,
}: {
  value: MonitorSortOrder;
  onChange: (next: MonitorSortOrder) => void;
}) {
  const { t } = useTranslation();
  const label = t('settings.monitor_sort_order');

  return (
    <SettingsRow>
      <RowLabel label={label} desc={t('settings.monitor_sort_order_desc')} />
      <Select value={value} onValueChange={(next) => onChange(next as MonitorSortOrder)}>
        <SelectTrigger
          className="w-36 flex-shrink-0"
          aria-label={label}
          data-testid="settings-monitor-sort-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              data-testid={`settings-monitor-sort-${option.value}`}
            >
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
