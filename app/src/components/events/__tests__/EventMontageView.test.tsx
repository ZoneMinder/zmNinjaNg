import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { EventMontageView } from '../EventMontageView';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useEventContextStore } from '../../../stores/eventContext';
import { RETURN_FLASH_MS } from '../../../lib/zmninja-ng-constants';
import { downloadEventVideo } from '../../../services/download';
import { clearAllServerMaps, setServerMap } from '../../../lib/zm/server-resolver';
import { asProfileId, type EventData } from '../../../api/types';
import type { ScopedEventItem } from '../EventListView';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { queryKeys } from '../../../lib/query/query-keys';
import { UNRESTRICTED_PERMISSIONS } from '../../../lib/permissions/zm-permissions';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  // EventContextButton (the "Nearby" trigger) also reads useLocation to push
  // a history entry when it opens the panel (refs #494); a stub missing it
  // throws the moment that button mounts, not just when it's clicked.
  useLocation: () => ({ pathname: '/events', search: '', state: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: (d: Date) => d.toISOString() }),
}));

// Per-row owning-profile resolution (EventItem pattern, refs #337 Task 2):
// useProfileById/useFreshAccessToken (now real) return profile-specific
// portal/token when given a profileId, and the current profile's otherwise.
const THUMBNAIL_CHAIN = [{ type: 'snapshot' as const, enabled: true }];
const PROFILE_SETTINGS = { thumbnailFallbackChain: THUMBNAIL_CHAIN, forceDisableMultiPort: false, hoverPreview: { eventsGrid: false } as never };

vi.mock('../EventThumbnail', () => ({
  EventThumbnail: ({ urls }: { urls: string[] }) => (
    <div data-testid="event-thumbnail" data-url={urls[0] ?? ''} />
  ),
}));

vi.mock('../EventThumbnailHoverPreview', () => ({
  EventThumbnailHoverPreview: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../services/download', () => ({ downloadEventVideo: vi.fn() }));

// EventData is a wrapper: { Event: {...} }. These are the inner Event fields.
const baseEventFields = {
  Id: '101',
  MonitorId: '1',
  StorageId: null,
  SecondaryStorageId: null,
  Name: 'Motion Event',
  Cause: 'Motion',
  StartDateTime: '2024-01-01 10:00:00',
  EndDateTime: null,
  Width: '640',
  Height: '480',
  Length: '12',
  Frames: '120',
  AlarmFrames: '5',
  AlarmFrameId: '1',
  MaxScoreFrameId: '2',
  DefaultVideo: null,
  SaveJPEGs: '0',
  TotScore: '10',
  AvgScore: '1',
  MaxScore: '3',
  Archived: '0',
  Videoed: '0',
  Uploaded: '0',
  Emailed: '0',
  Messaged: '0',
  Executed: '0',
  Notes: null,
  StateId: null,
  Orientation: null,
  DiskSpace: null,
  Scheme: null,
};

// ZoneMinder StartDateTime format: 'YYYY-MM-DD HH:mm:ss' (space, local time).
function toZmDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function eventWithId(id: string): EventData {
  return { Event: { ...baseEventFields, Id: id } } as unknown as EventData;
}

/** A ScopedEventItem tagged with an owning profile, as Events.tsx builds them
 *  in All mode (refs #337 Task 2). */
function scopedEvent(id: string, profileId: string, profileChip: string, overrides: Partial<typeof baseEventFields> = {}): ScopedEventItem {
  return {
    Event: { ...baseEventFields, ...overrides, Id: id },
    profileId,
    profileChip,
  } as unknown as ScopedEventItem;
}

function renderEvents(events: EventData[], monitors: Array<{ Monitor: { Id: string; ServerId?: string | null }; profileId?: string }> = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // EventContextButton's usePermissions probes account permissions on mount.
  // Pre-seeding the (infinitely fresh, per usePermissions) cache means that
  // probe resolves synchronously from cache instead of settling one
  // microtask after render, which would otherwise warn outside act().
  client.setQueryData(queryKeys.accountPermissions(asProfileId('current')), UNRESTRICTED_PERMISSIONS);
  client.setQueryData(queryKeys.accountPermissions(asProfileId('profile-b')), UNRESTRICTED_PERMISSIONS);
  return render(
    <QueryClientProvider client={client}>
      <EventMontageView
        events={events as ScopedEventItem[]}
        monitors={monitors as never}
        gridCols={3}
        thumbnailFit="contain"
        portalUrl="https://zm.example.test"
        accessToken="current-profile-token"
        batchSize={20}
        onLoadMore={vi.fn()}
        eventFilters={{ monitorId: '1' } as never}
      />
    </QueryClientProvider>
  );
}

function renderMontage(startDateTime: string) {
  return renderEvents([{ Event: { ...baseEventFields, StartDateTime: startDateTime } } as unknown as EventData]);
}

// Reset before, not after: Testing Library unmounts between tests, so by the
// time this runs no tile is mounted to re-render outside act().
beforeEach(() => {
  navigate.mockClear();
  useReturnHighlightStore.setState({ lastViewedEventId: null });
  seedProfiles([makeProfile('current'), makeProfile('profile-b', { portalUrl: 'https://profile-b.test' })], {
    current: 'current',
    settings: { current: PROFILE_SETTINGS, 'profile-b': PROFILE_SETTINGS },
  });
});

// Server maps are module-global state (server-resolver.ts); clear after
// every test so a later test never sees a map a previous one registered.
afterEach(() => {
  clearAllServerMaps();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventMontageView relative time (grid view)', () => {
  it('shows a relative-time label for a recent event', () => {
    renderMontage(toZmDate(new Date(Date.now() - 40 * 60_000)));
    expect(screen.getByTestId('event-montage-relative-time')).toBeInTheDocument();
  });

  it('hides the relative-time label for an event older than the window', () => {
    renderMontage(toZmDate(new Date(Date.now() - 30 * 24 * 60 * 60_000)));
    expect(screen.queryByTestId('event-montage-relative-time')).not.toBeInTheDocument();
  });
});

describe('EventMontageView return highlight (grid view)', () => {
  it('records the opened event and navigates when a tile is clicked', () => {
    renderEvents([eventWithId('101')]);

    fireEvent.click(screen.getByTestId('event-montage-tile'));

    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('101');
    expect(navigate).toHaveBeenCalledWith('/events/101', {
      state: { from: '/events', eventFilters: { monitorId: '1' } },
    });
  });

  it('flashes the arrow only on the tile the user returned from', () => {
    useReturnHighlightStore.setState({ lastViewedEventId: '102' });

    renderEvents([eventWithId('101'), eventWithId('102'), eventWithId('103')]);

    const arrows = screen.getAllByTestId('return-flash-indicator');
    expect(arrows).toHaveLength(1);
    // The arrow is a sibling of the Card, not a child: the Card clips its
    // overflow, and the arrow has to straddle the tile's top edge. It must
    // still belong to the returned-from tile's wrapper.
    const wrapper = arrows[0].parentElement;
    expect(wrapper?.querySelector('[data-event-id="102"]')).not.toBeNull();
    expect(wrapper?.querySelector('[data-event-id="101"]')).toBeNull();
  });

  it('clears the arrow after RETURN_FLASH_MS', () => {
    vi.useFakeTimers();
    try {
      useReturnHighlightStore.setState({ lastViewedEventId: '101' });
      renderEvents([eventWithId('101')]);
      expect(screen.getByTestId('return-flash-indicator')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(RETURN_FLASH_MS + 1);
      });

      expect(screen.queryByTestId('return-flash-indicator')).not.toBeInTheDocument();
      expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// All-mode per-tile owning-profile wiring (refs #337 Task 2): each tile must
// build ITS OWN event's owning profile's portal URL and token, exactly like
// EventListView's EventItem, rather than the page-level current-profile
// defaults (which reflect no/whatever profile is current in All mode).
describe('EventMontageView all-mode owning-profile wiring (refs #337 Task 2)', () => {
  it("builds profile B's tile with profile B's portal and token while the page-level default is profile A's", () => {
    renderEvents([scopedEvent('201', 'profile-b', 'Office')]);

    const thumb = screen.getByTestId('event-thumbnail');
    const url = decodeURIComponent(thumb.getAttribute('data-url') ?? '');
    expect(url).toContain('https://profile-b.test');
    expect(url).not.toContain('zm.example.test');
  });

  it('renders the owning profile chip with the shared list-view testid', () => {
    renderEvents([scopedEvent('202', 'profile-b', 'Office')]);

    expect(screen.getByTestId('event-profile-chip')).toHaveTextContent('Office');
  });

  it('renders no profile chip in single mode (profileId undefined)', () => {
    renderEvents([eventWithId('203')]);

    expect(screen.queryByTestId('event-profile-chip')).not.toBeInTheDocument();
  });

  it("the video download button uses the tile's own owning-profile portal and token, not the page-level default", async () => {
    renderEvents([scopedEvent('204', 'profile-b', 'Office', { Videoed: '1' })]);

    fireEvent.click(screen.getByTestId('event-download-button'));
    // The click handler is async (haptics await before calling
    // downloadEventVideo); flush the microtask queue.
    await act(async () => {});

    expect(downloadEventVideo).toHaveBeenCalledTimes(1);
    const [portalUrl, eventId, , accessToken] = vi.mocked(downloadEventVideo).mock.calls[0];
    expect(portalUrl).toContain('https://profile-b.test');
    expect(eventId).toBe('204');
    expect(accessToken).toBe('access-profile-b');
  });

  it('single-mode tile still uses the page-level portal and token unchanged (byte-identical)', () => {
    renderEvents([eventWithId('205')]);

    const thumb = screen.getByTestId('event-thumbnail');
    const url = decodeURIComponent(thumb.getAttribute('data-url') ?? '');
    expect(url).toContain('https://zm.example.test');
  });

  // Fix round 1: the tile now subscribes to the server map directly (instead
  // of the parent's monitorMap useMemo busting on a serverMapVersion dep it
  // never read) - this proves that subscription still refreshes a mounted
  // tile's URL when the server map arrives late, not just that the lint
  // warning went away.
  it("refreshes an already-mounted tile's thumbnail URL when the server map arrives after first render", () => {
    renderEvents(
      [scopedEvent('301', 'profile-b', 'Office')],
      [{ Monitor: { Id: '1', ServerId: 'srv-1' }, profileId: 'profile-b' }]
    );

    // Before the server map arrives: falls back to profile-b's own portal.
    const before = decodeURIComponent(screen.getByTestId('event-thumbnail').getAttribute('data-url') ?? '');
    expect(before).toContain('https://profile-b.test');

    act(() => {
      setServerMap(
        new Map([['srv-1', { recordingUrl: '', portalPath: 'https://srv1.example.test/index.php', apiBaseUrl: '' }]]),
        asProfileId('profile-b')
      );
    });

    const after = decodeURIComponent(screen.getByTestId('event-thumbnail').getAttribute('data-url') ?? '');
    expect(after).toContain('https://srv1.example.test');
  });
});

// The around-this-event trigger (refs #494 Task 9): reuses EventContextButton
// rather than duplicating its open/permission logic, so these tests only need
// to prove the tile wires it to its OWN owning profile and that opening it
// pushes a history entry for the current location rather than routing the
// tile to the event (refs #494 navigation follow-up).
describe('EventMontageView around-this-event trigger (refs #494 Task 9)', () => {
  afterEach(() => {
    useEventContextStore.setState({ anchor: null, profileId: undefined });
  });

  it('offers the around-this-event button on a montage tile and opens the panel for the tile\'s own owning profile', () => {
    renderEvents([scopedEvent('401', 'profile-b', 'Office')]);

    fireEvent.click(screen.getByTestId('event-context-open'));

    const state = useEventContextStore.getState();
    expect(state.anchor?.Event.Id).toBe('401');
    expect(state.profileId).toBe('profile-b');
  });

  it('pushes a history entry for the anchor instead of routing the tile to the event', () => {
    renderEvents([eventWithId('402')]);

    fireEvent.click(screen.getByTestId('event-context-open'));

    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/events', search: '' },
      { state: { eventContextAnchor: { eventId: '402', profileId: 'current' } } }
    );
  });
});
