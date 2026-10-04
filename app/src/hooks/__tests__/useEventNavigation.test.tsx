import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockNavigate = vi.fn();
const mockLocation = { state: undefined as unknown };

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../../api/events', async () => {
  const actual = await vi.importActual<typeof import('../../api/events')>('../../api/events');
  return { ...actual, getAdjacentEvent: vi.fn() };
});
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useEventNavigation } from '../useEventNavigation';
import * as eventsApi from '../../api/events';
import type { EventData } from '../../api/types';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useReturnHighlightStore } from '../../stores/returnHighlight';

const getAdjacentEvent = vi.mocked(eventsApi.getAdjacentEvent);

function makeEvent(id: string) {
  return { Event: { Id: id, StartDateTime: '2026-07-18 10:00:00' } } as EventData;
}

describe('useEventNavigation.goToNextEvent', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    getAdjacentEvent.mockReset();
    mockLocation.state = undefined;
    seedProfiles(['p1']);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('resolves true and navigates when a next event exists', async () => {
    getAdjacentEvent.mockResolvedValue(makeEvent('99'));
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '1', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.goToNextEvent();
    });

    expect(advanced).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/events/99', expect.anything());
  });

  it('marks an automatic advance in navigation state', async () => {
    getAdjacentEvent.mockResolvedValue(makeEvent('99'));
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '1', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    await act(async () => {
      await result.current.goToNextEvent({ continuousPlayback: true });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events/99', {
      replace: true,
      state: expect.objectContaining({ continuousPlayback: true }),
    });
  });

  it('resolves false and does not navigate when there is no next event', async () => {
    getAdjacentEvent.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '1', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.goToNextEvent();
    });

    expect(advanced).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Refs #547: an event opened from the Nearby panel carries the panel's
  // events, and continuous play walks them instead of the Events filter.
  it('continues to the next nearby event an event was opened from', async () => {
    mockLocation.state = { eventContextQueue: ['1', '2', '3'] };
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '2', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.goToNextEvent({ continuousPlayback: true });
    });

    expect(advanced).toBe(true);
    expect(getAdjacentEvent).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/events/3', {
      replace: true,
      state: expect.objectContaining({ continuousPlayback: true, eventContextQueue: ['1', '2', '3'] }),
    });
    // Back to the panel highlights the event playback reached.
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('3');
  });

  it('stops after the last nearby event', async () => {
    mockLocation.state = { eventContextQueue: ['1', '2', '3'] };
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '3', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.goToNextEvent({ continuousPlayback: true });
    });

    expect(advanced).toBe(false);
    expect(getAdjacentEvent).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the nearby events through a manual next, which still follows the filter', async () => {
    mockLocation.state = { eventContextQueue: ['1', '2', '3'] };
    getAdjacentEvent.mockResolvedValue(makeEvent('99'));
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '2', currentStartDateTime: '2026-07-18 09:00:00' })
    );

    await act(async () => {
      await result.current.goToNextEvent();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events/99', {
      replace: true,
      state: expect.objectContaining({ eventContextQueue: ['1', '2', '3'] }),
    });
  });

  it('resolves false when there is no current timestamp', async () => {
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: undefined, currentStartDateTime: undefined })
    );

    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.goToNextEvent();
    });

    expect(advanced).toBe(false);
    expect(getAdjacentEvent).not.toHaveBeenCalled();
  });
});
