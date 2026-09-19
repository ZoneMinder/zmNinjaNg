/**
 * useEventFilters Hook Tests
 *
 * Tests filter state management, URL sync, and settings persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventFilters, ALL_TAGS_FILTER_ID } from '../useEventFilters';
import { resolveOwnMonitorIds } from '../useScopedEvents';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

// Mock react-router-dom
const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
const mockLocation = { state: null, pathname: '/events', search: '', hash: '', key: 'default' };

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useLocation: () => mockLocation,
}));

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore, DEFAULT_SETTINGS, type ProfileSettings, mergeProfileSettings } from '../../stores/settings';
import { useProfileStore } from '../../stores/profile';

type EventsPageFilters = ProfileSettings['eventsPageFilters'];

/** Seeds profile-1 as current, with its eventsPageFilters bucket overridden. */
function setupMocks(overrides?: Partial<EventsPageFilters>) {
  seedProfiles(['profile-1'], {
    current: 'profile-1',
    settings: {
      'profile-1': {
        defaultEventLimit: 100,
        eventsPageFilters: { ...DEFAULT_SETTINGS.eventsPageFilters, ...overrides },
      },
    },
  });
}

/** Captures the hook's value on every render, so first-render state is observable. */
function renderCapturingFilters() {
  const monitorIdPerRender: (string | undefined)[] = [];
  const view = renderHook(() => {
    const r = useEventFilters();
    monitorIdPerRender.push(r.filters.monitorId);
    return r;
  });
  return { ...view, monitorIdPerRender };
}

describe('useEventFilters first-render hydration (refs #197)', () => {
  beforeEach(() => {
    // Collect keys before deleting: forEach walks by live index, so deleting
    // during iteration skips every other key once 2+ are set.
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupMocks();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // The Events page builds its React Query key from filters.monitorId on the
  // first render. If the persisted filter only lands in a post-paint effect,
  // that first render fetches the unfiltered list, and useScrollRestoration
  // (a layout effect) restores against it before the filter narrows the list.
  it('applies the persisted monitor filter on the very first render', () => {
    setupMocks({ monitorIds: ['3'] });

    const { monitorIdPerRender, result } = renderCapturingFilters();

    expect(monitorIdPerRender[0]).toBe('3');
    expect(result.current.filters.monitorId).toBe('3');
  });

  it('lets a deep-link URL filter win over the persisted one, also on the first render', () => {
    mockSearchParams.set('monitorId', '7');
    setupMocks({ monitorIds: ['3'] });

    const { monitorIdPerRender, result } = renderCapturingFilters();

    expect(monitorIdPerRender[0]).toBe('7');
    expect(result.current.filters.monitorId).toBe('7');
  });

  it('renders no monitor filter when neither settings nor URL carry one', () => {
    setupMocks();
    const { monitorIdPerRender } = renderCapturingFilters();
    expect(monitorIdPerRender[0]).toBeUndefined();
  });

  // A monitor card's Events button deep-links to ?monitorId=<id>&startDateTime=<watermark>
  // (refs #239). That URL sets startDateInput but leaves activeQuickRange null, since
  // resolveInitialFilters only ever sets activeQuickRange from the persisted settings
  // path, never from the URL. The Events page's clear-date button must key off
  // startDateInput/endDateInput too, not just activeQuickRange, or this state is
  // unclearable without also losing the monitor filter.
  it('hydrates startDateInput from a deep-linked date but leaves activeQuickRange null', () => {
    mockSearchParams.set('monitorId', '1');
    mockSearchParams.set('startDateTime', '2026-07-10T08:49:38');
    setupMocks();

    const { result } = renderCapturingFilters();

    expect(result.current.startDateInput).not.toBe('');
    expect(result.current.activeQuickRange).toBeNull();
  });
});

describe('useEventFilters', () => {
  beforeEach(() => {
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupMocks();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  describe('initial state', () => {
    it('returns empty filter values on first render', () => {
      const { result } = renderHook(() => useEventFilters());

      expect(result.current.selectedMonitorIds).toEqual([]);
      expect(result.current.selectedTagIds).toEqual([]);
      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.onlyDetectedObjects).toBe(false);
    });

    it('computes activeFilterCount as 0 when no filters set', () => {
      const { result } = renderHook(() => useEventFilters());
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('returns default filters object with correct shape', () => {
      const { result } = renderHook(() => useEventFilters());

      expect(result.current.filters).toMatchObject({
        limit: 100,
        sort: 'StartDateTime',
        direction: 'desc',
      });
      expect(result.current.filters.monitorId).toBeUndefined();
      expect(result.current.filters.startDateTime).toBeUndefined();
      expect(result.current.filters.endDateTime).toBeUndefined();
    });

    it('exports ALL_TAGS_FILTER_ID sentinel constant', () => {
      expect(ALL_TAGS_FILTER_ID).toBe('__all_tags__');
    });
  });

  describe('setSelectedMonitorIds', () => {
    it('updates selectedMonitorIds state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']);
      });

      expect(result.current.selectedMonitorIds).toEqual(['1', '2']);
    });

    it('reflects monitor selection in derived filters.monitorId', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['3', '4']);
      });

      expect(result.current.filters.monitorId).toBe('3,4');
    });

    it('sets filters.monitorId to undefined when list is empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1']);
      });
      act(() => {
        result.current.setSelectedMonitorIds([]);
      });

      expect(result.current.filters.monitorId).toBeUndefined();
    });

    it('persists to settings store when profile is present', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['5']);
      });

      expect(useSettingsStore.getState().getProfileSettings('profile-1').eventsPageFilters.monitorIds).toEqual([
        '5',
      ]);
    });
  });

  describe('setSelectedTagIds', () => {
    it('updates selectedTagIds state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-a', 'tag-b']);
      });

      expect(result.current.selectedTagIds).toEqual(['tag-a', 'tag-b']);
    });

    it('increments activeFilterCount for tag selection', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-a']);
      });

      expect(result.current.activeFilterCount).toBe(1);
    });
  });

  describe('date range filters', () => {
    it('sets start date input', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
      });

      expect(result.current.startDateInput).toBe('2024-01-01T00:00');
      expect(result.current.filters.startDateTime).toBe('2024-01-01T00:00');
    });

    it('sets end date input', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setEndDateInput('2024-12-31T23:59');
      });

      expect(result.current.endDateInput).toBe('2024-12-31T23:59');
      expect(result.current.filters.endDateTime).toBe('2024-12-31T23:59');
    });

    it('leaves startDateTime undefined in filters when empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('');
      });

      expect(result.current.filters.startDateTime).toBeUndefined();
    });

    it('counts each date field separately in activeFilterCount', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
      });

      expect(result.current.activeFilterCount).toBe(2);
    });
  });

  describe('favoritesOnly filter', () => {
    it('toggles favoritesOnly on', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setFavoritesOnly(true);
      });

      expect(result.current.favoritesOnly).toBe(true);
      expect(result.current.activeFilterCount).toBe(1);
    });

    it('toggles favoritesOnly off', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setFavoritesOnly(true);
      });
      act(() => {
        result.current.setFavoritesOnly(false);
      });

      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });
  });

  describe('archivedOnly filter', () => {
    it('toggles archivedOnly on', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });

      expect(result.current.archivedOnly).toBe(true);
      expect(result.current.activeFilterCount).toBe(1);
    });

    it('toggles archivedOnly off', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });
      act(() => {
        result.current.setArchivedOnly(false);
      });

      expect(result.current.archivedOnly).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('reflects archivedOnly in the archived URL param', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });
      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('archived')).toBe('true');
    });

    it('sets filters.archived to true when archivedOnly is enabled', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });

      expect(result.current.filters.archived).toBe(true);
    });
  });

  describe('onlyDetectedObjects filter', () => {
    it('enables onlyDetectedObjects and sets notesRegexp', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setOnlyDetectedObjects(true);
      });

      expect(result.current.onlyDetectedObjects).toBe(true);
      expect(result.current.filters.notesRegexp).toBe('detected:');
    });

    it('disables onlyDetectedObjects and clears notesRegexp', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setOnlyDetectedObjects(true);
      });
      act(() => {
        result.current.setOnlyDetectedObjects(false);
      });

      expect(result.current.filters.notesRegexp).toBeUndefined();
    });
  });

  describe('toggleMonitorSelection', () => {
    it('adds a monitor ID that is not yet selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.toggleMonitorSelection('7');
      });

      expect(result.current.selectedMonitorIds).toContain('7');
    });

    it('removes a monitor ID that is already selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['7', '8']);
      });
      act(() => {
        result.current.toggleMonitorSelection('7');
      });

      expect(result.current.selectedMonitorIds).not.toContain('7');
      expect(result.current.selectedMonitorIds).toContain('8');
    });
  });

  describe('toggleTagSelection', () => {
    it('adds a tag ID not yet selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.toggleTagSelection('tag-x');
      });

      expect(result.current.selectedTagIds).toContain('tag-x');
    });

    it('removes a tag ID already selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-x', 'tag-y']);
      });
      act(() => {
        result.current.toggleTagSelection('tag-x');
      });

      expect(result.current.selectedTagIds).not.toContain('tag-x');
      expect(result.current.selectedTagIds).toContain('tag-y');
    });
  });

  describe('clearFilters', () => {
    it('resets all filter state to empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']);
        result.current.setSelectedTagIds(['tag-a']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
        result.current.setFavoritesOnly(true);
        result.current.setOnlyDetectedObjects(true);
      });

      act(() => {
        result.current.clearFilters();
      });

      expect(result.current.selectedMonitorIds).toEqual([]);
      expect(result.current.selectedTagIds).toEqual([]);
      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.onlyDetectedObjects).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('calls setSearchParams on clear to remove URL params', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.clearFilters();
      });

      expect(mockSetSearchParams).toHaveBeenCalled();
    });
  });

  describe('applyFilters', () => {
    it('calls setSearchParams with current filter state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['3']);
      });
      act(() => {
        result.current.applyFilters();
      });

      expect(mockSetSearchParams).toHaveBeenCalled();
      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBe('3');
    });

    it('sets default sort and direction params if absent', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('sort')).toBe('StartDateTime');
      expect(newParams.get('direction')).toBe('desc');
    });

    it('removes monitorId from URL when monitor list is cleared', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds([]);
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBeNull();
    });
  });

  describe('applyFilters with date overrides (refs #193)', () => {
    it('writes override dates to URL instead of current state values', () => {
      const { result } = renderHook(() => useEventFilters());

      // Simulate the stale state: a previously selected range is in state...
      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-01-02T00:00');
      });

      // ...but the quick-range handler passes the freshly computed range as overrides.
      act(() => {
        result.current.applyFilters({
          startDateTime: '2024-06-01T06:00',
          endDateTime: '2024-06-01T10:00',
        });
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('startDateTime')).toBe('2024-06-01T06:00');
      expect(newParams.get('endDateTime')).toBe('2024-06-01T10:00');
    });

    it('falls back to current date state when no overrides are passed', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-03-03T03:00');
        result.current.setEndDateInput('2024-03-04T04:00');
      });
      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('startDateTime')).toBe('2024-03-03T03:00');
      expect(newParams.get('endDateTime')).toBe('2024-03-04T04:00');
    });
  });

  describe('clearDateRange (refs #194)', () => {
    it('clears the date range and active quick range but keeps monitor selection', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['5']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-01-02T00:00');
        result.current.setActiveQuickRange(4);
      });

      act(() => {
        result.current.clearDateRange();
      });

      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.activeQuickRange).toBeNull();
      // Monitor scope must survive clearing the time filter.
      expect(result.current.selectedMonitorIds).toEqual(['5']);
    });

    it('removes only the date params from the URL, preserving monitorId', () => {
      mockSearchParams.set('monitorId', '5');
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.clearDateRange();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBe('5');
      expect(newParams.get('startDateTime')).toBeNull();
      expect(newParams.get('endDateTime')).toBeNull();
    });
  });

  describe('activeFilterCount', () => {
    it('counts each active filter type once', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']); // counts as 1
        result.current.setSelectedTagIds(['tag-a']);      // counts as 1
        result.current.setFavoritesOnly(true);            // counts as 1
      });

      expect(result.current.activeFilterCount).toBe(3);
    });

    it('counts up to 6 at maximum (all filter types active)', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1']);
        result.current.setSelectedTagIds(['tag-a']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
        result.current.setFavoritesOnly(true);
        result.current.setOnlyDetectedObjects(true);
      });

      expect(result.current.activeFilterCount).toBe(6);
    });
  });

  describe('no profile', () => {
    it('does not crash when currentProfile is null', () => {
      seedProfiles([], { current: null });

      const { result } = renderHook(() => useEventFilters());

      // Should not throw; state setters should still work
      act(() => {
        result.current.setSelectedMonitorIds(['1']);
      });

      expect(result.current.selectedMonitorIds).toEqual(['1']);
      // Settings store should NOT be written because there is no profile ID
      expect(useSettingsStore.getState().profileSettings).toEqual({});
    });
  });
});

// All Servers mode has no current profile, only the ALL sentinel. Filters have
// to persist against that sentinel's bucket, or every selection dies on
// navigation away from the page (refs #337).
describe('useEventFilters in All Servers mode', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  /** Seeds profile-1 (unused unless a test switches back to single mode) plus
   *  the ALL sentinel as current, with the ALL bucket's eventsPageFilters
   *  overridden. */
  function setupAllMode(saved?: Partial<EventsPageFilters>) {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });
    useSettingsStore.setState({
      profileSettings: {
        ...useSettingsStore.getState().profileSettings,
        [ALL_PROFILES_ID]: mergeProfileSettings({
          defaultEventLimit: 100,
          eventsPageFilters: { ...DEFAULT_SETTINGS.eventsPageFilters, ...saved },
        }),
      },
    });
  }

  it('writes a filter to the ALL bucket and restores it on the next mount', () => {
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupAllMode();

    const first = renderHook(() => useEventFilters());
    act(() => {
      first.result.current.setFavoritesOnly(true);
      first.result.current.setActiveQuickRange(6);
    });
    first.unmount();

    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).eventsPageFilters).toMatchObject({
      favoritesOnly: true,
      activeQuickRange: 6,
    });

    const second = renderHook(() => useEventFilters());
    expect(second.result.current.favoritesOnly).toBe(true);
    expect(second.result.current.activeQuickRange).toBe(6);
  });

  // All-mode monitor selections are composite `${profileId}:${monitorId}`
  // tokens (EventsFilterPopover). The persisted form has to keep the token
  // whole: a bare id restored into All mode would apply profile-a's monitor 3
  // to profile-b's query too, since resolveOwnMonitorIds passes a ':'-less
  // token through to every profile in scope.
  it('round-trips a composite monitor token that no other profile matches', () => {
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupAllMode();

    const first = renderHook(() => useEventFilters());
    act(() => {
      first.result.current.setSelectedMonitorIds(['profile-a:3']);
    });
    first.unmount();

    const second = renderHook(() => useEventFilters());
    const restored = second.result.current.filters.monitorId;

    expect(resolveOwnMonitorIds(restored, asProfileId('profile-a'))).toBe('3');
    expect(resolveOwnMonitorIds(restored, asProfileId('profile-b'))).toBeUndefined();
    expect(second.result.current.selectedMonitorIds).toEqual(['profile-a:3']);
  });

  it('keeps the ALL bucket filter out of a single profile bucket', () => {
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupAllMode();

    const inAllMode = renderHook(() => useEventFilters());
    act(() => {
      inAllMode.result.current.setSelectedMonitorIds(['profile-a:3']);
    });
    inAllMode.unmount();

    useProfileStore.setState({ currentProfileId: asProfileId('profile-1') });
    const inSingleMode = renderHook(() => useEventFilters());

    expect(useSettingsStore.getState().getProfileSettings('profile-1').eventsPageFilters.monitorIds).toEqual([]);
    expect(inSingleMode.result.current.selectedMonitorIds).toEqual([]);
  });
});

// Linked recordings: a monitor linked to another records whenever that one
// alarms. Some people want only those, most want them out of the way, and the
// two directions map to ZoneMinder's REGEXP and NOT REGEXP on Cause (refs
// #493).
describe('useEventFilters - linked event cause', () => {
  it('asks for no cause at all by default', () => {
    setupMocks();
    const { result } = renderHook(() => useEventFilters());

    expect(result.current.linkedFilter).toBe('all');
    expect(result.current.filters.cause).toBeUndefined();
    expect(result.current.filters.causeExclude).toBeUndefined();
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('asks only for linked events, and counts as an active filter', () => {
    setupMocks();
    const { result } = renderHook(() => useEventFilters());

    act(() => result.current.setLinkedFilter('only'));

    expect(result.current.filters.cause).toBe('Linked');
    expect(result.current.filters.causeExclude).toBeUndefined();
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('excludes linked events, and counts as an active filter', () => {
    setupMocks();
    const { result } = renderHook(() => useEventFilters());

    act(() => result.current.setLinkedFilter('hide'));

    expect(result.current.filters.causeExclude).toBe('Linked');
    expect(result.current.filters.cause).toBeUndefined();
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('persists the choice to the profile bucket and restores it', () => {
    setupMocks();
    const { result } = renderHook(() => useEventFilters());

    act(() => result.current.setLinkedFilter('hide'));

    expect(
      useSettingsStore.getState().getProfileSettings(asProfileId('profile-1')).eventsPageFilters.linkedFilter
    ).toBe('hide');

    const restored = renderHook(() => useEventFilters());
    expect(restored.result.current.linkedFilter).toBe('hide');
  });

  it('treats a bucket saved before this filter existed as no filter', () => {
    setupMocks();
    const stored = useSettingsStore.getState().getProfileSettings(asProfileId('profile-1')).eventsPageFilters;
    const { linkedFilter: _dropped, ...withoutLinked } = stored;
    useSettingsStore.getState().updateProfileSettings(asProfileId('profile-1'), {
      eventsPageFilters: withoutLinked as typeof stored,
    });

    const { result } = renderHook(() => useEventFilters());

    expect(result.current.linkedFilter).toBe('all');
    expect(result.current.filters.cause).toBeUndefined();
  });

  it('clearing the filters puts it back to all', () => {
    setupMocks({ linkedFilter: 'hide' });
    const { result } = renderHook(() => useEventFilters());
    expect(result.current.linkedFilter).toBe('hide');

    act(() => result.current.clearFilters());

    expect(result.current.linkedFilter).toBe('all');
    expect(result.current.filters.causeExclude).toBeUndefined();
  });
});
