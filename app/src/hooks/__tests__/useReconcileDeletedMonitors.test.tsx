import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useReconcileDeletedMonitors } from '../useReconcileDeletedMonitors';
import { useSettingsStore, DEFAULT_MONTAGE_GROUP_LAYOUT } from '../../stores/settings';
import { useDashboardStore } from '../../stores/dashboard';
import { getMonitors } from '../../api/monitors';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../api/types';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

const VIRTUAL_ID = mintVirtualProfileId();

const mockGetMonitors = vi.mocked(getMonitors);

function monitorList(ids: string[]) {
  return { monitors: ids.map((Id) => ({ Monitor: { Id }, Monitor_Status: undefined })) } as never;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function seedProfile() {
  seedProfiles(['p1']);
  useSettingsStore.setState({
    profileSettings: {
      p1: {
        excludedMonitorIds: ['1', '99'],
        montageByGroup: {
          all: { ...DEFAULT_MONTAGE_GROUP_LAYOUT, hiddenMonitorIds: ['99'] },
        },
      },
      // The All Servers bucket, keyed by composite tile ids: one of p1's is
      // stale, one is live, and p2's are unknowable from p1's monitor list.
      [ALL_PROFILES_ID]: {
        montageByGroup: {
          all: {
            ...DEFAULT_MONTAGE_GROUP_LAYOUT,
            hiddenMonitorIds: ['p1:1', 'p1:99', 'p2:99'],
            workingLayout: [
              { i: 'p1:1', x: 0, y: 0, w: 4, h: 4 },
              { i: 'p1:99', x: 4, y: 0, w: 4, h: 4 },
              { i: 'p2:99', x: 8, y: 0, w: 4, h: 4 },
            ],
          },
        },
      },
    } as never,
  });
  useDashboardStore.setState({
    widgets: {
      p1: [
        {
          id: 'w1',
          type: 'monitor',
          settings: { monitorIds: ['1', '99'] },
          layout: { i: 'w1', x: 0, y: 0, w: 4, h: 4 },
        },
      ],
    },
  });
}

function storedState() {
  const allBucket = useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID)
    .montageByGroup?.all;
  return {
    excluded: useSettingsStore.getState().getProfileSettings('p1').excludedMonitorIds,
    montageHidden:
      useSettingsStore.getState().getProfileSettings('p1').montageByGroup?.all?.hiddenMonitorIds,
    widgetIds: useDashboardStore.getState().widgets.p1?.[0].settings.monitorIds,
    allHidden: allBucket?.hiddenMonitorIds,
    allLayoutIds: allBucket?.workingLayout.map((item) => item.i),
  };
}

describe('useReconcileDeletedMonitors', () => {
  beforeEach(() => {
    mockGetMonitors.mockReset();
    seedProfile();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('drops ids for monitors ZoneMinder no longer has, everywhere they are stored', async () => {
    mockGetMonitors.mockResolvedValue(monitorList(['1']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(storedState().excluded).toEqual(['1']));
    expect(storedState().montageHidden).toEqual([]);
    expect(storedState().widgetIds).toEqual(['1']);
  });

  it('keeps a hidden monitor that still exists, which the ordinary monitor list omits', async () => {
    // '99' is hidden, so getMonitors() without includeExcluded would not return
    // it. Reconciling against that list would delete the user's own hidden
    // entry, so the hook must ask for the list that includes it.
    mockGetMonitors.mockResolvedValue(monitorList(['1', '99']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(mockGetMonitors).toHaveBeenCalledWith(expect.anything(), expect.anything(), { includeExcluded: true });
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
  });

  it("drops this profile's deleted tiles from the All Servers bucket and leaves the other server's alone", async () => {
    mockGetMonitors.mockResolvedValue(monitorList(['1']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    // p1:99 is gone from p1's server. p2:99 is a different server's monitor
    // that happens to share the raw id, and p1's list says nothing about it.
    await waitFor(() => expect(storedState().allHidden).toEqual(['p1:1', 'p2:99']));
    expect(storedState().allLayoutIds).toEqual(['p1:1', 'p2:99']);
  });

  it("drops this profile's deleted tiles from a virtual profile's bucket too (refs #337)", async () => {
    // A group's bucket holds the same composite profileId:monitorId tile ids
    // the All bucket does, under its own key. Pruning only the All bucket
    // leaves a group showing a monitor ZoneMinder no longer has, with no way
    // to clear it.
    useSettingsStore.setState({
      profileSettings: {
        ...useSettingsStore.getState().profileSettings,
        [VIRTUAL_ID]: {
          montageByGroup: {
            all: {
              ...DEFAULT_MONTAGE_GROUP_LAYOUT,
              hiddenMonitorIds: ['p1:1', 'p1:99', 'p2:99'],
              workingLayout: [
                { i: 'p1:1', x: 0, y: 0, w: 4, h: 4 },
                { i: 'p1:99', x: 4, y: 0, w: 4, h: 4 },
                { i: 'p2:99', x: 8, y: 0, w: 4, h: 4 },
              ],
            },
          },
        },
      } as never,
    });
    mockGetMonitors.mockResolvedValue(monitorList(['1']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() =>
      expect(
        useSettingsStore.getState().getProfileSettings(VIRTUAL_ID).montageByGroup?.all
          ?.hiddenMonitorIds
      ).toEqual(['p1:1', 'p2:99'])
    );
    // The All bucket is still pruned as well - this is an addition, not a move.
    expect(storedState().allHidden).toEqual(['p1:1', 'p2:99']);
  });

  it("drops this profile's deleted picks from an aggregate dashboard's widgets (refs #529)", async () => {
    const p1 = asProfileId('p1');
    const p2 = asProfileId('p2');
    useDashboardStore.setState({
      widgets: {
        ...useDashboardStore.getState().widgets,
        [ALL_PROFILES_ID]: [
          {
            id: 'agg',
            type: 'monitor',
            settings: { monitorRefs: [{ profileId: p1, monitorId: '1' }, { profileId: p1, monitorId: '99' }, { profileId: p2, monitorId: '99' }] },
            layout: { i: 'agg', x: 0, y: 0, w: 4, h: 4 },
          },
        ],
      },
    });
    mockGetMonitors.mockResolvedValue(monitorList(['1']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() =>
      expect(useDashboardStore.getState().widgets[ALL_PROFILES_ID][0].settings.monitorRefs).toEqual([
        { profileId: p1, monitorId: '1' },
        { profileId: p2, monitorId: '99' },
      ])
    );
  });

  it('changes nothing when the fetch fails: an error is not proof of deletion', async () => {
    mockGetMonitors.mockRejectedValue(new Error('offline'));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
  });

  it('changes nothing when the server returns no monitors at all', async () => {
    mockGetMonitors.mockResolvedValue(monitorList([]));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().montageHidden).toEqual(['99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
    expect(storedState().allHidden).toEqual(['p1:1', 'p1:99', 'p2:99']);
  });
});
