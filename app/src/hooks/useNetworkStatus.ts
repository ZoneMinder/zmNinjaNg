/**
 * useNetworkStatus Hook
 *
 * Tracks browser/device network connectivity for the app-wide offline banner
 * (see AppLayout.tsx). On native platforms (iOS/Android) it uses Capacitor's
 * Network plugin, loaded dynamically and gated on Platform.isNative per rule
 * 14. On web/desktop it falls back to `navigator.onLine` plus the
 * `online`/`offline` window events.
 *
 * The native branch reads the current status once on mount (so the banner
 * doesn't wait for the first transition), then subscribes to transitions
 * through useCapacitorListener, which centralizes the dynamic-import +
 * add/remove listener lifecycle also used by useNotificationAutoConnect for
 * the same `networkStatusChange` event. Both consumers share one
 * `import('@capacitor/network')` call via a ref-cached promise: two
 * concurrent dynamic imports of the same plugin from two effects on the same
 * mount is unnecessary and, under Vitest's module mocking, races.
 *
 * This is presentation-only: it does not touch the WebSocket/event-poller
 * reconnect logic in useNotificationAutoConnect.ts, which already listens for
 * the same browser/native connectivity signals to trigger a reconnect.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from '../lib/platform';
import { useCapacitorListener } from './useCapacitorListener';
import type { CapacitorListenerSource } from './useCapacitorListener';

function getInitialOnlineState(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export interface UseNetworkStatusReturn {
  /** False while the device/browser has no network connectivity. */
  isOnline: boolean;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnlineState);

  // Cache the dynamic import so the initial-status effect and the
  // useCapacitorListener registration below resolve the same module load
  // instead of each triggering their own `import('@capacitor/network')`.
  const networkImportRef = useRef<Promise<typeof import('@capacitor/network')> | null>(null);
  const getNetworkImport = () => {
    if (!networkImportRef.current) {
      networkImportRef.current = import('@capacitor/network');
    }
    return networkImportRef.current;
  };

  // Web/desktop: standard browser connectivity events.
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Native: read the current status once on mount.
  useEffect(() => {
    if (!Platform.isNative) return;

    let cancelled = false;

    (async () => {
      try {
        const { Network } = await getNetworkImport();
        const status = await Network.getStatus();
        if (!cancelled) setIsOnline(status.connected);
      } catch {
        // Network plugin unavailable; the browser online/offline listeners
        // above still cover us.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native: subscribe to connectivity transitions.
  useCapacitorListener(
    () => getNetworkImport().then((m) => ({ plugin: m.Network as CapacitorListenerSource })),
    'networkStatusChange',
    (status: { connected: boolean }) => {
      setIsOnline(status.connected);
    },
  );

  return { isOnline };
}
