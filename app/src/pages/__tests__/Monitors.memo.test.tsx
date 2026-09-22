/**
 * MonitorCard is memo()'d, so a parent re-render (the monitor status poll
 * refetches on an interval) must not re-render every card. memo does a shallow
 * compare of props, so one prop with a fresh identity per render defeats it.
 * These tests pin the two things that keep the compare honest: the callback
 * prop's identity, and the resulting render count.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import Monitors from '../Monitors';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// Its own tests cover the button's two gates; stubbing keeps useAssistantEnabled's
// settings-store reads out of this file's mock surface, as with the analysis
// toggle above.
vi.mock('../../components/assistant/NinjiiToolbarButton', () => ({
  NinjiiToolbarButton: () => null,
}));


const mockState = vi.hoisted(() => ({
  renderCount: new Map<string, number>(),
  settingsProps: [] as Array<(monitor: unknown) => void>,
  newEventCounts: { '1': 2, '2': 1 } as Record<string, number>,
  newestEventAt: { '1': '2026-07-10 09:00:00', '2': '2026-07-10 08:00:00' } as Record<string, string | null>,
  // Same array reference returned on every call, mirroring the real
  // useScopedMonitors' `combine`-based reference stability (Task 4). A fresh
  // array per call would defeat the memo comparison this file exists to test.
  scopedMonitors: [
    { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected', CaptureFPS: '10.00' } } },
    { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected', CaptureFPS: '10.00' } } },
  ],
}));

vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => ({
    monitors: mockState.scopedMonitors,
    errors: [],
    isLoading: false,
    refetchProfile: vi.fn(),
  }),
}));

vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ isFilterActive: false, filteredMonitorIds: [], isFilterReady: true }),
}));

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: mockState.newEventCounts, newest: mockState.newestEventAt }),
  useScopedMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  scopedMonitorEventKey: (profileId: string, monitorId: string) => `${profileId}:${monitorId}`,
}));

// Stand-in for the real memo()'d MonitorCard (MonitorCard.tsx:382). It is
// memo()'d here for the same reason, and counts how often its body actually
// runs so an escaped re-render is visible.
vi.mock('../../components/monitors/MonitorCard', async () => {
  const { memo } = await import('react');
  const Card = ({
    monitor,
    onShowSettings,
  }: {
    monitor: { Id: string; Name: string };
    onShowSettings: (monitor: unknown) => void;
  }) => {
    mockState.renderCount.set(monitor.Id, (mockState.renderCount.get(monitor.Id) ?? 0) + 1);
    mockState.settingsProps.push(onShowSettings);
    return <div data-testid={`monitor-card-${monitor.Id}`}>{monitor.Name}</div>;
  };
  return { MonitorCard: memo(Card) };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Its own tests cover the toggle (including how it resolves the page's
// Streaming Mode in All mode); stubbing keeps that resolution's stores out of
// this file's mock surface.
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({
  AnalysisFramesToggle: () => <div data-testid="analysis-frames-toggle-stub" />,
}));

describe('Monitors page memo stability', () => {
  // No username on the seeded profile, so usePermissions' real
  // fetchAccountPermissions short-circuits to UNRESTRICTED_PERMISSIONS
  // (system: 'Edit') without any network call - matching the old mock's
  // value while exercising the real hook.
  beforeEach(() => {
    mockState.renderCount.clear();
    mockState.settingsProps.length = 0;
    seedProfiles([makeProfile('profile-1', { name: 'Home' })], {
      current: 'profile-1',
      settings: {
        'profile-1': {
          monitorsViewMode: 'list',
          monitorsFeedFit: 'contain',
          monitorGridCols: 2,
          monitorsGroupByServer: false,
        },
      },
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  function renderMonitors() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<Monitors />, {
      wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: queryClient }, children),
    });
  }

  it('passes a reference-stable onShowSettings to every card across re-renders', () => {
    const { rerender } = renderMonitors();
    const firstPass = [...mockState.settingsProps];
    expect(firstPass).toHaveLength(2);

    rerender(<Monitors />);

    // Every card, on both passes, got the exact same function object.
    for (const handler of mockState.settingsProps) {
      expect(handler).toBe(firstPass[0]);
    }
  });

  it('does not re-render memoized cards when the parent re-renders with unchanged data', () => {
    const { rerender } = renderMonitors();
    expect(mockState.renderCount.get('1')).toBe(1);
    expect(mockState.renderCount.get('2')).toBe(1);

    // Stands in for the 20s monitor status poll settling with identical data.
    rerender(<Monitors />);
    rerender(<Monitors />);

    expect(mockState.renderCount.get('1')).toBe(1);
    expect(mockState.renderCount.get('2')).toBe(1);
  });
});
