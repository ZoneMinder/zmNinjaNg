/**
 * The edit dialog marks each saved address with whether it answers
 * (refs #603), and drops the mark once the user edits that field. Real
 * stores and session registry; the API client is fake and the portal and
 * stream probes are faked at lib/http, the HTTP boundary.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const httpGet = vi.fn();
vi.mock('../../lib/http', () => ({ httpGet: (...args: unknown[]) => httpGet(...args) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

import Profiles from '../Profiles';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

describe('Profiles edit dialog address checks', () => {
  afterEach(() => {
    httpGet.mockReset();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('marks the saved addresses and drops a mark when its field is edited', async () => {
    const [p] = seedProfiles([makeProfile('p1', { cgiUrl: 'http://p1.test/cgi-bin/nph-zms' })]);
    installApiClient(p.id, fakeApiClient({
      '/monitors.json': { monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }] },
    }));
    httpGet.mockImplementation(async (url: string) => {
      const isStream = url.includes('nph-zms');
      return { status: isStream ? 404 : 200, statusText: '', data: '', headers: { 'content-type': 'text/html' } };
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Profiles />
      </QueryClientProvider>,
    );

    await user.click(screen.getByTestId('profile-actions-menu-p1'));
    await user.click(await screen.findByTestId('profile-edit-button-p1'));

    expect(await screen.findByTestId('profile-edit-check-portal-ok')).toHaveAttribute('aria-label', 'profiles.check_ok');
    expect(await screen.findByTestId('profile-edit-check-api-ok')).toHaveAttribute('aria-label', 'profiles.check_ok');
    expect(await screen.findByTestId('profile-edit-check-streaming-failed')).toHaveAttribute(
      'aria-label',
      'profiles.check_failed:{"status":404}',
    );

    await user.type(screen.getByTestId('profile-edit-cgi-url'), 'x');
    expect(screen.queryByTestId(/profile-edit-check-streaming/)).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-edit-check-portal-ok')).toHaveAttribute('aria-label', 'profiles.check_ok');
  });

  // Checking every row logged in to servers nobody was using; only the
  // current profile's row gets a health icon now.
  it('checks only the current profile', async () => {
    const monitors = { monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }] };
    const [p1, p2] = seedProfiles([
      makeProfile('p1', { cgiUrl: 'http://p1.test/cgi-bin/nph-zms' }),
      makeProfile('p2', { cgiUrl: 'http://p2.test/cgi-bin/nph-zms' }),
    ]);
    installApiClient(p1.id, fakeApiClient({ '/monitors.json': monitors }));
    const other = fakeApiClient({ '/monitors.json': monitors });
    installApiClient(p2.id, other);
    httpGet.mockResolvedValue({ status: 200, statusText: '', data: '', headers: { 'content-type': 'image/jpeg' } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Profiles />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('profile-health-ok')).toHaveAttribute('aria-label', 'profiles.health_ok');
    expect(httpGet.mock.calls.filter(([url]) => String(url).includes('p2.test'))).toEqual([]);
    expect(other.calls).toEqual([]);
  });
});
