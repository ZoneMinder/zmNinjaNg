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
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { getEvent } from '../../api/events';
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

// Mock the event lookup (api/* only, per the testing playbook)
vi.mock('../../api/events', () => ({
  getEvent: vi.fn(),
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

  it('times tray notifications by their events and lists them newest first (issue #615)', async () => {
    const [profile] = seedProfiles([makeProfile('home', { timezone: 'Australia/Sydney' })], { current: 'home' });
    useNotificationStore.setState({ profileEvents: {} });
    const starts: Record<string, string> = {
      '37562': '2026-11-26 22:55:07',
      '38073': '2026-11-27 08:12:37',
      '38085': '2026-11-27 08:15:49',
    };
    vi.mocked(getEvent).mockImplementation(async (_client, id) => ({
      Event: { Id: id, StartDateTime: starts[id] },
    }) as never);
    // iOS returns them newest first.
    vi.mocked(FirebaseMessaging.getDeliveredNotifications).mockResolvedValueOnce({
      notifications: ['38085', '38073', '37562'].map((eid) => ({
        id: eid, title: 'Garage Gate Camera', body: 'detected:person', data: { eid, mid: '12' },
      })),
    } as never);

    renderHook(() => useNotificationDelivered({ currentProfile: profile }));
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().getEvents(profile.id)).toHaveLength(3);
    });

    const events = useNotificationStore.getState().getEvents(profile.id);
    expect(events.map((e) => e.EventId)).toEqual([38085, 38073, 37562]);
    // 22:55:07 AEDT (UTC+11) is 11:55:07 UTC.
    expect(events[2].receivedAt).toBe(Date.UTC(2026, 10, 26, 11, 55, 7));
    // The tray is cleared before the lookups, so a push arriving during them
    // stays in the tray for the next read.
    const cleared = vi.mocked(FirebaseMessaging.removeAllDeliveredNotifications).mock.invocationCallOrder[0];
    expect(cleared).toBeLessThan(vi.mocked(getEvent).mock.invocationCallOrder[0]);
  });
});
