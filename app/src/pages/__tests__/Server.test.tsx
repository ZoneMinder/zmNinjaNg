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

describe('Server page - storage areas (refs #539)', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows free space as total minus DiskUsedSpace, not DiskUsedSpace itself', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    // A 208.5 GB partition whose DiskUsedSpace includes ext4's reserved blocks.
    const storage = {
      Id: 1, Path: '/video4/zoneminder/events', Name: 'Default', Type: 'local', Url: null,
      DiskSpace: 840478311, Scheme: 'Medium', ServerId: 0, DoDelete: true, Enabled: true,
      DiskTotalSpace: 223854247936, DiskUsedSpace: 12300128256,
    };
    installApiClient(profileA.id, fakeApiClient({ ...serverRoutes(), '/storage.json': { storage: [{ Storage: storage }] } }));

    renderServer();

    expect(await screen.findByTestId('storage-free-1')).toHaveTextContent('197.0 GB server.storage_free');
    expect(screen.getByTestId('storage-total-1')).toHaveTextContent('208.5 GB server.storage_total');
  });

  function storageWithDiskSpace(diskSpace: number | null) {
    return {
      Id: 1, Path: '/var/cache/zoneminder/events', Name: 'Default', Type: 'local', Url: null,
      DiskSpace: diskSpace, Scheme: 'Medium', ServerId: 0, DoDelete: true, Enabled: true,
      DiskTotalSpace: 105089261568, DiskUsedSpace: 72923566080,
    };
  }

  it('shows the space events take from DiskSpace', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({ ...serverRoutes(), '/storage.json': { storage: [{ Storage: storageWithDiskSpace(1101004402) }] } }));

    renderServer();

    expect(await screen.findByTestId('storage-events-1')).toHaveTextContent('1.0 GB');
    expect(screen.queryByTestId('storage-events-drifted-1')).toBeNull();
  });

  it('says the value drifted instead of showing a negative DiskSpace', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({ ...serverRoutes(), '/storage.json': { storage: [{ Storage: storageWithDiskSpace(-129197848613) }] } }));

    renderServer();

    expect(await screen.findByTestId('storage-events-drifted-1')).toHaveTextContent('server.storage_events_drifted');
    expect(screen.queryByTestId('storage-events-1')).toBeNull();
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
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('stat-load')).toHaveTextContent('2.30'));
    expect(screen.getByTestId('stat-cpu')).toHaveTextContent('9.8%');
    expect(await screen.findByTestId('stat-storage-1')).toHaveTextContent('Default: 71%');
    expect(screen.getByTestId('stat-storage-detail-1')).toHaveTextContent('69.35 GB 97.87 GB');
    expect(screen.getByTestId('stat-storage-events-1')).toHaveTextContent('562.43 MB');
    expect(screen.getByTestId('stat-swap')).toHaveTextContent('0%');
    expect(screen.getByTestId('stat-swap-detail')).toHaveTextContent('0.00 B 8.00 GB');
    expect(screen.queryByText('server.disk_usage')).toBeNull();
  });

  it('shows the stats on a multi-server install too', async () => {
    const [profileA] = seedProfiles(['profile-a']);
    installApiClient(profileA.id, fakeApiClient({
      ...serverRoutes(),
      '/servers.json': { servers: [{ Server: { Id: '2', Name: 'pseudo' } }, { Server: { Id: '13', Name: 'unicron' } }] },
      '/server_stats/': { serverstats: [{ ServerStat: { ...portalStat, ServerId: 13 } }] },
      '/storage.json': { storage: [{ Storage: portalStorage }] },
    }));

    renderServer();

    await waitFor(() => expect(screen.getByTestId('server-card-13')).toBeInTheDocument());
    expect(screen.getByTestId('stat-load')).toHaveTextContent('2.30');
    expect(screen.getByTestId('stat-cpu')).toHaveTextContent('9.8%');
    expect(screen.getByTestId('stat-storage-1')).toHaveTextContent('Default: 71%');
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
