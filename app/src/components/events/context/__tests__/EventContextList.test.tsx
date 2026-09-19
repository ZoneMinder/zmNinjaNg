import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
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
    // A partial stub of this hook is a trap: a component reading i18n.language
    // only on some branches crashes the day that branch starts running.
    i18n: { language: 'en' },
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
  it('renders a sub-minute offset in seconds only', () => {
    expect(offsetLabel(38_000)).toBe('+38s');
  });

  it('signs a row before the anchor, in minutes and seconds', () => {
    expect(offsetLabel(-252_000)).toBe('−4m 12s');
  });

  it('drops the seconds when a whole-minute offset has none', () => {
    expect(offsetLabel(1_320_000)).toBe('+22m');
  });

  it('renders hours and minutes once the window passes an hour', () => {
    expect(offsetLabel(3_900_000)).toBe('+1h 05m');
  });

  it('gives the anchor itself no sign', () => {
    expect(offsetLabel(0)).toBe('0s');
  });
});

describe('EventContextList', () => {
  const props = {
    profileId: undefined,
    monitorNames: new Map<string, string>(),
    isLoading: false,
    error: null,
    truncated: false,
    onWiden: undefined,
  };

  it('renders a non-anchor row with its offset', () => {
    renderList(<EventContextList {...props} rows={[row('405', -252_000), row('406', 0, true)]} />);
    expect(screen.getByTestId('event-context-row-405')).toHaveTextContent('−4m 12s');
  });

  it('labels the anchor row with what it is instead of a zero offset', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    expect(screen.getByTestId('event-context-row-406')).toHaveTextContent('events.around.this_event');
  });

  it('tints the anchor badge blue instead of the default muted chip', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    const badge = screen.getByText('events.around.this_event');
    expect(badge.className).toContain('blue');
    expect(badge.className).not.toContain('bg-muted');
  });

  it('leaves a non-anchor badge with the default muted colours', () => {
    renderList(<EventContextList {...props} rows={[row('405', -252_000)]} />);
    const badge = screen.getByText('−4m 12s');
    expect(badge.className).toContain('bg-muted');
    expect(badge.className).not.toContain('blue');
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

  it('comes back scrolled where the user left it, not at the top', async () => {
    // Opening a row unmounts this list; browser back returns to the same
    // history entry, so the position saved on the way out must come back.
    const rows = Array.from({ length: 20 }, (_, i) => row(String(500 + i), i * 1000));
    const first = renderList(<EventContextList {...props} rows={rows} />);
    const container = first.container.querySelector('.overflow-y-auto') as HTMLElement;
    container.scrollTop = 240;
    first.unmount();

    const second = renderList(<EventContextList {...props} rows={rows} />);
    const restored = second.container.querySelector('.overflow-y-auto') as HTMLElement;
    await waitFor(() => expect(restored.scrollTop).toBe(240));
  });

  it('gives the offset badge its own title, not the duration tooltip', () => {
    renderList(<EventContextList {...props} rows={[row('406', 0, true)]} />);
    expect(screen.getByText('events.around.this_event')).toHaveAttribute('title', 'events.around.offset_title');
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

  // refs #494: every row belongs to a different camera in this panel, so the
  // heading needs to say which one instead of the cause CompactEventRow
  // defaults to.
  it('heads a row with its owning monitor name', () => {
    renderList(
      <EventContextList {...props} monitorNames={new Map([['3', 'Front Door']])} rows={[row('405', -252_000)]} />
    );
    expect(screen.getByTestId('event-context-row-405')).toHaveTextContent('Front Door');
  });

  it('falls back to the monitor id when its name is not known', () => {
    renderList(<EventContextList {...props} rows={[row('405', -252_000)]} />);
    expect(within(screen.getByTestId('event-context-row-405')).getByText('3')).toBeTruthy();
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
