/**
 * Live pages' stream path banner (refs #603): only a failed probe shows, and
 * in a group it names the server. Real stores and session registry; the probe
 * request is faked at lib/http.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

import { ZmsProbeBanner } from '../ZmsProbeBanner';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

const monitorsBody = { monitors: [{ Monitor: { Id: '1', Name: 'Door', Function: 'Modect', Enabled: '1' } }] };

describe('ZmsProbeBanner', () => {
  afterEach(() => {
    httpGet.mockReset();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('names the server whose nph-zms refused, and stays quiet for the one that answered', async () => {
    const profiles = seedProfiles([
      makeProfile('a', { name: 'Home', cgiUrl: 'http://a.test/cgi-bin/nph-zms' }),
      makeProfile('b', { name: 'Shop', cgiUrl: 'http://b.test/cgi-bin/nph-zms' }),
    ]);
    for (const p of profiles) installApiClient(p.id, fakeApiClient({ '/monitors.json': monitorsBody }));
    httpGet.mockImplementation(async (url: string) =>
      url.startsWith('http://a.test')
        ? { status: 200, statusText: '', data: '', headers: { 'content-type': 'image/jpeg' } }
        : { status: 403, statusText: '', data: '', headers: {} },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ZmsProbeBanner profileIds={profiles.map((p) => p.id)} />
      </QueryClientProvider>,
    );
    const banner = await screen.findByTestId('zms-probe-banner');
    expect(banner.textContent).toBe('Shop: monitors.zms_probe_failed:{"status":403,"path":"/cgi-bin/nph-zms"}');
  });
});
