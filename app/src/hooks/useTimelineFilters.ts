/**
 * Timeline Filters Hook
 *
 * Persists filter selections to the settings store.
 * Mirrors Events filter options (monitors, date range, object detection)
 * but stored independently under timelinePageFilters.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useSettingsStore } from '../stores/settings';

interface UseTimelineFiltersReturn {
  selectedMonitorIds: string[];
  startDateInput: string;
  endDateInput: string;
  onlyDetectedObjects: boolean;
  causeFilter: string;
  activeQuickRange: number | null;
  setSelectedMonitorIds: (ids: string[]) => void;
  setStartDateInput: (date: string) => void;
  setEndDateInput: (date: string) => void;
  setOnlyDetectedObjects: (enabled: boolean) => void;
  setCauseFilter: (cause: string) => void;
  setActiveQuickRange: (hours: number | null) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

function saveFilterField(profileId: string, field: string, value: unknown) {
  const store = useSettingsStore.getState();
  const current = store.getProfileSettings(profileId).timelinePageFilters;
  store.updateProfileSettings(profileId, {
    timelinePageFilters: { ...current, [field]: value },
  });
}

export function useTimelineFilters(): UseTimelineFiltersReturn {
  const { currentProfile, settings } = useCurrentProfile();

  const [selectedMonitorIds, _setMonitorIds] = useState<string[]>([]);
  const [startDateInput, _setStartDate] = useState('');
  const [endDateInput, _setEndDate] = useState('');
  const [onlyDetectedObjects, _setOnlyDetected] = useState(false);
  const [causeFilter, _setCauseFilter] = useState('');
  const [activeQuickRange, _setActiveQuickRange] = useState<number | null>(null);

  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = currentProfile?.id ?? null;

  const setSelectedMonitorIds = useCallback((ids: string[]) => {
    _setMonitorIds(ids);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'monitorIds', ids);
  }, []);

  const setStartDateInput = useCallback((date: string) => {
    _setStartDate(date);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'startDateTime', date);
  }, []);

  const setEndDateInput = useCallback((date: string) => {
    _setEndDate(date);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'endDateTime', date);
  }, []);

  const setOnlyDetectedObjects = useCallback((enabled: boolean) => {
    _setOnlyDetected(enabled);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'onlyDetectedObjects', enabled);
  }, []);

  const setCauseFilter = useCallback((cause: string) => {
    _setCauseFilter(cause);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'causeFilter', cause);
  }, []);

  const setActiveQuickRange = useCallback((hours: number | null) => {
    _setActiveQuickRange(hours);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'activeQuickRange', hours);
  }, []);

  // Restore from persisted settings on mount / profile change
  const prevSettingsRef = useRef<string>('');
  useEffect(() => {
    if (!currentProfile) return;
    const saved = settings.timelinePageFilters;
    const settingsKey = JSON.stringify(saved);
    if (settingsKey === prevSettingsRef.current) return;
    prevSettingsRef.current = settingsKey;

    _setMonitorIds(saved.monitorIds);
    _setStartDate(saved.startDateTime);
    _setEndDate(saved.endDateTime);
    _setOnlyDetected(saved.onlyDetectedObjects);
    _setCauseFilter(saved.causeFilter ?? '');
    _setActiveQuickRange(saved.activeQuickRange ?? null);
  }, [currentProfile?.id, settings.timelinePageFilters]);

  const clearFilters = useCallback(() => {
    setSelectedMonitorIds([]);
    setStartDateInput('');
    setEndDateInput('');
    setOnlyDetectedObjects(false);
    setCauseFilter('');
    setActiveQuickRange(null);
  }, [setSelectedMonitorIds, setStartDateInput, setEndDateInput, setOnlyDetectedObjects, setCauseFilter, setActiveQuickRange]);

  const activeFilterCount =
    (selectedMonitorIds.length > 0 ? 1 : 0) +
    (startDateInput ? 1 : 0) +
    (endDateInput ? 1 : 0) +
    (onlyDetectedObjects ? 1 : 0) +
    (causeFilter ? 1 : 0);

  return {
    selectedMonitorIds, startDateInput, endDateInput, onlyDetectedObjects, causeFilter, activeQuickRange,
    setSelectedMonitorIds, setStartDateInput, setEndDateInput, setOnlyDetectedObjects, setCauseFilter, setActiveQuickRange,
    clearFilters, activeFilterCount,
  };
}