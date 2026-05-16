import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitorCard } from '../MonitorCard';
import type { Monitor, MonitorStatus } from '../../../api/types';

vi.mock('../LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: ({ monitor }: { monitor: { Name: string } }) => (
    <div data-testid="video-player">{monitor.Name}</div>
  ),
}));

vi.mock('../MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'test', portalUrl: 'https://test', cgiUrl: 'https://test/cgi', apiUrl: 'https://test/api' },
    settings: { viewMode: 'streaming', hoverPreview: { eventsList: true, eventsGrid: false, monitorsList: true, monitorsGrid: false, dashboard: true, timeline: true, notifications: true } },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    monitorCard: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../../stores/auth', () => ({
  useAuthStore: (selector: (state: { version: string }) => unknown) =>
    selector({ version: '1.38.0' }),
}));

describe('MonitorCard', () => {
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
        eventCount={3}
        onShowSettings={onShowSettings}
      />
    );

    await user.click(screen.getByTestId('monitor-settings-button'));

    expect(onShowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ Id: '1', Name: 'Front Door' })
    );
  });
});
