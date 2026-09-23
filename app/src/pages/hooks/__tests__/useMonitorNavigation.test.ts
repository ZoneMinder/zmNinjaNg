/**
 * useMonitorNavigation tests.
 *
 * Regression coverage for #180: stepping through monitors with prev/next must
 * not interfere with the back button. Prev/next/cycle navigation replaces the
 * history entry (so no per-monitor back-stack builds up) and preserves the
 * original `from` referrer (so the back button returns to the origin view, e.g.
 * montage, not the previously viewed monitor).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { asProfileId } from '../../../api/types';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

const navigateMock = vi.fn();
let mockLocation: { pathname: string; state: unknown };
let mockQueryKey: readonly unknown[] = [];
/** A monitor that is capturing, so skip-offline navigation stops on it. */
const liveMonitor = (id: string) => ({
  Monitor: { Id: id, Function: 'Monitor', Capturing: 'Always' },
  Monitor_Status: { Status: 'Connected', CaptureFPS: '10.00' },
});

const defaultMonitors = () => [liveMonitor('1'), liveMonitor('2'), liveMonitor('3')];

let mockMonitors: unknown[] = defaultMonitors();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => mockLocation,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    mockQueryKey = options.queryKey;
    return { data: { monitors: mockMonitors } };
  },
}));


vi.mock('../../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../../lib/monitor/filters', () => ({
  filterEnabledMonitors: (monitors: unknown) => monitors,
}));
vi.mock('../../../hooks/useSwipeNavigation', () => ({
  useSwipeNavigation: () => ({}),
}));

let mockGroupFilter: { isFilterActive: boolean; filteredMonitorIds: string[] } = {
  isFilterActive: false,
  filteredMonitorIds: [],
};

vi.mock('../../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => mockGroupFilter,
}));

import { useMonitorNavigation } from '../useMonitorNavigation';

const profileB = asProfileId('profile-b');

describe('useMonitorNavigation prev/next history handling', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    seedProfiles(['profile-a'], { current: 'profile-a' });
    mockLocation = { pathname: '/monitors/2', state: { from: '/montage' } };
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('next replaces history and preserves the original referrer', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', {
      replace: true,
      state: { from: '/montage' },
    });
  });

  it('prev replaces history and preserves the original referrer', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeRight());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/1', {
      replace: true,
      state: { from: '/montage' },
    });
  });

  it('does not overwrite the referrer with the current monitor path', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeLeft());

    const [, options] = navigateMock.mock.calls[0];
    expect((options.state as { from?: string }).from).not.toBe('/monitors/2');
  });
});

describe('useMonitorNavigation skips offline monitors (refs #527)', () => {
  // Legacy `Function` fields: the seeded auth slices carry no ZM version, so
  // the run state resolves through the pre-1.38 path.
  const live = liveMonitor;
  const offline = (id: string) => ({
    Monitor: { Id: id, Function: 'Monitor', Capturing: 'Always' },
    Monitor_Status: { Status: 'Running', CaptureFPS: '0.00' },
  });
  const onDemand = (id: string) => ({
    Monitor: { Id: id, Function: 'Monitor', Capturing: 'Ondemand' },
    Monitor_Status: { Status: null, CaptureFPS: null },
  });

  beforeEach(() => {
    navigateMock.mockClear();
    mockLocation = { pathname: '/monitors/1', state: { from: '/monitors' } };
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    mockMonitors = defaultMonitors();
  });

  it('steps over an offline monitor when the setting is on', () => {
    seedProfiles(['profile-a'], { current: 'profile-a', settings: { 'profile-a': { skipOfflineMonitors: true } } });
    mockMonitors = [live('1'), offline('2'), live('3')];

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '1' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', expect.anything());
  });

  it('stops on an offline monitor when the setting is off', () => {
    seedProfiles(['profile-a'], { current: 'profile-a', settings: { 'profile-a': { skipOfflineMonitors: false } } });
    mockMonitors = [live('1'), offline('2'), live('3')];

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '1' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/2', expect.anything());
  });

  it('keeps on-demand monitors in the rotation: they only start capturing once viewed', () => {
    seedProfiles(['profile-a'], { current: 'profile-a', settings: { 'profile-a': { skipOfflineMonitors: true } } });
    mockMonitors = [live('1'), onDemand('2'), live('3')];

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '1' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/2', expect.anything());
  });

  it('keeps the monitor being viewed navigable even when it is offline', () => {
    seedProfiles(['profile-a'], { current: 'profile-a', settings: { 'profile-a': { skipOfflineMonitors: true } } });
    mockMonitors = [live('1'), offline('2'), live('3')];
    mockLocation = { pathname: '/monitors/2', state: { from: '/monitors' } };

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    expect(result.current.hasPrev).toBe(true);
    expect(result.current.hasNext).toBe(true);

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', expect.anything());
  });
});

describe('useMonitorNavigation All mode (refs #337)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    seedProfiles(['profile-a', 'profile-b'], { current: 'profile-a' });
    mockLocation = { pathname: '/all/monitors/profile-b/2', state: { from: '/monitors' } };
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches monitors via the given profile\'s session and queryKey', () => {
    renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    expect(mockQueryKey).toEqual(['monitors', profileB]);
  });

  it('navigates within /all/monitors/:profileId/... on next, staying in owning-profile context', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/profile-b/3', {
      replace: true,
      state: { from: '/monitors' },
    });
  });

  it('navigates within /all/monitors/:profileId/... on prev, staying in owning-profile context', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    act(() => result.current.onSwipeRight());

    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/profile-b/1', {
      replace: true,
      state: { from: '/monitors' },
    });
  });
});

describe('useMonitorNavigation respects the monitor group (refs #527)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    seedProfiles(['profile-a'], { current: 'profile-a' });
    mockMonitors = [liveMonitor('1'), liveMonitor('2'), liveMonitor('3')];
    mockLocation = { pathname: '/monitors/1', state: { from: '/monitors' } };
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    mockGroupFilter = { isFilterActive: false, filteredMonitorIds: [] };
    mockMonitors = defaultMonitors();
  });

  it('steps over a monitor outside the selected group', () => {
    mockGroupFilter = { isFilterActive: true, filteredMonitorIds: ['1', '3'] };

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '1' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', expect.anything());
  });

  it('steps through every monitor when no group is selected', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '1' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/2', expect.anything());
  });

  it('keeps the monitor being viewed navigable when it sits outside the group', () => {
    mockGroupFilter = { isFilterActive: true, filteredMonitorIds: ['1', '3'] };
    mockLocation = { pathname: '/monitors/2', state: { from: '/monitors' } };

    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    expect(result.current.hasPrev).toBe(true);

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', expect.anything());
  });

  it('ignores the group filter on an /all/ deep route, which has no cross-server groups', () => {
    seedProfiles(['profile-a', 'profile-b'], { current: 'profile-a' });
    mockGroupFilter = { isFilterActive: true, filteredMonitorIds: ['1', '3'] };
    mockLocation = { pathname: '/all/monitors/profile-b/1', state: { from: '/monitors' } };

    const { result } = renderHook(() =>
      useMonitorNavigation({ currentMonitorId: '1', profileId: profileB })
    );

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/profile-b/2', expect.anything());
  });
});
