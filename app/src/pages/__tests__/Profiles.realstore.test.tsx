/**
 * Profiles page real-store regression test (refs #337).
 *
 * The isolated Profiles test mocks the store as `(selector) => selector(state)`,
 * which bypasses useSyncExternalStore and therefore cannot see the failure
 * mode a new subscription risks: a selector that mints a fresh array on every
 * call loops the render ("Maximum update depth exceeded") and useShallow never
 * stabilizes it. The group card list added here subscribes to exactly that
 * shape, so this renders against the REAL store and asserts what the user sees
 * after a group is created and deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profiles from '../Profiles';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { asProfileId } from '../../api/types';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The cards' stream badge runs a query (refs #603).
const renderProfiles = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Profiles />
    </QueryClientProvider>,
  );

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock('../../components/NotificationBadge', () => ({ NotificationBadge: () => null }));
vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));
vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn(),
  getSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

const server = (id: string, name: string) => ({
  id: asProfileId(id),
  name,
  apiUrl: `http://${id}`,
  portalUrl: `http://${id}`,
  cgiUrl: `http://${id}/cgi-bin`,
  isDefault: false,
  createdAt: 1,
});

describe('Profiles page against the real store', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [server('p1', 'Home'), server('p2', 'Away')],
      virtualProfiles: [],
      currentProfileId: asProfileId('p1'),
      isInitialized: true,
    });
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('shows a group created after mount and drops the card when it is deleted', () => {
    renderProfiles();
    expect(screen.queryByText('Upstairs')).not.toBeInTheDocument();

    let id = asProfileId('');
    act(() => {
      id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
    });

    const card = screen.getByTestId(`profile-card-virtual-${id}`);
    expect(card).toHaveTextContent('Upstairs');
    expect(card).toHaveTextContent('profiles.group_member_count:{"count":1}');

    act(() => useProfileStore.getState().deleteVirtualProfile(id));

    expect(screen.queryByTestId(`profile-card-virtual-${id}`)).not.toBeInTheDocument();
    // The member profile is untouched, which is what the delete copy promises.
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  // ZM 1.39.45 reports an empty ZM_PATH_ZMS, so setup saves a guessed
  // streaming URL (refs #584, #603). The edit dialog keeps saying so until
  // the user changes the field.
  it('says the streaming URL is a guess while the field still holds it', async () => {
    useProfileStore.setState({
      profiles: [{ ...server('p1', 'Home'), cgiUrlGuessed: true }, server('p2', 'Away')],
    });
    const user = userEvent.setup();
    renderProfiles();

    await user.click(screen.getByTestId('profile-actions-menu-p1'));
    await user.click(await screen.findByTestId('profile-edit-button-p1'));
    expect(await screen.findByTestId('profile-edit-cgi-url-guessed')).toHaveTextContent('profiles.cgi_url_guessed');

    await user.type(screen.getByTestId('profile-edit-cgi-url'), '/x');
    expect(screen.queryByTestId('profile-edit-cgi-url-guessed')).not.toBeInTheDocument();
  });

  it('shows no guess warning for a streaming URL the server reported', async () => {
    const user = userEvent.setup();
    renderProfiles();

    await user.click(screen.getByTestId('profile-actions-menu-p1'));
    await user.click(await screen.findByTestId('profile-edit-button-p1'));
    expect(await screen.findByTestId('profile-edit-cgi-url')).toHaveValue('http://p1/cgi-bin');
    expect(screen.queryByTestId('profile-edit-cgi-url-guessed')).not.toBeInTheDocument();
  });
});
