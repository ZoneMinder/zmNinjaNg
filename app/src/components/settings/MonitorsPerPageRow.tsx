/**
 * "Monitors per page" (refs #507).
 *
 * Its own file rather than another forty lines inside LiveStreamingSection,
 * which is already at the 400-line limit (C2).
 */

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { RowLabel } from './SettingsLayout';
import { MONITOR_PAGING } from '../../lib/zmninja-ng-constants';

export function MonitorsPerPageRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="px-4 py-3 space-y-2">
      <RowLabel
        label={t('settings.monitors_per_page')}
        desc={t('settings.monitors_per_page_desc')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="monitors-per-page"
          type="number"
          min="0"
          max={MONITOR_PAGING.maxPageSize}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20"
          data-testid="settings-monitors-per-page"
        />
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => onChange(MONITOR_PAGING.off)}
            data-testid="settings-monitors-per-page-off"
          >
            {t('common.off')} ({t('settings.default')})
          </Button>
          {MONITOR_PAGING.sizeOptions.map((size) => (
            <Button
              key={size}
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => onChange(size)}
              data-testid={`settings-monitors-per-page-${size}`}
            >
              {size}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
