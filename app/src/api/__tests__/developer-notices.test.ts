import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpGetMock = vi.fn();
vi.mock('../../lib/http', () => ({
  httpGet: (...args: unknown[]) => httpGetMock(...args),
}));

import { fetchDeveloperNotices } from '../developer-notices';

const sampleFeed = [
  {
    id: '2026-05-30-welcome',
    title: 'Hi',
    body: 'hello',
    publishedAt: '2026-05-30T18:13:53Z',
    severity: 'info',
  },
];

describe('fetchDeveloperNotices', () => {
  beforeEach(() => httpGetMock.mockReset());

  it('parses an array response (browser / Electron path)', async () => {
    httpGetMock.mockResolvedValue({ data: sampleFeed, status: 200, statusText: 'OK', headers: {} });
    const notices = await fetchDeveloperNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].id).toBe('2026-05-30-welcome');
  });

  it('parses a string response (Capacitor / iOS+Android path: text/plain from GitHub raw)', async () => {
    httpGetMock.mockResolvedValue({
      data: JSON.stringify(sampleFeed),
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
    const notices = await fetchDeveloperNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].id).toBe('2026-05-30-welcome');
  });

  it('throws when the payload is not parseable JSON', async () => {
    httpGetMock.mockResolvedValue({ data: 'not json', status: 200, statusText: 'OK', headers: {} });
    await expect(fetchDeveloperNotices()).rejects.toThrow();
  });
});
