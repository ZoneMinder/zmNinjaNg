import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAlarm,
  changeMonitorFunction,
  getAlarmStatus,
  getControl,
  getDaemonStatus,
  getMonitor,
  getMonitors,
  getStreamUrl,
  setMonitorEnabled,
  triggerAlarm,
  updateMonitor,
} from '../monitors';
import { getApiClient } from '../client';
import { validateApiResponse } from '../../lib/api-validator';
import { getMonitorStreamUrl } from '../../lib/url-builder';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

vi.mock('../../lib/url-builder', () => ({
  getMonitorStreamUrl: vi.fn(() => 'https://stream.test'),
  getMonitorControlUrl: vi.fn(() => 'https://control.test'),
}));

vi.mock('../../lib/platform', () => ({
  Platform: {
    shouldUseProxy: false,
  },
}));

describe('Monitors API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
      post: mockPost,
    } as unknown as ApiClient);
  });

  it('fetches monitors list', async () => {
    mockGet.mockResolvedValue({ data: { monitors: [{ Monitor: { Id: '1' } }] } });

    const response = await getMonitors();

    expect(mockGet).toHaveBeenCalledWith('/monitors.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(response.monitors).toHaveLength(1);
  });

  it('fetches a monitor and validates response', async () => {
    mockGet.mockResolvedValue({ data: { monitor: { Monitor: { Id: '1', Name: 'Front Door' } } } });

    const monitor = await getMonitor('1');

    expect(mockGet).toHaveBeenCalledWith('/monitors/1.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(validateApiResponse).toHaveBeenCalled();
    expect(monitor.Monitor.Id).toBe('1');
  });

  it('fetches control data for a monitor', async () => {
    mockGet.mockResolvedValue({ data: { control: { Control: { Id: '1' } } } });

    const control = await getControl('1');

    expect(mockGet).toHaveBeenCalledWith('/controls/1.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(control.control.Control.Id).toBe('1');
  });

  it('updates monitor data', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Saved' } });

    await updateMonitor('2', { 'Monitor[Name]': 'Updated' });

    expect(mockPost).toHaveBeenCalledWith('/monitors/2.json', expect.any(URLSearchParams), expect.any(Object));
    const body = mockPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('Monitor[Name]')).toBe('Updated');
  });

  it('changes monitor function', async () => {
    mockPost.mockResolvedValue({ data: { monitor: { Id: '3' } } });

    await changeMonitorFunction('3', 'Monitor');

    expect(mockPost).toHaveBeenCalledWith('/monitors/3.json', expect.any(URLSearchParams), expect.any(Object));
    const body = mockPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('Monitor[Function]')).toBe('Monitor');
  });

  it('enables or disables a monitor', async () => {
    mockPost.mockResolvedValue({ data: { monitor: { Id: '4' } } });

    await setMonitorEnabled('4', false);

    expect(mockPost).toHaveBeenCalledWith('/monitors/4.json', expect.any(URLSearchParams), expect.any(Object));
    const body = mockPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('Monitor[Enabled]')).toBe('0');
  });

  it('triggers and cancels alarms', async () => {
    mockGet.mockResolvedValue({
      data: {
        status: 'ok',
        output: 'Command sent successfully'
      }
    });

    await triggerAlarm('5');
    await cancelAlarm('5');

    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:on.json', undefined);
    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:off.json', undefined);
  });

  it('gets alarm status', async () => {
    mockGet.mockResolvedValue({ data: { status: 'on' } });

    const status = await getAlarmStatus('6');

    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:6/command:status.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(status.status).toBe('on');
  });

  it('gets daemon status', async () => {
    mockGet.mockResolvedValue({
      data: {
        status: 'ok',
        statustext: 'running'
      }
    });

    const status = await getDaemonStatus('7', 'zmc');

    expect(mockGet).toHaveBeenCalledWith('/monitors/daemonStatus/id:7/daemon:zmc.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(status.status).toBe('ok');
    expect(status.statustext).toBe('running');
  });

  it('routes triggerAlarm to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', output: 'Command sent' },
    });

    await triggerAlarm('5', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:5/command:on.json',
      { baseURL: 'https://pseudo.example.com/api' }
    );
  });

  it('routes cancelAlarm to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', output: 'Command sent' },
    });

    await cancelAlarm('5', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:5/command:off.json',
      { baseURL: 'https://pseudo.example.com/api' }
    );
  });

  it('routes getAlarmStatus to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({ data: { status: 'on' } });

    await getAlarmStatus('6', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:6/command:status.json',
      expect.objectContaining({ baseURL: 'https://pseudo.example.com/api', intent: expect.any(String) }),
    );
  });

  it('routes getDaemonStatus to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', statustext: 'running' },
    });

    await getDaemonStatus('7', 'zmc', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/daemonStatus/id:7/daemon:zmc.json',
      expect.objectContaining({ baseURL: 'https://pseudo.example.com/api', intent: expect.any(String) }),
    );
  });

  it('uses default client baseURL when apiBaseUrl is undefined', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', statustext: 'running' },
    });

    await getDaemonStatus('7', 'zmc');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/daemonStatus/id:7/daemon:zmc.json',
      expect.objectContaining({ intent: expect.any(String) }),
    );
  });

  it('builds monitor stream URL via url builder', () => {
    const url = getStreamUrl('https://example.test/cgi-bin', '9', {
      mode: 'stream',
      scale: 50,
    });

    expect(getMonitorStreamUrl).toHaveBeenCalledWith(
      'https://example.test/cgi-bin',
      '9',
      expect.objectContaining({ mode: 'stream', scale: 50 })
    );
    expect(url).toBe('https://stream.test');
  });
});
