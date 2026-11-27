import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useNotificationStore, startEventPoller, resolvePollIntervalMs } from '../notifications';
import { useProfileStore } from '../profile';
import { stopAllEventPollers } from '../../services/eventPoller';
import { resetAllNotificationServices } from '../../services/notifications';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../api/types';
import { getBandwidthSettings } from '../../lib/zmninja-ng-constants';
import type { ZMAlarmEvent, ConnectionState } from '../../types/notifications';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { markSessionActive, markAllSessionsInactive } from '../../services/session-flags';

const mockService = {
  connect: vi.fn().mockResolvedValue(undefined),
  onStateChange: vi.fn((_cb: (state: ConnectionState) => void) => vi.fn()),
  onEvent: vi.fn((_cb: (event: ZMAlarmEvent) => void) => vi.fn()),
  setMonitorFilter: vi.fn().mockResolvedValue(undefined),
  updateBadgeCount: vi.fn().mockResolvedValue(undefined),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  deregisterPushToken: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../services/notifications', () => ({
  getNotificationService: vi.fn(() => mockService),
  resetNotificationService: vi.fn(),
  resetAllNotificationServices: vi.fn(),
}));

const mockPollerStart = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/eventPoller', () => ({
  getEventPoller: vi.fn(() => ({
    start: mockPollerStart,
    stop: vi.fn(),
    isRunning: vi.fn(() => false),
  })),
  stopAllEventPollers: vi.fn(),
}));

// The real profile store (already unmocked here) subscribes to the real auth
// store's setState and logs through profileService/auth on its own
// housekeeping; stub those too so seeding doesn't crash on an undefined
// method, alongside the fields this store's own code calls.
vi.mock('../../lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    notifications: vi.fn(),
    profileService: vi.fn(),
    auth: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('../../lib/version', () => ({
  getAppVersion: vi.fn(() => '1.0.0'),
}));

vi.mock('../../api/notifications', () => ({
  updateNotification: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(() => ({ client: {} })),
  registerSessionsGate: vi.fn(),
  // Required by tests/profile-fixture.ts's resetProfileFixture(), which calls
  // this unconditionally; this store never calls it itself.
  dropAllSessions: vi.fn(),
}));

// services/pushNotifications.ts is only reachable dynamically from this store
// (native-only token registration); mock it so the store test doesn't need
// to evaluate the real push service module. setPushServiceStoreGates is
// called at this module's top level (refs #217), so it must exist on the mock.
vi.mock('../../services/pushNotifications', () => ({
  setPushServiceStoreGates: vi.fn(),
  getPushService: vi.fn(() => ({
    isReady: vi.fn(() => false),
    registerTokenWithServer: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Notification Store', () => {
  const profileId = 'profile-1';
  const baseEvent: ZMAlarmEvent = {
    MonitorId: 1,
    MonitorName: 'Front Door',
    EventId: 101,
    Cause: 'Motion',
    Name: 'Front Door',
    ImageUrl: 'https://example.com/1.jpg',
  };

  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.setState({
      profileSettings: {},
      connections: {},
      currentProfileId: null,
      profileEvents: {},
      _cleanupFunctions: {},
    });
    vi.clearAllMocks();

    // Real profile/settings/auth stores (per the testing playbook): every
    // profile id this file connects/polls for needs a settings bucket
    // (bandwidthMode) and a session marked active, or getFreshAccessToken
    // returns null before it even looks at the (fresh) seeded token.
    // current: null matches this store's real dependency (useProfileStore)
    // as it always ran here - no test seeds a real "current" profile, and
    // connect()'s switch-teardown check (a truthy appCurrentProfileId that
    // isn't the connecting profile) must stay dormant unless a test opts in.
    seedProfiles(['profile-1', 'profile-A', 'profile-B'], { current: null });
    markSessionActive('profile-1');
    markSessionActive('profile-A');
    markSessionActive('profile-B');
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    markAllSessionsInactive();
  });

  it('returns default settings for a profile', () => {
    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(9000);
    expect(settings.monitorFilters).toEqual([]);
  });

  it('updates profile settings and disconnects when disabling active profile', () => {
    useNotificationStore.setState({
      connections: { [profileId]: 'connected' },
      currentProfileId: profileId,
    });

    const disconnectSpy = vi.spyOn(useNotificationStore.getState(), 'disconnect');

    useNotificationStore.getState().updateProfileSettings(profileId, {
      enabled: false,
      host: 'example.com',
    });

    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.host).toBe('example.com');
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('adds and updates monitor filters', () => {
    const store = useNotificationStore.getState();

    store.setMonitorFilter(profileId, 1, true, 60);
    store.setMonitorFilter(profileId, 1, false, 120);

    const settings = store.getProfileSettings(profileId);
    expect(settings.monitorFilters).toHaveLength(1);
    expect(settings.monitorFilters[0]).toEqual({
      monitorId: 1,
      enabled: false,
      checkInterval: 120,
    });
  });

  it('removes monitor filters', () => {
    const store = useNotificationStore.getState();

    store.setMonitorFilter(profileId, 1, true, 60);
    store.setMonitorFilter(profileId, 2, true, 60);
    store.removeMonitorFilter(profileId, 1);

    const settings = store.getProfileSettings(profileId);
    expect(settings.monitorFilters).toHaveLength(1);
    expect(settings.monitorFilters[0].monitorId).toBe(2);
  });

  it('adds events and updates badge count', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 });

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(2);
    expect(store.getUnreadCount(profileId)).toBe(2);
    expect(store.getProfileSettings(profileId).badgeCount).toBe(2);
  });

  it('defaults source to websocket', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent);
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('websocket');
  });

  it('stores push source when specified', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent, 'push');
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('push');
  });

  it('replaces duplicate events by EventId', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, MonitorName: 'Back Door' });

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].MonitorName).toBe('Back Door');
  });

  it('keeps every event with no real id (EventId 0) instead of collapsing them', () => {
    // Notifications delivered while backgrounded lose their FCM data payload,
    // so they arrive without an event id (EventId 0). They are distinct events
    // and must not dedup into one. See issue #242.
    const store = useNotificationStore.getState();

    store.addEvent(profileId, { ...baseEvent, EventId: 0, MonitorName: 'A' });
    store.addEvent(profileId, { ...baseEvent, EventId: 0, MonitorName: 'B' });

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.MonitorName)).toEqual(['B', 'A']);
  });

  it('updates source when duplicate event replaces existing', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent, 'websocket');
    store.addEvent(profileId, baseEvent, 'push');

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('push');
  });

  it('keeps a duplicate event\'s time, read state and position (issue #615)', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent, 'websocket', 1_000);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 }, 'websocket', 2_000);
    store.markEventRead(profileId, 101);
    // A late copy of 101 (a tray read on resume) arrives "now".
    store.addEvent(profileId, baseEvent, 'push', 9_000);

    const events = store.getEvents(profileId);
    expect(events.map((e) => e.EventId)).toEqual([102, 101]);
    const old = events.find((e) => e.EventId === 101)!;
    expect(old.receivedAt).toBe(1_000);
    expect(old.read).toBe(true);
    expect(old.source).toBe('push');
  });

  it('keeps the list newest first when events arrive out of order (issue #615)', () => {
    const store = useNotificationStore.getState();

    // iOS hands back delivered notifications newest first; each is timed by
    // its event, so the list must not end up oldest on top.
    store.addEvent(profileId, { ...baseEvent, EventId: 103 }, 'push', 3_000);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 }, 'push', 2_000);
    store.addEvent(profileId, { ...baseEvent, EventId: 101 }, 'push', 1_000);

    const events = store.getEvents(profileId);
    expect(events.map((e) => e.EventId)).toEqual([103, 102, 101]);
    expect(events.map((e) => e.receivedAt)).toEqual([3_000, 2_000, 1_000]);
  });

  it('marks events read and clears all', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 });

    store.markEventRead(profileId, 101);
    expect(store.getUnreadCount(profileId)).toBe(1);

    store.markAllRead(profileId);
    expect(store.getUnreadCount(profileId)).toBe(0);

    store.clearEvents(profileId);
    expect(store.getEvents(profileId)).toHaveLength(0);
  });

  it('limits stored events to 100', () => {
    const store = useNotificationStore.getState();

    for (let i = 1; i <= 150; i += 1) {
      store.addEvent(profileId, { ...baseEvent, EventId: i });
    }

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(100);
    expect(events[0].EventId).toBe(150);
  });

  it('sets notification mode via updateProfileSettings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, { notificationMode: 'direct' });
    expect(store.getProfileSettings(profileId).notificationMode).toBe('direct');

    store.updateProfileSettings(profileId, { notificationMode: 'es' });
    expect(store.getProfileSettings(profileId).notificationMode).toBe('es');
  });

  it('sets and clears notification ID via updateProfileSettings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, { notificationId: 42 });
    expect(store.getProfileSettings(profileId).notificationId).toBe(42);

    store.updateProfileSettings(profileId, { notificationId: null });
    expect(store.getProfileSettings(profileId).notificationId).toBeNull();
  });

  it('stores poll source when specified', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent, 'poll');
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('poll');
  });

  it('defaults onlyDetectedEvents and pollingInterval', () => {
    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.onlyDetectedEvents).toBe(false);
    expect(settings.pollingInterval).toBe(30);
  });

  it('updates direct mode settings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, {
      onlyDetectedEvents: true,
      pollingInterval: 60,
    });

    const settings = store.getProfileSettings(profileId);
    expect(settings.onlyDetectedEvents).toBe(true);
    expect(settings.pollingInterval).toBe(60);
  });

  it('connect injects store-derived providers into the service', async () => {
    const store = useNotificationStore.getState();
    store.updateProfileSettings(profileId, { enabled: true, host: 'es.example.com' });

    await useNotificationStore
      .getState()
      .connect(profileId, 'admin', 'secret', 'http://zm.local');

    expect(mockService.connect).toHaveBeenCalledTimes(1);
    const [config, providers] = mockService.connect.mock.calls[0];

    expect(config).toMatchObject({
      host: 'es.example.com',
      username: 'admin',
      password: 'secret',
    });

    // The real auth store's seeded (fresh) token for this profile.
    expect(await providers.getFreshAccessToken()).toBe('access-profile-1');

    const imageUrl = providers.buildEventImageUrl(42, 'tok');
    expect(imageUrl).toContain('http://zm.local');
    expect(imageUrl).toContain('eid=42');
    expect(imageUrl).toContain('fid=snapshot');
    expect(imageUrl).toContain('width=600');
    expect(imageUrl).toContain('token=tok');

    // No token: builder must omit the token parameter
    expect(providers.buildEventImageUrl(42, null)).not.toContain('token=');

    expect(providers.getKeepaliveIntervalMs()).toBe(60000);
  });

  describe('multi-profile connection lifecycle (refs #337)', () => {
    const profileA = 'profile-A';
    const profileB = 'profile-B';

    beforeEach(() => {
      useNotificationStore.getState().updateProfileSettings(profileA, { enabled: true, host: 'a.example.com' });
      useNotificationStore.getState().updateProfileSettings(profileB, { enabled: true, host: 'b.example.com' });
    });

    it('connects two profiles independently; disconnecting one leaves the other connected', async () => {
      const store = useNotificationStore.getState();
      await store.connect(profileA, 'admin', 'secretA', 'http://a.local');
      await store.connect(profileB, 'admin', 'secretB', 'http://b.local');

      // Simulate each connection's onStateChange callback firing 'connected'.
      const stateCalls = mockService.onStateChange.mock.calls;
      expect(stateCalls).toHaveLength(2);
      stateCalls[0][0]('connected');
      stateCalls[1][0]('connected');

      expect(useNotificationStore.getState().connections[profileA]).toBe('connected');
      expect(useNotificationStore.getState().connections[profileB]).toBe('connected');

      useNotificationStore.getState().disconnect(profileA);

      expect(useNotificationStore.getState().connections[profileA]).toBe('disconnected');
      expect(useNotificationStore.getState().connections[profileB]).toBe('connected');
    });

    it('binds each connection\'s onEvent callback to its own profile id', async () => {
      const store = useNotificationStore.getState();
      await store.connect(profileA, 'admin', 'secretA', 'http://a.local');
      await store.connect(profileB, 'admin', 'secretB', 'http://b.local');

      const eventCalls = mockService.onEvent.mock.calls;
      expect(eventCalls).toHaveLength(2);

      // Profile B's own callback fires - must land in profile B's history only.
      eventCalls[1][0]({ ...baseEvent, EventId: 999 });

      expect(useNotificationStore.getState().getEvents(profileB)).toHaveLength(1);
      expect(useNotificationStore.getState().getEvents(profileA)).toHaveLength(0);
    });

    it('anchors currentProfileId only when profileId is the app\'s real current profile; All mode leaves it alone (refs #337 I4)', async () => {
      const store = useNotificationStore.getState();
      try {
        // Single mode: the app's real current profile IS profileA.
        useProfileStore.setState({ currentProfileId: asProfileId(profileA) });
        await store.connect(profileA, 'admin', 'secretA', 'http://a.local');
        expect(useNotificationStore.getState().currentProfileId).toBe(profileA);

        // All mode: the app's real current profile is the ALL sentinel, not
        // profileB - connecting profileB (a connector's own connect() call)
        // must not overwrite the anchor with "whichever profile connected
        // last".
        useNotificationStore.setState({ currentProfileId: null });
        useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });
        await store.connect(profileB, 'admin', 'secretB', 'http://b.local');
        expect(useNotificationStore.getState().currentProfileId).toBeNull();
      } finally {
        useProfileStore.setState({ currentProfileId: null });
      }
    });

    it('disconnects itself if the app switched to a different real profile while connect() was in flight (refs #337 round 2 minor #2)', async () => {
      const store = useNotificationStore.getState();
      try {
        useProfileStore.setState({ currentProfileId: asProfileId(profileA) });

        let resolveConnect: () => void = () => {};
        mockService.connect.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveConnect = resolve; })
        );

        const connectPromise = store.connect(profileA, 'admin', 'secretA', 'http://a.local');

        // The user switches to a different real profile while the
        // handshake is still in flight. The switch-teardown effect (in
        // useNotificationAutoConnect) already ran by this point and found
        // profileA not yet connected, so nothing else will ever disconnect
        // it once the handshake finally completes.
        useProfileStore.setState({ currentProfileId: asProfileId(profileB) });

        resolveConnect();
        await connectPromise;

        expect(useNotificationStore.getState().connections[profileA]).toBe('disconnected');
        expect(useNotificationStore.getState().currentProfileId).not.toBe(profileA);
      } finally {
        useProfileStore.setState({ currentProfileId: null });
      }
    });

    it('keeps a member\'s connection alive when a virtual profile becomes current mid-connect (refs #337)', async () => {
      const store = useNotificationStore.getState();
      try {
        useProfileStore.setState({ currentProfileId: asProfileId(profileA) });

        let resolveConnect: () => void = () => {};
        mockService.connect.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveConnect = resolve; })
        );

        const connectPromise = store.connect(profileA, 'admin', 'secretA', 'http://a.local');
        mockService.onStateChange.mock.calls[0][0]('connected');

        // Selecting a group that CONTAINS profileA is not "the user switched
        // to a different real profile": a member's connection under an
        // aggregate is intentional, exactly as under All Servers. Reading the
        // group id as a real profile tears the socket down the moment the
        // handshake completes, and the member's notifications never arrive.
        const groupId = mintVirtualProfileId();
        useProfileStore.setState({
          virtualProfiles: [
            { id: groupId, name: 'Upstairs', memberProfileIds: [asProfileId(profileA)] },
          ],
          currentProfileId: groupId,
        });

        resolveConnect();
        await connectPromise;

        expect(useNotificationStore.getState().connections[profileA]).toBe('connected');
      } finally {
        useProfileStore.setState({ currentProfileId: null, virtualProfiles: [] });
      }
    });

    it('disconnects a NON-member whose connect was in flight when a virtual profile became current (refs #337)', async () => {
      const store = useNotificationStore.getState();
      try {
        useProfileStore.setState({ currentProfileId: asProfileId(profileA) });

        let resolveConnect: () => void = () => {};
        mockService.connect.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveConnect = resolve; })
        );

        const connectPromise = store.connect(profileA, 'admin', 'secretA', 'http://a.local');
        mockService.onStateChange.mock.calls[0][0]('connected');

        // The group EXCLUDES profileA, so nothing in the new scope owns this
        // connection: the switch-teardown effect already ran and found it not
        // yet connected. Exempting every aggregate id unconditionally would
        // leave it streaming events for the rest of the session with no
        // connector behind it.
        const groupId = mintVirtualProfileId();
        useProfileStore.setState({
          virtualProfiles: [
            { id: groupId, name: 'Downstairs', memberProfileIds: [asProfileId(profileB)] },
          ],
          currentProfileId: groupId,
        });

        resolveConnect();
        await connectPromise;

        expect(useNotificationStore.getState().connections[profileA]).toBe('disconnected');
      } finally {
        useProfileStore.setState({ currentProfileId: null, virtualProfiles: [] });
      }
    });

    it('disconnects an in-flight connection when the group it belonged to is gone (refs #337)', async () => {
      const store = useNotificationStore.getState();
      try {
        useProfileStore.setState({ currentProfileId: asProfileId(profileA) });

        let resolveConnect: () => void = () => {};
        mockService.connect.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveConnect = resolve; })
        );

        const connectPromise = store.connect(profileA, 'admin', 'secretA', 'http://a.local');
        mockService.onStateChange.mock.calls[0][0]('connected');

        // A virtual id with no group behind it (deleted in another tab, or
        // hand-edited storage) has no members, so it owns nothing.
        useProfileStore.setState({ virtualProfiles: [], currentProfileId: mintVirtualProfileId() });

        resolveConnect();
        await connectPromise;

        expect(useNotificationStore.getState().connections[profileA]).toBe('disconnected');
      } finally {
        useProfileStore.setState({ currentProfileId: null, virtualProfiles: [] });
      }
    });

    it('keeps every profile\'s in-flight connection under All Servers, which spans them all (refs #337)', async () => {
      const store = useNotificationStore.getState();
      try {
        useProfileStore.setState({ currentProfileId: asProfileId(profileB) });

        let resolveConnect: () => void = () => {};
        mockService.connect.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveConnect = resolve; })
        );

        const connectPromise = store.connect(profileA, 'admin', 'secretA', 'http://a.local');
        mockService.onStateChange.mock.calls[0][0]('connected');

        useProfileStore.setState({ currentProfileId: ALL_PROFILES_ID });

        resolveConnect();
        await connectPromise;

        expect(useNotificationStore.getState().connections[profileA]).toBe('connected');
      } finally {
        useProfileStore.setState({ currentProfileId: null });
      }
    });

    it('_initialize cleans up a previous registration for the same profile before re-subscribing (refs #337 #10)', async () => {
      const store = useNotificationStore.getState();
      await store.connect(profileA, 'admin', 'secretA', 'http://a.local');

      const firstStateUnsub = mockService.onStateChange.mock.results[0].value;
      const firstEventUnsub = mockService.onEvent.mock.results[0].value;
      expect(firstStateUnsub).not.toHaveBeenCalled();

      // A second _initialize for the same profile without an intervening
      // disconnect (e.g. a retried connect()) must tear down the stale
      // listeners first, not just overwrite the cleanup array and leak them
      // (duplicate event/state delivery).
      useNotificationStore.getState()._initialize(profileA);

      expect(firstStateUnsub).toHaveBeenCalledTimes(1);
      expect(firstEventUnsub).toHaveBeenCalledTimes(1);
    });

    it('disconnectAll disconnects every connected profile and sweeps pollers (refs #337 I5)', async () => {
      const store = useNotificationStore.getState();
      await store.connect(profileA, 'admin', 'secretA', 'http://a.local');
      await store.connect(profileB, 'admin', 'secretB', 'http://b.local');
      mockService.onStateChange.mock.calls[0][0]('connected');
      mockService.onStateChange.mock.calls[1][0]('connected');
      vi.mocked(stopAllEventPollers).mockClear();
      vi.mocked(resetAllNotificationServices).mockClear();

      useNotificationStore.getState().disconnectAll();

      expect(useNotificationStore.getState().connections[profileA]).toBe('disconnected');
      expect(useNotificationStore.getState().connections[profileB]).toBe('disconnected');
      expect(stopAllEventPollers).toHaveBeenCalledTimes(1);
      // Also sweeps the service registry directly - not just the profiles
      // `connections` happens to know about (refs #337 round 2 minor #3).
      expect(resetAllNotificationServices).toHaveBeenCalledTimes(1);
    });
  });

  it('startEventPoller wires store-derived deps into the poller', async () => {
    useNotificationStore
      .getState()
      .updateProfileSettings(profileId, { onlyDetectedEvents: true });

    await startEventPoller(profileId);

    expect(mockPollerStart).toHaveBeenCalledTimes(1);
    const [id, deps] = mockPollerStart.mock.calls[0];
    expect(id).toBe(profileId);

    expect(deps.getOnlyDetectedEvents()).toBe(true);
    // The real auth store's seeded (fresh) token for this profile.
    expect(await deps.getFreshAccessToken()).toBe('access-profile-1');
    expect(deps.getPollIntervalMs()).toBe(30000);

    deps.onEvent(baseEvent);
    const events = useNotificationStore.getState().getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('poll');
  });
});

describe('resolvePollIntervalMs', () => {
  const normalDefault = getBandwidthSettings('normal').eventPollerInterval;
  const lowDefault = getBandwidthSettings('low').eventPollerInterval;

  it('honours the user interval in normal bandwidth mode', () => {
    expect(resolvePollIntervalMs('normal', 10)).toBe(10000);
    expect(resolvePollIntervalMs('normal', 120)).toBe(120000);
  });

  it('floors the user interval at the low-bandwidth cadence', () => {
    expect(resolvePollIntervalMs('low', 10)).toBe(lowDefault);
  });

  it('lets the user poll slower than the low-bandwidth cadence', () => {
    expect(resolvePollIntervalMs('low', 120)).toBe(120000);
  });

  it('falls back to the bandwidth default when the stored value is unusable', () => {
    expect(resolvePollIntervalMs('normal', undefined)).toBe(normalDefault);
    expect(resolvePollIntervalMs('normal', 0)).toBe(normalDefault);
    expect(resolvePollIntervalMs('normal', NaN)).toBe(normalDefault);
    expect(resolvePollIntervalMs('low', -5)).toBe(lowDefault);
  });

  it('floors against the named bandwidth key when one is given', () => {
    // alarmStatusInterval is 10000 in low mode, 5000 in normal.
    expect(resolvePollIntervalMs('low', 2, 'alarmStatusInterval')).toBe(10_000);
    expect(resolvePollIntervalMs('normal', 2, 'alarmStatusInterval')).toBe(2000);
  });

  it('still defaults to the event-poller interval when no key is given', () => {
    expect(resolvePollIntervalMs('normal', 0)).toBe(30_000);
  });
});
