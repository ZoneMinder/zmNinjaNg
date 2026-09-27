import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { MonitorCard } from '../MonitorCard';
import { useMonitorSeenStore } from '../../../stores/monitorSeen';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore } from '../../../stores/settings';
import { asProfileId } from '../../../api/types';
import type { Monitor, MonitorStatus } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

const OTHER_PROFILE_ID = asProfileId('other-profile');

vi.mock('../LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: ({ monitor, muted }: { monitor: { Name: string }; muted?: boolean }) => (
    <div data-testid="video-player" data-muted={String(muted ?? true)}>{monitor.Name}</div>
  ),
}));

vi.mock('../MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="monitor-hover-preview">{children}</div>
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, monitorCard: vi.fn() } };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('MonitorCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.mocked(toast.error).mockClear();
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    seedProfiles([makeProfile('test'), makeProfile('other-profile')], {
      current: 'test',
      settings: {
        test: {
          viewMode: 'streaming',
          hoverPreview: { eventsList: true, eventsGrid: false, monitorsList: true, monitorsGrid: false, dashboard: true, timeline: true, notifications: true } as never,
        },
      },
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('calls settings callback when settings button is clicked', async () => {
    const user = userEvent.setup();
    const onShowSettings = vi.fn();
    const monitor = {
      Id: '1',
      Name: 'Front Door',
      Type: 'Local',
      Function: 'Monitor',
      Enabled: '1',
      Controllable: '0',
      Width: '640',
      Height: '480',
    } as Monitor;
    const status = {
      MonitorId: '1',
      Status: 'Connected',
      CaptureFPS: '10',
    } as MonitorStatus;

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={3}
        onShowSettings={onShowSettings}
      />
    );

    await user.click(screen.getByTestId('monitor-settings-button'));

    expect(onShowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ Id: '1', Name: 'Front Door' }),
      undefined
    );
  });

  const monitor = {
    Id: '1',
    Name: 'Front Door',
    Type: 'Local',
    Function: 'Monitor',
    Enabled: '1',
    Controllable: '0',
    Width: '640',
    Height: '480',
  } as Monitor;
  const status = {
    MonitorId: '1',
    Status: 'Connected',
    CaptureFPS: '10',
  } as MonitorStatus;

  it('navigates with the watermark-derived startDateTime when there are new events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', '2026-07-10 08:49:37');

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={2}
        newestEventAt="2026-07-10 09:15:00"
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [url] = mockNavigate.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('monitorId')).toBe('1');
    expect(params.get('startDateTime')).toBe('2026-07-10T08:49:38');
  });

  it('navigates without a date filter when there are no new events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', '2026-07-10 08:49:37');

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={undefined}
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('navigates without a date filter when the monitor was seeded with zero events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', null);

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={5}
        newestEventAt="2026-07-10 09:15:00"
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('renders the profile chip when profileChip is provided (All mode)', () => {
    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    expect(screen.getByTestId('monitor-profile-chip')).toHaveTextContent('Office');
  });

  it('does not render a profile chip in single mode', () => {
    render(<MonitorCard monitor={monitor} status={status} onShowSettings={vi.fn()} />);

    expect(screen.queryByTestId('monitor-profile-chip')).not.toBeInTheDocument();
  });

  it('navigates directly to the /all/ deep route without switching profile (refs #337)', async () => {
    const user = userEvent.setup();

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    await user.click(screen.getByTestId('monitor-player'));

    expect(useProfileStore.getState().currentProfileId).toBe('test');
    expect(mockNavigate).toHaveBeenCalledWith(
      `/all/monitors/${OTHER_PROFILE_ID}/1`,
      { state: { from: '/monitors' } }
    );
  });

  it('navigates to the single-mode detail route in single mode (no profileId)', async () => {
    const user = userEvent.setup();

    render(<MonitorCard monitor={monitor} status={status} onShowSettings={vi.fn()} />);

    await user.click(screen.getByTestId('monitor-player'));

    expect(useProfileStore.getState().currentProfileId).toBe('test');
    expect(mockNavigate).toHaveBeenCalledWith('/monitors/1', { state: { from: '/monitors' } });
  });

  it('navigates directly to the aggregated events list with the owning profileId, without switching (refs #337, Task 4)', async () => {
    const user = userEvent.setup();

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={undefined}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(useProfileStore.getState().currentProfileId).toBe('test');
    expect(mockNavigate).toHaveBeenCalledWith(
      `/events?monitorId=1&profileId=${OTHER_PROFILE_ID}`,
      { state: { from: '/monitors' } }
    );
  });

  it('moves the capture pipeline off the card face into the info popover (refs #467)', async () => {
    const user = userEvent.setup();
    const modern = { ...monitor, Capturing: 'Always', Analysing: 'None', Recording: 'OnMotion', Decoding: 'Ondemand' } as Monitor;
    render(<MonitorCard monitor={modern} status={status} onShowSettings={vi.fn()} />);

    // Nothing on the card face reads as a bare pipeline value any more.
    expect(screen.queryByText('OnMotion')).toBeNull();

    await user.click(screen.getByTestId('monitor-info-btn'));
    expect(screen.getByTestId('monitor-info-recording')).toHaveTextContent('OnMotion');
    expect(screen.getByTestId('monitor-info-decoding')).toHaveTextContent('Ondemand');
    // Opening the popover is not a tap on the card.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('remembers an unmuted Go2RTC monitor across remounts (refs #463)', async () => {
    const user = userEvent.setup();
    seedProfiles([makeProfile('test', { go2rtcUrl: 'https://go2rtc.test' })], {
      current: 'test',
      settings: { test: { viewMode: 'streaming' } },
    });
    const rtcMonitor = { ...monitor, Go2RTCEnabled: true } as Monitor;
    const card = <MonitorCard monitor={rtcMonitor} status={status} onShowSettings={vi.fn()} />;

    const { unmount } = render(card);
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'true');
    await user.click(screen.getByTestId('monitor-volume-btn'));
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'false');
    expect(useSettingsStore.getState().getProfileSettings(asProfileId('test')).unmutedMonitorIds).toEqual(['1']);
    unmount();

    render(card);
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'false');
    expect(screen.getByTestId('monitor-volume-btn')).toHaveAttribute('aria-label', 'monitor_detail.mute');
  });
  it('takes hover preview from the selected group, not the owning server (refs #536)', () => {
    // hoverPreview is selection-scoped: with a group selected the card follows
    // the group's own bucket even though it streams from its owning server.
    const group = useProfileStore.getState().addVirtualProfile('Both', [asProfileId('test'), OTHER_PROFILE_ID]);
    useSettingsStore.getState().updateProfileSettings(group, {
      hoverPreview: { ...useSettingsStore.getState().getProfileSettings('test').hoverPreview, monitorsList: false },
    });
    useProfileStore.setState({ currentProfileId: group });

    render(<MonitorCard monitor={monitor} status={status} profileId={asProfileId('test')} onShowSettings={vi.fn()} />);

    expect(screen.getByTestId('video-player')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('monitor-hover-preview')).toBeNull();
  });
});
