/**
 * Stream Lifecycle Hook
 *
 * Encapsulates the shared connection-key lifecycle pattern used by monitor
 * streams. Handles:
 * - connKey state generation via the monitor store
 * - CMD_QUIT before connKey regeneration (skips initial mount)
 * - CMD_QUIT on unmount (streaming mode only)
 * - CMD_QUIT when `enabled` goes false, so a disabled hook never leaves a live
 *   nph-zms process behind, and re-enabling mints a fresh key
 * - CMD_QUIT when `viewMode` leaves 'streaming', for the same reason: every
 *   other quit path is gated on streaming and would skip the key by then
 * - Image/media element abort on unmount to release browser connections
 * - cleanupParamsRef pattern to capture latest values for the unmount effect
 */

import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { getZmsControlUrl } from '../lib/zm/url-builder';
import { ZMS_COMMANDS } from '../lib/zm/zm-constants';
import { httpGet } from '../lib/http';
import { API_REQUEST } from '../lib/zmninja-ng-constants';
import { useMonitorStore, monitorCacheKey } from '../stores/monitors';
import { registerActiveStream, unregisterActiveStream } from '../lib/monitor/active-streams';
import { log, LogLevel } from '../lib/logger';
import type { ProfileId } from '../api/types';

/** Signature of a component-scoped log helper (e.g. log.monitor, log.dashboard). */
type ComponentLogger = (message: string, level?: LogLevel, details?: unknown) => void;

/** Captured stream context used to send CMD_QUIT outside of render. */
interface StreamCleanupParams {
  monitorId: string;
  /** Composite profileId:monitorId key used for the connKeys store lookup
   *  (refs #337) - distinct from monitorId, which stays the real ZM monitor
   *  id used to build CMD_QUIT URLs. */
  cacheKey: string;
  monitorName: string;
  connKey: number;
  portalUrl: string | undefined;
  token: string | null;
  viewMode: 'streaming' | 'snapshot';
  minStreamingPort: number | undefined;
  cmdQuitTimeoutMs: number | undefined;
}

/**
 * Send CMD_QUIT for a stream and clear its stored connkey. Shared by the
 * unmount cleanup and the profile-switch teardown registry so both build the
 * exact same per-server quit URL. `reason` only affects the log line. Resolves
 * once the request settles; never rejects (the connection may already be gone).
 */
async function quitStreamForParams(
  params: StreamCleanupParams,
  logFn: ComponentLogger,
  reason: 'unmount' | 'profile-switch' | 'disable' | 'view-mode' | 'scale',
): Promise<void> {
  if (
    params.viewMode !== 'streaming' ||
    !params.portalUrl ||
    !params.monitorId ||
    params.connKey === 0
  ) {
    return;
  }

  const controlUrl = getZmsControlUrl(
    params.portalUrl,
    ZMS_COMMANDS.cmdQuit,
    params.connKey.toString(),
    { token: params.token || undefined, minStreamingPort: params.minStreamingPort, monitorId: params.monitorId },
  );

  log.dedupe(`connkey-cmd-quit-${reason}`, 3000, (suffix) =>
    logFn(`Sending CMD_QUIT on ${reason}${suffix}`, LogLevel.DEBUG, {
      monitorId: params.monitorId,
      monitorName: params.monitorName,
      connkey: params.connKey,
    }),
  );

  // Drop the stored connkey BEFORE awaiting the request so a fast remount gets a
  // fresh key (a quit key can collide with the server-side stream state) and the
  // unmount caller's clear stays synchronous. The store comparison keeps a
  // concurrent mount's newer key intact: only the key this teardown quit is
  // cleared, never a newer one.
  const store = useMonitorStore.getState();
  if (store.connKeys[params.cacheKey] === params.connKey) {
    store.clearConnKey(params.cacheKey);
  }

  try {
    await httpGet(controlUrl, { timeoutMs: params.cmdQuitTimeoutMs });
  } catch {
    // Silently ignore - server connection may already be closed
  }
}

export interface UseStreamLifecycleOptions {
  /** Monitor ID to generate a connKey for. When undefined the hook is inert. */
  monitorId: string | undefined;
  /** Human-readable name, used only for log messages. */
  monitorName?: string;
  /** Portal URL of the active profile, needed for CMD_QUIT requests. */
  portalUrl: string | undefined;
  /** Auth token appended to CMD_QUIT requests. */
  accessToken: string | null;
  /** Current view mode: CMD_QUIT is only sent in streaming mode. */
  viewMode: 'streaming' | 'snapshot';
  /** Ref to the <img> or <video> element whose src is cleared on unmount. */
  mediaRef: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  /** Component-scoped log function (e.g. log.monitor, log.montageMonitor). */
  logFn: ComponentLogger;
  /**
   * When true the hook is fully enabled. When false the hook holds no connKey:
   * going from enabled to disabled quits the current key on the server, and
   * re-enabling mints a fresh one. Defaults to true.
   */
  enabled?: boolean;
  /** Base port for multi-port streaming (port = minStreamingPort + monitorId). */
  minStreamingPort?: number;
  /**
   * Profile that owns this monitorId, used only to scope the connKeys store
   * lookup key (monitorCacheKey) so two profiles sharing a monitor id (two
   * independent ZM servers) never collide on one connkey slot (refs #337).
   * Omitted callers keep the pre-existing monitorId-only key.
   */
  profileId?: ProfileId | null;
  /**
   * The `scale=` this stream is currently asking zms for. A running nph-zms
   * keeps sending the size it was started at, so a change here is a different
   * stream and not a different frame: the old process is quit and a fresh key
   * minted, exactly as a view-mode flip does. Zooming in raises it and the
   * Stream scale setting changes it (refs #478).
   */
  scale?: number;
}

export interface UseStreamLifecycleReturn {
  /** The current connection key. 0 means no key has been generated yet. */
  connKey: number;
  /**
   * Force-regenerate the connKey. By default skips CMD_QUIT. Pass
   * `killPrevious: true` when the previous stream may still be alive on the
   * server (visibility resume, manual retry, error-driven reconnect) so its
   * nph-zms process is closed before a new one is started. An `<img>` error
   * cannot tell a dead server process from a dropped-but-alive one, so the
   * reconnect path passes `killPrevious: true` to avoid orphaning a connkey.
   */
  forceRegenerate: (options?: { killPrevious?: boolean }) => number;
  /**
   * Release the current connkey without minting a new one: sends CMD_QUIT for
   * it and clears the stored key so the next mount/retry starts fresh. Used
   * when the reconnect loop gives up, so the final connkey is not orphaned
   * until unmount.
   */
  releaseConnection: () => void;
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
  profileId,
  scale,
}: UseStreamLifecycleOptions): UseStreamLifecycleReturn {
  const regenerateConnKey = useMonitorStore((state) => state.regenerateConnKey);

  // Teardown timeout, deliberately shorter than the API timeout: a profile
  // switch awaits every CMD_QUIT, and a wedged zms never answers. See
  // API_REQUEST.cmdQuitTimeoutSeconds.
  const cmdQuitTimeoutMs = API_REQUEST.cmdQuitTimeoutSeconds * 1000;
  const cacheKey = monitorCacheKey(profileId, monitorId || '');

  const [connKey, setConnKey] = useState(0);

  // Track previous connKey to send CMD_QUIT before regenerating
  const prevConnKeyRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);

  // Snapshot of the values a teardown needs, for a given key. Callers outside
  // render capture one of these; nothing reads props directly at teardown time.
  const buildCleanupParams = useCallback(
    (key: number): StreamCleanupParams => ({
      monitorId: monitorId || '',
      cacheKey,
      monitorName: monitorName || '',
      connKey: key,
      portalUrl,
      token: accessToken,
      viewMode,
      minStreamingPort,
      cmdQuitTimeoutMs,
    }),
    [monitorId, cacheKey, monitorName, portalUrl, accessToken, viewMode, minStreamingPort, cmdQuitTimeoutMs],
  );

  // Store cleanup parameters in a ref so the teardowns, which run outside
  // render, see the stream this hook currently owns.
  const cleanupParamsRef = useRef<StreamCleanupParams>(buildCleanupParams(0));

  // Regenerate connKey on mount or when monitorId changes
  useEffect(() => {
    if (!enabled || !monitorId) return;

    // If we already have a connKey for this monitor, don't regenerate
    // (only regenerate when first enabled or monitor changes)
    //
    // Despite that second line, a monitorId change on a live hook returns here
    // rather than minting for the new monitor, and the old monitor's key is
    // left for the unmount path to quit against whatever the props say by
    // then. Nothing in the app reaches it: every call site that swaps monitors
    // remounts the player instead, keyed by monitor id, which was itself the
    // fix for the feed lagging a monitor behind (see MonitorDetail's `key=`
    // comment, refs #201). Left alone deliberately - changing it would move a
    // teardown that the keyed remount already handles.
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

      httpGet(controlUrl, { timeoutMs: cmdQuitTimeoutMs }).catch(() => {
        // Silently ignore errors - connection may already be closed
      });
    }

    isInitialMountRef.current = false;

    // Generate new connKey
    log.dedupe('connkey-regen', 3000, (suffix) =>
      logFn(`Regenerating connkey${suffix}`, LogLevel.DEBUG, { monitorId, monitorName }),
    );
    const newKey = regenerateConnKey(cacheKey);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    // Bind the key to the identity that minted it, here rather than waiting for
    // the params effect below. A commit that mints and disables together never
    // reaches that effect, and the teardown must still know which monitor and
    // port this key belongs to.
    cleanupParamsRef.current = buildCleanupParams(newKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorId, enabled]);

  // Refresh the cleanup params as the profile's values change, but only while
  // enabled. Once disabled the hook owns no stream, so the ref must keep the
  // identity of the one it minted (monitorId, viewMode, port) instead of
  // adopting whatever the props now say: a commit that disables and repoints
  // the tile at another monitor would otherwise quit the old key against the
  // new monitor's port and leave the old stored key behind.
  useEffect(() => {
    if (!enabled) return;
    cleanupParamsRef.current = buildCleanupParams(connKey);
  }, [enabled, connKey, buildCleanupParams]);

  // Disable teardown. A connkey is never left alive on the server when its hook
  // goes disabled: going enabled -> disabled sends CMD_QUIT for the current key
  // and clears it, exactly as an unmount does, and zeroing connKey makes the
  // regeneration effect above mint a *fresh* key when the hook is re-enabled
  // (the pre-disable key's nph-zms process is gone, so reusing it would mount an
  // <img> on a dead stream). A Go2RTC monitor flipping between WebRTC and MJPEG
  // fallback therefore orphans nothing, however many times it flips.
  //
  // This effect deliberately has no cleanup function, so it cannot race the
  // unmount teardown into quitting the same key twice: an unmount runs only the
  // unmount cleanup, which by then sees connKey 0 and no-ops. quitStreamForParams
  // is the single quit path (it already skips snapshot mode, a missing portal
  // URL, and connKey 0, so hovering off a snapshot tile costs no request), and
  // its store comparison keeps a concurrent re-enable's newer key intact.
  const wasEnabledRef = useRef(enabled);
  useEffect(() => {
    if (wasEnabledRef.current === enabled) return;
    wasEnabledRef.current = enabled;
    if (enabled) return;

    const params = cleanupParamsRef.current;
    void quitStreamForParams(params, logFn, 'disable');
    cleanupParamsRef.current = { ...params, connKey: 0 };
    prevConnKeyRef.current = 0;
    setConnKey(0);
  }, [enabled, logFn]);

  // View-mode teardown. A streaming connkey is a running nph-zms process on the
  // server; a snapshot request is not. Flipping a live hook from streaming to
  // snapshot therefore ends that process's usefulness while nothing else would
  // ever close it: the unmount and disable teardowns both skip snapshot mode by
  // the time they run, so the key was orphaned until ZM's own idle timeout. The
  // Streaming Mode setting reaches this, and so does the All-mode idle
  // downgrade (refs #337), which flips every tile at once.
  //
  // Both directions then mint a fresh key. The new mode needs one (a snapshot
  // URL carries a connkey too), and reusing the quit key risks colliding with
  // whatever server-side state it left behind.
  const prevStreamIdentityRef = useRef({ viewMode, monitorId, enabled, minStreamingPort, scale });
  useEffect(() => {
    const prev = prevStreamIdentityRef.current;
    prevStreamIdentityRef.current = { viewMode, monitorId, enabled, minStreamingPort, scale };
    if (prev.viewMode === viewMode && prev.scale === scale) return;
    // Only a mode flip on an otherwise unchanged stream is this effect's to
    // handle. When the enabled flag moved in the same commit, the disable
    // teardown or the regeneration effect already owns that key. When the
    // monitor moved, the key held here was opened against the previous
    // monitor's URL and port while every prop now describes the new one, so
    // there is nothing here that could quit it correctly; standing down at
    // least avoids quitting the wrong monitor's stream. That leaves the old
    // key to the unmount path, which is a pre-existing gap in the monitor-
    // change path (the regeneration effect above returns early on a live hook
    // and never mints for the new monitor either). It is unreachable from the
    // app today because every call site that swaps monitors remounts instead,
    // via a keyed element - see MonitorDetail's `key=` comment and refs #201.
    //
    // minStreamingPort is deliberately NOT part of this comparison: it is
    // derived from the view mode, so it changes BECAUSE of the flip.
    if (prev.monitorId !== monitorId || prev.enabled !== enabled) return;
    // A disabled hook owns no stream: the disable teardown already quit its key
    // and re-enabling mints a fresh one, so there is nothing to do here.
    if (!enabled || !monitorId) return;

    if (prev.viewMode === 'streaming') {
      // Both values are forced back to what the key was opened under. The
      // params effect above runs earlier in this same commit and has already
      // rebuilt the ref for the NEW mode, where viewMode is 'snapshot' (which
      // would make the quit a silent no-op) and minStreamingPort is undefined,
      // because the caller only computes a port for streaming. A CMD_QUIT sent
      // to the portal's default port on a multi-port install is answered by a
      // server that knows nothing about this connkey: the request succeeds,
      // the log says the stream closed, and the nph-zms process on the real
      // port keeps running.
      void quitStreamForParams(
        {
          ...cleanupParamsRef.current,
          viewMode: 'streaming',
          minStreamingPort: prev.minStreamingPort,
        },
        logFn,
        prev.viewMode === viewMode ? 'scale' : 'view-mode',
      );
    }

    const newKey = regenerateConnKey(cacheKey);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    cleanupParamsRef.current = buildCleanupParams(newKey);
    // minStreamingPort is a dependency so the identity ref keeps the port the
    // current stream was opened on, even when it changes without a flip (the
    // force-disable-multi-port setting does that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, monitorId, enabled, minStreamingPort, scale]);

  // Capture the live media element on every render. The unmount cleanup runs as
  // a passive effect, by which point React has already nulled mediaRef, so we
  // keep our own handle to the element to tear it down.
  const mediaElRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  useEffect(() => {
    mediaElRef.current = mediaRef.current;
  });

  // Register a profile-switch teardown thunk. A profile switch awaits this
  // (via quitAllActiveStreams) before tearing down the old profile's auth and
  // SSL trust, so the old server's stream is quit while its trust setting and
  // token are still in effect. The thunk reads cleanupParamsRef at call time so
  // it always uses the latest connkey. refs #188
  const streamId = useId();
  useEffect(() => {
    if (!enabled) return;
    registerActiveStream(streamId, () =>
      quitStreamForParams(cleanupParamsRef.current, logFn, 'profile-switch'),
    );
    return () => unregisterActiveStream(streamId);
  }, [streamId, enabled, logFn]);

  // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
  useEffect(() => {
    return () => {
      // A cleanup on an empty-dependency effect is NOT proof of an unmount.
      // React re-runs `[]` effects against a live, still-committed tree in
      // three situations: the StrictMode mount double-invoke, revealing a
      // Suspense/Offscreen subtree that was hidden, and a Fast Refresh update.
      // In all three the DOM node survives and no re-render follows, so a
      // teardown here would quit a stream the user is still watching and strip
      // a `src` React can never put back (its virtual DOM still carries the
      // same URL, so the next diff writes nothing). React detaches the subtree
      // in the mutation phase, well before this passive cleanup runs, so a
      // media element still connected to the document means the component is
      // staying. Nothing is orphaned by skipping: the real unmount still runs
      // this cleanup with the same cleanupParamsRef.
      if (mediaElRef.current?.isConnected) return;

      const params = cleanupParamsRef.current;

      // Send CMD_QUIT to properly close the stream connection (streaming mode
      // only). Fire-and-forget: the unmount is not an async context.
      void quitStreamForParams(params, logFn, 'unmount');

      // After CMD_QUIT, tear down the client side: removing the src aborts the
      // in-flight nph-zms connection and frees the browser connection slot.
      // Use removeAttribute, not src='' (an empty src resolves to the page URL
      // on some engines and triggers a spurious request).
      if (mediaElRef.current) {
        logFn('Aborting media element on unmount', LogLevel.DEBUG, {
          monitorId: params.monitorId,
        });
        mediaElRef.current.removeAttribute('src');
      }
    };
  }, []); // Empty deps = only run on unmount

  // Send CMD_QUIT for a connkey to close its nph-zms process on the server.
  // No-op unless we have a real key, are streaming, and know the portal URL.
  // Errors are ignored: the connection may already be closed.
  const sendCmdQuit = (key: number): void => {
    if (key === 0 || viewMode !== 'streaming' || !portalUrl || !monitorId) return;
    const controlUrl = getZmsControlUrl(
      portalUrl,
      ZMS_COMMANDS.cmdQuit,
      key.toString(),
      { token: accessToken || undefined, minStreamingPort, monitorId },
    );
    httpGet(controlUrl, { timeoutMs: cmdQuitTimeoutMs }).catch(() => {
      // Silently ignore - server connection may already be closed
    });
  };

  // Force-regenerate. Optionally sends CMD_QUIT for the previous connkey first
  // when `killPrevious` is true: used by the visibility-resume, manual-retry,
  // and error-reconnect paths where the old stream may still be alive on the
  // server. Without it, each regeneration would orphan a connkey on ZM and the
  // nph-zms process would only exit after its own idle timeout, leaking sockets
  // in CLOSE_WAIT. Dedupes the log line across all monitors in the same 3s
  // window so a visibility-resume burst surfaces as one line. refs #150
  const forceRegenerate = ({ killPrevious = false }: { killPrevious?: boolean } = {}): number => {
    if (!monitorId) return 0;

    if (killPrevious) {
      sendCmdQuit(prevConnKeyRef.current);
    }

    const newKey = regenerateConnKey(cacheKey);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    log.dedupe('connkey-force-regen', 3000, (suffix) =>
      logFn(`Force-regenerated connkey${suffix}`, LogLevel.INFO, { monitorId, newKey, killPrevious }),
    );
    return newKey;
  };

  // Release the current connkey without minting a new one. Used when the
  // reconnect loop gives up so the last errored connkey is closed on the
  // server now, not left until unmount. Clearing the stored key keeps a quit
  // key from being reused on the next mount (it can collide with server state).
  const releaseConnection = (): void => {
    const key = prevConnKeyRef.current;
    if (key === 0 || viewMode !== 'streaming') return;
    sendCmdQuit(key);
    log.dedupe('connkey-release', 3000, (suffix) =>
      logFn(`Releasing connkey after giving up${suffix}`, LogLevel.INFO, { monitorId, connkey: key }),
    );
    if (monitorId) {
      const store = useMonitorStore.getState();
      if (store.connKeys[cacheKey] === key) {
        store.clearConnKey(cacheKey);
      }
    }
    prevConnKeyRef.current = 0;
  };

  return { connKey, forceRegenerate, releaseConnection };
}
