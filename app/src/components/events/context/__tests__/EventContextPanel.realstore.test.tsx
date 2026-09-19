/**
 * Regression test for the around-this-event render loop (refs #494).
 *
 * `EventContextPanel` reads its settings with
 * `useSettingsStore(useShallow((s) => s.getProfileSettings(id)))`. That merge
 * runs on every read, so a coercion that rebuilds `eventContext` each time
 * hands the shallow compare a new nested identity on every call, and
 * `useSyncExternalStore` re-renders until React throws "Maximum update depth
 * exceeded". A profile written with a half-shaped blob, or one still
 * carrying a retired key such as `view`, is exactly the kind of value that
 * can trip that repair.
 *
 * Has to render against the REAL settings store, seeded the way rehydration
 * seeds it (raw, unmerged): a test double that calls `selector(state)`
 * directly bypasses `useSyncExternalStore` and cannot catch this class of bug.
 * See the testing playbook, "Regression tests for store-subscription bugs".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { useEventContextStore } from '../../../../stores/eventContext';
import { EventContextPanel } from '../EventContextPanel';
import { EventContextButton } from '../EventContextButton';
import {
  seedProfiles,
  resetProfileFixture,
  makeProfile,
  asProfileId,
  fakeApiClient,
} from '../../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { useSettingsStore, type ProfileSettings } from '../../../../stores/settings';

const P1 = asProfileId('p1');

const anchorEvent = {
  Id: '406',
  MonitorId: '3',
  Name: 'Front Door',
  StartDateTime: '2026-09-17 21:14:03',
  EndDateTime: '2026-09-17 21:14:41',
  Length: '38.00',
} as never;

function emptyServer() {
  return fakeApiClient({
    '/monitors.json': { monitors: [] },
    '/groups.json': { groups: [] },
    '/events/index': { events: [], pagination: { count: 0 } },
  });
}

/** Writes the profile's settings bucket the way `persist` rehydration does:
 *  straight into the store, never through `mergeProfileSettings`, so the
 *  pre-`view` shape is what the selector actually reads. */
function seedRawEventContext(raw: unknown) {
  useSettingsStore.setState({
    profileSettings: {
      [P1]: { eventContext: raw } as unknown as ProfileSettings,
    },
  });
}

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

function expectsNoRenderLoop(onError: ReturnType<typeof vi.spyOn>) {
  const looped = onError.mock.calls.some((args) =>
    args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded'))
  );
  expect(looped).toBe(false);
}

describe('EventContextPanel - real store render loop regression (refs #494)', () => {
  it('opens on a minimal persisted blob without looping', async () => {
    seedProfiles([makeProfile('p1')]);
    seedRawEventContext({ windowMinutes: 30, scope: 'linked' });
    installApiClient(P1, emptyServer());

    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EventContextButton event={anchorEvent} profileId={P1} />
          <EventContextPanel />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-empty');

    // The window the user saved still comes back.
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'true');
    expectsNoRenderLoop(onError);

    // Closing now goes back a history entry, and react-router wraps a
    // location update in startTransition; act() keeps that inside the test.
    act(() => { fireEvent.click(screen.getByTestId('event-context-close')); });
    onError.mockRestore();
  });

  it('opens on a blob that still carries the now-unknown `view` key without looping', async () => {
    seedProfiles([makeProfile('p1')]);
    seedRawEventContext({ windowMinutes: 30, scope: 'linked', view: 'graph' });
    installApiClient(P1, emptyServer());

    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EventContextButton event={anchorEvent} profileId={P1} />
          <EventContextPanel />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByTestId('event-context-open'));
    await screen.findByTestId('event-context-empty');

    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'true');
    expectsNoRenderLoop(onError);

    // Closing now goes back a history entry, and react-router wraps a
    // location update in startTransition; act() keeps that inside the test.
    act(() => { fireEvent.click(screen.getByTestId('event-context-close')); });
    onError.mockRestore();
  });
});
