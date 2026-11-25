/**
 * Stream badge on a Profiles card (refs #603): one look at the profile list
 * says which servers answer live streams. Real profile, settings and auth
 * stores and the real session registry; the API client is fake, and the
 * probe's own request is faked at lib/http, the HTTP boundary.
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

import { ProfileStreamBadge } from '../ProfileStreamBadge';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';
import type { Profile } from '../../../api/types';

const monitorsBody = {
  monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }],
};

function renderBadge(overrides: Partial<Profile> = {}) {
  const [p] = seedProfiles([makeProfile('p1', { cgiUrl: 'http://p1.test/cgi-bin/nph-zms', ...overrides })]);
  installApiClient(p.id, fakeApiClient({ '/monitors.json': monitorsBody }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileStreamBadge profile={p} />
    </QueryClientProvider>,
  );
}

const answer = (status: number, contentType: string) =>
  httpGet.mockResolvedValue({ status, statusText: '', data: '', headers: { 'content-type': contentType } });

describe('ProfileStreamBadge', () => {
  afterEach(() => {
    httpGet.mockReset();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows a green badge when the stream path answers a frame', async () => {
    answer(200, 'image/jpeg');
    renderBadge();
    const badge = await screen.findByTestId('profile-stream-badge-ok');
    expect(badge).toHaveTextContent('profiles.stream_ok');
  });

  it('shows a red badge with the status when the stream path fails', async () => {
    answer(404, 'text/html');
    renderBadge();
    const badge = await screen.findByTestId('profile-stream-badge-failed');
    expect(badge).toHaveTextContent('profiles.stream_failed:{"status":404}');
    expect(badge.className).toContain('bg-destructive');
  });

  // A guessed path is not a state of its own: it works or it doesn't.
  it('shows nothing for a guessed path when the probe cannot tell', async () => {
    httpGet.mockRejectedValue(new Error('Network Error'));
    renderBadge({ cgiUrlGuessed: true });
    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId(/profile-stream-badge/)).not.toBeInTheDocument();
  });

  it('does not probe a disabled profile', async () => {
    answer(200, 'image/jpeg');
    renderBadge({ disabled: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(httpGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId(/profile-stream-badge/)).not.toBeInTheDocument();
  });
});
