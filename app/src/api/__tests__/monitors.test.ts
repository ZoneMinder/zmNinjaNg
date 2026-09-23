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
import { validateApiResponse } from '../../lib/zm/api-validator';
import { getMonitorStreamUrl } from '../../lib/zm/url-builder';
import { getExcludedMonitorIds, getMonitorSortOrder } from '../../lib/profile/profile-settings';
import { asProfileId } from '../types';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockClient = { get: mockGet, postForm: mockPost } as unknown as ApiClient;
const pid = asProfileId('p1');

vi.mock('../../lib/zm/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

vi.mock('../../lib/profile/profile-settings', () => ({
  getExcludedMonitorIds: vi.fn(() => []),
  getMonitorSortOrder: vi.fn(() => 'unsorted'),
}));

vi.mock('../../lib/zm/url-builder', () => ({
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
    vi.mocked(getExcludedMonitorIds).mockReturnValue([]);
    vi.mocked(getMonitorSortOrder).mockReturnValue('unsorted');
  });

  // The order is applied here, not per page, so the grid, the montage and
  // live-view stepping cannot disagree about it (refs #527).
  it('returns the server order when the profile asks for none', async () => {
    mockGet.mockResolvedValue({
      data: { monitors: [{ Monitor: { Id: '10', Name: 'B' } }, { Monitor: { Id: '2', Name: 'A' } }] },
    });

    const response = await getMonitors(mockClient, pid);

    expect(response.monitors.map((m) => m.Monitor.Id)).toEqual(['10', '2']);
  });

  it('sorts by id when the profile asks for it', async () => {
    vi.mocked(getMonitorSortOrder).mockReturnValue('id');
    mockGet.mockResolvedValue({
      data: { monitors: [{ Monitor: { Id: '10', Name: 'B' } }, { Monitor: { Id: '2', Name: 'A' } }] },
    });

    const response = await getMonitors(mockClient, pid);

    expect(response.monitors.map((m) => m.Monitor.Id)).toEqual(['2', '10']);
  });

  it('sorts by name when the profile asks for it', async () => {
    vi.mocked(getMonitorSortOrder).mockReturnValue('name');
    mockGet.mockResolvedValue({
      data: { monitors: [{ Monitor: { Id: '10', Name: 'Zebra' } }, { Monitor: { Id: '2', Name: 'attic' } }] },
    });

    const response = await getMonitors(mockClient, pid);

    expect(response.monitors.map((m) => m.Monitor.Name)).toEqual(['attic', 'Zebra']);
  });

  it('fetches monitors list', async () => {
    mockGet.mockResolvedValue({ data: { monitors: [{ Monitor: { Id: '1' } }] } });

    const response = await getMonitors(mockClient, pid);

    expect(mockGet).toHaveBeenCalledWith('/monitors.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(response.monitors).toHaveLength(1);
  });

  it('drops excluded monitors at the API boundary', async () => {
    vi.mocked(getExcludedMonitorIds).mockReturnValue(['2']);
    mockGet.mockResolvedValue({
      data: {
        monitors: [
          { Monitor: { Id: '1' } },
          { Monitor: { Id: '2' } },
          { Monitor: { Id: '3' } },
        ],
      },
    });

    const response = await getMonitors(mockClient, pid);

    expect(response.monitors.map((m) => m.Monitor.Id)).toEqual(['1', '3']);
  });

  it('keeps excluded monitors when includeExcluded is true', async () => {
    vi.mocked(getExcludedMonitorIds).mockReturnValue(['2']);
    mockGet.mockResolvedValue({
      data: {
        monitors: [
          { Monitor: { Id: '1' } },
          { Monitor: { Id: '2' } },
          { Monitor: { Id: '3' } },
        ],
      },
    });

    const response = await getMonitors(mockClient, pid, { includeExcluded: true });

    expect(response.monitors.map((m) => m.Monitor.Id)).toEqual(['1', '2', '3']);
  });

  it('always drops deleted monitors even with includeExcluded', async () => {
    vi.mocked(getExcludedMonitorIds).mockReturnValue([]);
    mockGet.mockResolvedValue({
      data: {
        monitors: [
          { Monitor: { Id: '1', Deleted: false } },
          { Monitor: { Id: '2', Deleted: true } },
        ],
      },
    });

    const response = await getMonitors(mockClient, pid, { includeExcluded: true });

    expect(response.monitors.map((m) => m.Monitor.Id)).toEqual(['1']);
  });

  it('fetches a monitor and validates response', async () => {
    mockGet.mockResolvedValue({ data: { monitor: { Monitor: { Id: '1', Name: 'Front Door' } } } });

    const monitor = await getMonitor(mockClient, '1');

    expect(mockGet).toHaveBeenCalledWith('/monitors/1.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(validateApiResponse).toHaveBeenCalled();
    expect(monitor.Monitor.Id).toBe('1');
  });

  it('fetches control data for a monitor', async () => {
    mockGet.mockResolvedValue({ data: { control: { Control: { Id: '1' } } } });

    const control = await getControl(mockClient, '1');

    expect(mockGet).toHaveBeenCalledWith('/controls/1.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(control.control.Control.Id).toBe('1');
  });

  it('updates monitor data', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Saved' } });

    await updateMonitor(mockClient, '2', { 'Monitor[Name]': 'Updated' });

    expect(mockPost).toHaveBeenCalledWith('/monitors/2.json', expect.any(URLSearchParams));
    const body = mockPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('Monitor[Name]')).toBe('Updated');
  });

  it('changes monitor function', async () => {
    mockPost.mockResolvedValue({ data: { monitor: { Id: '3' } } });

    await changeMonitorFunction(mockClient, '3', 'Monitor');

    expect(mockPost).toHaveBeenCalledWith('/monitors/3.json', expect.any(URLSearchParams));
    const body = mockPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('Monitor[Function]')).toBe('Monitor');
  });

  it('enables or disables a monitor', async () => {
    mockPost.mockResolvedValue({ data: { monitor: { Id: '4' } } });

    await setMonitorEnabled(mockClient, '4', false);

    expect(mockPost).toHaveBeenCalledWith('/monitors/4.json', expect.any(URLSearchParams));
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

    await triggerAlarm(mockClient, '5');
    await cancelAlarm(mockClient, '5');

    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:on.json', undefined);
    expect(mockGet).toHaveBeenCalledWith('/monitors/alarm/id:5/command:off.json', undefined);
  });

  it('gets alarm status', async () => {
    mockGet.mockResolvedValue({ data: { status: 'on' } });

    const status = await getAlarmStatus(mockClient, '6');

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

    const status = await getDaemonStatus(mockClient, '7', 'zmc');

    expect(mockGet).toHaveBeenCalledWith('/monitors/daemonStatus/id:7/daemon:zmc.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(status.status).toBe('ok');
    expect(status.statustext).toBe('running');
  });

  it('routes triggerAlarm to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', output: 'Command sent' },
    });

    await triggerAlarm(mockClient, '5', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:5/command:on.json',
      { baseURL: 'https://pseudo.example.com/api' }
    );
  });

  it('routes cancelAlarm to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', output: 'Command sent' },
    });

    await cancelAlarm(mockClient, '5', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:5/command:off.json',
      { baseURL: 'https://pseudo.example.com/api' }
    );
  });

  it('routes getAlarmStatus to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({ data: { status: 'on' } });

    await getAlarmStatus(mockClient, '6', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/alarm/id:6/command:status.json',
      expect.objectContaining({ baseURL: 'https://pseudo.example.com/api', intent: expect.any(String) }),
    );
  });

  it('routes getDaemonStatus to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', statustext: 'running' },
    });

    await getDaemonStatus(mockClient, '7', 'zmc', 'https://pseudo.example.com/api');

    expect(mockGet).toHaveBeenCalledWith(
      '/monitors/daemonStatus/id:7/daemon:zmc.json',
      expect.objectContaining({ baseURL: 'https://pseudo.example.com/api', intent: expect.any(String) }),
    );
  });

  it('uses default client baseURL when apiBaseUrl is undefined', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ok', statustext: 'running' },
    });

    await getDaemonStatus(mockClient, '7', 'zmc');

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
