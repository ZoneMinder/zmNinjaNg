import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { DashboardLayout } from '../DashboardLayout';
import { asProfileId, ALL_PROFILES_ID, mintVirtualProfileId } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { useProfileStore } from '../../../stores/profile';
import { useDashboardStore, type DashboardWidget } from '../../../stores/dashboard';

function makeWidgets(): DashboardWidget[] {
  return [
    {
      id: 'widget-1',
      type: 'monitor',
      title: 'Front Door',
      layout: { i: 'widget-1', x: 0, y: 0, w: 4, h: 3 },
      settings: { monitorIds: ['1'], feedFit: 'contain' },
    },
    {
      id: 'widget-2',
      type: 'events',
      title: 'Recent Events',
      layout: { i: 'widget-2', x: 4, y: 0, w: 4, h: 3 },
      settings: { eventCount: 5 },
    },
  ];
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock react-grid-layout to capture layout changes
let capturedOnLayoutChange: ((layout: { i: string; x: number; y: number; w: number; h: number }[]) => void) | null = null;

vi.mock('react-grid-layout', () => {
  return {
    default: vi.fn(({ children, onLayoutChange }) => {
      capturedOnLayoutChange = onLayoutChange;
      return <div data-testid="grid-layout">{children}</div>;
    }),
    WidthProvider: (Component: React.ComponentType) => Component,
  };
});

// Mock the widget components to avoid their dependencies
// The stubs expose the picks each widget is handed.
vi.mock('../widgets/MonitorWidget', () => ({
  MonitorWidget: ({ monitorRefs }: { monitorRefs?: unknown }) => (
    <div data-testid="monitor-widget" data-refs={JSON.stringify(monitorRefs ?? null)} />
  ),
}));

vi.mock('../widgets/EventsWidget', () => ({
  EventsWidget: ({ monitorRefs }: { monitorRefs?: unknown }) => (
    <div data-testid="events-widget" data-refs={JSON.stringify(monitorRefs ?? null)} />
  ),
}));

vi.mock('../widgets/TimelineWidget', () => ({
  TimelineWidget: () => <div data-testid="timeline-widget" />,
}));

vi.mock('../widgets/HeatmapWidget', () => ({
  HeatmapWidget: () => <div data-testid="heatmap-widget" />,
}));

vi.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ children, id }: { children: React.ReactNode; id: string }) => (
    <div data-testid={`dashboard-widget-${id}`}>{children}</div>
  ),
}));

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([makeProfile('profile-1', { name: 'Test' })]);
    useDashboardStore.setState({ widgets: { 'profile-1': makeWidgets() }, isEditing: true });
    capturedOnLayoutChange = null;
    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      setTimeout(cb, 0);
      return 0;
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useDashboardStore.setState({ widgets: {}, isEditing: false });
  });

  it('renders widgets from the store', () => {
    render(<DashboardLayout />);

    expect(screen.getByTestId('dashboard-widget-widget-1')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-widget-widget-2')).toBeInTheDocument();
  });

  // Each aggregate keeps its own dashboard: a group's widgets live under the
  // group's id, not the All Servers sentinel's (refs #337).
  it("renders the active group's own widgets", () => {
    const group = mintVirtualProfileId();
    useDashboardStore.setState({ widgets: { [group]: makeWidgets(), [ALL_PROFILES_ID]: [] } });
    useProfileStore.setState({
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: [asProfileId('profile-1')] }],
    });

    render(<DashboardLayout />);

    expect(screen.getByTestId('dashboard-widget-widget-1')).toBeInTheDocument();
  });

  // A widget saved before picks carried their server keeps showing the
  // same monitors: its stored profile, or the first in scope (refs #529).
  it('hands a legacy aggregate widget its monitors pinned to their server', () => {
    const home = makeProfile('profile-1', { name: 'Test' });
    const work = makeProfile('profile-2', { name: 'Work' });
    seedProfiles([home, work], { current: ALL_PROFILES_ID });
    const [monitor, events] = makeWidgets();
    useDashboardStore.setState({
      widgets: {
        [ALL_PROFILES_ID]: [
          { ...monitor, settings: { monitorIds: ['1'], profileId: work.id } },
          { ...events, settings: { monitorIds: ['3'] } },
        ],
      },
    });

    render(<DashboardLayout />);

    expect(JSON.parse(screen.getByTestId('monitor-widget').dataset.refs!))
      .toEqual([{ profileId: work.id, monitorId: '1' }]);
    expect(JSON.parse(screen.getByTestId('events-widget').dataset.refs!))
      .toEqual([{ profileId: home.id, monitorId: '3' }]);
  });

  it('renders empty state when no widgets exist', () => {
    useDashboardStore.setState({ widgets: { 'profile-1': [] } });

    render(<DashboardLayout />);

    expect(screen.queryByTestId('grid-layout')).not.toBeInTheDocument();
  });

  it('does not touch the store during initial sync from store', async () => {
    render(<DashboardLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('grid-layout')).toBeInTheDocument();
    });

    // The initial render's own layout sync must not write back to the
    // store - it should still hold exactly what beforeEach seeded.
    expect(useDashboardStore.getState().widgets['profile-1']).toEqual(makeWidgets());
  });

  it('writes the changed layout to the store once sync completes', async () => {
    render(<DashboardLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('grid-layout')).toBeInTheDocument();
    });

    // Wait for requestAnimationFrame to complete (sync flag reset)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Now simulate a user-initiated layout change
    if (capturedOnLayoutChange) {
      act(() => {
        capturedOnLayoutChange!([
          { i: 'widget-1', x: 0, y: 0, w: 6, h: 4 }, // Changed size
          { i: 'widget-2', x: 6, y: 0, w: 4, h: 3 },
        ]);
      });
    }

    await waitFor(() => {
      const widget1 = useDashboardStore.getState().widgets['profile-1'].find((w) => w.id === 'widget-1');
      expect(widget1?.layout).toMatchObject({ w: 6, h: 4 });
      expect(widget1?.layouts?.lg).toMatchObject({ w: 6, h: 4 });
    });
  });

  it('uses areLayoutsEqual to compare layouts correctly', () => {
    // Test the layout comparison logic directly
    const layout1 = [
      { i: 'widget-1', x: 0, y: 0, w: 4, h: 3 },
      { i: 'widget-2', x: 4, y: 0, w: 4, h: 3 },
    ];

    const layout2 = [
      { i: 'widget-1', x: 0, y: 0, w: 4, h: 3 },
      { i: 'widget-2', x: 4, y: 0, w: 4, h: 3 },
    ];

    const layout3 = [
      { i: 'widget-1', x: 0, y: 0, w: 6, h: 4 }, // Different
      { i: 'widget-2', x: 6, y: 0, w: 4, h: 3 },
    ];

    // Helper function to compare layouts (same logic as in component)
    const areLayoutsEqual = (a: typeof layout1, b: typeof layout1) => {
      if (a.length !== b.length) return false;
      const map = new Map(a.map((item) => [item.i, item]));
      return b.every((item) => {
        const match = map.get(item.i);
        return (
          match &&
          match.x === item.x &&
          match.y === item.y &&
          match.w === item.w &&
          match.h === item.h
        );
      });
    };

    expect(areLayoutsEqual(layout1, layout2)).toBe(true);
    expect(areLayoutsEqual(layout1, layout3)).toBe(false);
    expect(areLayoutsEqual(layout1, [])).toBe(false);
  });

  it('renders correct widget types based on widget configuration', () => {
    render(<DashboardLayout />);

    // Check that monitor widget is rendered for type 'monitor'
    expect(screen.getByTestId('monitor-widget')).toBeInTheDocument();
    // Check that events widget is rendered for type 'events'
    expect(screen.getByTestId('events-widget')).toBeInTheDocument();
  });
});
