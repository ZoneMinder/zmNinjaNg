import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profiles from '../Profiles';
import { mintVirtualProfileId } from '../../api/types';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { seedProfiles, resetProfileFixture, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The cards' stream badge runs a query (refs #603).
const renderProfiles = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Profiles />
    </QueryClientProvider>,
  );

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('../../services/discovery', () => ({
  discoverZoneminder: vi.fn(),
  DiscoveryError: class DiscoveryError extends Error {},
}));

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const HOME = {
  id: asProfileId('p1'),
  name: 'Home',
  portalUrl: 'https://home.test',
  apiUrl: 'https://api.home.test',
  cgiUrl: 'https://home.test/cgi-bin',
  isDefault: true,
  createdAt: 1,
};

const OFFICE = {
  id: asProfileId('p2'),
  name: 'Office',
  portalUrl: 'https://office.test',
  apiUrl: 'https://api.office.test',
  cgiUrl: 'https://office.test/cgi-bin',
  isDefault: false,
  createdAt: 2,
};

beforeEach(() => {
  mockNavigate.mockClear();
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('Profiles Page', () => {
  it('renders profile list and active indicator', () => {
    seedProfiles([HOME], { current: 'p1' });

    renderProfiles();

    // One seeded profile, so the list holds exactly one card.
    const cards = within(screen.getByTestId('profile-list')).getAllByTestId('profile-card');
    expect(cards).toHaveLength(1);
    // HOME.isDefault is true, so its card carries the Default badge.
    expect(cards[0]).toHaveTextContent('profiles.default');
    // The active indicator belongs to HOME's own card, not just the document.
    expect(cards[0]).toContainElement(screen.getByTestId('profile-active-indicator'));
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Home');
  });

  // Virtual profile groups supersede the All Servers card, so the page offers
  // no built-in aggregate at all: an aggregate is now always a named group the
  // user picked members for (refs #337).
  it('renders no All Servers card, whatever the enabled profile count', () => {
    seedProfiles([HOME, OFFICE], { current: 'p1' });

    renderProfiles();

    expect(screen.getByTestId('profile-new-group-button')).toHaveTextContent('profiles.new_group');
    expect(screen.queryByTestId('profile-card-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-card-all-note')).not.toBeInTheDocument();
  });

  // refs #337: per-profile disable toggle
  it('renders a disable toggle for every profile and flips a non-active one', async () => {
    const user = userEvent.setup();
    seedProfiles([HOME, OFFICE], { current: 'p1' });

    renderProfiles();
    await user.click(screen.getByTestId('profile-actions-menu-p2'));
    await user.click(await screen.findByTestId('profile-disable-toggle-p2'));

    expect(useProfileStore.getState().profiles.find((p) => p.id === 'p2')?.disabled).toBe(true);
  });

  it('shows a muted card and Disabled badge for a disabled profile, hiding its switch button', () => {
    seedProfiles([HOME, { ...OFFICE, disabled: true }], { current: 'p1' });

    renderProfiles();

    expect(screen.getByTestId('profile-disabled-badge')).toHaveTextContent('profiles.disabled');
    expect(screen.queryByTestId('profile-switch-button-p2')).not.toBeInTheDocument();
    // Edit, delete, and the re-enable toggle stay available, in the row menu.
    expect(screen.getByTestId('profile-actions-menu-p2')).toHaveAttribute(
      'aria-label',
      'profiles.more_actions'
    );
  });

  it('shows an error toast when disabling the active profile is rejected', async () => {
    const user = userEvent.setup();
    const { toast: sonnerToast } = await import('sonner');
    seedProfiles([HOME, OFFICE], { current: 'p1' });

    renderProfiles();
    await user.click(screen.getByTestId('profile-actions-menu-p1'));
    await user.click(await screen.findByTestId('profile-disable-toggle-p1'));

    // The real guard rejects disabling the active profile - it stays enabled.
    expect(useProfileStore.getState().profiles.find((p) => p.id === 'p1')?.disabled).toBeFalsy();
    expect(sonnerToast.error).toHaveBeenCalledWith('profiles.cannot_disable_active');
  });

  // Group cards: the visible half of virtual profiles (refs #337, spec 11).
  describe('group cards', () => {
    const GROUP = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: [asProfileId('p2')] };

    beforeEach(() => {
      seedProfiles([HOME, OFFICE], { current: 'p1' });
      useProfileStore.setState({ virtualProfiles: [GROUP] });
    });

    it('names the group and counts its members', () => {
      renderProfiles();

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      expect(card).toHaveTextContent('Backyard');
      expect(card).toHaveTextContent('profiles.group_member_count:{"count":1}');
    });

    it('renders group cards after every profile card', () => {
      renderProfiles();

      const cards = screen.getAllByTestId(/^profile-card(-virtual-.+)?$/);
      expect(cards.at(-1)).toBe(screen.getByTestId(`profile-card-virtual-${GROUP.id}`));
    });

    it('marks the group card active while that group is current', () => {
      useProfileStore.setState({ currentProfileId: GROUP.id });

      renderProfiles();

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      expect(card.querySelector('[data-testid="profile-active-indicator"]')).not.toBeNull();
    });

    it('switches to the group id from its switch button', async () => {
      const user = userEvent.setup();

      renderProfiles();
      await user.click(screen.getByTestId(`profile-virtual-switch-${GROUP.id}`));

      await waitFor(() => expect(useProfileStore.getState().currentProfileId).toBe(GROUP.id));
      expect(mockNavigate).toHaveBeenCalledWith('/monitors');
    });

    // The group keeps its own lastRoute bucket, and a switch used to discard
    // it and land on /monitors every time (refs #337).
    it('lands on the page the group was last on', async () => {
      const user = userEvent.setup();
      useSettingsStore.getState().updateProfileSettings(GROUP.id, { lastRoute: '/events' });

      renderProfiles();
      await user.click(screen.getByTestId(`profile-virtual-switch-${GROUP.id}`));

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events'));
    });

    // With one selectable server there is nothing to group.
    it('offers the New Virtual Profile Group action only with 2+ enabled profiles', () => {
      seedProfiles([HOME, { ...OFFICE, disabled: true }], { current: 'p1' });
      const { unmount } = renderProfiles();
      expect(screen.queryByTestId('profile-new-group-button')).not.toBeInTheDocument();
      unmount();

      seedProfiles([HOME, OFFICE], { current: 'p1' });
      renderProfiles();
      expect(screen.getByTestId('profile-new-group-button')).toHaveTextContent('profiles.new_group');
    });

    it('opens the dialog in edit mode from the group card', async () => {
      const user = userEvent.setup();

      renderProfiles();
      await user.click(screen.getByTestId(`profile-actions-menu-virtual-${GROUP.id}`));
      await user.click(await screen.findByTestId(`profile-edit-button-virtual-${GROUP.id}`));

      expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
        'profiles.group_edit_title'
      );
      expect(screen.getByTestId('virtual-profile-name')).toHaveValue('Backyard');
      // Editing a group must not also switch to it.
      expect(useProfileStore.getState().currentProfileId).toBe('p1');
    });

    it('opens the dialog in create mode from the New Virtual Profile Group action', async () => {
      const user = userEvent.setup();

      renderProfiles();
      await user.click(screen.getByTestId('profile-new-group-button'));

      expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
        'profiles.group_create_title'
      );
    });

    // The confirmation has to say the member servers survive; without that
    // line, "Delete Backyard?" reads as deleting the two servers in it.
    it('confirms the delete, promises the servers survive, then deletes only the group', async () => {
      const user = userEvent.setup();

      renderProfiles();
      await user.click(screen.getByTestId(`profile-actions-menu-virtual-${GROUP.id}`));
      await user.click(await screen.findByTestId(`profile-delete-button-virtual-${GROUP.id}`));

      expect(screen.getByTestId('profile-virtual-delete-dialog')).toHaveTextContent(
        'profiles.delete_group_confirm_desc:{"name":"Backyard"}'
      );
      expect(useProfileStore.getState().virtualProfiles).toEqual([GROUP]);

      await user.click(screen.getByTestId('profile-virtual-delete-confirm'));

      expect(useProfileStore.getState().virtualProfiles).toEqual([]);
      expect(useProfileStore.getState().currentProfileId).toBe('p1');
    });

    // The page owns the effective count, so this is the wiring test: disable
    // the group's only member and the card must stop offering the switch.
    it('will not switch to a group whose only member is disabled', async () => {
      const user = userEvent.setup();
      seedProfiles([HOME, { ...OFFICE, disabled: true }], { current: 'p1' });
      useProfileStore.setState({ virtualProfiles: [GROUP] });

      renderProfiles();
      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      await user.click(card);

      expect(useProfileStore.getState().currentProfileId).toBe('p1');
      expect(card).toHaveTextContent('profiles.group_no_active_members');
      // Still fixable: edit and delete are the way out, through this menu.
      expect(screen.getByTestId(`profile-actions-menu-virtual-${GROUP.id}`)).toHaveAttribute(
        'aria-label',
        'profiles.more_actions'
      );
    });

    it('reports a failed group delete instead of closing silently', async () => {
      const user = userEvent.setup();
      const { toast: sonnerToast } = await import('sonner');

      renderProfiles();
      await user.click(screen.getByTestId(`profile-actions-menu-virtual-${GROUP.id}`));
      await user.click(await screen.findByTestId(`profile-delete-button-virtual-${GROUP.id}`));
      // Simulate the group having already been removed (e.g. another tab)
      // between opening the confirmation and clicking it, so the real
      // deleteVirtualProfile rejects the stale id instead of succeeding.
      useProfileStore.setState((s) => ({ virtualProfiles: s.virtualProfiles.filter((v) => v.id !== GROUP.id) }));
      await user.click(screen.getByTestId('profile-virtual-delete-confirm'));

      expect(sonnerToast.error).toHaveBeenCalledWith('profiles.delete_group_error');
    });
  });
});
