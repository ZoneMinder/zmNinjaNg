/**
 * The icon next to a profile's name sums up its three address checks
 * (refs #603): green when portal, API and streaming all answer, a warning
 * when some fail, red when all fail. Real stores and session registry; the
 * API client is fake, and the portal and stream probes are faked at lib/http.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

const httpGet = vi.fn();
vi.mock('../../../lib/http', () => ({ httpGet: (...args: unknown[]) => httpGet(...args) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

import { ProfileHealthIcon } from '../ProfileHealthIcon';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';
import type { Profile } from '../../../api/types';

const monitorsBody = {
  monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }],
};
const unauthorized = () => {
  throw Object.assign(new Error('Unauthorized'), { status: 401 });
};

/** `portal` and `stream` are the statuses the two probes get back. */
function renderIcon(portal: number, stream: number, monitors: unknown = monitorsBody, overrides: Partial<Profile> = {}) {
  httpGet.mockImplementation(async (url: string) => {
    const isStream = url.includes('nph-zms');
    const status = isStream ? stream : portal;
    const type = isStream && status === 200 ? 'image/jpeg' : 'text/html';
    return { status, statusText: '', data: '', headers: { 'content-type': type } };
  });
  const [p] = seedProfiles([makeProfile('p1', { cgiUrl: 'http://p1.test/cgi-bin/nph-zms', ...overrides })]);
  installApiClient(p.id, fakeApiClient({ '/monitors.json': monitors }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProfileHealthIcon profile={p} />
    </QueryClientProvider>,
  );
}

describe('ProfileHealthIcon', () => {
  afterEach(() => {
    httpGet.mockReset();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('is green when portal, API and streaming all answer', async () => {
    renderIcon(200, 200);
    expect(await screen.findByTestId('profile-health-ok')).toHaveAttribute('aria-label', 'profiles.health_ok');
  });

  it('warns when some addresses fail', async () => {
    renderIcon(200, 404);
    expect(await screen.findByTestId('profile-health-partial')).toHaveAttribute('aria-label', 'profiles.health_partial');
  });

  // A failed API leaves no monitor to probe the stream with.
  it('is red when portal and API fail and nothing answers', async () => {
    renderIcon(503, 404, unauthorized);
    expect(await screen.findByTestId('profile-health-failed')).toHaveAttribute('aria-label', 'profiles.health_failed');
  });

  it('does not probe a disabled profile', async () => {
    renderIcon(200, 200, monitorsBody, { disabled: true });
    await waitFor(() => expect(screen.queryByTestId(/profile-health/)).not.toBeInTheDocument());
    expect(httpGet).not.toHaveBeenCalled();
  });
});
