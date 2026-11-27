/**
 * useNotificationDelivered Hook Tests
 *
 * Covers the appStateChange listener registration race: a listener that
 * resolves after effect cleanup must be removed immediately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useNotificationDelivered } from '../useNotificationDelivered';
import { resetProfileFixture, seedProfiles, makeProfile } from '../../tests/profile-fixture';
import { useNotificationStore } from '../../stores/notifications';
import { DeliveredNotifications } from '../../plugins/delivered-notifications';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

// Mock Platform (mutable so individual tests can flip isNative)
const mockPlatform = vi.hoisted(() => ({ isDesktopOrWeb: false, isNative: true }));
vi.mock('../../lib/platform', () => ({
  Platform: mockPlatform,
}));

// Mock logger
// Every component logger is a mock: the real stores seeded below log too.
vi.mock('../../lib/logger', () => ({
  log: new Proxy({} as Record<string, unknown>, {
    get: (loggers, name: string) => (loggers[name] ??= vi.fn()),
  }),
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// Mock @capacitor/app (dynamically imported by the hook on native)
const mockAppAddListener = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app', () => ({
  App: { addListener: mockAppAddListener },
}));

// Mock @capacitor-firebase/messaging (dynamically imported by the hook)
vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    getDeliveredNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
    removeAllDeliveredNotifications: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the app's tray reader (dynamically imported by the hook)
vi.mock('../../plugins/delivered-notifications', () => ({
  DeliveredNotifications: {
    getDelivered: vi.fn().mockResolvedValue({ notifications: [] }),
  },
}));

describe('useNotificationDelivered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.isNative = true;
    mockAppAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('does not register the appStateChange listener on non-native platforms', async () => {
    mockPlatform.isNative = false;

    renderHook(() => useNotificationDelivered({ currentProfile: null }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAppAddListener).not.toHaveBeenCalled();
  });

  it('removes the appStateChange listener on unmount after registration resolves', async () => {
    const remove = vi.fn();
    mockAppAddListener.mockResolvedValueOnce({ remove });

    const { unmount } = renderHook(() => useNotificationDelivered({ currentProfile: null }));

    // Let the dynamic imports and addListener resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAppAddListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes the appStateChange listener when registration resolves after unmount', async () => {
    const remove = vi.fn();
    let resolveListener: (handle: { remove: () => void }) => void = () => {};
    mockAppAddListener.mockReturnValueOnce(
      new Promise((resolve) => { resolveListener = resolve; }),
    );

    const { unmount } = renderHook(() => useNotificationDelivered({ currentProfile: null }));

    // Let the dynamic imports resolve so addListener is invoked
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAppAddListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    // Unmount while addListener is still pending, then resolve it
    unmount();
    resolveListener({ remove });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('times tray notifications by when the OS delivered them and lists them newest first (issue #615)', async () => {
    const [profile] = seedProfiles([makeProfile('home')], { current: 'home' });
    useNotificationStore.setState({ profileEvents: {} });
    const delivered: Record<string, number> = {
      '37562': Date.UTC(2026, 10, 26, 11, 55, 7),
      '38073': Date.UTC(2026, 10, 26, 21, 12, 37),
      '38085': Date.UTC(2026, 10, 26, 21, 15, 49),
    };
    // iOS returns them newest first.
    vi.mocked(DeliveredNotifications.getDelivered).mockResolvedValueOnce({
      notifications: ['38085', '38073', '37562'].map((eid) => ({
        id: eid, title: 'Garage Gate Camera', body: 'detected:person', data: { eid, mid: '12' }, time: delivered[eid],
      })),
    });

    renderHook(() => useNotificationDelivered({ currentProfile: profile }));
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().getEvents(profile.id)).toHaveLength(3);
    });

    const events = useNotificationStore.getState().getEvents(profile.id);
    expect(events.map((e) => e.EventId)).toEqual([38085, 38073, 37562]);
    expect(events.map((e) => e.receivedAt)).toEqual([delivered['38085'], delivered['38073'], delivered['37562']]);
  });

  it('falls back to now when the OS gives no delivery time', async () => {
    const [profile] = seedProfiles([makeProfile('home')], { current: 'home' });
    useNotificationStore.setState({ profileEvents: {} });
    vi.mocked(DeliveredNotifications.getDelivered).mockResolvedValueOnce({
      notifications: [{ id: '1', tag: 'zmninja_38085_alarm', title: 'Garage Alarm', body: 'detected:person' }],
    });
    const before = Date.now();

    renderHook(() => useNotificationDelivered({ currentProfile: profile }));
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().getEvents(profile.id)).toHaveLength(1);
    });

    const [event] = useNotificationStore.getState().getEvents(profile.id);
    expect(event.EventId).toBe(38085);
    expect(event.receivedAt).toBeGreaterThanOrEqual(before);
  });
});
