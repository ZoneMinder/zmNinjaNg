/**
 * Events Filter Popover Component
 *
 * Extracted from Events.tsx to reduce component complexity.
 * Provides filtering UI for events by monitors, favorites, tags, and date range.
 */

import { Archive, Star, Tag, X, Loader2, ScanSearch } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorData, Tag as TagType } from '../../api/types';
import { ALL_TAGS_FILTER_ID } from '../../hooks/useEventFilters';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { PopoverContent } from '../ui/popover';
import { Switch } from '../ui/switch';
import { QuickDateRangeButtons } from '../ui/quick-date-range-buttons';
import { MonitorFilterPopoverContent } from '../filters/MonitorFilterPopover';
import { TagChip } from './TagChip';
import { cn } from '../../lib/utils';

interface EventsFilterPopoverProps {
  monitors: MonitorData[];
  /** All mode only: monitors grouped by owning server. When present, the
   *  monitor picker renders one section per server instead of the flat
   *  `monitors` list (refs #337). */
  serverGroups?: Array<{ profileId: string; profileName: string; monitors: MonitorData[] }>;
  selectedMonitorIds: string[];
  onMonitorSelectionChange: (ids: string[]) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  archivedOnly: boolean;
  onArchivedOnlyChange: (value: boolean) => void;
  startDateInput: string;
  onStartDateChange: (value: string) => void;
  endDateInput: string;
  onEndDateChange: (value: string) => void;
  onQuickRangeSelect: (range: { start: Date; end: Date }) => void;
  /** The dates are passed explicitly: applying reads them out of the fields,
   *  and the page's own applyFilters still closes over its pre-commit state
   *  (refs #193). */
  onApplyFilters: (overrides?: { startDateTime?: string; endDateTime?: string }) => void;
  onClearFilters: () => void;
  // Tags filter props
  tagsSupported?: boolean;
  availableTags?: TagType[];
  selectedTagIds?: string[];
  onTagSelectionChange?: (ids: string[]) => void;
  isLoadingTags?: boolean;
  // Object detection filter
  onlyDetectedObjects?: boolean;
  onOnlyDetectedObjectsChange?: (value: boolean) => void;
}

export function EventsFilterPopover({
  monitors,
  serverGroups,
  selectedMonitorIds,
  onMonitorSelectionChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  archivedOnly,
  onArchivedOnlyChange,
  startDateInput,
  onStartDateChange,
  endDateInput,
  onEndDateChange,
  onQuickRangeSelect,
  onApplyFilters,
  onClearFilters,
  tagsSupported = false,
  availableTags = [],
  selectedTagIds = [],
  onTagSelectionChange,
  isLoadingTags = false,
  onlyDetectedObjects = false,
  onOnlyDetectedObjectsChange,
}: EventsFilterPopoverProps) {
  const { t } = useTranslation();

  // The two date fields keep what is typed to themselves until Apply or Enter.
  // Reporting sooner - on every keystroke, or on every blur - made the page
  // start a new events query, which arrives pending with no rows, so
  // Events.tsx swapped in its loading skeleton and unmounted this panel: a
  // character was lost mid-edit, and moving from one date field to the other
  // reloaded the page underneath the user (refs #495).
  //
  // They are uncontrolled, keyed by the page's value, so typing never rewrites
  // the DOM value, and a date the page sets - a quick range, Clear, a deep
  // link - still replaces the field.
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  // Compared as instants, not strings: a field can report the same moment in a
  // different shape than the page holds (a browser with step="1" reports
  // seconds, a deep link may not), and reporting that as a change would run a
  // query for a date nobody touched.
  const dateChanged = (next: string, current: string): boolean => {
    if (next === current) return false;
    const nextMs = new Date(next).getTime();
    const currentMs = new Date(current).getTime();
    if (Number.isFinite(nextMs) && Number.isFinite(currentMs)) return nextMs !== currentMs;
    return true;
  };

  const applyDates = () => {
    const start = startRef.current?.value ?? startDateInput;
    const end = endRef.current?.value ?? endDateInput;
    if (dateChanged(start, startDateInput)) onStartDateChange(start);
    if (dateChanged(end, endDateInput)) onEndDateChange(end);
    onApplyFilters({ startDateTime: start || undefined, endDateTime: end || undefined });
  };

  const isAllTagsSelected = selectedTagIds.includes(ALL_TAGS_FILTER_ID);

  // Get selected tags for display (exclude the "All" sentinel)
  const selectedTags = availableTags.filter((tag) =>
    selectedTagIds.includes(tag.Id)
  );

  const handleTagToggle = (tagId: string) => {
    if (!onTagSelectionChange) return;
    if (tagId === ALL_TAGS_FILTER_ID) {
      // Toggle "All": mutually exclusive with individual tags
      onTagSelectionChange(isAllTagsSelected ? [] : [ALL_TAGS_FILTER_ID]);
      return;
    }
    // Selecting an individual tag deselects "All"
    const withoutAll = selectedTagIds.filter((id) => id !== ALL_TAGS_FILTER_ID);
    const newSelection = withoutAll.includes(tagId)
      ? withoutAll.filter((id) => id !== tagId)
      : [...withoutAll, tagId];
    onTagSelectionChange(newSelection);
  };

  const handleRemoveTag = (tagId: string) => {
    if (!onTagSelectionChange) return;
    onTagSelectionChange(selectedTagIds.filter((id) => id !== tagId));
  };

  return (
    <PopoverContent
      className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm max-h-[80vh] overflow-y-auto no-scrollbar"
      data-testid="events-filter-panel"
    >
      {/* Action buttons at top for mobile accessibility */}
      <div className="flex gap-2 mb-2 pb-2 border-b sticky top-0 bg-popover z-10">
        <Button onClick={applyDates} size="sm" className="flex-1" data-testid="events-apply-filters">
          {t('common.filter')}
        </Button>
        <Button
          onClick={onClearFilters}
          size="sm"
          variant="outline"
          className="flex-1"
          data-testid="events-clear-filters"
        >
          {t('common.clear')}
        </Button>
      </div>

      {serverGroups ? (
        <div className="space-y-3" data-testid="events-monitor-filter-by-server">
          {serverGroups.map((group) => {
            // All-mode selections are composite `${profileId}:${monitorId}`
            // tokens, not bare monitor ids: a bare id is only unique within
            // one server, so two groups sharing a numeric id would otherwise
            // read/write the SAME entry in the flat selection and selecting
            // one server's monitor would silently select the other's too
            // (refs #337 I6).
            const prefix = `${group.profileId}:`;
            const groupSelectedBareIds = selectedMonitorIds
              .filter((id) => id.startsWith(prefix))
              .map((id) => id.slice(prefix.length));
            // Each section's "select all" must only replace THIS group's
            // slice of the shared selection, not every other server's picks
            // too (MonitorFilterPopoverContent's handleSelectAll replaces
            // wholesale) - merge back the other groups' ids here.
            const handleGroupChange = (ids: string[]) => {
              const others = selectedMonitorIds.filter((id) => !id.startsWith(prefix));
              onMonitorSelectionChange([...others, ...ids.map((id) => `${prefix}${id}`)]);
            };
            return (
              <div key={group.profileId}>
                <h5 className="text-xs font-medium text-muted-foreground mb-1 truncate" title={group.profileName}>
                  {group.profileName}
                </h5>
                <MonitorFilterPopoverContent
                  monitors={group.monitors}
                  selectedMonitorIds={groupSelectedBareIds}
                  onSelectionChange={handleGroupChange}
                  idPrefix={`events-${group.profileId}`}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <MonitorFilterPopoverContent
          monitors={monitors}
          selectedMonitorIds={selectedMonitorIds}
          onSelectionChange={onMonitorSelectionChange}
          idPrefix="events"
        />
      )}
      <div className="grid gap-2 mt-3">
        {/* Favorites filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-yellow-500 stroke-yellow-500" />
            <Label htmlFor="favorites-only" className="cursor-pointer">
              {t('events.favorites_only')}
            </Label>
          </div>
          <Switch
            id="favorites-only"
            checked={favoritesOnly}
            onCheckedChange={onFavoritesOnlyChange}
            data-testid="events-favorites-toggle"
          />
        </div>

        {/* Archived filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="archived-only" className="cursor-pointer">
              {t('events.archived_only')}
            </Label>
          </div>
          <Switch
            id="archived-only"
            checked={archivedOnly}
            onCheckedChange={onArchivedOnlyChange}
            data-testid="events-archived-toggle"
          />
        </div>

        {/* Object detection filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="only-detected" className="cursor-pointer">
              {t('events.filter.onlyDetectedObjects')}
            </Label>
          </div>
          <Switch
            id="only-detected"
            checked={onlyDetectedObjects}
            onCheckedChange={onOnlyDetectedObjectsChange}
            data-testid="events-detected-objects-toggle"
          />
        </div>

        {/* Tags filter - only show if tags are supported */}
        {tagsSupported && (
          <div className="p-3 rounded-md border bg-card space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">{t('events.filter.tags')}</Label>
            </div>

            {/* Loading state */}
            {isLoadingTags && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('events.tags.loading')}</span>
              </div>
            )}

            {/* No tags available */}
            {!isLoadingTags && availableTags.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('events.filter.noTags')}
              </p>
            )}

            {/* Selected tags */}
            {(isAllTagsSelected || selectedTags.length > 0) && (
              <div className="flex flex-wrap gap-1.5" data-testid="events-selected-tags">
                {isAllTagsSelected && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary cursor-pointer"
                    onClick={() => handleRemoveTag(ALL_TAGS_FILTER_ID)}
                    data-testid="tag-chip-all"
                  >
                    {t('events.filter.allTags')}
                    <X className="h-3 w-3" />
                  </button>
                )}
                {selectedTags.map((tag) => (
                  <TagChip
                    key={tag.Id}
                    tag={tag}
                    removable
                    onRemove={handleRemoveTag}
                    size="md"
                  />
                ))}
              </div>
            )}

            {/* Available tags list */}
            {!isLoadingTags && availableTags.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-2">
                {/* "All" option: show events with any tag */}
                <button
                  type="button"
                  onClick={() => handleTagToggle(ALL_TAGS_FILTER_ID)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center justify-between font-medium',
                    isAllTagsSelected
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted'
                  )}
                  data-testid="tag-option-all"
                >
                  <span>{t('events.filter.allTags')}</span>
                  {isAllTagsSelected && (
                    <X className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  )}
                </button>
                {/* Individual tags */}
                {availableTags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.Id);
                  return (
                    <button
                      key={tag.Id}
                      type="button"
                      onClick={() => handleTagToggle(tag.Id)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center justify-between',
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : isAllTagsSelected
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-muted'
                      )}
                      disabled={isAllTagsSelected}
                      data-testid={`tag-option-${tag.Id}`}
                    >
                      <span className="truncate">{tag.Name}</span>
                      {isSelected && (
                        <X className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-2 mt-3">
        <div className="grid gap-2">
          <div className="grid gap-2">
            <Label htmlFor="start-date" className="text-xs">
              {t('events.date_range')} ({t('events.start')})
            </Label>
            <Input
              key={startDateInput}
              ref={startRef}
              id="start-date"
              type="datetime-local"
              defaultValue={startDateInput}
              onKeyDown={(e) => { if (e.key === 'Enter') applyDates(); }}
              step="1"
              data-testid="events-start-date"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="end-date" className="text-xs">
              {t('events.date_range')} ({t('events.end')})
            </Label>
            <Input
              key={endDateInput}
              ref={endRef}
              id="end-date"
              type="datetime-local"
              defaultValue={endDateInput}
              onKeyDown={(e) => { if (e.key === 'Enter') applyDates(); }}
              step="1"
              data-testid="events-end-date"
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">{t('events.quick_ranges')}</Label>
            <QuickDateRangeButtons onRangeSelect={onQuickRangeSelect} />
          </div>
        </div>
      </div>
    </PopoverContent>
  );
}
