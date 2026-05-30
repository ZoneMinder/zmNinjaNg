import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { compareSemver, useDeveloperNotices } from '../useDeveloperNotices';
import { useDeveloperNoticeStore } from '../../stores/developerNotices';

const fetchMock = vi.fn();
vi.mock('../../api/developer-notices', async () => {
  const actual = await vi.importActual<typeof import('../../api/developer-notices')>(
    '../../api/developer-notices',
  );
  return {
    ...actual,
    fetchDeveloperNotices: () => fetchMock(),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns positive when a > b', () => {
    expect(compareSemver('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareSemver('1.3.0', '1.2.99')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('returns negative when a < b', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.1.14', '1.2.0')).toBeLessThan(0);
  });

  it('handles mismatched length by zero-padding', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('ignores non-numeric suffixes on components', () => {
    expect(compareSemver('1.1.14-stream-resume', '1.1.14')).toBe(0);
  });
});

describe('useDeveloperNotices — feed deletions', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [] });
  });

  it('drops a notice the developer deleted from the feed; orphan readIds stay in storage but cause no UI', async () => {
    useDeveloperNoticeStore.setState({
      readIds: ['notice-a', 'notice-b-deleted'],
      dismissedBannerIds: ['notice-c-deleted'],
    });

    // Feed now only has notice-a; notice-b-deleted and notice-c-deleted were removed by the dev
    fetchMock.mockResolvedValue([
      {
        id: 'notice-a',
        title: 'Surviving notice',
        body: 'still here',
        publishedAt: '2026-05-30T18:00:00Z',
        severity: 'info',
      },
    ]);

    const { result } = renderHook(() => useDeveloperNotices(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // UI only sees what the feed returns
    expect(result.current.notices.map((n) => n.id)).toEqual(['notice-a']);
    expect(result.current.notices[0].isRead).toBe(true); // still remembered as read
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isError).toBe(false);

    // Orphan ids are still in localStorage — harmless, but accumulate over time
    const state = useDeveloperNoticeStore.getState();
    expect(state.readIds).toContain('notice-b-deleted');
    expect(state.dismissedBannerIds).toContain('notice-c-deleted');
  });

  it('shrinks unreadCount when the dev deletes an unread notice', async () => {
    fetchMock.mockResolvedValueOnce([
      { id: 'a', title: 'A', body: '', publishedAt: '2026-05-30T18:00:00Z', severity: 'info' },
      { id: 'b', title: 'B', body: '', publishedAt: '2026-05-30T19:00:00Z', severity: 'info' },
    ]);
    const { result, rerender } = renderHook(() => useDeveloperNotices(), { wrapper });
    await waitFor(() => expect(result.current.notices.length).toBe(2));
    expect(result.current.unreadCount).toBe(2);

    // Dev deletes 'a' from the feed
    fetchMock.mockResolvedValueOnce([
      { id: 'b', title: 'B', body: '', publishedAt: '2026-05-30T19:00:00Z', severity: 'info' },
    ]);
    await result.current.refetch();
    rerender();
    await waitFor(() => expect(result.current.notices.length).toBe(1));
    expect(result.current.unreadCount).toBe(1);
  });

  it('a critical notice the dev re-publishes with the same id stays banner-dismissed', async () => {
    useDeveloperNoticeStore.setState({ dismissedBannerIds: ['crit-1'] });
    fetchMock.mockResolvedValue([
      { id: 'crit-1', title: 'Security', body: '', publishedAt: '2026-05-30T18:00:00Z', severity: 'critical' },
    ]);
    const { result } = renderHook(() => useDeveloperNotices(), { wrapper });
    await waitFor(() => expect(result.current.notices.length).toBe(1));
    // criticalUnread exists (unread on the page), but the banner won't render because the id is in dismissedBannerIds
    expect(result.current.criticalUnread.map((n) => n.id)).toEqual(['crit-1']);
  });
});
