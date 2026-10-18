import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeveloperNotice as Notice } from '../../api/developer-notices';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const feed: Notice[] = [
  {
    id: 'release-2.7.0',
    title: 'Release notes',
    body: 'body',
    publishedAt: '2026-10-04T10:46:16.745Z',
    severity: 'info',
    minAppVersion: '0.0.1',
  },
  {
    id: 'welcome',
    title: 'Welcome',
    body: 'body',
    publishedAt: '2026-05-30T00:00:00.000Z',
    severity: 'info',
  },
];

vi.mock('../../api/developer-notices', () => ({
  fetchDeveloperNotices: () => Promise.resolve(feed),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import DeveloperNotice from '../DeveloperNotice';

describe('DeveloperNotice page', () => {
  it('shows the app version a notice is for next to its date, and only the date when it has none', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <DeveloperNotice />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('developer-notice-meta-release-2.7.0')).toHaveTextContent(/^v0\.0\.1 · Oct \d/);
    expect(screen.getByTestId('developer-notice-meta-welcome')).toHaveTextContent(/^May \d/);
  });
});
