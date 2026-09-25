/**
 * All-mode smoke test for the dashboard widgets (refs #337): none of them
 * may throw when the virtual ALL_PROFILES_ID sentinel is the active
 * selection, whether or not any profile's query has resolved yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { MonitorWidget } from '../MonitorWidget';
import { EventsWidget } from '../EventsWidget';
import { TimelineWidget } from '../TimelineWidget';
import { HeatmapWidget } from '../HeatmapWidget';
import { getEvents } from '../../../../api/events';
import { getMonitor, getMonitors } from '../../../../api/monitors';
import { ALL_PROFILES_ID, type EventData } from '../../../../api/types';
import { useSettingsStore } from '../../../../stores/settings';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: () => 'x', fmtDate: () => 'x', fmtWeekday: () => 'x', fmtTimeShort: () => 'x' }),
}));
vi.mock('../../../theme-provider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));
// TimelineWidget renders a real recharts BarChart; jsdom has no layout
// engine, so ResponsiveContainer measures a 0x0 container and recharts logs
// a noisy width/height warning on every render. This is a smoke test for
// throws, not chart output, so stub the whole module out.
// The stubs expose the chart's rows and each bar's series, which is what the
// stacked-by-server test reads.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) => (
    <div data-testid="bar-chart" data-rows={JSON.stringify(data ?? [])}>{children}</div>
  ),
  Bar: ({ dataKey, stackId, name }: { dataKey: string; stackId?: string; name?: string }) => (
    <div data-testid="bar" data-key={dataKey} data-stack={stackId ?? ''}>{name}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));
vi.mock('../../../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getMonitors: vi.fn(),
}));
vi.mock('../../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="live-player" />,
}));
vi.mock('../../../monitors/MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

describe('Dashboard widgets under the ALL_PROFILES_ID sentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // bandwidthMode defaults to 'normal' in every seeded profile below, whose
    // real getBandwidthSettings() gives eventsWidgetInterval 30000 and
    // timelineHeatmapInterval 60000 - the same values the old mock hardcoded.
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: {
        [profileA.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
        [profileB.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
      },
    });
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getMonitor).mockResolvedValue({ Monitor: { Id: '1', Name: 'Cam', Deleted: false } } as never);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  const wrap = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('MonitorWidget does not throw, pinned to the first profile in scope', () => {
    expect(() => render(wrap(<MonitorWidget monitorRefs={[{ profileId: profileA.id, monitorId: '1' }]} />))).not.toThrow();
  });

  it('EventsWidget does not throw and aggregates across scope.profiles', () => {
    expect(() => render(wrap(<EventsWidget />))).not.toThrow();
  });

  it('TimelineWidget does not throw', () => {
    expect(() => render(wrap(<TimelineWidget />))).not.toThrow();
  });

  it('HeatmapWidget does not throw', () => {
    expect(() => render(wrap(<HeatmapWidget />))).not.toThrow();
  });

  // Group by server (refs #529): the aggregate's own eventsGroupByServer
  // sections the list and the heatmap per server and stacks the bars.
  describe('grouped by server', () => {
    // Half an hour ago in UTC wall-clock form, the profiles' timezone.
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const ev = (id: string, name: string) =>
      ({ Event: { Id: id, Name: name, StartDateTime: recent, Cause: 'Motion', Length: '10', Notes: '' } }) as EventData;

    beforeEach(() => {
      vi.mocked(getEvents).mockImplementation(async (_client, profileId) =>
        ({ events: profileId === profileA.id ? [ev('1', 'A-one'), ev('2', 'A-two')] : [ev('1', 'B-one')] }) as never
      );
    });

    const groupOn = () =>
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { eventsGroupByServer: true });

    it('EventsWidget lists each server under its own section', async () => {
      groupOn();
      render(wrap(<EventsWidget />));
      const home = await screen.findByTestId(`dashboard-events-group-section-${profileA.id}`);
      const work = screen.getByTestId(`dashboard-events-group-section-${profileB.id}`);
      expect(home).toHaveTextContent('A-one');
      expect(home).toHaveTextContent('A-two');
      expect(home).not.toHaveTextContent('B-one');
      expect(work).toHaveTextContent('B-one');
      expect(work).not.toHaveTextContent('A-one');
    });

    it('EventsWidget keeps one flat list with the toggle off', async () => {
      render(wrap(<EventsWidget />));
      await screen.findByText('B-one');
      expect(screen.queryByTestId(`dashboard-events-group-section-${profileA.id}`)).not.toBeInTheDocument();
    });

    it('TimelineWidget stacks one bar per server carrying that server\'s counts', async () => {
      groupOn();
      render(wrap(<TimelineWidget />));
      await waitFor(() => expect(screen.getAllByTestId('bar')).toHaveLength(2));
      const bars = screen.getAllByTestId('bar');
      expect(bars.map((b) => b.textContent)).toEqual(['Home', 'Work']);
      expect(new Set(bars.map((b) => b.getAttribute('data-stack')))).toEqual(new Set(['servers']));
      // Summed over every bucket: the first series is Home's two events,
      // the second Work's one.
      const total = (key: string | null) =>
        (JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-rows')!) as Record<string, number>[])
          .reduce((sum, row) => sum + (row[key!] ?? 0), 0);
      await waitFor(() => expect(total(bars[0].getAttribute('data-key'))).toBe(2));
      expect(total(bars[1].getAttribute('data-key'))).toBe(1);
    });

    it('TimelineWidget keeps its single count bar with the toggle off', async () => {
      render(wrap(<TimelineWidget />));
      await waitFor(() => expect(screen.getAllByTestId('bar')).toHaveLength(1));
      expect(screen.getByTestId('bar')).toHaveAttribute('data-key', 'count');
    });

    it('HeatmapWidget draws one heatmap per server', async () => {
      groupOn();
      render(wrap(<HeatmapWidget />));
      const home = await screen.findByTestId(`dashboard-heatmap-group-section-${profileA.id}`);
      const work = screen.getByTestId(`dashboard-heatmap-group-section-${profileB.id}`);
      // Each bucket's label ends "<count> events"; a section's buckets add up
      // to its own server's events only.
      const count = (section: HTMLElement) =>
        within(section).queryAllByRole('button')
          .map((b) => /: (\d+) /.exec(b.getAttribute('aria-label') ?? '')?.[1])
          .reduce((sum, n) => sum + Number(n ?? 0), 0);
      expect(count(home)).toBe(2);
      expect(count(work)).toBe(1);
    });
  });
});
