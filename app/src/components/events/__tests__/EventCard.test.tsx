import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { EventCard } from '../EventCard';
import { setEventArchived } from '../../../api/events';
import { asProfileId } from '../../../api/types';
import { toast } from 'sonner';
import { createHttpError } from '../../../lib/http/types';
import { usePermissionDenialStore } from '../../../stores/permissions';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

const navigate = vi.fn();
// Calls through: the assertion is that the list gets refreshed, not that it doesn't.
const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock('../../../api/events', () => ({ setEventArchived: vi.fn() }));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  // EventContextButton (the "Nearby" trigger) also reads useLocation to push
  // a history entry when it opens the panel (refs #494); a stub missing it
  // throws the moment that button mounts, not just when it's clicked.
  useLocation: () => ({ pathname: '/events', search: '', state: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, eventCard: vi.fn() } };
});

// Base event object with all required fields. Accepts overrides for specific fields.
const baseEvent = {
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

function makeEvent(overrides: Partial<typeof baseEvent>) {
  return { ...baseEvent, ...overrides };
}

function renderEventCard(
  eventOverrides: Partial<typeof baseEvent> = {},
  props: Record<string, unknown> = {},
) {
  return renderWithClient(
    <EventCard
      {...props}
      event={makeEvent(eventOverrides)}
      monitorName="Front Door"
      thumbnailUrls={['https://example.test/thumb.jpg']}
      thumbnailWidth={160}
      thumbnailHeight={120}
    />
  );
}

describe('EventCard', () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it('renders event details and thumbnail', () => {
    renderWithClient(
      <EventCard
        event={{
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
        }}
        monitorName="Front Door"
        thumbnailUrls={["https://example.test/thumb.jpg"]}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    expect(screen.getByTestId('event-card')).toBeInTheDocument();
    expect(screen.getByTestId('event-thumbnail')).toBeInTheDocument();
    expect(screen.getByTestId('event-monitor-name')).toHaveTextContent('Front Door');
  });

  it('navigates to event details on click', () => {
    renderWithClient(
      <EventCard
        event={{
          Id: '202',
          MonitorId: '1',
          StorageId: null,
          SecondaryStorageId: null,
          Name: 'Door',
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
        }}
        monitorName="Front Door"
        thumbnailUrls={["https://example.test/thumb.jpg"]}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    fireEvent.click(screen.getByTestId('event-card'));

    expect(navigate).toHaveBeenCalledWith('/events/202', { state: { from: '/events', eventFilters: undefined } });
  });

  it('navigates to the /all/ deep route and renders a profile chip when profileId is given (refs #337)', () => {
    renderWithClient(
      <EventCard
        event={{
          Id: '303',
          MonitorId: '1',
          StorageId: null,
          SecondaryStorageId: null,
          Name: 'Door',
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
        }}
        monitorName="Front Door"
        profileId={'profile-b' as never}
        profileChip="Office"
        thumbnailUrls={["https://example.test/thumb.jpg"]}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    expect(screen.getByTestId('event-profile-chip')).toHaveTextContent('Office');

    fireEvent.click(screen.getByTestId('event-card'));

    expect(navigate).toHaveBeenCalledWith('/all/events/profile-b/303', { state: { from: '/events', eventFilters: undefined } });
  });

  // refs #337 round 2: All-mode's camera filter stores composite
  // `${profileId}:${monitorId}` tokens (I6) in the shared eventFilters
  // object handed to every row. Riding that straight into nav state sends
  // a bogus `MonitorId:profile-b:3` segment to getAdjacentEvent - stripped
  // here to just this row's OWN bare ids before it reaches navigate().
  it('strips composite monitor tokens down to this row\'s own bare ids in the nav state (refs #337 round 2)', () => {
    renderWithClient(
      <EventCard
        event={makeEvent({ Id: '405' })}
        monitorName="Front Door"
        profileId={'profile-b' as never}
        eventFilters={{ monitorId: 'profile-a:1,profile-b:3' }}
        thumbnailUrls={['https://example.test/thumb.jpg']}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    fireEvent.click(screen.getByTestId('event-card'));

    expect(navigate).toHaveBeenCalledWith('/all/events/profile-b/405', {
      state: { from: '/events', eventFilters: { monitorId: '3' } },
    });
  });

  it('leaves bare eventFilters.monitorId untouched in single mode (byte-identical, refs #337 round 2)', () => {
    renderWithClient(
      <EventCard
        event={makeEvent({ Id: '406' })}
        monitorName="Front Door"
        eventFilters={{ monitorId: '5' }}
        thumbnailUrls={['https://example.test/thumb.jpg']}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    fireEvent.click(screen.getByTestId('event-card'));

    expect(navigate).toHaveBeenCalledWith('/events/406', {
      state: { from: '/events', eventFilters: { monitorId: '5' } },
    });
  });

  it('shows a relative-time chip for a recent event', () => {
    const recent = new Date(Date.now() - 40 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${recent.getFullYear()}-${pad(recent.getMonth() + 1)}-${pad(recent.getDate())} ${pad(recent.getHours())}:${pad(recent.getMinutes())}:${pad(recent.getSeconds())}`;
    renderEventCard({ StartDateTime: start });
    expect(screen.getByTestId('event-relative-time')).toBeInTheDocument();
  });

  it('hides the relative-time chip for an event older than the window', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())} ${pad(old.getHours())}:${pad(old.getMinutes())}:${pad(old.getSeconds())}`;
    renderEventCard({ StartDateTime: start });
    expect(screen.queryByTestId('event-relative-time')).not.toBeInTheDocument();
  });
});

/**
 * Archiving needs Events: Edit (refs #344).
 *
 * One greyed button per card, not one note per card: the explanation belongs on
 * the control that stopped working, and a note repeated down a scrolling list
 * would be noise.
 */
describe('EventCard without permission to archive', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('greys the archive control when ZoneMinder denies editing', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(asProfileId('p1'), fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Events: 'View' } }] } }));

    renderEventCard({}, { profileId: asProfileId('p1') });

    await waitFor(() => expect(screen.getByTestId('event-archive-button')).toHaveAttribute('aria-disabled', 'true'));
  });

  it('leaves it alone at Edit', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(asProfileId('p1'), fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Events: 'Edit' } }] } }));

    renderEventCard({}, { profileId: asProfileId('p1') });

    await waitFor(() => expect(screen.getByTestId('event-archive-button')).not.toHaveAttribute('aria-disabled'));
  });

  it('leaves it alone while the permission is unknown', () => {
    // No profile seeded for this id: usePermissions(p1) sees no real profile
    // (isReal but not authenticated), so its query never runs and the
    // verdict stays unknown - never denied.
    renderEventCard({}, { profileId: asProfileId('p1') });

    expect(screen.getByTestId('event-archive-button')).not.toHaveAttribute('aria-disabled');
  });
});

/**
 * When the account is too restricted to be gated in advance (refs #344).
 *
 * An account that cannot read its own permissions - System='None', which is
 * every account below System View - leaves canEditEvents at 'unknown', so the
 * archive control is deliberately left alone. The refusal is then the only
 * thing that can teach anyone anything, so it has to be spent well: say what
 * actually happened, and do not make the user discover it twice.
 */
describe('EventCard when ZoneMinder refuses the archive', () => {
  const privilegeRefusal = createHttpError(
    401,
    'Unauthorized',
    { success: false, data: { name: 'Insufficient Privileges' } },
    {},
  );

  beforeEach(() => {
    usePermissionDenialStore.setState({ denied: {} });
    vi.mocked(setEventArchived).mockReset();
    invalidateQueries.mockClear();
    // No username: usePermissions resolves UNRESTRICTED_PERMISSIONS with no
    // network call, so nothing here is pre-gated - only the server's refusal
    // (mocked per test below) decides the outcome, matching this describe's
    // "gated only by ZoneMinder's own answer" premise.
    seedProfiles([makeProfile('p1')]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('names the permission instead of blaming the archive', async () => {
    vi.mocked(setEventArchived).mockRejectedValue(privilegeRefusal);

    renderEventCard({}, { profileId: asProfileId('p1') });
    fireEvent.click(screen.getByTestId('event-archive-button'));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('events.archive_permission_denied'),
    );
  });

  it('greys the control afterwards so the refusal is spent once', async () => {
    vi.mocked(setEventArchived).mockRejectedValue(privilegeRefusal);

    renderEventCard({}, { profileId: asProfileId('p1') });
    fireEvent.click(screen.getByTestId('event-archive-button'));

    await waitFor(() =>
      expect(screen.getByTestId('event-archive-button')).toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('leaves the control alone when the failure was not about permission', async () => {
    // A timeout says nothing about the account, and greying on it would take
    // archiving away from someone who has it.
    vi.mocked(setEventArchived).mockRejectedValue(new Error('Failed to fetch'));

    renderEventCard({}, { profileId: asProfileId('p1') });
    fireEvent.click(screen.getByTestId('event-archive-button'));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('events.archive_failed'));
    expect(screen.getByTestId('event-archive-button')).not.toHaveAttribute('aria-disabled');
  });

  it('says the event is gone rather than blaming the archive, and drops the stale card', async () => {
    // A server that prunes deletes events under an open list, so the card is
    // still on screen when the write goes out. ZoneMinder answers 404.
    vi.mocked(setEventArchived).mockRejectedValue(createHttpError(404, 'Not Found', {}, {}));

    renderEventCard({}, { profileId: asProfileId('p1') });
    fireEvent.click(screen.getByTestId('event-archive-button'));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('events.event_gone'));
    // The list refetches, which is what takes the ghost off screen.
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
    expect(screen.getByTestId('event-archive-button')).not.toHaveAttribute('aria-disabled');
  });

  it('shows the restore icon on an archived event, and the plain one otherwise', () => {
    // Shape rather than fill: a solid archive box loses its lid and reads as a
    // blob, and colour alone leaves nothing for a colourblind reader.
    const { unmount } = renderEventCard({ Archived: '1' }, { profileId: asProfileId('p1') });
    expect(screen.getByTestId('event-archive-icon-on')).toBeInTheDocument();
    expect(screen.queryByTestId('event-archive-icon-off')).not.toBeInTheDocument();
    unmount();

    renderEventCard({ Archived: '0' }, { profileId: asProfileId('p1') });
    expect(screen.getByTestId('event-archive-icon-off')).toBeInTheDocument();
  });
});
