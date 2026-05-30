import { describe, it, expect, beforeEach } from 'vitest';
import { useDeveloperNoticeStore } from '../developerNotices';

beforeEach(() => {
  useDeveloperNoticeStore.setState({ readIds: [], dismissedBannerIds: [] });
});

describe('useDeveloperNoticeStore', () => {
  it('marks a notice id as read exactly once', () => {
    const { markRead } = useDeveloperNoticeStore.getState();
    markRead('a');
    markRead('a');
    expect(useDeveloperNoticeStore.getState().readIds).toEqual(['a']);
  });

  it('isRead reflects markRead', () => {
    const { markRead, isRead } = useDeveloperNoticeStore.getState();
    expect(isRead('a')).toBe(false);
    markRead('a');
    expect(useDeveloperNoticeStore.getState().isRead('a')).toBe(true);
  });

  it('markAllRead merges without duplicates', () => {
    const { markRead, markAllRead } = useDeveloperNoticeStore.getState();
    markRead('a');
    markAllRead(['a', 'b', 'c']);
    expect(useDeveloperNoticeStore.getState().readIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('tracks banner dismissals separately from read state', () => {
    const { dismissBanner } = useDeveloperNoticeStore.getState();
    dismissBanner('crit-1');
    expect(useDeveloperNoticeStore.getState().isBannerDismissed('crit-1')).toBe(true);
    // dismissing the banner does not mark the notice as read
    expect(useDeveloperNoticeStore.getState().isRead('crit-1')).toBe(false);
  });
});
