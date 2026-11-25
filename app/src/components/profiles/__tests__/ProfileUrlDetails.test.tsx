/**
 * A profile card's Details rows say which of its three addresses answer
 * (refs #603): the portal page, the API (the monitor list), and the stream
 * path (one nph-zms frame). Real profile, settings and auth stores and the
 * real session registry; the API client is fake, and the portal and stream
 * probes are faked at lib/http, the HTTP boundary.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { ProfileUrlDetails } from '../ProfileUrlDetails';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { setServerMap, clearAllServerMaps } from '../../../lib/zm/server-resolver';
import { asProfileId } from '../../../api/types';

const monitorsBody = {
  monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }],
};

/** Answers the portal page with `portal` and the nph-zms frame with `stream`. */
function answer(portal: number, stream: number) {
  httpGet.mockImplementation(async (url: string) => {
    const isStream = url.includes('nph-zms');
    const status = isStream ? stream : portal;
    const type = isStream && status === 200 ? 'image/jpeg' : 'text/html';
    return { status, statusText: '', data: '', headers: { 'content-type': type } };
  });
}

async function renderDetails(monitors: unknown = monitorsBody) {
  const [p] = seedProfiles([
    makeProfile('p1', {
      portalUrl: 'http://p1.test/zm',
      apiUrl: 'http://p1.test/zm/api',
      cgiUrl: 'http://p1.test/cgi-bin/nph-zms',
    }),
  ]);
  installApiClient(p.id, fakeApiClient({ '/monitors.json': monitors }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileUrlDetails profile={p} />
    </QueryClientProvider>,
  );
  await userEvent.setup().click(screen.getByTestId(`profile-urls-${p.id}-toggle`));
}

describe('ProfileUrlDetails', () => {
  afterEach(() => {
    httpGet.mockReset();
    clearAllServerMaps();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('marks portal, API and streaming green when each answers', async () => {
    answer(200, 200);
    await renderDetails();
    for (const kind of ['portal', 'api', 'streaming']) {
      expect(await screen.findByTestId(`profile-url-check-${kind}-ok`)).toHaveAttribute('aria-label', 'profiles.check_ok');
    }
  });

  it('marks only streaming red, with its status, when nph-zms answers 404', async () => {
    answer(200, 404);
    await renderDetails();
    expect(await screen.findByTestId('profile-url-check-streaming-failed')).toHaveAttribute(
      'aria-label',
      'profiles.check_failed:{"status":404}',
    );
    expect(await screen.findByTestId('profile-url-check-portal-ok')).toHaveAttribute('aria-label', 'profiles.check_ok');
  });

  it('marks the API red with the status the monitor list failed with', async () => {
    answer(200, 200);
    await renderDetails(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
    expect(await screen.findByTestId('profile-url-check-api-failed')).toHaveAttribute(
      'aria-label',
      'profiles.check_failed:{"status":401}',
    );
  });

  // A multi-server install can list a second server the app can't reach (a
  // LAN-only hostname): no status, so no verdict. The path that answers still
  // makes streaming green.
  it('marks streaming green when one stream URL answers and another gives no status', async () => {
    setServerMap(
      new Map([['2', { recordingUrl: 'http://lan-only.test/zm/cgi-bin/nph-zms', portalPath: 'http://lan-only.test/zm/index.php', apiBaseUrl: 'http://lan-only.test/zm/api' }]]),
      asProfileId('p1'),
    );
    httpGet.mockImplementation(async (url: string) => {
      if (url.includes('lan-only.test')) throw new Error('getaddrinfo ENOTFOUND lan-only.test');
      const isStream = url.includes('nph-zms');
      return { status: 200, statusText: '', data: '', headers: { 'content-type': isStream ? 'image/jpeg' : 'text/html' } };
    });
    await renderDetails({
      monitors: [
        { Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always', ServerId: null } },
        { Monitor: { Id: '8', Name: 'Yard', Function: 'Modect', Enabled: '1', Capturing: 'Always', ServerId: '2' } },
      ],
    });
    await waitFor(() => expect(httpGet.mock.calls.some(([u]) => String(u).includes('lan-only.test'))).toBe(true));
    expect(await screen.findByTestId('profile-url-check-streaming-ok')).toHaveAttribute('aria-label', 'profiles.check_ok');
  });
});
