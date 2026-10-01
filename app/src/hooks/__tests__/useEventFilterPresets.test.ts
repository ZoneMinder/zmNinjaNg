/**
 * Event filter presets (refs #544): a named snapshot of the Events filter,
 * saved, loaded back and deleted against the real settings store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
const mockLocation = { state: null, pathname: '/events', search: '', hash: '', key: 'default' };

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useLocation: () => mockLocation,
}));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useEventFilters } from '../useEventFilters';
import { useEventFilterPresets } from '../useEventFilterPresets';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';

function renderPresets() {
  return renderHook(() => {
    const filters = useEventFilters();
    const presets = useEventFilterPresets(filters.loadFilters);
    return { filters, presets };
  });
}

const stored = () => useSettingsStore.getState().getProfileSettings('profile-1');

describe('useEventFilterPresets', () => {
  beforeEach(() => {
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    mockSetSearchParams.mockClear();
    seedProfiles(['profile-1'], { current: 'profile-1' });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('saves the current filter under a name and marks it loaded', () => {
    const { result } = renderPresets();
    act(() => result.current.filters.setSelectedMonitorIds(['3', '5']));
    act(() => result.current.filters.setFavoritesOnly(true));

    act(() => result.current.presets.save('Driveway'));

    expect(stored().eventFilterPresets).toEqual([
      { name: 'Driveway', filters: expect.objectContaining({ monitorIds: ['3', '5'], favoritesOnly: true }) },
    ]);
    expect(result.current.presets.activeName).toBe('Driveway');
  });

  it('overwrites a preset saved again under the same name', () => {
    const { result } = renderPresets();
    act(() => result.current.filters.setSelectedMonitorIds(['3']));
    act(() => result.current.presets.save('Driveway'));
    act(() => result.current.filters.setSelectedMonitorIds(['4']));

    act(() => result.current.presets.save('Driveway'));

    expect(stored().eventFilterPresets).toHaveLength(1);
    expect(stored().eventFilterPresets[0].filters.monitorIds).toEqual(['4']);
  });

  it('loading a preset replaces the current filter, persists it and writes the URL', () => {
    const { result } = renderPresets();
    act(() => result.current.filters.setSelectedMonitorIds(['3']));
    act(() => result.current.filters.setOnlyDetectedObjects(true));
    act(() => result.current.presets.save('Driveway'));
    act(() => result.current.filters.clearFilters());
    act(() => result.current.presets.clearActive());
    mockSetSearchParams.mockClear();

    act(() => result.current.presets.load('Driveway'));

    expect(result.current.filters.selectedMonitorIds).toEqual(['3']);
    expect(result.current.filters.onlyDetectedObjects).toBe(true);
    expect(stored().eventsPageFilters.monitorIds).toEqual(['3']);
    expect(result.current.presets.activeName).toBe('Driveway');
    const params = mockSetSearchParams.mock.calls.at(-1)?.[0] as URLSearchParams;
    expect(params.get('monitorId')).toBe('3');
  });

  it('loads a quick range relative to now, not to when it was saved', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
      const { result } = renderPresets();
      act(() => {
        result.current.filters.setStartDateInput('2026-09-01T08:00:00');
        result.current.filters.setEndDateInput('2026-09-01T12:00:00');
        result.current.filters.setActiveQuickRange(4);
      });
      act(() => result.current.presets.save('Last 4h'));

      vi.setSystemTime(new Date(2026, 9, 1, 15, 30, 0));
      act(() => result.current.presets.load('Last 4h'));

      expect(result.current.filters.startDateInput).toBe('2026-10-01T11:30:00');
      expect(result.current.filters.endDateInput).toBe('2026-10-01T15:30:00');
      expect(result.current.filters.activeQuickRange).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes the loaded preset and leaves no preset loaded', () => {
    const { result } = renderPresets();
    act(() => result.current.presets.save('Driveway'));
    act(() => result.current.presets.save('Porch'));

    act(() => result.current.presets.remove());

    expect(stored().eventFilterPresets.map((p) => p.name)).toEqual(['Driveway']);
    expect(result.current.presets.activeName).toBe('');
  });
});
