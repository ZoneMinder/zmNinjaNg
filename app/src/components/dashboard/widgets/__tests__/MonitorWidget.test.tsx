import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { MonitorWidget } from '../MonitorWidget';
import * as sessions from '../../../../services/sessions';
import { getMonitor, getMonitors } from '../../../../api/monitors';
import { ALL_PROFILES_ID } from '../../../../api/types';
import type { MonitorRef } from '../../../../stores/dashboard';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getMonitors: vi.fn(),
}));
vi.mock('../../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: ({ profileId }: { profileId?: string }) => (
    <div data-testid="live-player" data-profile-id={profileId ?? ''} />
  ),
}));
vi.mock('../../../monitors/MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

function renderWidget(monitorRefs?: MonitorRef[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {monitorRefs ? <MonitorWidget monitorRefs={monitorRefs} /> : <MonitorWidget monitorIds={['7']} />}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MonitorWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([profileA, profileB], {
      current: profileA.id,
      settings: {
        [profileA.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
        [profileB.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
      },
    });
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const id = client === sessions.getSession(profileB.id).client ? profileB.id : profileA.id;
      return { monitors: [{ Monitor: { Id: '7', Name: `Cam-${id}`, Deleted: false } }] } as never;
    });
    vi.mocked(getMonitor).mockImplementation(async (client) => {
      const id = client === sessions.getSession(profileB.id).client ? profileB.id : profileA.id;
      return { Monitor: { Id: '7', Name: `Cam-${id}`, Deleted: false } } as never;
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('single mode (bare monitorIds): fetches via the current profile, no chip', async () => {
    const getSessionSpy = vi.spyOn(sessions, 'getSession');

    renderWidget(undefined);

    await waitFor(() => expect(screen.getByTestId('live-player')).toBeInTheDocument());
    expect(getSessionSpy).toHaveBeenCalledWith(profileA.id);
    expect(screen.queryByTestId('widget-profile-chip')).toBeNull();
  });

  it('picker widget: given a pick owned by B, fetches the monitor via profile B\'s client, not the current profile\'s (refs #337)', async () => {
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: {
        [profileA.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
        [profileB.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
      },
    });
    const getSessionSpy = vi.spyOn(sessions, 'getSession');
    const clientB = sessions.getSession(profileB.id).client;

    renderWidget([{ profileId: profileB.id, monitorId: '7' }]);

    await waitFor(() => expect(getMonitor).toHaveBeenCalled());
    // The client passed to getMonitor is the one getSession(profileB.id) built.
    expect(getSessionSpy).toHaveBeenCalledWith(profileB.id);
    expect(getSessionSpy).not.toHaveBeenCalledWith(profileA.id);
    const [client] = vi.mocked(getMonitor).mock.calls[0];
    expect(client).toBe(clientB);

    await waitFor(() => expect(screen.getByTestId('widget-profile-chip')).toHaveTextContent('Work'));
    // LiveMonitorPlayer's own profileId prop (distinct from `profile`) scopes
    // its go2rtc failure cache / MJPEG token resolution to the OWNING
    // profile, not whichever profile is globally selected (refs #337).
    expect(screen.getByTestId('live-player')).toHaveAttribute('data-profile-id', profileB.id);
  });

  // Two servers' monitors in one widget, even with the same raw id: each
  // feed plays from its own server (refs #529).
  it('mixed-server widget: renders each pick from its own server', async () => {
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: {
        [profileA.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
        [profileB.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
      },
    });

    renderWidget([
      { profileId: profileA.id, monitorId: '7' },
      { profileId: profileB.id, monitorId: '7' },
    ]);

    await waitFor(() => expect(screen.getAllByTestId('live-player')).toHaveLength(2));
    expect(screen.getAllByTestId('live-player').map((p) => p.getAttribute('data-profile-id')))
      .toEqual([profileA.id, profileB.id]);
    expect(screen.getAllByTestId('widget-profile-chip').map((c) => c.textContent)).toEqual(['Home', 'Work']);
  });
});
