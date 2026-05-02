/**
 * Hook for Montage grid layout management
 *
 * Uses a fixed 12-column internal grid. The user's "display columns" setting
 * (1–5) controls the default item width (12/displayCols). Items can be resized
 * to any width 1–12 for mixed sizes; vertical compaction reflows items.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { GRID_LAYOUT } from '../../../lib/zmninja-ng-constants';
import { useSettingsStore } from '../../../stores/settings';
import { getMonitorAspectRatio } from '../../../lib/monitor-rotation';
import type { Layout } from 'react-grid-layout';
import type { Monitor, MonitorData } from '../../../api/types';
import type { Profile } from '../../../api/types';
import type { ProfileSettings } from '../../../stores/settings';

/** Internal grid always uses 12 columns for fine-grained positioning. */
export const INTERNAL_COLS = 12;

const parseAspectRatioValue = (monitor: Monitor): number => {
  const ratio = getMonitorAspectRatio(monitor.Width, monitor.Height, monitor.Orientation);

  if (!ratio) return 9 / 16;

  const match = ratio.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!match) return 9 / 16;

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 9 / 16;
  }

  return height / width;
};

const calculateHeightUnits = (
  monitorMap: Map<string, Monitor>,
  monitorId: string,
  widthUnits: number,
  gridWidth: number,
  margin: number
): number => {
  const monitor = monitorMap.get(monitorId);
  if (!monitor) return 200;

  const CARD_HEADER_HEIGHT = 32; // h-8 header bar with monitor name + buttons
  const aspectRatio = parseAspectRatioValue(monitor);
  const columnWidth = (gridWidth - margin * (INTERNAL_COLS - 1)) / INTERNAL_COLS;
  const itemWidth = columnWidth * widthUnits + margin * (widthUnits - 1);
  const videoPx = itemWidth * aspectRatio;
  const heightPx = videoPx + CARD_HEADER_HEIGHT;
  const unit = (heightPx + margin) / (GRID_LAYOUT.montageRowHeight + margin);

  return Math.max(2, Math.ceil(unit));
};

/**
 * Migrate legacy layouts from when the grid used `displayCols` columns directly
 * (each item stored with `w=1`) to the current 12-column internal grid.
 * Detection: legacy layouts always have every item at `w=1`. New-format layouts
 * use `w = floor(12/displayCols)`, which is ≥ 2 for displayCols 1–10 (the UI cap).
 */
export const migrateLayout = (stored: Layout[], displayCols: number): Layout[] => {
  if (stored.length === 0) return stored;
  const maxW = Math.max(...stored.map((item) => item.w));
  if (maxW !== 1) return stored;

  const scale = Math.floor(INTERNAL_COLS / displayCols);
  return stored.map((item) => ({
    ...item,
    w: Math.min(INTERNAL_COLS, item.w * scale),
    x: Math.min(INTERNAL_COLS - 1, item.x * scale),
  }));
};

const areLayoutsEqual = (a: Layout[], b: Layout[]): boolean => {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((item) => [item.i, item]));
  for (const item of b) {
    const match = map.get(item.i);
    if (!match) return false;
    if (match.x !== item.x || match.y !== item.y || match.w !== item.w || match.h !== item.h) {
      return false;
    }
  }
  return true;
};

interface UseMontageGridOptions {
  monitors: MonitorData[];
  currentProfile: Profile | null;
  settings: ProfileSettings;
  isEditMode: boolean;
}

interface UseMontageGridReturn {
  layout: Layout[];
  gridCols: number;
  currentWidthRef: React.MutableRefObject<number>;
  handleApplyGridLayout: (cols: number) => void;
  handleLoadSavedLayout: (savedLayout: Layout[], displayCols: number) => void;
  handleLayoutChange: (nextLayout: Layout[]) => void;
  handleResizeStop: (layout: Layout[], oldItem: Layout, newItem: Layout) => void;
  handleWidthChange: (width: number) => void;
  handleDragStop: (layout: Layout[], oldItem: Layout, newItem: Layout) => void;
  handleFillWidth: () => void;
  togglePinMonitor: (monitorId: string) => void;
  isMonitorPinned: (monitorId: string) => boolean;
}

export function useMontageGrid({
  monitors,
  currentProfile,
  settings,
  isEditMode,
}: UseMontageGridOptions): UseMontageGridReturn {
  const { t } = useTranslation();
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const saveMontageLayout = useSettingsStore((state) => state.saveMontageLayout);

  // displayCols = user's chosen number of visible columns (1–5)
  const [displayCols, setDisplayCols] = useState<number>(settings.montageGridCols);
  const [layout, setLayout] = useState<Layout[]>([]);
  const [hasWidth, setHasWidth] = useState(false);
  // Track whether initial layout has been built (prevent re-running on monitor refetch)
  const initializedRef = useRef(false);
  // Skip the restore effect when handleApplyGridLayout/handleLoadSavedLayout already set layout
  const skipRestoreRef = useRef(false);

  const currentWidthRef = useRef(0);
  // Width at which heights were last calculated — used to skip trivial changes
  const lastCalcWidthRef = useRef(0);

  // Refs for stable access in callbacks without causing re-renders
  const monitorMapRef = useRef<Map<string, Monitor>>(new Map());
  const isEditModeRef = useRef(isEditMode);
  const currentProfileRef = useRef(currentProfile);
  const settingsRef = useRef(settings);

  useEffect(() => { isEditModeRef.current = isEditMode; }, [isEditMode]);
  useEffect(() => { currentProfileRef.current = currentProfile; }, [currentProfile]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const monitorMap = useMemo(() => {
    return new Map(monitors.map((item) => [item.Monitor.Id, item.Monitor]));
  }, [monitors]);

  useEffect(() => { monitorMapRef.current = monitorMap; }, [monitorMap]);

  /** Default item width in internal-col units for the current display setting. */
  const defaultItemWidth = (cols: number) => Math.max(1, Math.floor(INTERNAL_COLS / cols));

  const buildDefaultLayout = useCallback(
    (monitorList: MonitorData[], cols: number, gridWidth: number): Layout[] => {
      const w = defaultItemWidth(cols);
      const map = monitorMapRef.current;
      return monitorList.map(({ Monitor }, index) => {
        const h = calculateHeightUnits(map, Monitor.Id, w, gridWidth, 0);
        const perRow = Math.floor(INTERNAL_COLS / w);
        return {
          i: Monitor.Id,
          x: (index % perRow) * w,
          y: Math.floor(index / perRow) * h,
          w,
          h,
          minW: 1,
          minH: 50,
        };
      });
    },
    [] // Uses ref — stable identity
  );

  const recalcHeights = useCallback(
    (current: Layout[], gridWidth: number): Layout[] => {
      const map = monitorMapRef.current;
      return current.map((item) => ({
        ...item,
        w: Math.min(item.w, INTERNAL_COLS),
        x: Math.min(item.x, INTERNAL_COLS - item.w),
        h: calculateHeightUnits(map, item.i, item.w, gridWidth, 0),
      }));
    },
    [] // Uses ref — stable identity
  );

  // Update displayCols when profile changes (external change only)
  useEffect(() => {
    setDisplayCols(settings.montageGridCols);
  }, [currentProfile?.id, settings.montageGridCols]);

  // Build initial layout once when we have monitors + width.
  // Also re-runs when displayCols changes (user picked a new column count).
  useEffect(() => {
    if (monitors.length === 0) return;
    if (!hasWidth || currentWidthRef.current === 0) return;

    // handleApplyGridLayout / handleLoadSavedLayout already set layout directly
    if (skipRestoreRef.current) {
      skipRestoreRef.current = false;
      initializedRef.current = true;
      return;
    }

    const stored = settingsRef.current.montageLayouts?.lg;
    let nextLayout: Layout[];

    if (stored && stored.length > 0) {
      const migrated = migrateLayout(stored, displayCols);
      const existingIds = new Set(monitors.map((item) => item.Monitor.Id));
      const filtered = migrated.filter((item) => existingIds.has(item.i));
      const presentIds = new Set(filtered.map((item) => item.i));
      const missing = monitors.filter((item) => !presentIds.has(item.Monitor.Id));
      const defaults = buildDefaultLayout(missing, displayCols, currentWidthRef.current);
      nextLayout = [...filtered, ...defaults];
    } else {
      nextLayout = buildDefaultLayout(monitors, displayCols, currentWidthRef.current);
    }

    const normalized = recalcHeights(nextLayout, currentWidthRef.current);
    setLayout((prev) => (areLayoutsEqual(prev, normalized) ? prev : normalized));
    initializedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayCols, hasWidth]);

  // When the monitor list changes (new/removed monitors), add missing ones
  // but don't reset existing positions.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (monitors.length === 0) return;

    setLayout((prev) => {
      const existingIds = new Set(prev.map((item) => item.i));
      const newMonitors = monitors.filter((m) => !existingIds.has(m.Monitor.Id));
      if (newMonitors.length === 0) {
        // No new monitors; just remove items for monitors that no longer exist
        const currentIds = new Set(monitors.map((m) => m.Monitor.Id));
        const filtered = prev.filter((item) => currentIds.has(item.i));
        return filtered.length === prev.length ? prev : filtered;
      }
      const defaults = buildDefaultLayout(newMonitors, displayCols, currentWidthRef.current);
      return [...prev, ...defaults];
    });
  }, [monitors, displayCols, buildDefaultLayout]);

  const handleApplyGridLayout = useCallback(
    (cols: number) => {
      if (!currentProfileRef.current) return;

      const nextLayout = buildDefaultLayout(monitors, cols, currentWidthRef.current);

      skipRestoreRef.current = true;
      setDisplayCols(cols);
      setLayout(nextLayout);

      const profileId = currentProfileRef.current.id;
      updateSettings(profileId, {
        montageGridRows: cols,
        montageGridCols: cols,
      });
      saveMontageLayout(profileId, { ...settingsRef.current.montageLayouts, lg: nextLayout });

      toast.success(t('montage.grid_applied', { columns: cols }));
    },
    [monitors, updateSettings, saveMontageLayout, buildDefaultLayout, t]
  );

  const handleLoadSavedLayout = useCallback(
    (savedLayout: Layout[], cols: number) => {
      if (!currentProfileRef.current) return;

      skipRestoreRef.current = true;
      const normalized = recalcHeights(savedLayout, currentWidthRef.current);
      setDisplayCols(cols);
      setLayout(normalized);

      const profileId = currentProfileRef.current.id;
      updateSettings(profileId, { montageGridCols: cols, montageGridRows: cols });
      saveMontageLayout(profileId, { ...settingsRef.current.montageLayouts, lg: normalized });
    },
    [updateSettings, saveMontageLayout, recalcHeights]
  );

  const handleWidthChange = useCallback(
    (width: number) => {
      const isFirstMeasurement = lastCalcWidthRef.current === 0;
      currentWidthRef.current = width;

      if (isFirstMeasurement) {
        lastCalcWidthRef.current = width;
        setHasWidth(true);
        return;
      }

      // Recalculate heights to match new column pixel widths so aspect
      // ratios stay correct (especially for "Fit"/contain mode).
      // Jiggle is prevented by handleLayoutChange being a no-op in
      // non-edit mode — RGL compaction won't trigger re-render loops.
      lastCalcWidthRef.current = width;
      setLayout((prev) => recalcHeights(prev, width));
    },
    [recalcHeights]
  );

  // onLayoutChange fires on EVERY re-render due to RGL compaction.
  // Do NOT persist here — it overwrites our layout with compacted positions.
  const handleLayoutChange = useCallback(
    (_nextLayout: Layout[]) => { /* no-op */ },
    []
  );

  // Save layout only when user finishes a drag
  const handleDragStop = useCallback(
    (nextLayout: Layout[]) => {
      if (!isEditModeRef.current || !currentProfileRef.current) return;
      setLayout(nextLayout);
      saveMontageLayout(currentProfileRef.current.id, {
        ...settingsRef.current.montageLayouts,
        lg: nextLayout,
      });
    },
    [saveMontageLayout]
  );

  const handleResizeStop = useCallback(
    (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
      const map = monitorMapRef.current;
      const adjustedHeight = calculateHeightUnits(
        map,
        newItem.i,
        newItem.w,
        currentWidthRef.current,
        0
      );

      setLayout((prev) => {
        const nextLayout = prev.map((item) =>
          item.i === newItem.i ? { ...item, h: adjustedHeight, w: newItem.w } : item
        );
        if (isEditModeRef.current && currentProfileRef.current) {
          saveMontageLayout(currentProfileRef.current.id, {
            ...settingsRef.current.montageLayouts,
            lg: nextLayout,
          });
        }
        return areLayoutsEqual(prev, nextLayout) ? prev : nextLayout;
      });
    },
    [saveMontageLayout]
  );

  // Proportionally scale the entire layout so it fills the full grid width
  const handleFillWidth = useCallback(() => {
    const profileId = currentProfileRef.current?.id;
    if (!profileId) return;

    setLayout((prev) => {
      // Find the rightmost edge of any item
      const maxRight = Math.max(...prev.map((item) => item.x + item.w));
      if (maxRight <= 0 || maxRight === INTERNAL_COLS) return prev;

      const scale = INTERNAL_COLS / maxRight;

      const nextLayout = prev.map((item) => ({
        ...item,
        x: Math.round(item.x * scale),
        w: Math.max(1, Math.round(item.w * scale)),
      }));

      // Recalculate heights for new widths
      const recalculated = recalcHeights(nextLayout, currentWidthRef.current);

      saveMontageLayout(profileId, {
        ...settingsRef.current.montageLayouts,
        lg: recalculated,
      });

      return recalculated;
    });
  }, [recalcHeights, saveMontageLayout]);

  // Pinned monitors: prevents accidental drag/resize of the pinned item.
  // Uses per-item isDraggable/isResizable on the layout — does NOT use `static`.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const togglePinMonitor = useCallback((monitorId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(monitorId)) next.delete(monitorId);
      else next.add(monitorId);
      return next;
    });
  }, []);

  const isMonitorPinned = useCallback((monitorId: string) => {
    return pinnedIds.has(monitorId);
  }, [pinnedIds]);

  return {
    layout,
    gridCols: displayCols,
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
  };
}
