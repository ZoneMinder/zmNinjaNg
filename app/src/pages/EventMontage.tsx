/**
 * Event Montage Page
 *
 * Displays a grid of event thumbnails for quick visual scanning.
 * Supports custom grid layouts and filtering.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getMonitors } from '../api/monitors';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { useSettingsStore } from '../stores/settings';
import { useEventPagination } from '../hooks/useEventPagination';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RefreshCw, AlertCircle, Clock, LayoutGrid } from 'lucide-react';
import { filterEnabledMonitors } from '../lib/filters';
import { EventMontageView } from '../components/events/EventMontageView';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { EventMontageFilterPanel } from '../components/events/EventMontageFilterPanel';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/ui/empty-state';
import { log, LogLevel } from '../lib/logger';

export default function EventMontage() {
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const normalizedThumbnailFit =
    settings.eventsThumbnailFit === 'fill' ? 'contain' : settings.eventsThumbnailFit;
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter state - load from settings
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>(
    settings.eventMontageFilters.monitorIds
  );
  const [selectedCause, setSelectedCause] = useState<string>(settings.eventMontageFilters.cause);
  const [startDate, setStartDate] = useState<string>(settings.eventMontageFilters.startDate);
  const [endDate, setEndDate] = useState<string>(settings.eventMontageFilters.endDate);

  // Fetch monitors for filter
  const { data: monitorsData } = useQuery({
    queryKey: ['monitors'],
    queryFn: getMonitors,
  });

  const monitors = monitorsData?.monitors ? filterEnabledMonitors(monitorsData.monitors) : [];

  // Build filter params
  const filterParams = useMemo(() => {
    const params: Record<string, string | number> = {};

    if (selectedMonitorIds.length > 0) {
      params.monitorId = selectedMonitorIds.join(',');
    }

    if (selectedCause && selectedCause !== 'all') {
      params.cause = selectedCause;
    }

    if (startDate) {
      params.startDateTime = new Date(startDate).toISOString();
    }

    if (endDate) {
      params.endDateTime = new Date(endDate).toISOString();
    }

    params.limit = settings.defaultEventLimit || 100;
    params.sort = 'StartDateTime';
    params.direction = 'desc';

    log.eventMontage('Event montage filter params', LogLevel.DEBUG, { params });

    return params;
  }, [selectedMonitorIds, selectedCause, startDate, endDate, settings.defaultEventLimit]);

  // Fetch events
  const { data: eventsData, isLoading, error, refetch } = useQuery({
    queryKey: ['event-montage', filterParams],
    queryFn: () => getEvents(filterParams),
  });

  const events = eventsData?.events || [];

  // Use pagination hook for manual "Load More" button
  const { batchSize, isLoadingMore, loadNextPage } = useEventPagination({
    defaultLimit: settings.defaultEventLimit || 100,
  });

  // Use grid management hook
  const gridControls = useEventMontageGrid({
    initialCols: settings.eventMontageGridCols,
    containerRef,
    onGridChange: (cols) => {
      if (currentProfile) {
        updateSettings(currentProfile.id, { eventMontageGridCols: cols });
      }
    },
  });

  log.eventMontage('Event montage API results', LogLevel.DEBUG, {
    eventCount: events.length,
    settingsLimit: settings.defaultEventLimit,
  });

  // Get unique causes for filter
  const uniqueCauses = useMemo(() => {
    const causes = new Set<string>();
    events.forEach((event) => {
      if (event.Event.Cause) causes.add(event.Event.Cause);
    });
    return Array.from(causes).sort();
  }, [events]);

  const handleMonitorToggle = (monitorId: string) => {
    setSelectedMonitorIds((prev) =>
      prev.includes(monitorId) ? prev.filter((id) => id !== monitorId) : [...prev, monitorId]
    );
  };

  const handleSelectAllMonitors = () => {
    if (selectedMonitorIds.length === monitors.length) {
      setSelectedMonitorIds([]);
    } else {
      setSelectedMonitorIds(monitors.map((m) => m.Monitor.Id));
    }
  };

  const handleClearFilters = () => {
    setSelectedMonitorIds([]);
    setSelectedCause('all');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters =
    selectedMonitorIds.length > 0 || selectedCause !== 'all' || !!startDate || !!endDate;

  // Update grid state and filters when profile changes
  useEffect(() => {
    gridControls.setGridCols(settings.eventMontageGridCols);
    gridControls.setCustomCols(settings.eventMontageGridCols.toString());
    setSelectedMonitorIds(settings.eventMontageFilters.monitorIds);
    setSelectedCause(settings.eventMontageFilters.cause);
    setStartDate(settings.eventMontageFilters.startDate);
    setEndDate(settings.eventMontageFilters.endDate);
  }, [currentProfile?.id, settings.eventMontageGridCols, settings.eventMontageFilters]);

  // Persist filters to settings when they change
  useEffect(() => {
    if (!currentProfile) return;

    const timeoutId = setTimeout(() => {
      updateSettings(currentProfile.id, {
        eventMontageFilters: {
          monitorIds: selectedMonitorIds,
          cause: selectedCause,
          startDate,
          endDate,
        },
      });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [selectedMonitorIds, selectedCause, startDate, endDate, currentProfile, updateSettings]);

  const handleThumbnailFitChange = (value: string) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, {
      eventsThumbnailFit: (value === 'fill' ? 'contain' : value) as typeof settings.eventsThumbnailFit,
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="aspect-video bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('eventMontage.title')}</h1>
        </div>
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {t('eventMontage.load_error')}: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 md:space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 sm:h-5 sm:w-5" />
            {t('eventMontage.title')}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
            {t('eventMontage.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Thumbnail Fit Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">
              {t('events.thumbnail_fit')}
            </span>
            <Select value={normalizedThumbnailFit} onValueChange={handleThumbnailFitChange}>
              <SelectTrigger className="h-8 sm:h-9 w-[160px]">
                <SelectValue placeholder={t('events.thumbnail_fit')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contain">{t('montage.fit_fit')}</SelectItem>
                <SelectItem value="cover">{t('montage.fit_crop')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grid Layout Controls */}
          <EventMontageGridControls
            gridCols={gridControls.gridCols}
            customCols={gridControls.customCols}
            isCustomGridDialogOpen={gridControls.isCustomGridDialogOpen}
            onApplyGridLayout={gridControls.handleApplyGridLayout}
            onCustomColsChange={gridControls.setCustomCols}
            onCustomGridDialogOpenChange={gridControls.setIsCustomGridDialogOpen}
            onCustomGridSubmit={gridControls.handleCustomGridSubmit}
          />

          {/* Refresh Button */}
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="icon"
            aria-label={t('eventMontage.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Screen Too Small Warning */}
      {gridControls.isScreenTooSmall && (
        <p className="text-xs text-destructive">{t('eventMontage.screen_too_small')}</p>
      )}

      {/* Filter Panel */}
      <EventMontageFilterPanel
        monitors={monitors}
        selectedMonitorIds={selectedMonitorIds}
        selectedCause={selectedCause}
        startDate={startDate}
        endDate={endDate}
        uniqueCauses={uniqueCauses}
        onMonitorToggle={handleMonitorToggle}
        onSelectAllMonitors={handleSelectAllMonitors}
        onCauseChange={setSelectedCause}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Events Grid */}
      {events.length === 0 && !isLoading ? (
        <EmptyState icon={Clock} title={t('eventMontage.no_events')} />
      ) : (
        <EventMontageView
          events={events}
          monitors={monitors}
          gridCols={gridControls.gridCols}
          thumbnailFit={normalizedThumbnailFit}
          portalUrl={currentProfile?.portalUrl || ''}
          accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
          batchSize={batchSize}
          totalCount={eventsData?.pagination?.totalCount}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadNextPage}
          minStreamingPort={currentProfile?.minStreamingPort}
        />
      )}
    </div>
  );
}
