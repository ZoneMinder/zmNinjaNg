/**
 * View parity gate (refs #494): the maintainer's requirement is that grid and
 * list expose the same event capabilities, only presented differently. Each
 * test here renders the SAME event under the SAME profile through both
 * EventCard (list) and EventMontageView (grid) and asserts both produce the
 * same value-level outcome. A control added to one view and not the other
 * fails the matching test here, naming what's missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { EventCard } from '../EventCard';
import { EventMontageView } from '../EventMontageView';
import { setEventArchived } from '../../../api/events';
import { httpRequest } from '../../../lib/http';
// Real store, not mocked: its module scope registers services/download's
// task-store gate, the same way app startup does (refs #494).
import '../../../stores/backgroundTasks';
import { asProfileId, type Event as ZmEvent } from '../../../api/types';
import type { ScopedEventItem } from '../EventListView';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { queryKeys } from '../../../lib/query/query-keys';
import { UNRESTRICTED_PERMISSIONS } from '../../../lib/permissions/zm-permissions';
import { useEventFavoritesStore } from '../../../stores/eventFavorites';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { useEventContextStore } from '../../../stores/eventContext';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/events', search: '', state: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../EventThumbnail', () => ({
  EventThumbnail: ({ urls }: { urls: string[] }) => (
    <div data-testid="event-thumbnail" data-url={urls[0] ?? ''} />
  ),
}));

vi.mock('../EventThumbnailHoverPreview', () => ({
  EventThumbnailHoverPreview: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Stub the network boundary, not the download service: downloadEventVideo
// runs for real (through the real backgroundTasks store) so the URL it
// builds - the actual proof the right event flows through - is visible in
// httpRequest's own call args.
vi.mock('../../../lib/http', () => ({
  httpRequest: vi.fn().mockRejectedValue(new Error('no network in tests')),
  httpGet: vi.fn(),
  httpPost: vi.fn(),
  httpPut: vi.fn(),
  httpDelete: vi.fn(),
}));
vi.mock('../../../api/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/events')>();
  return { ...actual, setEventArchived: vi.fn() };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

// Same event, same profile, through both views. Videoed and Archived are on
// so the download control and the archived badge both have something to show;
// Frames/AlarmFrames/AvgScore/MaxScore are distinct so a swapped or dropped
// figure fails on its own value.
const sharedEvent = {
  Id: '701',
  MonitorId: '1',
  StorageId: null,
  SecondaryStorageId: null,
  Name: 'Driveway Motion',
  Cause: 'Motion',
  StartDateTime: '2024-01-01 10:00:00',
  EndDateTime: null,
  Width: '640',
  Height: '480',
  Length: '15',
  Frames: '42',
  AlarmFrames: '7',
  AlarmFrameId: '1',
  MaxScoreFrameId: '2',
  DefaultVideo: null,
  SaveJPEGs: '0',
  TotScore: '30',
  AvgScore: '3',
  MaxScore: '9',
  Archived: '1',
  Videoed: '1',
  Uploaded: '0',
  Emailed: '0',
  Messaged: '0',
  Executed: '0',
  Notes: null,
  StateId: null,
  Orientation: null,
  DiskSpace: null,
  Scheme: null,
} as unknown as ZmEvent;

function renderCard(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.accountPermissions(asProfileId('current')), UNRESTRICTED_PERMISSIONS);
  return render(
    <QueryClientProvider client={client}>
      <EventCard
        event={sharedEvent}
        monitorName="Front Door"
        thumbnailUrls={['https://example.test/thumb.jpg']}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    </QueryClientProvider>
  );
}

function renderTile(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.accountPermissions(asProfileId('current')), UNRESTRICTED_PERMISSIONS);
  return render(
    <QueryClientProvider client={client}>
      <EventMontageView
        events={[{ Event: sharedEvent } as ScopedEventItem]}
        monitors={[]}
        gridCols={3}
        showThumbnailLabels
        portalUrl="https://zm.example.test"
        accessToken="current-profile-token"
        batchSize={20}
        onLoadMore={vi.fn()}
      />
    </QueryClientProvider>
  );
}

/** Unmount inside act(): both views subscribe to the favourite/delete-
 *  selection stores, and tearing one down outside act reports the
 *  unsubscribe-time render as unwrapped (EventMontageView.test.tsx pattern). */
function unmount(result: ReturnType<typeof render>) {
  act(() => { result.unmount(); });
}

beforeEach(() => {
  navigate.mockClear();
  seedProfiles([makeProfile('current')], { current: 'current' });
});

afterEach(() => {
  act(() => {
    useEventFavoritesStore.setState({ profileFavorites: {} });
    useDeleteSelectionStore.getState().clear();
    useEventContextStore.setState({ anchor: null, profileId: undefined });
  });
  vi.mocked(setEventArchived).mockReset();
  vi.mocked(httpRequest).mockClear();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('grid/list view parity (refs #494)', () => {
  it('shows the same frames, alarm-frame and score figures in both views', () => {
    const card = renderCard();
    expect(screen.getByTestId('event-frames')).toHaveTextContent('42');
    expect(screen.getByTestId('event-alarm-frames')).toHaveTextContent('7');
    expect(screen.getByTestId('event-score')).toHaveTextContent('3/9');
    unmount(card);

    const tile = renderTile();
    expect(screen.getByTestId('event-frames')).toHaveTextContent('42');
    expect(screen.getByTestId('event-alarm-frames')).toHaveTextContent('7');
    expect(screen.getByTestId('event-score')).toHaveTextContent('3/9');
    unmount(tile);
  });

  it('shows the archived badge in both views for an archived event', () => {
    const card = renderCard();
    expect(screen.getByTestId('event-archived-badge')).toHaveTextContent('events.archived');
    unmount(card);

    const tile = renderTile();
    expect(screen.getByTestId('event-archived-badge')).toHaveTextContent('events.archived');
    unmount(tile);
  });

  it('offers a working download control in both views for a videoed event', async () => {
    const card = renderCard();
    fireEvent.click(screen.getByTestId('event-download-button'));
    await waitFor(() => expect(httpRequest).toHaveBeenCalledTimes(1));
    expect(decodeURIComponent(vi.mocked(httpRequest).mock.calls[0][0] as string)).toContain('eid=701');
    unmount(card);

    vi.mocked(httpRequest).mockClear();

    const tile = renderTile();
    fireEvent.click(screen.getByTestId('event-download-button'));
    await waitFor(() => expect(httpRequest).toHaveBeenCalledTimes(1));
    expect(decodeURIComponent(vi.mocked(httpRequest).mock.calls[0][0] as string)).toContain('eid=701');
    unmount(tile);
  });

  it('highlights both views the same way when the event is queued for deletion', () => {
    useDeleteSelectionStore.setState({ selectedKeys: [eventSelectionKey(asProfileId('current'), '701')] });

    const card = renderCard();
    expect(screen.getByTestId('event-card').className).toContain('bg-destructive/10');
    expect(screen.getByTestId('event-card').className).toContain('opacity-60');
    unmount(card);

    const tile = renderTile();
    expect(screen.getByTestId('event-montage-tile').className).toContain('bg-destructive/10');
    expect(screen.getByTestId('event-montage-tile').className).toContain('opacity-60');
    unmount(tile);
  });

  it('does not highlight either view when the event is not queued for deletion', () => {
    const card = renderCard();
    expect(screen.getByTestId('event-card').className).not.toContain('bg-destructive/10');
    unmount(card);

    const tile = renderTile();
    expect(screen.getByTestId('event-montage-tile').className).not.toContain('bg-destructive/10');
    unmount(tile);
  });

  it('toggles the same favourite in both views', async () => {
    const card = renderCard();
    await act(async () => { fireEvent.click(screen.getByTestId('event-favorite-button')); });
    expect(useEventFavoritesStore.getState().isFavorited(asProfileId('current'), '701')).toBe(true);
    unmount(card);

    act(() => { useEventFavoritesStore.setState({ profileFavorites: {} }); });

    const tile = renderTile();
    await act(async () => { fireEvent.click(screen.getByTestId('event-favorite-button')); });
    expect(useEventFavoritesStore.getState().isFavorited(asProfileId('current'), '701')).toBe(true);
    unmount(tile);
  });

  it('queues the same event for deletion from both views', async () => {
    const card = renderCard();
    await act(async () => { fireEvent.click(screen.getByTestId('event-delete-button')); });
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(asProfileId('current'), '701')]);
    unmount(card);

    act(() => { useDeleteSelectionStore.getState().clear(); });

    const tile = renderTile();
    await act(async () => { fireEvent.click(screen.getByTestId('event-delete-button')); });
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(asProfileId('current'), '701')]);
    unmount(tile);
  });

  it('archives the same event from both views', async () => {
    vi.mocked(setEventArchived).mockResolvedValue(undefined);

    const card = renderCard();
    fireEvent.click(screen.getByTestId('event-archive-button'));
    await waitFor(() => expect(setEventArchived).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setEventArchived).mock.calls[0][1]).toBe('701');
    unmount(card);

    vi.mocked(setEventArchived).mockClear();

    const tile = renderTile();
    fireEvent.click(screen.getByTestId('event-archive-button'));
    await waitFor(() => expect(setEventArchived).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setEventArchived).mock.calls[0][1]).toBe('701');
    unmount(tile);
  });

  it('opens the around-this-event panel for the same event from both views', () => {
    const card = renderCard();
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(useEventContextStore.getState().anchor?.Event.Id).toBe('701');
    unmount(card);

    act(() => { useEventContextStore.setState({ anchor: null, profileId: undefined }); });

    const tile = renderTile();
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(useEventContextStore.getState().anchor?.Event.Id).toBe('701');
    unmount(tile);
  });
});
