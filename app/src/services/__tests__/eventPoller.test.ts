import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted so they're available in vi.mock factories) ---

const {
  mockGetEvents,
  mockGetEventImageUrl,
  mockGetMonitors,
  mockAddEvent,
  mockGetProfileSettings,
} = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockGetEventImageUrl: vi.fn(() => 'http://example.com/snap.jpg'),
  mockGetMonitors: vi.fn(),
  mockAddEvent: vi.fn(),
  mockGetProfileSettings: vi.fn(),
}));

vi.mock('../../api/events', () => ({
  getEvents: mockGetEvents,
  getEventImageUrl: mockGetEventImageUrl,
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: mockGetMonitors,
}));

vi.mock('../../stores/notifications', () => ({
  useNotificationStore: {
    getState: () => ({
      getProfileSettings: mockGetProfileSettings,
      addEvent: mockAddEvent,
    }),
  },
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: {
    getState: () => ({
      profiles: [{ id: 'profile-1', portalUrl: 'http://zm.local' }],
      currentProfileId: 'profile-1',
    }),
  },
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: {
    getState: () => ({
      accessToken: 'test-token',
      getFreshAccessToken: async () => 'test-token',
    }),
  },
}));

vi.mock('../../lib/logger', () => ({
  log: {
    notifications: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { getEventPoller } from '../eventPoller';

// --- Helpers ---

function makeEvent(id: number, monitorId = '1', cause = 'Motion') {
  return {
    Event: {
      Id: String(id),
      MonitorId: String(monitorId),
      Cause: cause,
    },
  };
}

const defaultSettings = {
  pollingInterval: 30,
  onlyDetectedEvents: false,
};

// --- Tests ---

describe('EventPollerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockGetProfileSettings.mockReturnValue({ ...defaultSettings });
    mockGetMonitors.mockResolvedValue({
      monitors: [
        { Monitor: { Id: '1', Name: 'Front Door' } },
        { Monitor: { Id: '2', Name: 'Backyard' } },
      ],
    });
    mockGetEvents.mockResolvedValue({ events: [] });
  });

  afterEach(() => {
    const poller = getEventPoller();
    poller.stop();
    vi.useRealTimers();
  });

  it('getEventPoller() returns a singleton', () => {
    const a = getEventPoller();
    const b = getEventPoller();
    expect(a).toBe(b);
  });

  it('start() loads monitor names and begins polling', async () => {
    const poller = getEventPoller();
    await poller.start('profile-1');
    // _pollAndSchedule sets the timer inside .finally(), flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetMonitors).toHaveBeenCalledTimes(1);
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(poller.isRunning()).toBe(true);
  });

  it('first poll seeds seen events without calling addEvent', async () => {
    mockGetEvents.mockResolvedValue({
      events: [makeEvent(100), makeEvent(101)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1');

    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it('subsequent polls detect new events and call addEvent with poll source', async () => {
    // First poll seeds events 100, 101
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(100), makeEvent(101)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1');
    expect(mockAddEvent).not.toHaveBeenCalled();

    // Second poll returns events 100, 101, 102 (102 is new)
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(102, '1', 'Person'), makeEvent(101), makeEvent(100)],
    });

    // Advance past the polling interval and let the async poll settle
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockAddEvent).toHaveBeenCalledTimes(1);
    expect(mockAddEvent).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        EventId: 102,
        MonitorName: 'Front Door',
        Cause: 'Person',
      }),
      'poll',
    );
  });

  it('skips duplicate events (same ID already seen)', async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(200)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1');

    // Second poll returns the same event
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(200)],
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it('stop() clears the timer and resets state', async () => {
    const poller = getEventPoller();
    await poller.start('profile-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.isRunning()).toBe(true);

    poller.stop();
    expect(poller.isRunning()).toBe(false);
  });

  it('isRunning() reflects the running state', () => {
    const poller = getEventPoller();
    expect(poller.isRunning()).toBe(false);
  });

  it('applies notesRegexp filter when onlyDetectedEvents is enabled', async () => {
    mockGetProfileSettings.mockReturnValue({
      ...defaultSettings,
      onlyDetectedEvents: true,
    });

    const poller = getEventPoller();
    await poller.start('profile-1');

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        notesRegexp: 'detected:',
      }),
    );
  });

  it('caps the seen set at 500 entries', async () => {
    // Seed first poll with 5 events
    const seedEvents = Array.from({ length: 5 }, (_, i) => makeEvent(i));
    mockGetEvents.mockResolvedValueOnce({ events: seedEvents });

    const poller = getEventPoller();
    await poller.start('profile-1');

    // Build up past 500 seen IDs across multiple polls
    for (let batch = 0; batch < 100; batch++) {
      const batchEvents = Array.from({ length: 6 }, (_, i) =>
        makeEvent(1000 + batch * 6 + i),
      );
      mockGetEvents.mockResolvedValueOnce({ events: batchEvents });
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // After pruning, only the last poll's IDs remain in the set.
    // Event 0 was in the seed but should now be treated as new.
    mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(0)] });
    mockAddEvent.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockAddEvent).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ EventId: 0 }),
      'poll',
    );
  });
});
