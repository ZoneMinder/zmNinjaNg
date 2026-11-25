/**
 * The Settings stream path row (refs #603): what the user reads after the app
 * asks nph-zms for one frame. Real profile, settings and auth stores and the
 * real session registry; the API client is fake, and the probe's own request
 * is faked at lib/http, the HTTP boundary.
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

import { ZmsProbeRow } from '../ZmsProbeRow';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

const monitorsBody = {
  monitors: [{ Monitor: { Id: '7', Name: 'Door', Function: 'Modect', Enabled: '1', Capturing: 'Always' } }],
};

function renderRow(status: number, contentType: string) {
  const [p] = seedProfiles([makeProfile('p1', { cgiUrl: 'http://p1.test/cgi-bin-zm/nph-zms' })]);
  installApiClient(p.id, fakeApiClient({ '/monitors.json': monitorsBody }));
  httpGet.mockResolvedValue({ status, statusText: '', data: '', headers: { 'content-type': contentType } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ZmsProbeRow profileId={p.id} />
    </QueryClientProvider>,
  );
}

describe('ZmsProbeRow', () => {
  afterEach(() => {
    httpGet.mockReset();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the path in green when nph-zms answers a jpeg, probing with the profile token', async () => {
    renderRow(200, 'image/jpeg');
    const line = await screen.findByTestId('settings-zms-probe-ok');
    expect(line.textContent).toContain('p1.test/cgi-bin-zm/nph-zms');
    const url = new URL(httpGet.mock.calls[0][0] as string);
    expect(url.searchParams.get('monitor')).toBe('7');
    expect(url.searchParams.get('token')).toBe('access-p1');
  });

  it('shows the status and path on red when nph-zms answers 404', async () => {
    renderRow(404, 'text/html');
    const line = await screen.findByTestId('settings-zms-probe-failed');
    expect(line.textContent).toBe(
      'settings.zms_probe_failed:{"status":404,"url":"p1.test/cgi-bin-zm/nph-zms"}',
    );
    expect(line.className).toContain('bg-destructive');
    expect(line.getAttribute('title')).toBe(line.textContent);
  });
});
