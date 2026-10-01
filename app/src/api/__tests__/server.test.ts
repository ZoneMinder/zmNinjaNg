import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDaemonCheck, getDiskPercent, getLatestServerStat, getLoad, getServers, getStorages } from '../server';
import { validateApiResponse } from '../../lib/zm/api-validator';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockClient = { get: mockGet } as unknown as ApiClient;

vi.mock('../../lib/zm/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

describe('Server API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns server list', async () => {
    mockGet.mockResolvedValue({
      data: {
        servers: [{ Server: { Id: '1', Name: 'Main' } }],
      },
    });

    const servers = await getServers(mockClient);

    expect(mockGet).toHaveBeenCalledWith('/servers.json');
    expect(validateApiResponse).toHaveBeenCalled();
    expect(servers).toEqual([{ Id: '1', Name: 'Main' }]);
  });

  it('checks daemon state', async () => {
    mockGet.mockResolvedValue({
      data: { result: 1 },
    });

    const isRunning = await getDaemonCheck(mockClient);

    expect(mockGet).toHaveBeenCalledWith('/host/daemonCheck.json', undefined);
    expect(isRunning).toBe(true);
  });

  it('normalizes load value', async () => {
    mockGet.mockResolvedValue({
      data: { load: [1.2, 0.8, 0.5] },
    });

    const load = await getLoad(mockClient);

    expect(mockGet).toHaveBeenCalledWith('/host/getLoad.json', undefined);
    expect(load.load).toBe(1.2);
  });

  it('asks for server stats newer than the given server-local time and returns the newest row', async () => {
    mockGet.mockResolvedValue({
      data: {
        serverstats: [
          { ServerStat: { TimeStamp: '2026-09-30 19:30:10', CpuLoad: 2.0, CpuUsagePercent: 9.1 } },
          { ServerStat: { TimeStamp: '2026-09-30 19:31:10', CpuLoad: 2.3, CpuUsagePercent: 9.8 } },
        ],
      },
    });

    const stat = await getLatestServerStat(mockClient, '2026-09-30 19:21:10');

    expect(mockGet).toHaveBeenCalledWith(
      '/server_stats/index/TimeStamp%20%3E%3D%3A2026-09-30%2019%3A21%3A10.json',
    );
    expect(stat?.CpuLoad).toBe(2.3);
    expect(stat?.CpuUsagePercent).toBe(9.8);
  });

  it('returns undefined rather than guess when the rows come from several servers', async () => {
    mockGet.mockResolvedValue({
      data: {
        serverstats: [
          { ServerStat: { TimeStamp: '2026-09-30 19:31:00', ServerId: '13', CpuLoad: 4.7 } },
          { ServerStat: { TimeStamp: '2026-09-30 19:31:10', ServerId: '2', CpuLoad: 0.8 } },
        ],
      },
    });

    expect(await getLatestServerStat(mockClient, '2026-09-30 19:21:10')).toBeUndefined();
  });

  it('returns undefined when no server stats are recent enough', async () => {
    mockGet.mockResolvedValue({ data: { serverstats: [] } });

    expect(await getLatestServerStat(mockClient, '2026-09-30 19:21:10')).toBeUndefined();
  });

  it('parses disk usage from complex response', async () => {
    mockGet.mockResolvedValue({
      data: {
        usage: {
          Total: { space: 75.5 },
        },
        percent: 80,
      },
    });

    const disk = await getDiskPercent(mockClient);

    expect(mockGet).toHaveBeenCalledWith('/host/getDiskPercent.json', undefined);
    expect(disk.usage).toBe(75.5);
    expect(disk.percent).toBe(80);
  });

  it('parses server routing fields', async () => {
    mockGet.mockResolvedValue({
      data: {
        servers: [
          {
            Server: {
              Id: '2',
              Name: 'Remote',
              Hostname: 'remote.example.com',
              Protocol: 'https',
              Port: 443,
              PathToIndex: '/zm',
              PathToZMS: '/zm/cgi-bin/nph-zms',
              PathToApi: '/zm/api',
            },
          },
        ],
      },
    });

    const servers = await getServers(mockClient);

    expect(servers).toEqual([
      {
        Id: '2',
        Name: 'Remote',
        Hostname: 'remote.example.com',
        Protocol: 'https',
        Port: 443,
        PathToIndex: '/zm',
        PathToZMS: '/zm/cgi-bin/nph-zms',
        PathToApi: '/zm/api',
      },
    ]);
  });

  it('returns storage list', async () => {
    mockGet.mockResolvedValue({
      data: {
        storage: [
          {
            Storage: {
              Id: '1',
              Path: '/var/cache/zoneminder/events',
              Name: 'Default',
              Type: 'local',
              Url: null,
              DiskSpace: 1024000,
              Scheme: 'Medium',
              ServerId: '1',
              DoDelete: true,
              Enabled: true,
              DiskTotalSpace: 5000000,
              DiskUsedSpace: 1024000,
            },
          },
        ],
      },
    });

    const storages = await getStorages(mockClient);

    expect(mockGet).toHaveBeenCalledWith('/storage.json');
    expect(storages).toHaveLength(1);
    expect(storages[0].Name).toBe('Default');
    expect(storages[0].ServerId).toBe('1');
  });

  it('routes getDaemonCheck to alternate server when apiBaseUrl provided', async () => {
    mockGet.mockResolvedValue({ data: { result: 1 } });
    await getDaemonCheck(mockClient, 'https://pseudo.example.com/api');
    expect(mockGet).toHaveBeenCalledWith('/host/daemonCheck.json', { baseURL: 'https://pseudo.example.com/api' });
  });

  it('routes getLoad to alternate server', async () => {
    mockGet.mockResolvedValue({ data: { load: [1.2] } });
    await getLoad(mockClient, 'https://pseudo.example.com/api');
    expect(mockGet).toHaveBeenCalledWith('/host/getLoad.json', { baseURL: 'https://pseudo.example.com/api' });
  });

  it('routes getDiskPercent to alternate server', async () => {
    mockGet.mockResolvedValue({ data: { usage: 50, percent: 50 } });
    await getDiskPercent(mockClient, 'https://pseudo.example.com/api');
    expect(mockGet).toHaveBeenCalledWith('/host/getDiskPercent.json', { baseURL: 'https://pseudo.example.com/api' });
  });

  it('handles empty storage response', async () => {
    mockGet.mockResolvedValue({
      data: {
        storage: [],
      },
    });

    const storages = await getStorages(mockClient);

    expect(storages).toEqual([]);
  });
});
