/**
 * Montage Page
 *
 * Displays a customizable grid of live monitor streams.
 * Supports drag-and-drop layout, resizing, and fullscreen mode.
 */

import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { GRID_LAYOUT } from '../lib/zmninja-ng-constants';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useTvMode } from '../hooks/useTvMode';
import { Button } from '../components/ui/button';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Video, AlertCircle, Maximize, Pencil, ArrowLeftRight } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { filterEnabledMonitors, filterMonitorsByGroup } from '../lib/filters';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { useInsomnia } from '../hooks/useInsomnia';
import { NotificationBadge } from '../components/NotificationBadge';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Extracted hooks and components
import {
  GridLayoutControls,
  FullscreenControls,
  useMontageGrid,
  useContainerResize,
  useFullscreenMode,
} from '../components/montage';
import { INTERNAL_COLS } from '../components/montage/hooks/useMontageGrid';

const WrappedGridLayout = WidthProvider(GridLayout);

export default function Montage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const bandwidth = useBandwidthSettings();
  const { currentProfile, settings } = useCurrentProfile();
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['monitors'],
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.monitorStatusInterval,
  });
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const { isFilterActive, filteredMonitorIds } = useGroupFilter();

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Detect mobile viewport
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show enabled monitors only, filtered by group if active
  const enabledMonitors = useMemo(
    () => (data?.monitors ? filterEnabledMonitors(data.monitors) : []),
    [data]
  );

  const monitors = useMemo(() => {
    if (!isFilterActive) return enabledMonitors;
    return filterMonitorsByGroup(enabledMonitors, filteredMonitorIds);
  }, [enabledMonitors, isFilterActive, filteredMonitorIds]);

  // Edit mode state lifted to page level
  const [isEditMode, setIsEditMode] = useState(false);

  // Active saved layout name (persisted in settings)
  const activeLayoutName = settings.montageActiveLayoutName;

  // Monitor label overlay toggle for fullscreen mode
  const [showMonitorLabels, setShowMonitorLabels] = useState(false);

  // Toolbar visibility (controlled from app header eye button)
  const showToolbar = settings.montageShowToolbar;

  // Fullscreen mode
  const { isFullscreen, handleToggleFullscreen } =
    useFullscreenMode({
      currentProfile,
      settings,
    });


  // Grid layout management
  const {
    layout,
    gridCols,
    currentWidthRef,
    handleApplyGridLayout,
    handleLoadSavedLayout,
    handleLayoutChange,
    handleDragStop,
    handleFillWidth,
    handleResizeStop,
    handleWidthChange,
    togglePinMonitor,
    isMonitorPinned,
  } = useMontageGrid({
    monitors,
    currentProfile,
    settings,
    isEditMode,
  });

  // Container resize observation
  const { containerRef } = useContainerResize({
    onWidthChange: handleWidthChange,
    currentWidthRef,
  });

  // TV mode D-pad grid navigation
  const { isTvMode } = useTvMode();
  const [focusedMonitorIndex, setFocusedMonitorIndex] = useState(0);

  // Estimate columns from gridCols (display columns)
  const estimatedCols = gridCols;

  const handleDpadNav = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      setFocusedMonitorIndex((prev) => {
        const total = monitors.length;
        if (total === 0) return 0;
        let next = prev;
        switch (direction) {
          case 'left':
            next = prev - 1;
            break;
          case 'right':
            next = prev + 1;
            break;
          case 'up':
            next = prev - estimatedCols;
            break;
          case 'down':
            next = prev + estimatedCols;
            break;
        }
        return Math.max(0, Math.min(total - 1, next));
      });
    },
    [monitors.length, estimatedCols]
  );

  const handleDpadEnter = useCallback(() => {
    const mon = monitors[focusedMonitorIndex];
    if (mon) {
      navigate(`/monitors/${mon.Monitor.Id}`);
    }
  }, [monitors, focusedMonitorIndex, navigate]);

  useTvKeyHandler({
    ArrowLeft: () => handleDpadNav('left'),
    ArrowRight: () => handleDpadNav('right'),
    ArrowUp: () => handleDpadNav('up'),
    ArrowDown: () => handleDpadNav('down'),
    Enter: handleDpadEnter,
  });

  // Focus the monitor element when index changes in TV mode
  useEffect(() => {
    if (!isTvMode || monitors.length === 0) return;
    const el = document.querySelector(
      `[data-testid="montage-monitor-${monitors[focusedMonitorIndex]?.Monitor.Id}"]`
    ) as HTMLElement | null;
    el?.focus();
  }, [isTvMode, focusedMonitorIndex, monitors]);

  // Pinch-to-zoom (disabled in fullscreen to avoid gesture conflicts)
  const pinchZoom = usePinchZoom({
    minScale: 0.5,
    maxScale: 3,
    initialScale: 1,
    enabled: !isFullscreen,
  });

  const handleApplyGridLayoutWithClear = (cols: number) => {
    handleApplyGridLayout(cols);
    if (currentProfile) {
      updateSettings(currentProfile.id, { montageActiveLayoutName: null });
    }
  };

  const handleFeedFitChange = (value: string) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, {
      montageFeedFit: value as typeof settings.montageFeedFit,
    });
  };

  // Saved layout handlers
  const handleSaveLayout = (name: string) => {
    if (!currentProfile) return;
    const saved = settings.montageSavedLayouts || [];
    const entry = { name, layout: [...layout], displayCols: gridCols };
    updateSettings(currentProfile.id, {
      montageSavedLayouts: [...saved, entry],
      montageActiveLayoutName: name,
    });
  };

  const handleLoadLayout = (saved: { name: string; layout: Layout[]; displayCols: number }) => {
    handleLoadSavedLayout(saved.layout, saved.displayCols);
    if (currentProfile) {
      updateSettings(currentProfile.id, { montageActiveLayoutName: saved.name });
    }
  };

  const handleDeleteLayout = (index: number) => {
    if (!currentProfile) return;
    const saved = [...(settings.montageSavedLayouts || [])];
    saved.splice(index, 1);
    updateSettings(currentProfile.id, { montageSavedLayouts: saved });
  };

  const handleEditModeToggle = () => {
    setIsEditMode((prev) => !prev);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-video bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
        </div>
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {t('common.error')}: {(error as Error).message}
        </div>
      </div>
    );
  }

  // Empty state
  if (monitors.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
          <RefreshButton
            size="sm"
            onRefresh={() => refetch()}
            isLoading={isFetching}
            showLabel="always"
          />
        </div>
        <div className="text-center py-20 text-muted-foreground">
          <Video className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>{t('montage.no_monitors')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        isFullscreen
          ? 'fixed inset-0 z-40 bg-black flex flex-col'
          : 'flex flex-col bg-background relative'
      )}
    >
      {/* Header - Hidden in fullscreen mode */}
      {!isFullscreen && (
        <>
          {/* Toolbar row - toggleable via eye button in app header */}
          {showToolbar && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm shrink-0 z-10">
              <GroupFilterSelect />
              <GridLayoutControls
                isMobile={isMobile}
                gridCols={gridCols}
                activeLayoutName={activeLayoutName}
                onApplyGridLayout={handleApplyGridLayoutWithClear}
                savedLayouts={settings.montageSavedLayouts || []}
                onSaveLayout={handleSaveLayout}
                onLoadLayout={handleLoadLayout}
                onDeleteLayout={handleDeleteLayout}
              />
              <Select value={settings.montageFeedFit} onValueChange={handleFeedFitChange}>
                <SelectTrigger className="h-8 sm:h-9 w-[80px]" data-testid="montage-fit-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover" data-testid="montage-fit-cover">
                    {t('montage.fit_crop')}
                  </SelectItem>
                  <SelectItem value="contain" data-testid="montage-fit-contain">
                    {t('montage.fit_fit')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <RefreshButton
                size="sm"
                onRefresh={() => refetch()}
                isLoading={isFetching}
                showLabel="sm-and-up"
                className="h-8 sm:h-9"
                data-testid="montage-refresh-button"
              />
              <Button
                onClick={handleEditModeToggle}
                variant={isEditMode ? 'default' : 'outline'}
                size="sm"
                className="h-8 sm:h-9"
                title={isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                data-testid="montage-edit-toggle"
              >
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                </span>
              </Button>
              {isEditMode && (
                <Button
                  onClick={handleFillWidth}
                  variant="outline"
                  size="sm"
                  className="h-8 sm:h-9"
                  title={t('montage.fill_width', 'Fill Width')}
                  data-testid="montage-fill-width"
                >
                  <ArrowLeftRight className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('montage.fill_width', 'Fill')}</span>
                </Button>
              )}
              <Button
                onClick={() => handleToggleFullscreen(true)}
                variant="default"
                size="sm"
                className="h-8 sm:h-9"
                title={t('montage.fullscreen')}
                data-testid="montage-fullscreen-button"
              >
                <Maximize className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('montage.fullscreen')}</span>
              </Button>
              <NotificationBadge />
            </div>
          )}
        </>
      )}

      {/* Fullscreen toolbar — always visible, thin, translucent */}
      {isFullscreen && (
        <FullscreenControls
          onRefetch={() => refetch()}
          onExitFullscreen={() => handleToggleFullscreen(false)}
          showLabels={showMonitorLabels}
          onToggleLabels={() => setShowMonitorLabels((prev) => !prev)}
        />
      )}

      {/* Grid Content */}
      <div
        ref={containerRef}
        {...pinchZoom.bind()}
        className={cn(
          'flex-1 overflow-auto bg-muted/10',
          isFullscreen
            ? 'pt-[calc(2rem+var(--sai-top,env(safe-area-inset-top)))] overscroll-contain'
            : 'touch-pan-y'
        )}
      >
        <div
          style={{
            transform: `scale(${pinchZoom.scale})`,
            transformOrigin: 'top left',
            transition: pinchZoom.isPinching ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          <div
            className={cn(
              'w-full',
              isFullscreen && 'pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
            )}
            data-testid="montage-grid"
          >
            <WrappedGridLayout
              layout={layout}
              cols={INTERNAL_COLS}
              rowHeight={GRID_LAYOUT.montageRowHeight}
              margin={[0, 0]}
              containerPadding={[0, 0]}
              compactType="vertical"
              preventCollision={false}
              isResizable={isEditMode}
              isDraggable={isEditMode}
              resizeHandles={['se', 'sw', 'ne', 'nw']}
              draggableCancel=".pin-locked,.no-drag"
              onLayoutChange={handleLayoutChange}
              onDragStop={handleDragStop}
              onResizeStop={handleResizeStop}
            >
              {monitors.map(({ Monitor, Monitor_Status }, idx) => (
                <div
                  key={Monitor.Id}
                  className={cn(
                    "relative",
                    isMonitorPinned(Monitor.Id) && "pin-locked",
                    isTvMode && idx === focusedMonitorIndex && "ring-2 ring-primary"
                  )}
                  data-testid={`montage-monitor-${Monitor.Id}`}
                  tabIndex={isTvMode ? 0 : undefined}
                >
                  <MontageMonitor
                    monitor={Monitor}
                    status={Monitor_Status}
                    currentProfile={currentProfile}
                    accessToken={accessToken}
                    navigate={navigate}
                    isFullscreen={isFullscreen}
                    isEditing={isEditMode}
                    isPinned={isMonitorPinned(Monitor.Id)}
                    onPinToggle={() => togglePinMonitor(Monitor.Id)}
                    objectFit={settings.montageFeedFit}
                    showOverlay={showMonitorLabels}
                    staggerIndex={idx}
                  />
                </div>
              ))}
            </WrappedGridLayout>
          </div>
        </div>
      </div>
    </div>
  );
}
