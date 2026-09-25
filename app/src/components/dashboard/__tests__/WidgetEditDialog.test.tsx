import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { WidgetEditDialog } from '../WidgetEditDialog';
import { ALL_PROFILES_ID } from '../../../api/types';
import type { DashboardWidget } from '../../../stores/dashboard';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { useDashboardStore } from '../../../stores/dashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../hooks/useEventTags', () => ({
  useEventTags: () => ({ availableTags: [], tagsSupported: false }),
}));

// Radix's Select relies on portals/pointer APIs jsdom doesn't fully support -
// same stub approach as Settings.test.tsx.
const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" onClick={() => ctx.onValueChange?.(value)}>{children}</button>
    );
  },
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

const widget: DashboardWidget = {
  id: 'widget-1',
  type: 'monitor',
  title: 'Front',
  settings: { monitorIds: ['1'] },
  layout: { i: 'widget-1', x: 0, y: 0, w: 4, h: 2 },
};

function monitorsFor(profileId: string) {
  return { monitors: [{ Monitor: { Id: '1', Name: `Cam-${profileId}`, Function: 'Modect', Enabled: '1' } }] };
}

describe('WidgetEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([profileA, profileB], { current: ALL_PROFILES_ID });
    installApiClient(profileA.id, fakeApiClient({ '/monitors.json': monitorsFor(profileA.id), '/servers.json': { servers: [] } }));
    installApiClient(profileB.id, fakeApiClient({ '/monitors.json': monitorsFor(profileB.id), '/servers.json': { servers: [] } }));
    useDashboardStore.setState({ widgets: { [profileA.id]: [widget] } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useDashboardStore.setState({ widgets: {}, isEditing: false });
  });

  function renderDialog(w: DashboardWidget) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WidgetEditDialog open onOpenChange={() => {}} widget={w} profileId={ALL_PROFILES_ID} />
      </QueryClientProvider>
    );
  }

  const saved = () => useDashboardStore.getState().widgets[ALL_PROFILES_ID]?.find((w) => w.id === 'widget-1');
  const checkbox = (profileId: string) => screen.findByTestId(`widget-edit-monitor-checkbox-${profileId}-1`);

  // Both servers' monitors list under their server's heading; ticking one
  // on each saves both, each with its owning server (refs #529).
  it('saves picks from two servers, each with its own server', async () => {
    const legacy = { ...widget, settings: { monitorIds: ['1'], profileId: profileB.id } };
    useDashboardStore.setState({ widgets: { [ALL_PROFILES_ID]: [legacy] } });
    renderDialog(legacy);

    expect(screen.queryByTestId('widget-profile-picker')).not.toBeInTheDocument();
    expect(await screen.findByTestId(`widget-edit-monitor-list-server-${profileA.id}`)).toHaveTextContent('Home');
    expect(screen.getByTestId(`widget-edit-monitor-list-server-${profileB.id}`)).toHaveTextContent('Work');

    // The legacy widget's monitor 1 belongs to Work, not Home.
    expect(await checkbox(profileB.id)).toHaveAttribute('data-state', 'checked');
    expect(await checkbox(profileA.id)).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(await checkbox(profileA.id));
    fireEvent.click(screen.getByTestId('widget-edit-save-button'));

    await waitFor(() => expect(saved()?.settings).toEqual({
      monitorRefs: [{ profileId: profileB.id, monitorId: '1' }, { profileId: profileA.id, monitorId: '1' }],
      feedFit: 'contain',
    }));
  });
});
