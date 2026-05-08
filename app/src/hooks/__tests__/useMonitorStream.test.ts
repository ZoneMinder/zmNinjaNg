/**
 * useMonitorStream Hook Tests
 *
 * Basic tests for the useMonitorStream hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import type { Profile } from '../../api/types';

// Mock dependencies
vi.mock('../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

vi.mock('../../api/monitors', () => ({
  getStreamUrl: (cgiUrl: string, monitorId: string, options: any) => {
    const params = new URLSearchParams();
    params.set('monitor', monitorId);
    if (options.mode) params.set('mode', options.mode);
    if (options.connkey) params.set('connkey', options.connkey.toString());
    if (options.scale) params.set('scale', options.scale.toString());
    if (options.maxfps) params.set('maxfps', options.maxfps.toString());
    if (options.cacheBuster) params.set('rand', options.cacheBuster.toString());
    return `${cgiUrl}/nph-zms?${params.toString()}`;
  },
}));

vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string, options: any) => {
    const params = new URLSearchParams();
    params.set('command', command);
    params.set('connkey', connkey);
    if (options?.token) params.set('token', options.token);
    return `${portalUrl}/api/host/daemonControl.json?${params.toString()}`;
  },
}));

vi.mock('../../lib/zm-constants', () => ({
  ZMS_COMMANDS: {
    cmdQuit: 'quit',
  },
}));

describe('useMonitorStream', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    // Reset stores
    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: 'profile-1',
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });

    useAuthStore.setState({
      accessToken: 'test-token',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      refreshToken: null,
      isAuthenticated: false,
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamScale: 50,
          streamMaxFps: 5,
          snapshotRefreshInterval: 1,
        },
      },
    });

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

    vi.clearAllMocks();
  });

  it('generates connKey on mount', async () => {
    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(regenerateConnKey).toHaveBeenCalledWith('1');
    });
  });

  it('returns empty streamUrl when no profile exists', async () => {
    useProfileStore.setState({
      profiles: [],
      currentProfileId: null,
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    expect(result.current.streamUrl).toBe('');
  });

  it('returns empty streamUrl when connKey is 0', async () => {
    const regenerateConnKey = vi.fn(() => 0);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBe('');
    });
  });

  it('provides imgRef for image element', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    expect(result.current.imgRef).toBeTruthy();
    expect(result.current.imgRef.current).toBeNull(); // Initially null
  });

  it('includes correct parameters in streaming mode', async () => {
    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    // Check streaming mode parameters
    // Note: Normal bandwidth mode uses 100% image scale
    expect(result.current.streamUrl).toContain('mode=jpeg');
    expect(result.current.streamUrl).toContain('connkey=12345');
    expect(result.current.streamUrl).toContain('scale=100');
    expect(result.current.streamUrl).toContain('maxfps=5');
    expect(result.current.streamUrl).not.toContain('rand='); // No cacheBuster in streaming
  });

  it('includes correct parameters in snapshot mode', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    // Check snapshot mode parameters
    // Note: Normal bandwidth mode uses 100% image scale
    expect(result.current.streamUrl).toContain('mode=single');
    expect(result.current.streamUrl).toContain('connkey=12345');
    expect(result.current.streamUrl).toContain('scale=100');
    expect(result.current.streamUrl).not.toContain('maxfps'); // No maxfps in snapshot
    expect(result.current.streamUrl).toContain('rand='); // cacheBuster in snapshot
  });

  it('viewModeOverride forces streaming when settings say snapshot', async () => {
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'snapshot',
          streamMaxFps: 5,
        },
      },
    });

    const regenerateConnKey = vi.fn(() => 12345);
    useMonitorStore.setState({ regenerateConnKey });

    const { result } = renderHook(() =>
      useMonitorStream({ monitorId: '1', viewModeOverride: 'streaming' })
    );

    await waitFor(() => {
      expect(result.current.streamUrl).toBeTruthy();
    });

    expect(result.current.streamUrl).toContain('mode=jpeg');
    expect(result.current.streamUrl).toContain('maxfps=5');
    expect(result.current.streamUrl).not.toContain('mode=single');
    expect(result.current.streamUrl).not.toContain('rand=');
  });
});
