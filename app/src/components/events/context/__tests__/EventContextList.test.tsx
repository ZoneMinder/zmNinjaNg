import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { EventContextList } from '../EventContextList';
import { offsetLabel } from '../../../../lib/event/event-context-view';
import { seedProfiles, resetProfileFixture } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';

// CompactEventRow reads useNavigate (routing) and EventDeleteButton's
// usePermissions reads useQuery unconditionally, so rows need a real router
// and a real QueryClient to mount - no app code is mocked for either. `t` is
// stubbed to the key (plus any count) so the assertions below check real
// rendered content instead of just an element's presence.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => `${key}${opts?.count !== undefined ? `:${opts.count}` : ''}`,
  }),
}));

function renderList(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const row = (id: string, offsetMs: number, isAnchor = false) => ({
  event: {
    Id: id,
    MonitorId: '3',
    Name: `Event ${id}`,
    StartDateTime: '2026-09-17 21:14:03',
    Length: '38.00',
    Frames: '40',
    AlarmFrames: '4',
    Cause: 'Motion',
  } as never,
  offsetMs,
  isAnchor,
});

describe('offsetLabel', () => {
  it('signs a row before the anchor', () => {
    expect(offsetLabel(-252_000)).toBe('−4:12');
  });

  it('signs a row after it', () => {
    expect(offsetLabel(38_000)).toBe('+0:38');
  });

  it('gives the anchor itself no sign', () => {
    expect(offsetLabel(0)).toBe('0:00');
  });
});

describe('EventContextList', () => {
  const props = { profileId: undefined, isLoading: false, error: null, truncated: false, onWiden: undefined };

  it('renders every row with its offset', () => {
    renderList(<EventContextList {...props} rows={[row('405', -252_000), row('406', 0, true)]} />);
    expect(screen.getByTestId('event-context-row-405')).toHaveTextContent('−4:12');
    expect(screen.getByTestId('event-context-row-406')).toHaveTextContent('0:00');
  });

  it('marks the anchor row so it reads as where you came from', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    const anchorRow = screen.getByTestId('event-context-row-406');
    expect(anchorRow).toHaveAttribute('aria-current', 'true');
    expect(anchorRow.className).toContain('ring-2');
    expect(anchorRow.className).toContain('bg-primary/5');
  });

  it('does not tint a row that is not the anchor', () => {
    renderList(<EventContextList {...props} rows={[row('405', -252_000)]} />);
    expect(screen.getByTestId('event-context-row-405').className).not.toContain('bg-primary/5');
  });

  it('gives the offset badge its own title, not the duration tooltip', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    expect(screen.getByText('0:00')).toHaveAttribute('title', 'events.around.offset_title');
  });

  it('offers a wider window when nothing else is in this one', () => {
    const onWiden = vi.fn();
    renderList(<EventContextList {...props} rows={[]} onWiden={onWiden} />);
    expect(screen.getByTestId('event-context-empty')).toHaveTextContent('events.around.empty');
    screen.getByTestId('event-context-widen').click();
    expect(onWiden).toHaveBeenCalled();
  });

  it('says so when the server had more than one window can show', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} truncated />);
    expect(screen.getByTestId('event-context-truncated')).toHaveTextContent('events.around.truncated:1');
  });

  it('shows the error banner instead of an empty list when the query failed', () => {
    renderList(<EventContextList {...props} rows={[]} error={new Error('nope')} />);
    expect(screen.queryByTestId('event-context-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('event-context-error')).toHaveTextContent('nope');
  });

  // refs #494: rows get the same hover preview as the event list cards,
  // gated by the panel's own eventContext setting, scoped to the anchor
  // profile (not whatever profile happens to be globally current).
  describe('hover preview', () => {
    afterEach(() => {
      resetProfileFixture();
      resetFakeStoreGates();
    });

    it('wraps a row thumbnail, scoped to the anchor profile, when eventContext hover preview is on', () => {
      const [profile] = seedProfiles(['anchor-profile']);
      vi.useFakeTimers();
      renderList(<EventContextList {...props} profileId={profile.id} rows={[row('406', 0, true)]} />);
      const wrapper = screen.getByTestId('compact-event-thumbnail').parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      act(() => { vi.advanceTimersByTime(700); });
      const img = screen.getByTestId('event-thumbnail-hover-preview').querySelector('img') as HTMLImageElement;
      expect(img.src).toContain('anchor-profile.test');
      vi.useRealTimers();
    });

    it('does not wrap the thumbnail when eventContext hover preview is off', () => {
      const [profile] = seedProfiles(['anchor-profile'], {
        settings: { 'anchor-profile': { hoverPreview: { eventContext: false } as never } },
      });
      renderList(<EventContextList {...props} profileId={profile.id} rows={[row('406', 0, true)]} />);
      fireEvent.mouseEnter(screen.getByTestId('compact-event-thumbnail'));
      expect(screen.queryByTestId('event-thumbnail-hover-preview')).toBeNull();
    });
  });
});
