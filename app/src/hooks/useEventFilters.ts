/**
 * Event Filters Hook
 *
 * Filter selections are saved to settings immediately on change (no Apply needed).
 * Settings store is the source of truth for persistence.
 * The "Filter" button syncs to URL params for deep linking.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useCurrentProfile } from './useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, type LinkedEventFilter, type ProfileSettings } from '../stores/settings';
import type { EventFilters } from '../api/events';
import { log, LogLevel } from '../lib/logger';
import { ZM_LINKED_CAUSE } from '../lib/zm/zm-constants';

/** Sentinel value for the "All tagged events" filter option */
export const ALL_TAGS_FILTER_ID = '__all_tags__';

/**
 * Explicit date range to write to the URL, bypassing component state.
 * Quick-range buttons set state and call applyFilters() in the same handler, so
 * applyFilters would otherwise close over the pre-click (stale) date range. The
 * URL-readback effect then reflects that stale range back into state, applying
 * the previously selected window instead of the one just clicked (refs #193).
 */
interface DateRangeOverrides {
  startDateTime?: string;
  endDateTime?: string;
}

interface UseEventFiltersReturn {
  filters: EventFilters;
  selectedMonitorIds: string[];
  selectedTagIds: string[];
  startDateInput: string;
  endDateInput: string;
  favoritesOnly: boolean;
  archivedOnly: boolean;
  onlyDetectedObjects: boolean;
  /** Linked recordings: every event, only linked ones, or none (refs #493). */
  linkedFilter: LinkedEventFilter;
  activeQuickRange: number | null;
  setSelectedMonitorIds: (ids: string[]) => void;
  setSelectedTagIds: (ids: string[]) => void;
  setStartDateInput: (date: string) => void;
  setEndDateInput: (date: string) => void;
  setFavoritesOnly: (enabled: boolean) => void;
  setArchivedOnly: (enabled: boolean) => void;
  setOnlyDetectedObjects: (enabled: boolean) => void;
  setLinkedFilter: (value: LinkedEventFilter) => void;
  setActiveQuickRange: (hours: number | null) => void;
  applyFilters: (overrides?: DateRangeOverrides) => void;
  clearFilters: () => void;
  clearDateRange: () => void;
  toggleMonitorSelection: (monitorId: string) => void;
  toggleTagSelection: (tagId: string) => void;
  activeFilterCount: number;
}

function formatInputDate(isoString: string | null | undefined): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  } catch (error) {
    log.time('Date filter parse failed', LogLevel.DEBUG, { error });
    return isoString;
  }
}

/** Save a single filter field to the settings store (merge with existing) */
function saveFilterField(profileId: string, field: string, value: unknown) {
  const store = useSettingsStore.getState();
  const current = store.getProfileSettings(profileId).eventsPageFilters;
  store.updateProfileSettings(profileId, {
    eventsPageFilters: { ...current, [field]: value },
  });
}

/** The 6 URL params that make up a deep-linked filter set. */
const URL_FILTER_KEYS = ['monitorId', 'tagIds', 'startDateTime', 'endDateTime', 'favorites', 'archived'] as const;

interface UrlFilterValues {
  monitorId: string | null;
  tagIds: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  favorites: string | null;
  archived: string | null;
}

/** True if any deep-link filter param is present in the URL. */
function hasUrlFilters(searchParams: URLSearchParams): boolean {
  return URL_FILTER_KEYS.some((key) => searchParams.has(key));
}

/** Raw string values (or null if absent) for all deep-link filter params. */
function readUrlFilters(searchParams: URLSearchParams): UrlFilterValues {
  return {
    monitorId: searchParams.get('monitorId'),
    tagIds: searchParams.get('tagIds'),
    startDateTime: searchParams.get('startDateTime'),
    endDateTime: searchParams.get('endDateTime'),
    favorites: searchParams.get('favorites'),
    archived: searchParams.get('archived'),
  };
}

interface InitialFilterState {
  monitorIds: string[];
  tagIds: string[];
  startDateTime: string;
  endDateTime: string;
  favoritesOnly: boolean;
  archivedOnly: boolean;
  onlyDetectedObjects: boolean;
  linkedFilter: LinkedEventFilter;
  activeQuickRange: number | null;
}

/**
 * The filter state the first render must already carry.
 *
 * The Events page derives its React Query key from these values, and
 * `useScrollRestoration` runs in a layout effect on that same first render.
 * Hydrating the filter in a post-paint effect instead made the first render
 * fetch the unfiltered list, so the scroll offset was restored against it and
 * then clamped away when the narrower filtered list replaced it (refs #197).
 * The URL keeps priority over the persisted filter, as it does after mount.
 */
function resolveInitialFilters(
  searchParams: URLSearchParams,
  saved: ProfileSettings['eventsPageFilters'] | undefined
): InitialFilterState {
  if (hasUrlFilters(searchParams)) {
    const url = readUrlFilters(searchParams);
    return {
      monitorIds: url.monitorId ? url.monitorId.split(',') : [],
      tagIds: url.tagIds ? url.tagIds.split(',') : [],
      startDateTime: formatInputDate(url.startDateTime),
      endDateTime: formatInputDate(url.endDateTime),
      favoritesOnly: url.favorites === 'true',
      archivedOnly: url.archived === 'true',
      onlyDetectedObjects: false,
      linkedFilter: 'all',
      activeQuickRange: null,
    };
  }
  return {
    monitorIds: saved?.monitorIds ?? [],
    tagIds: saved?.tagIds ?? [],
    startDateTime: saved?.startDateTime ?? '',
    endDateTime: saved?.endDateTime ?? '',
    favoritesOnly: saved?.favoritesOnly ?? false,
    archivedOnly: saved?.archivedOnly ?? false,
    onlyDetectedObjects: saved?.onlyDetectedObjects ?? false,
    // A bucket persisted before this key existed has no value for it, and the
    // settings object is spread rather than deep-merged (refs #493).
    linkedFilter: saved?.linkedFilter ?? 'all',
    activeQuickRange: saved?.activeQuickRange ?? null,
  };
}

export function useEventFilters(): UseEventFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { settings } = useCurrentProfile();
  // Filters persist against currentProfileId, not the current profile: while
  // aggregating there is no current profile, only the active aggregate's id,
  // and that id is the bucket `settings` already resolves to. Keying the
  // writes off currentProfile instead left every aggregate selection
  // unpersisted and the restore below dead (refs #337). Aggregate monitor
  // selections are composite `${profileId}:${monitorId}` tokens, so what
  // round-trips through that bucket is the same token EventsFilterPopover
  // produces and resolveOwnMonitorIds resolves; single mode stores bare ids
  // as before.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);

  // Local filter state. The `_set*` setters below are raw React setters: they
  // update state only and do NOT persist to the settings store. Reserve them
  // for restoring state from an external source (settings, URL) where saving
  // back would be redundant or create a feedback loop. Any user-driven change
  // must go through the wrapped `set*` functions defined below instead, so the
  // change is also saved.
  // Hydrated synchronously: the first render must already carry the filter, or
  // the Events page fetches the unfiltered list and restores scroll against it
  // (refs #197). See resolveInitialFilters.
  const [initial] = useState(() => resolveInitialFilters(searchParams, settings?.eventsPageFilters));
  const [selectedMonitorIds, _setMonitorIds] = useState<string[]>(initial.monitorIds);
  const [startDateInput, _setStartDate] = useState(initial.startDateTime);
  const [endDateInput, _setEndDate] = useState(initial.endDateTime);
  const [favoritesOnly, _setFavoritesOnly] = useState(initial.favoritesOnly);
  const [archivedOnly, _setArchivedOnly] = useState(initial.archivedOnly);
  const [selectedTagIds, _setTagIds] = useState<string[]>(initial.tagIds);
  const [onlyDetectedObjects, _setOnlyDetected] = useState(initial.onlyDetectedObjects);
  const [linkedFilter, _setLinkedFilter] = useState<LinkedEventFilter>(initial.linkedFilter);
  const [activeQuickRange, _setActiveQuickRange] = useState<number | null>(initial.activeQuickRange);

  // Wrapped setters that also save to settings store immediately.
  // No effects needed: saves happen synchronously on user action.
  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = currentProfileId;

  const setSelectedMonitorIds = useCallback((ids: string[]) => {
    _setMonitorIds(ids);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'monitorIds', ids);
  }, []);

  const setSelectedTagIds = useCallback((ids: string[]) => {
    _setTagIds(ids);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'tagIds', ids);
  }, []);

  const setStartDateInput = useCallback((date: string) => {
    _setStartDate(date);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'startDateTime', date);
  }, []);

  const setEndDateInput = useCallback((date: string) => {
    _setEndDate(date);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'endDateTime', date);
  }, []);

  const setFavoritesOnly = useCallback((enabled: boolean) => {
    _setFavoritesOnly(enabled);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'favoritesOnly', enabled);
  }, []);

  const setArchivedOnly = useCallback((enabled: boolean) => {
    _setArchivedOnly(enabled);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'archivedOnly', enabled);
  }, []);

  const setOnlyDetectedObjects = useCallback((enabled: boolean) => {
    _setOnlyDetected(enabled);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'onlyDetectedObjects', enabled);
  }, []);

  const setLinkedFilter = useCallback((value: LinkedEventFilter) => {
    _setLinkedFilter(value);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'linkedFilter', value);
  }, []);

  const setActiveQuickRange = useCallback((hours: number | null) => {
    _setActiveQuickRange(hours);
    if (profileIdRef.current) saveFilterField(profileIdRef.current, 'activeQuickRange', hours);
  }, []);

  // ----- Restore filters from settings on mount / profile change -----
  // Does NOT trigger auto-save because it uses the raw _set* functions.
  const prevSettingsRef = useRef<string>('');
  useEffect(() => {
    // Symmetry with the write path, not a covered branch: initial state
    // already hydrates synchronously from the same bucket, and the profile
    // switcher remounts this page, so this guard is near-unreachable. Kept
    // so both paths key off the same id (refs #337 review).
    if (!currentProfileId) return;

    // Deep-link URL params take priority
    if (hasUrlFilters(searchParams)) {
      return;
    }

    const saved = settings.eventsPageFilters;
    const settingsKey = JSON.stringify(saved);
    if (settingsKey === prevSettingsRef.current) return;
    prevSettingsRef.current = settingsKey;

    _setMonitorIds(saved.monitorIds);
    _setTagIds(saved.tagIds);
    _setStartDate(saved.startDateTime);
    _setEndDate(saved.endDateTime);
    _setFavoritesOnly(saved.favoritesOnly);
    _setArchivedOnly(saved.archivedOnly ?? false);
    _setOnlyDetected(saved.onlyDetectedObjects);
    _setLinkedFilter(saved.linkedFilter ?? 'all');
    _setActiveQuickRange(saved.activeQuickRange ?? null);
  }, [currentProfileId, settings.eventsPageFilters, searchParams]);

  // ----- Handle deep-link URL params -----
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;

      if (hasUrlFilters(searchParams)) {
        const { monitorId: m, tagIds: t, startDateTime: s, endDateTime: e, favorites: f, archived: a } = readUrlFilters(searchParams);
        // Use wrapped setters so URL filters persist to settings store
        setSelectedMonitorIds(m ? m.split(',') : []);
        setSelectedTagIds(t ? t.split(',') : []);
        setStartDateInput(s ? formatInputDate(s) : '');
        setEndDateInput(e ? formatInputDate(e) : '');
        setFavoritesOnly(f === 'true');
        setArchivedOnly(a === 'true');
      }
      return;
    }

    const { monitorId, tagIds, startDateTime: startDT, endDateTime: endDT, favorites, archived } = readUrlFilters(searchParams);

    if (monitorId !== null) _setMonitorIds(monitorId ? monitorId.split(',') : []);
    if (tagIds !== null) _setTagIds(tagIds ? tagIds.split(',') : []);
    if (startDT !== null) _setStartDate(formatInputDate(startDT));
    if (endDT !== null) _setEndDate(formatInputDate(endDT));
    if (favorites !== null) _setFavoritesOnly(favorites === 'true');
    if (archived !== null) _setArchivedOnly(archived === 'true');
  }, [searchParams]);

  // Derive EventFilters from local state (not URL).
  const filters: EventFilters = useMemo(
    () => ({
      limit: settings.defaultEventLimit || 100,
      sort: searchParams.get('sort') || 'StartDateTime',
      direction: (searchParams.get('direction') as 'asc' | 'desc') || 'desc',
      monitorId: selectedMonitorIds.length > 0 ? selectedMonitorIds.join(',') : undefined,
      startDateTime: startDateInput || undefined,
      endDateTime: endDateInput || undefined,
      notesRegexp: onlyDetectedObjects ? 'detected:' : undefined,
      archived: archivedOnly || undefined,
      // One cause, two directions: ZoneMinder matches Cause REGEXP for the
      // events a linked monitor recorded, and Cause NOT REGEXP for everything
      // else (refs #493).
      cause: linkedFilter === 'only' ? ZM_LINKED_CAUSE : undefined,
      causeExclude: linkedFilter === 'hide' ? ZM_LINKED_CAUSE : undefined,
    }),
    [searchParams, settings.defaultEventLimit, selectedMonitorIds, startDateInput, endDateInput, onlyDetectedObjects, archivedOnly, linkedFilter]
  );

  // "Apply" syncs current filters to URL for deep linking / sharing.
  // Callers that change the date range in the same handler must pass it via
  // `overrides`, since this closure still sees the pre-update state (refs #193).
  const applyFilters = useCallback((overrides?: DateRangeOverrides) => {
    const effectiveStart = overrides && 'startDateTime' in overrides ? overrides.startDateTime : startDateInput;
    const effectiveEnd = overrides && 'endDateTime' in overrides ? overrides.endDateTime : endDateInput;

    const newParams = new URLSearchParams(searchParams);
    if (!newParams.has('sort')) newParams.set('sort', 'StartDateTime');
    if (!newParams.has('direction')) newParams.set('direction', 'desc');

    if (selectedMonitorIds.length > 0) {
      newParams.set('monitorId', selectedMonitorIds.join(','));
    } else {
      newParams.delete('monitorId');
    }
    if (effectiveStart) {
      newParams.set('startDateTime', effectiveStart);
    } else {
      newParams.delete('startDateTime');
    }
    if (effectiveEnd) {
      newParams.set('endDateTime', effectiveEnd);
    } else {
      newParams.delete('endDateTime');
    }
    if (favoritesOnly) {
      newParams.set('favorites', 'true');
    } else {
      newParams.delete('favorites');
    }
    if (archivedOnly) {
      newParams.set('archived', 'true');
    } else {
      newParams.delete('archived');
    }
    // In All mode these tokens are tag NAMES, not ids: tag ids are per-server
    // and collide, so the aggregate selection is keyed by name and
    // resolveOwnTagIds maps it back per profile (useScopedEventTags). The name
    // therefore lands in ?tagIds= too, and a URL copied from All mode into
    // single mode asks ZoneMinder for Tags.Id:<name>, which matches nothing.
    //
    // Left as is deliberately: the filter still reads correctly in the mode it
    // was made in, the failure is an empty list rather than wrong events, and
    // the fix is a mode marker in the URL plus a resolver on the way back in -
    // new plumbing for a cross-mode link nobody shares (refs #337).
    if (selectedTagIds.length > 0) {
      newParams.set('tagIds', selectedTagIds.join(','));
    } else {
      newParams.delete('tagIds');
    }

    setSearchParams(newParams, { replace: true, state: location.state });
  }, [
    selectedMonitorIds, selectedTagIds, startDateInput, endDateInput, favoritesOnly, archivedOnly,
    searchParams, setSearchParams, location.state,
  ]);

  const clearFilters = useCallback(() => {
    // Use wrapped setters so clearing also saves to settings
    setSelectedMonitorIds([]);
    setSelectedTagIds([]);
    setStartDateInput('');
    setEndDateInput('');
    setFavoritesOnly(false);
    setArchivedOnly(false);
    setOnlyDetectedObjects(false);
    setLinkedFilter('all');
    setActiveQuickRange(null);

    const newParams = new URLSearchParams(searchParams);
    newParams.set('sort', 'StartDateTime');
    newParams.set('direction', 'desc');
    newParams.delete('monitorId');
    newParams.delete('tagIds');
    newParams.delete('startDateTime');
    newParams.delete('endDateTime');
    newParams.delete('favorites');
    newParams.delete('archived');
    setSearchParams(newParams, { replace: true, state: location.state });
  }, [searchParams, setSearchParams, location.state, setSelectedMonitorIds, setSelectedTagIds, setStartDateInput, setEndDateInput, setFavoritesOnly, setArchivedOnly, setOnlyDetectedObjects, setLinkedFilter]);

  // Clear only the time filter, leaving monitor/tag/favorite scope intact.
  // The "x" beside the quick-range chips uses this so removing the time window
  // does not also widen the view to every monitor (refs #194).
  const clearDateRange = useCallback(() => {
    setStartDateInput('');
    setEndDateInput('');
    setActiveQuickRange(null);

    const newParams = new URLSearchParams(searchParams);
    newParams.delete('startDateTime');
    newParams.delete('endDateTime');
    setSearchParams(newParams, { replace: true, state: location.state });
  }, [searchParams, setSearchParams, location.state, setStartDateInput, setEndDateInput, setActiveQuickRange]);

  const toggleMonitorSelection = useCallback((monitorId: string) => {
    _setMonitorIds((prev) => {
      const next = prev.includes(monitorId)
        ? prev.filter((id) => id !== monitorId)
        : [...prev, monitorId];
      if (profileIdRef.current) saveFilterField(profileIdRef.current, 'monitorIds', next);
      return next;
    });
  }, []);

  const toggleTagSelection = useCallback((tagId: string) => {
    _setTagIds((prev) => {
      const next = prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId];
      if (profileIdRef.current) saveFilterField(profileIdRef.current, 'tagIds', next);
      return next;
    });
  }, []);

  const activeFilterCount = useMemo(
    () =>
      [
        selectedMonitorIds.length > 0 ? 1 : null,
        selectedTagIds.length > 0 ? 1 : null,
        startDateInput ? 1 : null,
        endDateInput ? 1 : null,
        favoritesOnly ? 1 : null,
        archivedOnly ? 1 : null,
        onlyDetectedObjects ? 1 : null,
        linkedFilter !== 'all' ? 1 : null,
      ].filter(Boolean).length,
    [selectedMonitorIds.length, selectedTagIds.length, startDateInput, endDateInput, favoritesOnly, archivedOnly, onlyDetectedObjects, linkedFilter]
  );

  return {
    filters, selectedMonitorIds, selectedTagIds, startDateInput, endDateInput, favoritesOnly, archivedOnly, onlyDetectedObjects, linkedFilter, activeQuickRange,
    setSelectedMonitorIds, setSelectedTagIds, setStartDateInput, setEndDateInput, setFavoritesOnly, setArchivedOnly, setOnlyDetectedObjects, setLinkedFilter, setActiveQuickRange,
    applyFilters, clearFilters, clearDateRange, toggleMonitorSelection, toggleTagSelection, activeFilterCount,
  };
}
