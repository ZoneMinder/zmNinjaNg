/**
 * Stream Lifecycle Hook
 *
 * Encapsulates the shared connection-key lifecycle pattern used by monitor
 * streams. Handles:
 * - connKey state generation via the monitor store
 * - CMD_QUIT before connKey regeneration (skips initial mount)
 * - CMD_QUIT on unmount (streaming mode only)
 * - Image/media element abort on unmount to release browser connections
 * - cleanupParamsRef pattern to capture latest values for the unmount effect
 */

import { useState, useEffect, useRef } from 'react';
import { getZmsControlUrl } from '../lib/url-builder';
import { ZMS_COMMANDS } from '../lib/zm-constants';
import { httpGet } from '../lib/http';
import { useMonitorStore } from '../stores/monitors';
import { log, LogLevel } from '../lib/logger';

/** Signature of a component-scoped log helper (e.g. log.monitor, log.dashboard). */
type ComponentLogger = (message: string, level?: LogLevel, details?: unknown) => void;

export interface UseStreamLifecycleOptions {
  /** Monitor ID to generate a connKey for. When undefined the hook is inert. */
  monitorId: string | undefined;
  /** Human-readable name, used only for log messages. */
  monitorName?: string;
  /** Portal URL of the active profile, needed for CMD_QUIT requests. */
  portalUrl: string | undefined;
  /** Auth token appended to CMD_QUIT requests. */
  accessToken: string | null;
  /** Current view mode — CMD_QUIT is only sent in streaming mode. */
  viewMode: 'streaming' | 'snapshot';
  /** Ref to the <img> or <video> element whose src is cleared on unmount. */
  mediaRef: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  /** Component-scoped log function (e.g. log.monitor, log.montageMonitor). */
  logFn: ComponentLogger;
  /**
   * When true the hook is fully enabled. When false the hook skips connKey
   * generation and cleanup param tracking. Defaults to true.
   */
  enabled?: boolean;
  /** Base port for multi-port streaming (port = minStreamingPort + monitorId). */
  minStreamingPort?: number;
}

export interface UseStreamLifecycleReturn {
  /** The current connection key. 0 means no key has been generated yet. */
  connKey: number;
  /**
   * Force-regenerate the connKey without sending CMD_QUIT for the old one.
   * Used for error-recovery scenarios where the stream is already dead.
   */
  forceRegenerate: () => number;
}

/**
 * Manages the ZMS connection-key lifecycle for a single monitor stream.
 *
 * The hook generates a unique connKey on mount (and when monitorId changes),
 * sends CMD_QUIT for the previous connKey before regenerating, and sends a
 * final CMD_QUIT on unmount. It also clears the media element src on unmount
 * to abort in-flight image loads and free browser connections.
 */
export function useStreamLifecycle({
  monitorId,
  monitorName,
  portalUrl,
  accessToken,
  viewMode,
  mediaRef,
  logFn,
  enabled = true,
  minStreamingPort,
}: UseStreamLifecycleOptions): UseStreamLifecycleReturn {
  const regenerateConnKey = useMonitorStore((state) => state.regenerateConnKey);

  const [connKey, setConnKey] = useState(0);

  // Track previous connKey to send CMD_QUIT before regenerating
  const prevConnKeyRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);

  // Regenerate connKey on mount or when monitorId changes
  useEffect(() => {
    if (!enabled || !monitorId) return;

    // If we already have a connKey for this monitor, don't regenerate
    // (only regenerate when first enabled or monitor changes)
    if (connKey !== 0 && !isInitialMountRef.current) return;

    // Send CMD_QUIT for previous connKey before generating new one (skip on initial mount)
    if (
      !isInitialMountRef.current &&
      prevConnKeyRef.current !== 0 &&
      viewMode === 'streaming' &&
      portalUrl
    ) {
      const controlUrl = getZmsControlUrl(
        portalUrl,
        ZMS_COMMANDS.cmdQuit,
        prevConnKeyRef.current.toString(),
        { token: accessToken || undefined, minStreamingPort, monitorId },
      );

      // Connkey churn: a montage view can regenerate many keys within ms.
      // Dedupe the per-monitor chatter into a single line per 3s window;
      // on subsequent emits we surface the suppressed count.
      log.dedupe('connkey-cmd-quit-pre-regen', 3000, (suffix) =>
        logFn(`Sending CMD_QUIT before regenerating connkey${suffix}`, LogLevel.DEBUG, {
          monitorId,
          monitorName,
          oldConnkey: prevConnKeyRef.current,
        }),
      );

      httpGet(controlUrl).catch(() => {
        // Silently ignore errors - connection may already be closed
      });
    }

    isInitialMountRef.current = false;

    // Generate new connKey
    log.dedupe('connkey-regen', 3000, (suffix) =>
      logFn(`Regenerating connkey${suffix}`, LogLevel.DEBUG, { monitorId, monitorName }),
    );
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorId, enabled]);

  // Store cleanup parameters in ref to access latest values on unmount
  const cleanupParamsRef = useRef({
    monitorId: monitorId || '',
    monitorName: monitorName || '',
    connKey: 0,
    portalUrl,
    token: accessToken,
    viewMode,
    minStreamingPort,
  });

  // Update cleanup params whenever they change
  useEffect(() => {
    if (!enabled) return;
    cleanupParamsRef.current = {
      monitorId: monitorId || '',
      monitorName: monitorName || '',
      connKey,
      portalUrl,
      token: accessToken,
      viewMode,
      minStreamingPort,
    };
  }, [enabled, monitorId, monitorName, connKey, portalUrl, accessToken, viewMode, minStreamingPort]);

  // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
  useEffect(() => {
    return () => {
      const params = cleanupParamsRef.current;

      // Send CMD_QUIT to properly close the stream connection (only in streaming mode)
      if (
        params.viewMode === 'streaming' &&
        params.portalUrl &&
        params.monitorId &&
        params.connKey !== 0
      ) {
        const controlUrl = getZmsControlUrl(
          params.portalUrl,
          ZMS_COMMANDS.cmdQuit,
          params.connKey.toString(),
          { token: params.token || undefined, minStreamingPort: params.minStreamingPort, monitorId: params.monitorId },
        );

        log.dedupe('connkey-cmd-quit-unmount', 3000, (suffix) =>
          logFn(`Sending CMD_QUIT on unmount${suffix}`, LogLevel.DEBUG, {
            monitorId: params.monitorId,
            monitorName: params.monitorName,
            connkey: params.connKey,
          }),
        );

        // Send CMD_QUIT asynchronously, ignore errors (connection may already be closed)
        httpGet(controlUrl).catch(() => {
          // Silently ignore errors - server connection may already be closed
        });
      }

      // Abort image/video loading to release browser connection
      if (mediaRef.current) {
        logFn('Aborting media element on unmount', LogLevel.DEBUG, {
          monitorId: params.monitorId,
        });
        mediaRef.current.src =
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
    };
  }, []); // Empty deps = only run on unmount

  // Force-regenerate without CMD_QUIT (for error recovery when stream is dead).
  // Dedupes the log line across all monitors in the same 3s window so a
  // visibility-resume burst surfaces as one line, not one per tile. refs #150
  const forceRegenerate = (): number => {
    if (!monitorId) return 0;
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    log.dedupe('connkey-force-regen', 3000, (suffix) =>
      logFn(`Force-regenerated connkey${suffix}`, LogLevel.INFO, { monitorId, newKey }),
    );
    return newKey;
  };

  return { connKey, forceRegenerate };
}
