import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventContextList, offsetLabel } from '../EventContextList';

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
    expect(screen.getByTestId('event-context-row-406')).toHaveAttribute('aria-current', 'true');
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
});
