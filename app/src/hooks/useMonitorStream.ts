/**
 * Monitor Stream Hook
 *
 * Manages the lifecycle of a ZoneMinder video stream or snapshot sequence.
 * Handles connection keys (connkey) to allow multiple simultaneous streams.
 * Implements cache busting and periodic refreshing for snapshot mode.
 *
 * Features:
 * - Supports both 'streaming' (MJPEG) and 'snapshot' (JPEG refresh) modes
 * - Handles connection cleanup on unmount to prevent zombie streams on server
 * - On Tauri desktop in snapshot mode, fetches frames through the Rust HTTP
 *   client and serves them as data: URLs to avoid WebKitGTK socket leaks (#150)
 * - Generates unique connection keys per stream instance
 */

import { useState, useEffect, useRef } from 'react';
import { getStreamUrl } from '../api/monitors';
import { useCurrentProfile } from './useCurrentProfile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useStreamLifecycle } from './useStreamLifecycle';
import { useFreshAccessToken } from './useFreshAccessToken';
import { useServerUrls } from './useServerUrls';
import { log, LogLevel } from '../lib/logger';
import { Platform } from '../lib/platform';
import { startMjpegStream, stopMjpegStream, fetchMjpegSnapshot } from '../lib/tauri-mjpeg';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import type { StreamOptions } from '../api/types';

// Last image transport reported to the log. Module-scoped so the montage's
// many monitor hooks emit a single transport line per app session instead of
// one each. Re-logs only when the transport actually changes.
let lastLoggedImageTransport: string | null = null;

// Encode raw JPEG bytes as a data: URL for <img src>. The Tauri/WebKitGTK path
// uses data: URLs rather than blob: object URLs: WebKitGTK's network process
// never frees blob-registry entries (not even on revokeObjectURL), so they leak,
// whereas data: resources land in the resource cache that the periodic purge in
// src-tauri/src/lib.rs clears. refs #150
function jpegDataUrl(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

interface UseMonitorStreamOptions {
  monitorId: string;
  serverId?: string | null;
  streamOptions?: Partial<StreamOptions>;
  enabled?: boolean; // Enable/disable stream management (default: true)
  /**
   * Override the global Streaming Mode setting for this stream.
   * When set, forces 'streaming' or 'snapshot' regardless of profile settings.
   * Used by the single-monitor page, which always wants continuous streaming.
   */
  viewModeOverride?: 'streaming' | 'snapshot';
}

interface UseMonitorStreamReturn {
  streamUrl: string;
  /**
   * The value to bind to the `<img src>`.
   *
   * - On Tauri desktop, in both snapshot and streaming mode, this is the latest
   *   `data:` URL (snapshot frames via the Rust HTTP client, streaming frames via
   *   the Rust MJPEG reader), or `''` until the first frame arrives. We use
   *   `data:` rather than `blob:` URLs because WebKitGTK's network process never
   *   frees blob-registry entries (not even on revoke), whereas `data:` resources
   *   land in the resource cache that the periodic purge clears. refs #150
   * - In all other cases this equals `streamUrl` (set synchronously), so web and
   *   native (iOS/Android) behavior is byte-for-byte unchanged.
   */
  imageSrc: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  regenerateConnection: () => void;
}

/**
 * Custom hook for managing monitor stream URLs and connections.
 *
 * @param options - Configuration options
 * @param options.monitorId - The ID of the monitor to stream
 * @param options.streamOptions - Optional overrides for stream parameters
 */
export function useMonitorStream({
  monitorId,
  serverId,
  streamOptions = {},
  enabled = true,
  viewModeOverride,
}: UseMonitorStreamOptions): UseMonitorStreamReturn {
  const { currentProfile, settings } = useCurrentProfile();
  const bandwidth = useBandwidthSettings();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const { recordingUrl, portalPath } = useServerUrls(serverId);
  // portalUrl for stream lifecycle = portalPath without /index.php
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : currentProfile?.portalUrl;

  const effectiveViewMode = viewModeOverride ?? settings.viewMode;

  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const imgRef = useRef<HTMLImageElement>(null);

  // On Tauri desktop in snapshot mode we fetch each frame through the Rust HTTP
  // client and display it as a data: URL, so WebKitGTK's network process never
  // opens a socket to ZoneMinder (which it leaks in CLOSE_WAIT). Refs #150.
  const useDataUrlSnapshots = Platform.isTauri && effectiveViewMode === 'snapshot';
  // On Tauri desktop in streaming mode, the persistent MJPEG connection is owned
  // by the Rust reader (mjpeg_start). Frames arrive over a Channel and are shown
  // as data: URLs, so the webview never opens the nph-zms socket that WebKitGTK
  // leaks in CLOSE_WAIT. Refs #155, #150.
  const useRustStreaming = Platform.isTauri && effectiveViewMode === 'streaming';
  const streamIdRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imageSrc, setImageSrc] = useState<string>('');

  // Stream lifecycle: connKey generation, CMD_QUIT on regen/unmount, media abort
  const { connKey, forceRegenerate } = useStreamLifecycle({
    monitorId,
    portalUrl: resolvedPortalUrl,
    accessToken,
    viewMode: effectiveViewMode,
    mediaRef: imgRef,
    logFn: log.monitor,
    enabled,
    minStreamingPort: effectiveViewMode === 'streaming' ? currentProfile?.minStreamingPort : undefined,
  });

  // Reset cacheBuster when connKey changes (new connection)
  useEffect(() => {
    if (connKey !== 0) {
      setCacheBuster(Date.now());
    }
  }, [connKey]);

  // Snapshot mode: periodic refresh
  useEffect(() => {
    if (!enabled || effectiveViewMode !== 'snapshot') return;

    const interval = setInterval(() => {
      setCacheBuster(Date.now());
    }, settings.snapshotRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [enabled, effectiveViewMode, settings.snapshotRefreshInterval]);

  // Build stream URL - ONLY when we have a valid connKey to prevent zombie streams
  const streamUrl = currentProfile && connKey !== 0 && isAccessTokenFresh
    ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
      mode: effectiveViewMode === 'snapshot' ? 'single' : 'jpeg',
      scale: bandwidth.imageScale,
      maxfps:
        effectiveViewMode === 'streaming'
          ? settings.streamMaxFps
          : undefined,
      token: accessToken || undefined,
      connkey: connKey,
      // Only use cacheBuster in snapshot mode to force refresh; streaming mode uses only connkey
      cacheBuster: effectiveViewMode === 'snapshot' ? cacheBuster : undefined,
      // Only use multi-port in streaming mode, not snapshot
      minStreamingPort:
        effectiveViewMode === 'streaming'
          ? currentProfile.minStreamingPort
          : undefined,
      ...streamOptions,
    })
    : '';

  // Default path (streaming, web, iOS/Android native snapshot): the <img>
  // points straight at streamUrl. We mirror it into imageSrc synchronously so
  // the consumer binds to a single field with identical behavior to before.
  //
  // Native (Capacitor) snapshot fetch was tried previously and caused
  // NSURLErrorDomain errors on iOS, so it is deliberately not reintroduced
  // here. Only Tauri desktop uses the data: URL path below.
  useEffect(() => {
    if (useDataUrlSnapshots || useRustStreaming) return;
    setImageSrc(streamUrl);
  }, [useDataUrlSnapshots, useRustStreaming, streamUrl]);

  // Tauri desktop + snapshot mode: fetch each frame through the Rust HTTP
  // client and hand the webview a data: URL. The existing cacheBuster interval
  // drives streamUrl changes, so this effect re-runs once per refresh.
  useEffect(() => {
    if (!enabled || !useDataUrlSnapshots) return;

    if (!streamUrl) {
      setImageSrc('');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bytes = await fetchMjpegSnapshot(streamUrl);
        if (cancelled) return;
        setImageSrc(jpegDataUrl(bytes));
      } catch (error) {
        // Tauri invoke is not abortable mid-flight; discard stale results via
        // the cancelled flag. Log network failures without crashing.
        if (cancelled) return;
        log.monitor(
          `Snapshot frame fetch failed for monitor ${monitorId}`,
          LogLevel.WARN,
          { monitorId, error: error instanceof Error ? error.message : String(error) },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, useDataUrlSnapshots, streamUrl, monitorId]);

  // Tauri desktop + streaming mode: the Rust reader owns the nph-zms socket and
  // pushes JPEG frames over a Channel. Each frame becomes a data: URL. On
  // error/EOF we reconnect with exponential backoff by minting a fresh connkey
  // (forceRegenerate), which re-runs this effect.
  useEffect(() => {
    if (!enabled || !useRustStreaming) return;
    if (!streamUrl) {
      setImageSrc('');
      return;
    }

    let cancelled = false;
    let localId: number | null = null;

    const onFrame = (bytes: ArrayBuffer) => {
      if (cancelled) return;
      reconnectAttemptRef.current = 0;
      setImageSrc(jpegDataUrl(bytes));
    };

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const attempt = reconnectAttemptRef.current;
      if (attempt >= ZM_INTEGRATION.mjpegReconnectMaxAttempts) {
        log.monitor(
          `MJPEG stream gave up after ${attempt} reconnect attempts for monitor ${monitorId}`,
          LogLevel.ERROR,
          { monitorId },
        );
        return;
      }
      reconnectAttemptRef.current = attempt + 1;
      const delay = Math.min(
        ZM_INTEGRATION.mjpegReconnectBaseDelayMs * 2 ** attempt,
        ZM_INTEGRATION.mjpegReconnectMaxDelayMs,
      );
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) forceRegenerate();
      }, delay);
    };

    const onError = (message: string) => {
      if (cancelled) return;
      log.monitor(`MJPEG stream error for monitor ${monitorId}`, LogLevel.WARN, {
        monitorId,
        message,
      });
      scheduleReconnect();
    };

    startMjpegStream(streamUrl, onFrame, onError)
      .then((id) => {
        if (cancelled) {
          stopMjpegStream(id);
        } else {
          localId = id;
          streamIdRef.current = id;
        }
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const id = localId ?? streamIdRef.current;
      if (id != null) {
        stopMjpegStream(id);
        streamIdRef.current = null;
      }
    };
    // forceRegenerate is a stable-enough callback from useStreamLifecycle; adding
    // it would re-run the effect every render. Mirror the connkey effect's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, useRustStreaming, streamUrl, monitorId]);

  // Report which transport loads images so #150 can be diagnosed in the field:
  // 'native HTTP' means frames go through the Rust HTTP client (data: URL),
  // 'WebKit' means the <img> loads directly through the webview's own network
  // stack (WebKitGTK on Linux desktop, WKWebView on iOS, the browser on web).
  // Logged once per app session (module guard) and again only if it changes,
  // so the montage's many monitors do not each emit a line.
  useEffect(() => {
    if (!enabled) return;
    const transport = useDataUrlSnapshots
      ? 'native-http'
      : useRustStreaming
        ? 'rust-mjpeg'
        : 'webkit';
    if (transport === lastLoggedImageTransport) return;
    lastLoggedImageTransport = transport;
    const label =
      transport === 'native-http'
        ? 'native HTTP (Tauri Rust client)'
        : transport === 'rust-mjpeg'
          ? 'Rust MJPEG reader (Tauri Channel)'
          : 'WebKit (webview <img>)';
    log.monitor(`Image transport: ${label}`, LogLevel.INFO, {
      transport,
      viewMode: effectiveViewMode,
    });
  }, [enabled, useDataUrlSnapshots, useRustStreaming, effectiveViewMode]);

  const regenerateConnection = () => {
    log.monitor(`Manually regenerating connection for monitor ${monitorId}`, LogLevel.WARN);
    forceRegenerate();
    setCacheBuster(Date.now());
  };

  return {
    streamUrl,
    imageSrc,
    imgRef,
    regenerateConnection,
  };
}
