/**
 * Monitor Filter Popover Component
 *
 * Reusable popover component for selecting monitors with checkboxes.
 * Features:
 * - Select all/deselect all functionality
 * - Individual monitor selection
 * - Selected monitor badges with remove option
 * - Empty state handling
 */

import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorData } from '../../api/types';

export interface MonitorFilterPopoverContentProps {
  /** List of monitors to display */
  monitors: MonitorData[];
  /** Currently selected monitor IDs */
  selectedMonitorIds: string[];
  /** Callback when selection changes */
  onSelectionChange: (ids: string[]) => void;
  /** Unique ID prefix for checkbox inputs (to avoid conflicts) */
  idPrefix?: string;
  /** Controls shown to the right of the heading */
  headerActions?: ReactNode;
}

/**
 * Content for the monitor filter popover.
 * This is the inner content - parent should wrap in Popover/PopoverContent.
 */
export function MonitorFilterPopoverContent({
  monitors,
  selectedMonitorIds,
  onSelectionChange,
  idPrefix = 'monitor-filter',
  headerActions,
}: MonitorFilterPopoverContentProps) {
  const { t } = useTranslation();

  const toggleMonitorSelection = (monitorId: string) => {
    if (selectedMonitorIds.includes(monitorId)) {
      onSelectionChange(selectedMonitorIds.filter((id) => id !== monitorId));
    } else {
      onSelectionChange([...selectedMonitorIds, monitorId]);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(monitors.map((m) => m.Monitor.Id));
    } else {
      onSelectionChange([]);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm sm:text-base font-medium leading-none">
            {t('events.filters')}
          </h4>
          {headerActions}
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {t('events.select_monitor')}
        </p>
      </div>
      <div className="border rounded-md max-h-48 overflow-y-auto p-2 space-y-2">
        {monitors.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">
            {t('monitors.no_monitors')}
          </p>
        ) : (
          <>
            <div className="flex items-center space-x-2 pb-2 border-b">
              <Checkbox
                id={`${idPrefix}-select-all`}
                checked={selectedMonitorIds.length === monitors.length}
                onCheckedChange={handleSelectAll}
              />
              <label
                htmlFor={`${idPrefix}-select-all`}
                className="text-sm font-medium cursor-pointer"
              >
                {t('common.all')}
              </label>
            </div>
            {monitors.map(({ Monitor }) => (
              <div key={Monitor.Id} className="flex items-center space-x-2">
                <Checkbox
                  id={`${idPrefix}-${Monitor.Id}`}
                  checked={selectedMonitorIds.includes(Monitor.Id)}
                  onCheckedChange={() => toggleMonitorSelection(Monitor.Id)}
                />
                <label
                  htmlFor={`${idPrefix}-${Monitor.Id}`}
                  className="text-sm flex-1 cursor-pointer flex items-center justify-between"
                >
                  <span>{Monitor.Name}</span>
                  <Badge variant="outline" className="text-[10px] ml-2">
                    {t('events.id')}: {Monitor.Id}
                  </Badge>
                </label>
              </div>
            ))}
          </>
        )}
      </div>
      {selectedMonitorIds.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{t('common.selected')}:</span>
          {selectedMonitorIds.map((id) => {
            const monitor = monitors.find((m) => m.Monitor.Id === id);
            return monitor ? (
              <Badge key={id} variant="secondary" className="text-xs">
                {monitor.Monitor.Name}
                <X
                  className="h-3 w-3 ml-1 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMonitorSelection(id);
                  }}
                />
              </Badge>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
