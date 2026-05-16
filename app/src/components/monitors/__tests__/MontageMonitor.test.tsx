/**
 * MontageMonitor Tests
 *
 * Basic tests for the MontageMonitor component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MontageMonitor } from '../MontageMonitor';
import type { Monitor, MonitorStatus, Profile } from '../../../api/types';
import { useMonitorStore } from '../../../stores/monitors';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../../stores/settings';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}_${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../lib/download', () => ({
  downloadSnapshotFromElement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    montageMonitor: vi.fn(),
    videoPlayer: vi.fn(),
    monitor: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

vi.mock('../../../lib/monitor-rotation', () => ({
  getMonitorAspectRatio: (width: number, height: number) =>
    `${width}/${height}`,
}));

vi.mock('../LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="video-player">Mock LiveMonitorPlayer</div>,
}));

vi.mock('../../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({
    recordingUrl: '',
    portalPath: '',
    apiBaseUrl: '',
    isMultiServer: false,
  }),
}));

vi.mock('../../../stores/auth', () => ({
  useAuthStore: (selector: (state: { version: string }) => unknown) =>
    selector({ version: '1.38.0' }),
}));

vi.mock('../../../stores/notifications', () => {
  const store = () => 0;
  store.getState = () => ({ profileEvents: {} });
  store.subscribe = () => () => {};
  return { useNotificationStore: store };
});

describe('MontageMonitor', () => {
  const mockMonitor: Monitor = {
    Id: '1',
    Name: 'Front Door',
    Width: '1920',
    Height: '1080',
    Orientation: '0',
    Function: 'Modect',
    Capturing: 'Always',
    Analysing: 'Always',
    Enabled: '1',
  } as Monitor;

  const mockStatus: MonitorStatus = {
    MonitorId: '1',
    Status: 'Connected',
    CaptureFPS: '15.00',
    AnalysisFPS: '10.00',
  };

  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  const mockNavigate = vi.fn();

  beforeEach(() => {
    // Reset stores
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn((monitorId: string) => {
        const key = Date.now() + parseInt(monitorId);
        useMonitorStore.setState((state) => ({
          connKeys: { ...state.connKeys, [monitorId]: key },
        }));
        return key;
      }),
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamScale: 50,
          streamMaxFps: 5,
        },
      },
    });

    vi.clearAllMocks();
  });

  it('renders monitor name and status', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
  });

  it('displays running status badge for connected monitor', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      const badge = document.querySelector('.bg-green-500');
      expect(badge).toBeInTheDocument();
    });
  });

  it('displays error status badge for disconnected monitor', async () => {
    const disconnectedStatus: MonitorStatus = {
      MonitorId: '1',
      Status: 'Disconnected',
    };

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={disconnectedStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      const badge = document.querySelector('.bg-red-500');
      expect(badge).toBeInTheDocument();
    });
  });
});
