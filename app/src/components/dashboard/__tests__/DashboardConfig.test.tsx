import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { DashboardConfig } from '../DashboardConfig';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { useProfileStore } from '../../../stores/profile';
import { useDashboardStore } from '../../../stores/dashboard';

function monitorList(names: string[]) {
  return {
    monitors: names.map((Name, i) => ({ Monitor: { Id: String(i + 1), Name, Function: 'Modect', Enabled: '1', Deleted: false } })),
  };
}

function renderConfig() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardConfig />
    </QueryClientProvider>
  );
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('DashboardConfig', () => {
  beforeEach(() => {
    seedProfiles([makeProfile('profile-1', { name: 'Home' })]);
    installApiClient(asProfileId('profile-1'), fakeApiClient({ '/monitors.json': monitorList(['Front Door', 'Back Door']) }));
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useDashboardStore.setState({ widgets: {}, isEditing: false });
  });

  it('adds a monitor widget when a monitor is selected', async () => {
    renderConfig();

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(await screen.findByTestId('monitor-checkbox-1'));
    fireEvent.change(screen.getByTestId('widget-title-input'), {
      target: { value: 'My Monitor' },
    });
    fireEvent.click(screen.getByTestId('widget-add-button'));

    const widgets = useDashboardStore.getState().widgets['profile-1'];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      type: 'monitor',
      title: 'My Monitor',
      settings: { monitorIds: ['1'], feedFit: 'contain' },
    });
  });

  it('adds an events widget without requiring a monitor selection', () => {
    renderConfig();

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(screen.getByTestId('widget-type-events'));
    fireEvent.click(screen.getByTestId('widget-add-button'));

    const widgets = useDashboardStore.getState().widgets['profile-1'];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      type: 'events',
      settings: { monitorId: undefined, eventCount: 5 },
    });
  });

  // Each aggregate keeps its own dashboard, so a widget added while a group is
  // active is filed under the group, not the All Servers sentinel (refs #337).
  it("files a new widget under the active group's own bucket", () => {
    const group = mintVirtualProfileId();
    useProfileStore.setState({
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: [asProfileId('profile-1')] }],
    });

    renderConfig();

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(screen.getByTestId('widget-type-events'));
    fireEvent.click(screen.getByTestId('widget-add-button'));

    const widgets = useDashboardStore.getState().widgets[group];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ type: 'events' });
  });

  // In an aggregate one widget can hold monitors from several servers,
  // each saved with its owning server (refs #529).
  describe('in an aggregate', () => {
    const home = makeProfile('home', { name: 'Home' });
    const work = makeProfile('work', { name: 'Work' });

    beforeEach(() => {
      seedProfiles([home, work], { current: ALL_PROFILES_ID });
      installApiClient(home.id, fakeApiClient({ '/monitors.json': monitorList(['Porch']) }));
      installApiClient(work.id, fakeApiClient({ '/monitors.json': monitorList(['Lobby']) }));
    });

    it('adds a monitor widget holding one monitor from each server', async () => {
      renderConfig();

      fireEvent.click(screen.getByTestId('add-widget-trigger'));
      expect(screen.queryByTestId('widget-profile-picker')).not.toBeInTheDocument();
      fireEvent.click(await screen.findByTestId(`monitor-checkbox-${home.id}-1`));
      fireEvent.click(await screen.findByTestId(`monitor-checkbox-${work.id}-1`));
      fireEvent.click(screen.getByTestId('widget-add-button'));

      const [added] = useDashboardStore.getState().widgets[ALL_PROFILES_ID];
      expect(added.settings).toEqual({
        monitorRefs: [{ profileId: home.id, monitorId: '1' }, { profileId: work.id, monitorId: '1' }],
        feedFit: 'contain',
      });
    });

    it('adds an events widget filtered to one server\'s monitor', async () => {
      renderConfig();

      fireEvent.click(screen.getByTestId('add-widget-trigger'));
      fireEvent.click(screen.getByTestId('widget-type-events'));
      fireEvent.click(await screen.findByTestId(`monitor-checkbox-${work.id}-1`));
      fireEvent.click(screen.getByTestId('widget-add-button'));

      const [added] = useDashboardStore.getState().widgets[ALL_PROFILES_ID];
      expect(added.settings).toEqual({
        monitorRefs: [{ profileId: work.id, monitorId: '1' }],
        eventCount: 5,
      });
    });
  });
});
