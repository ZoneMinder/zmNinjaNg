import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Server from '../Server';
import { ALL_PROFILES_ID } from '../../api/types';
import { seedProfiles, resetProfileFixture, fakeApiClient } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// The permission probe reaches the profile store, which this suite's session
// mock cannot satisfy; permissions are not what it tests (refs #344).
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: { system: 'Edit' }, isLoading: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${Object.values(o).join(' ')}` : k),
  }),
}));
vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

// Every endpoint the page's queries touch, so an unrouted request fails loud
// rather than the page silently rendering an error state.
function serverRoutes() {
  return {
    '/servers.json': [],
    '/host/daemonCheck.json': true,
    '/host/getLoad.json': {},
    '/server_stats/': { serverstats: [] },
    '/states.json': [],
    '/host/getTimeZone.json': 'UTC',
    '/storage.json': [],
  };
}

function renderServer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Server />
    </QueryClientProvider>
  );
}

// Values read off a ZoneMinder 1.39.18 server, whose Options > Storage row read
// "70% 69.38GB of 97.87GB" and "132 using -204831925.00B". The negative size is
// scaled to MB here, where ZoneMinder leaves it in bytes.
describe('Server page - storage areas', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  function storageWithDiskSpace(diskSpace: number | null) {
    return {
      Id: 1, Path: '/var/cache/zoneminder/events', Name: 'Default', Type: 'local', Url: null,
      DiskSpace: diskSpace, Scheme: 'Medium', ServerId: 0, DoDelete: true, Enabled: true,
      DiskTotalSpace: 105089261568, DiskUsedSpace: 74492252160,
    };
  }

  // A second area at 99% of its disk, and a third at 96%.
  const fullStorage = {
    ...storageWithDiskSpace(0), Id: 2, Name: 'Full', Path: '/mnt/full',
    DiskTotalSpace: 100_000_000_000, DiskUsedSpace: 99_000_000_000,
  };
  const nearlyFullStorage = { ...fullStorage, Id: 3, Name: 'Nearly', DiskUsedSpace: 96_000_000_000 };

  function renderStorage(storages: object[]) {
    const [profileA] = seedProfiles(['profile-a']);
    const client = fakeApiClient({
      ...serverRoutes(),
      '/storage.json': { storage: storages.map((Storage) => ({ Storage })) },
      '/events/index/StorageId%3A1.json': { events: [], pagination: { count: 132 } },
      '/events/index/StorageId%3A2.json': { events: [], pagination: { count: 5 } },
      '/events/index/StorageId%3A3.json': { events: [], pagination: { count: 6 } },
    });
    installApiClient(profileA.id, client);
    renderServer();
    return client;
  }

  it('with one area, the storage tile carries its path and event count and the list is gone', async () => {
    renderStorage([storageWithDiskSpace(-204831925)]);

    expect(await screen.findByTestId('stat-storage-events-1')).toHaveTextContent('server.storage_events_using 132 -195.34 MB');
    expect(screen.getByTestId('stat-storage-path-1')).toHaveTextContent('/var/cache/zoneminder/events');
    expect(screen.queryByTestId('storage-list')).toBeNull();
  });

  it('with one area, shows a null DiskSpace as 0, as ZoneMinder does', async () => {
    renderStorage([storageWithDiskSpace(null)]);

    expect(await screen.findByTestId('stat-storage-events-1')).toHaveTextContent('server.storage_events_using 132 0.00 B');
  });

  it('with several areas, drops the tile and lists them as Options > Storage does, percentage truncated', async () => {
    renderStorage([storageWithDiskSpace(-204831925), fullStorage]);

    expect(await screen.findByTestId('storage-usage-1')).toHaveTextContent('70% server.used_of_total 69.38 GB 97.87 GB');
    expect(await screen.findByTestId('storage-events-1')).toHaveTextContent('server.storage_events_using 132 -195.34 MB');
    expect(screen.queryByTestId('stat-storage-1')).toBeNull();
  });

  it('with several areas, colours each entry as the console colours its storage figure', async () => {
    renderStorage([storageWithDiskSpace(0), fullStorage, nearlyFullStorage]);

    expect(await screen.findByTestId('storage-usage-2')).toHaveClass('text-destructive');
    expect(screen.getByTestId('storage-usage-3')).toHaveClass('text-orange-600');
    expect(screen.getByTestId('storage-usage-1')).not.toHaveClass('text-destructive');
    expect(screen.getByTestId('storage-usage-1')).not.toHaveClass('text-orange-600');
  });
});

// Values read off a ZoneMinder 1.39.18 server and its console, whose navbar showed
// "Load: 2.30", "Cpu: 9.8%", "Default: 71%" titled "69.35GB of 97.87GB" and
// "Swap: 0%" titled "0.00B of 8.00GB".
const portalStat = {
  Id: 355709, ServerId: 0, TimeStamp: '2026-09-30 19:31:10', CpuLoad: '2.3',
  CpuUserPercent: '9.2', CpuNicePercent: '0.0', CpuSystemPercent: '0.6', CpuIdlePercent: '90.2',
  CpuUsagePercent: '9.8', TotalMem: 33572806656, FreeMem: 28005707776,
  TotalSwap: 8589930496, FreeSwap: 8589930496,
};
const portalStorage = {
  Id: 1, Path: '/var/cache/zoneminder/events', Name: 'Default', Type: 'local', Url: null,
  DiskSpace: 589748154, Scheme: 'Medium', ServerId: 0, DoDelete: true, Enabled: true,
  DiskTotalSpace: 105089261568, DiskUsedSpace: 74462892032,
};

describe('Server page - stats as the ZoneMinder console shows them', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows load, CPU, storage and swap with the console numbers', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/server_stats/': { serverstats: [{ ServerStat: portalStat }] },
      '/storage.json': { storage: [{ Storage: portalStorage }] },
      '/events/index/StorageId%3A1.json': { events: [], pagination: { count: 132 } },
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('stat-load')).toHaveTextContent('2.30'));
    expect(screen.getByTestId('stat-cpu')).toHaveTextContent('9.8%');
    expect(await screen.findByTestId('stat-storage-1')).toHaveTextContent('Default: 71%');
    expect(screen.getByTestId('stat-storage-detail-1')).toHaveTextContent('69.35 GB 97.87 GB');
    expect(await screen.findByTestId('stat-storage-events-1')).toHaveTextContent('562.43 MB');
    expect(screen.getByTestId('stat-swap')).toHaveTextContent('0%');
    expect(screen.getByTestId('stat-swap-detail')).toHaveTextContent('0.00 B 8.00 GB');
    expect(screen.queryByText('server.disk_usage')).toBeNull();
  });

  // The console's navbar describes $thisServer, the server the web UI runs on;
  // the app's stand-in is the server whose hostname the profile talks to.
  const multiServers = {
    servers: [
      { Server: { Id: '2', Name: 'pseudo', Hostname: 'pseudo.example.com' } },
      { Server: { Id: '13', Name: 'unicron', Hostname: 'profile-a.test' } },
    ],
  };

  it('on a multi-server install, shows the stats of the server the profile talks to', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/servers.json': multiServers,
      '/server_stats/': { serverstats: [
        { ServerStat: { ...portalStat, ServerId: 13 } },
        { ServerStat: { ...portalStat, ServerId: 2, CpuLoad: '0.4', CpuUsagePercent: '1.5', TimeStamp: '2026-09-30 19:31:20' } },
      ] },
      '/storage.json': { storage: [{ Storage: portalStorage }] },
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('stat-cpu')).toHaveTextContent('9.8%'));
    expect(screen.getByTestId('stat-load')).toHaveTextContent('2.30');
    expect(screen.getByTestId('stat-storage-1')).toHaveTextContent('Default: 71%');
  });

  it('on a multi-server install, hides CPU and swap when no server matches the profile host', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/servers.json': { servers: [multiServers.servers[0]] },
      '/server_stats/': { serverstats: [{ ServerStat: { ...portalStat, ServerId: 2 } }] },
      '/host/getLoad.json': { load: [1.5, 1.2, 1.0] },
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('stat-load')).toHaveTextContent('1.50'));
    expect(screen.queryByTestId('stat-cpu')).toBeNull();
    expect(screen.queryByTestId('stat-swap')).toBeNull();
  });

  it('hides the load card when the server refuses getLoad for lack of System permission', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/host/getLoad.json': () => {
        throw Object.assign(new Error('refused'), {
          status: 401,
          data: { data: { name: 'Insufficient Privileges' } },
        });
      },
    }));

    renderServer();

    await waitFor(() => expect(screen.queryByTestId('stat-load')).toBeNull());
    expect(screen.getByText('server.version_info')).toBeInTheDocument();
  });

  it('falls back to getLoad and hides CPU and swap when no recent stats exist', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/host/getLoad.json': { load: [1.5, 1.2, 1.0] },
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('stat-load')).toHaveTextContent('1.50'));
    expect(screen.queryByTestId('stat-cpu')).toBeNull();
    expect(screen.queryByTestId('stat-swap')).toBeNull();
  });
});

describe('Server page - server rows as ZoneMinder Options > Servers shows them', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // Values from a multi-server install: unicron uses all of its swap, grahampc
  // has plenty of memory left.
  const servers = {
    servers: [
      { Server: {
        Id: '13', Name: 'unicron', Status: 'Running', CpuLoad: '11.9', CpuUsagePercent: '20.0',
        TotalMem: 535960010752, FreeMem: 36829298688, TotalSwap: 8589930496, FreeSwap: 0,
      } },
      { Server: {
        Id: '7', Name: 'grahampc', Status: 'NotRunning', CpuLoad: '0.2',
        TotalMem: 8321499136, FreeMem: 4160749568, TotalSwap: 6313476096, FreeSwap: 6313476096,
      } },
    ],
  };

  it('shows load as a load average and memory and swap as free / total, red where the table is', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({ ...serverRoutes(), '/servers.json': servers }));

    renderServer();

    expect(await screen.findByTestId('server-load-13')).toHaveTextContent('11.90');
    expect(screen.getByTestId('server-load-13')).toHaveClass('text-destructive');
    expect(screen.getByTestId('server-load-7')).toHaveTextContent('0.20');
    expect(screen.getByTestId('server-load-7')).not.toHaveClass('text-destructive');

    expect(screen.getByTestId('server-swap-13')).toHaveTextContent('0.00 B / 8.00 GB');
    expect(screen.getByTestId('server-swap-13')).toHaveClass('text-destructive');
    expect(screen.getByTestId('server-swap-7')).toHaveTextContent('5.88 GB / 5.88 GB');
    expect(screen.getByTestId('server-swap-7')).not.toHaveClass('text-destructive');

    expect(screen.getByTestId('server-memory-13')).toHaveTextContent('34.30 GB / 499.15 GB');
    expect(screen.getByTestId('server-memory-13')).toHaveClass('text-destructive');
    expect(screen.getByTestId('server-memory-7')).not.toHaveClass('text-destructive');
    expect(screen.getAllByText('server.free_total_swap')).toHaveLength(2);
  });
});

describe('Server page - a single server', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('folds memory and the service badges into the tiles and drops the details card', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/servers.json': { servers: [{ Server: {
        Id: '13', Name: 'unicron', Hostname: 'profile-a.test', Status: 'Running', CpuLoad: '11.9',
        TotalMem: 535960010752, FreeMem: 36829298688, zmstats: true, zmaudit: false,
      } }] },
    }));

    renderServer();

    expect(await screen.findByTestId('stat-memory')).toHaveTextContent('34.30 GB / 499.15 GB');
    expect(screen.getByTestId('stat-memory')).toHaveClass('text-destructive');
    expect(screen.getByTestId('stat-status')).toHaveTextContent('zmstats');
    expect(screen.getByTestId('stat-status')).toHaveTextContent('zmaudit');
    expect(screen.queryByTestId('server-details-list')).toBeNull();
  });
});

describe('Server page - profile picker (refs #337)', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('single mode: no picker, fetches via the current profile', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    const clientA = fakeApiClient(serverRoutes());
    installApiClient(profileA.id, clientA);

    renderServer();

    await waitFor(() => expect(clientA.calls.map((c) => c.url)).toContain('/servers.json'));
    expect(screen.queryByTestId('page-profile-picker')).toBeNull();
  });

  it('All mode: shows picker defaulted to first profile, and picking B fetches via B', async () => {
    const [profileA, profileB] = seedProfiles(['profile-a', 'profile-b'], { current: ALL_PROFILES_ID });
    const clientA = fakeApiClient(serverRoutes());
    const clientB = fakeApiClient(serverRoutes());
    installApiClient(profileA.id, clientA);
    installApiClient(profileB.id, clientB);

    renderServer();

    await waitFor(() => expect(clientA.calls.map((c) => c.url)).toContain('/servers.json'));
    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
    expect(clientB.calls).toEqual([]);

    fireEvent.click(screen.getByTestId(`page-profile-picker-option-${profileB.id}`));

    await waitFor(() => expect(clientB.calls.map((c) => c.url)).toContain('/servers.json'));
  });
});
