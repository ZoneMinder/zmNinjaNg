/**
 * useTimelineFilters Hook Tests
 *
 * Focus on the Event Cause filter: state, persistence, restore, and counting.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineFilters } from '../useTimelineFilters';
import { ALL_PROFILES_ID } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { useProfileStore } from '../../stores/profile';

describe('useTimelineFilters cause filter', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('defaults causeFilter to empty and counts 0', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('updates causeFilter and counts it as one active filter', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('motion_detected');
    });

    expect(result.current.causeFilter).toBe('motion_detected');
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('persists causeFilter to the settings store', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('Continuous');
    });

    expect(useSettingsStore.getState().getProfileSettings('profile-1').timelinePageFilters.causeFilter).toBe(
      'Continuous',
    );
  });

  it('restores a persisted causeFilter on mount', () => {
    seedProfiles(['profile-1'], {
      current: 'profile-1',
      settings: { 'profile-1': { timelinePageFilters: { ...DEFAULT_SETTINGS.timelinePageFilters, causeFilter: 'Signal' } } },
    });
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('Signal');
  });

  it('clears causeFilter via clearFilters', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('Forced');
    });
    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.causeFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });
});

// All Servers mode has no current profile, only the ALL sentinel, so filters
// have to persist against that sentinel's bucket (refs #337).
describe('useTimelineFilters in All Servers mode', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('writes a filter to the ALL bucket and restores it on the next mount', () => {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

    const first = renderHook(() => useTimelineFilters());
    act(() => {
      first.result.current.setCauseFilter('Motion');
      first.result.current.setActiveQuickRange(12);
    });
    first.unmount();

    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).timelinePageFilters).toMatchObject({
      causeFilter: 'Motion',
      activeQuickRange: 12,
    });

    const second = renderHook(() => useTimelineFilters());
    expect(second.result.current.causeFilter).toBe('Motion');
    expect(second.result.current.activeQuickRange).toBe(12);
  });

  it('keeps the ALL bucket filter out of a single profile bucket', () => {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

    const inAllMode = renderHook(() => useTimelineFilters());
    act(() => {
      inAllMode.result.current.setCauseFilter('Motion');
    });
    inAllMode.unmount();

    // Switch to single mode against the same, still-seeded profile-1.
    useProfileStore.setState({ currentProfileId: useProfileStore.getState().profiles[0].id });
    const inSingleMode = renderHook(() => useTimelineFilters());

    expect(useSettingsStore.getState().getProfileSettings('profile-1').timelinePageFilters.causeFilter).toBe('');
    expect(inSingleMode.result.current.causeFilter).toBe('');
  });
});

describe('useTimelineFilters persisted quick range (refs #556)', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('re-anchors a saved quick range to now on mount', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    seedProfiles(['profile-1'], {
      current: 'profile-1',
      settings: {
        'profile-1': {
          timelinePageFilters: {
            ...DEFAULT_SETTINGS.timelinePageFilters,
            activeQuickRange: 8,
            startDateTime: '2026-10-01T04:00',
            endDateTime: '2026-10-01T12:00',
          },
        },
      },
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.startDateInput).toBe('2026-10-10T04:00');
    expect(result.current.endDateInput).toBe('2026-10-10T12:00');
    expect(result.current.activeQuickRange).toBe(8);
  });

  it('moves a quick range up to now on refresh and reports when nothing moved', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    seedProfiles(['profile-1'], {
      current: 'profile-1',
      settings: {
        'profile-1': {
          timelinePageFilters: { ...DEFAULT_SETTINGS.timelinePageFilters, activeQuickRange: 8 },
        },
      },
    });
    const { result } = renderHook(() => useTimelineFilters());

    let moved = true;
    act(() => { moved = result.current.refreshQuickRange(); });
    expect(moved).toBe(false);

    vi.setSystemTime(new Date(2026, 9, 10, 13, 0, 0));
    act(() => { moved = result.current.refreshQuickRange(); });
    expect(moved).toBe(true);
    expect(result.current.startDateInput).toBe('2026-10-10T05:00');
    expect(result.current.endDateInput).toBe('2026-10-10T13:00');
  });
});

