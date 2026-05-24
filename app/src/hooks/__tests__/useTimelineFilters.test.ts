/**
 * useTimelineFilters Hook Tests
 *
 * Focus on the Event Cause filter: state, persistence, restore, and counting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineFilters } from '../useTimelineFilters';

const mockCurrentProfile = { id: 'profile-1', name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 };
const mockGetProfileSettings = vi.fn();
const mockUpdateProfileSettings = vi.fn();

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

import { useCurrentProfile } from '../useCurrentProfile';
import { useSettingsStore } from '../../stores/settings';

const defaultTimelineFilters = {
  monitorIds: [],
  startDateTime: '',
  endDateTime: '',
  onlyDetectedObjects: false,
  causeFilter: '',
  activeQuickRange: null,
};

function setupMocks(filterOverrides?: Partial<typeof defaultTimelineFilters>) {
  const timelinePageFilters = { ...defaultTimelineFilters, ...filterOverrides };
  const settings = { timelinePageFilters };

  vi.mocked(useCurrentProfile).mockReturnValue({
    currentProfile: mockCurrentProfile,
    settings: settings as never,
    hasProfile: true,
  });

  mockGetProfileSettings.mockReturnValue(settings);

  vi.mocked(useSettingsStore.getState).mockReturnValue({
    getProfileSettings: mockGetProfileSettings,
    updateProfileSettings: mockUpdateProfileSettings,
  } as never);
}

describe('useTimelineFilters cause filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('defaults causeFilter to empty and counts 0', () => {
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('updates causeFilter and counts it as one active filter', () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('motion_detected');
    });

    expect(result.current.causeFilter).toBe('motion_detected');
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('persists causeFilter to the settings store', () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('Continuous');
    });

    expect(mockUpdateProfileSettings).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        timelinePageFilters: expect.objectContaining({ causeFilter: 'Continuous' }),
      }),
    );
  });

  it('restores a persisted causeFilter on mount', () => {
    setupMocks({ causeFilter: 'Signal' });
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('Signal');
  });

  it('clears causeFilter via clearFilters', () => {
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
