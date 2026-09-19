import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { useEventContextStore, type EventContextHistoryState } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';
import { seedProfiles, resetProfileFixture, makeProfile, asProfileId, fakeApiClient } from '../../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { useSettingsStore } from '../../../../stores/settings';
import type { Event } from '../../../../api/types';

// EventContextButton reads usePermissions (useQuery) unconditionally, same as
// the sibling event-action buttons (EventDeleteButton, EventCard tests).
// The panel is itself a history entry (refs #494), so every render needs a
// real Router - a plain MemoryRouter, not the module mock the rest of the
// app's tests use for a no-op useNavigate.
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Test-only trigger for a route change: stands in for back/forward, a
 *  programmatic navigate elsewhere in the app, or a typed URL. */
function NavigateAway() {
  const navigate = useNavigate();
  return <button data-testid="navigate-away" onClick={() => navigate('/elsewhere')} />;
}

/** Test-only stand-in for the browser/Android back gesture. */
function GoBack() {
  const navigate = useNavigate();
  return <button data-testid="go-back" onClick={() => navigate(-1)} />;
}

/** Renders the current entry's `eventContextAnchor`, or "none": proves what
 *  the current history entry carries without a navigate spy, which only
 *  proves something was called (per the testing playbook). */
function LocationProbe() {
  const anchor = (useLocation().state as EventContextHistoryState | null)?.eventContextAnchor;
  return <div data-testid="location-anchor-probe">{anchor ? anchor.eventId : 'none'}</div>;
}

/** Empty monitors/groups/events: enough for useEventsAround to settle without
 *  a scope becoming available, which isn't what these tests are checking. */
function emptyServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [] },
    '/groups.json': { groups: [] },
    '/events/index': { events: [], pagination: { count: 0 } },
  });
}

/** One camera, two events a minute apart: enough for the list to offer a
 *  second row the anchor's own panel can navigate to. */
function twoEventsServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Front Door' } }] },
    '/groups.json': { groups: [] },
    '/events/index': {
      events: [{ Event: event }, { Event: event2 }],
      pagination: { count: 2 },
    },
  });
}

const event = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
} as unknown as Event;

const event2 = {
  Id: '407',
  MonitorId: '3',
  Name: 'Back Door',
  StartDateTime: '2026-09-17 21:15:03',
  EndDateTime: '2026-09-17 21:15:41',
  Length: '38.00',
} as unknown as Event;

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

afterEach(() => {
  // react-router wraps every location update in startTransition; unmounting
  // outside act() (resetProfileFixture's own plain cleanup(), which runs
  // after this) reports one as never having been wrapped, even though every
  // interaction above went through fireEvent. Force it here, first, so it
  // lands inside an act() this suite controls (refs #494).
  act(() => { cleanup(); });
  useEventContextStore.getState().closePanel();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventContextPanel', () => {
  it('stays closed until something opens it', () => {
    render(
      <MemoryRouter>
        <EventContextPanel />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('event-context-panel')).toBeNull();
  });

  it('opens on the trigger, names the anchor event, and pushes a history entry for it', () => {
    renderWithClient(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
        <LocationProbe />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    expect(screen.getByTestId('event-context-anchor')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('location-anchor-probe')).toHaveTextContent('406');
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('closing goes back one entry rather than leaving it behind', () => {
    renderWithClient(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
        <LocationProbe />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    fireEvent.click(screen.getByTestId('event-context-close'));
    expect(screen.queryByTestId('event-context-panel')).toBeNull();
    // The entry the close popped back to carries no anchor: closing didn't
    // just hide the sheet, it actually consumed the panel's own entry.
    expect(screen.getByTestId('location-anchor-probe')).toHaveTextContent('none');
    // The store keeps the anchor payload after close: it's the same event a
    // later back navigation into the panel's entry (if one still existed)
    // would need, and clearing it here would just have to be redone on open.
    expect(useEventContextStore.getState().anchor?.Event.Id).toBe('406');
  });

  it('dismisses on Escape the same way the close button does', () => {
    renderWithClient(
      <>
        <EventContextButton event={event} />
        <EventContextPanel />
        <LocationProbe />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByTestId('event-context-panel')).toBeNull();
    expect(screen.getByTestId('location-anchor-probe')).toHaveTextContent('none');
  });

  it('opens on the anchor profile\'s own saved window and scope', async () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 30, scope: 'linked' } } } });
    installApiClient(P1, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    // useEventsAround's monitors/groups/events queries resolve through the
    // real fakeApiClient; wait for them to settle (the empty-scope list) so
    // no state update from the resolved queries escapes act().
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('re-seeds from the newly opened profile, not whatever the panel showed before', async () => {
    seedProfiles([makeProfile('p1'), makeProfile('p2')], {
      settings: {
        p1: { eventContext: { windowMinutes: 10, scope: 'all' } },
        p2: { eventContext: { windowMinutes: 60, scope: 'group' } },
      },
    });
    installApiClient(P1, emptyServer());
    installApiClient(P2, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextButton event={event2} profileId={P2} />
        <EventContextPanel />
      </>
    );
    const [openP1, openP2] = screen.getAllByTestId('event-context-open');

    fireEvent.click(openP1);
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));

    fireEvent.click(openP2);
    await screen.findByTestId('event-context-empty');
    expect(screen.getByTestId('event-context-window-60')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('falls back to every camera, visibly, when the anchor cannot offer the saved scope', async () => {
    // A saved default of `linked` is reachable from Settings, but this monitor
    // has no LinkedMonitors, so resolveScopeMonitorIds drops the filter and
    // the window covers every camera. The pressed chip has to say so rather
    // than reading Linked over an all-cameras result (refs #494).
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 10, scope: 'linked' } } } });
    installApiClient(
      P1,
      fakeApiClient({
        '/monitors.json': { monitors: [{ Monitor: { Id: '3', Name: 'Front Door', LinkedMonitors: '' } }] },
        '/groups.json': { groups: [] },
        '/events/index': { events: [], pagination: { count: 0 } },
      })
    );
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-empty');

    expect(screen.getByTestId('event-context-scope-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-scope-linked')).toHaveAttribute('aria-pressed', 'false');

    // The fallback is about this anchor, not about the user's default: a
    // window change made while it shows must not write `all` back to settings.
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(useSettingsStore.getState().getProfileSettings(P1).eventContext).toEqual({
      windowMinutes: 30,
      scope: 'linked',
    });
    fireEvent.click(screen.getByTestId('event-context-close'));
  });

  it('closes on a route change instead of outliving the page it opened over', async () => {
    seedProfiles([makeProfile('p1')]);
    installApiClient(P1, emptyServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
        <NavigateAway />
      </>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-empty');

    fireEvent.click(screen.getByTestId('navigate-away'));

    // A route pushed with no eventContextAnchor of its own (elsewhere in the
    // app, a typed URL) is simply an entry the panel's `open` derivation
    // doesn't recognise - no dedicated effect needed to close it.
    expect(screen.queryByTestId('event-context-panel')).toBeNull();
  });
});

describe('EventContextPanel history navigation (refs #494)', () => {
  it('reopens on the same anchor, window and scope after going back from an event opened inside it', async () => {
    seedProfiles([makeProfile('p1')], { settings: { p1: { eventContext: { windowMinutes: 10, scope: 'all' } } } });
    installApiClient(P1, twoEventsServer());
    renderWithClient(
      <>
        <EventContextButton event={event} profileId={P1} />
        <EventContextPanel />
        <GoBack />
      </>
    );

    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId(`event-context-row-${event2.Id}`);

    // A row's own navigate (CompactEventRow) takes the user to that event,
    // pushing forward. The panel isn't that entry's own, so it closes.
    const row = within(screen.getByTestId(`event-context-row-${event2.Id}`));
    fireEvent.click(row.getByTestId('compact-event-row'));
    expect(screen.queryByTestId('event-context-panel')).toBeNull();

    // Back returns to the panel's own entry: the anchor, window and scope
    // are exactly what they were (window/scope come back from the anchor
    // profile's own settings, unchanged by the trip to the other event).
    fireEvent.click(screen.getByTestId('go-back'));
    expect(await screen.findByTestId('event-context-anchor')).toHaveTextContent(event.Name);
    await screen.findByTestId(`event-context-row-${event2.Id}`);
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-scope-all')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('event-context-close'));
  });
});
