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
 *   client and serves them as blob: URLs to avoid WebKitGTK socket leaks (#150)
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
   *   `blob:` object URL (snapshot frames via the Rust HTTP client, streaming
   *   frames via the Rust MJPEG reader), or `''` until the first frame arrives.
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
  // client and display it as a blob: URL, so WebKitGTK's network process never
  // opens a socket to ZoneMinder (which it leaks in CLOSE_WAIT). Refs #150.
  const useBlobSnapshots = Platform.isTauri && effectiveViewMode === 'snapshot';
  // On Tauri desktop in streaming mode, the persistent MJPEG connection is owned
  // by the Rust reader (mjpeg_start). Frames arrive over a Channel and are shown
  // as blob: URLs, so the webview never opens the nph-zms socket that WebKitGTK
  // leaks in CLOSE_WAIT. Refs #155, #150.
  const useRustStreaming = Platform.isTauri && effectiveViewMode === 'streaming';
  // The blob: URL of the frame currently bound to <img src>. Tracked so the
  // previous one can be revoked when a newer frame lands, preventing a memory
  // leak. Holds the latest URL only.
  const blobUrlRef = useRef<string>('');
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
    }, bandwidth.snapshotRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [enabled, effectiveViewMode, bandwidth.snapshotRefreshInterval]);

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
  // here. Only Tauri desktop uses the blob path below.
  useEffect(() => {
    if (useBlobSnapshots || useRustStreaming) return;
    setImageSrc(streamUrl);
  }, [useBlobSnapshots, useRustStreaming, streamUrl]);

  // Tauri desktop + snapshot mode: fetch each frame through the Rust HTTP
  // client and hand the webview a blob: URL. The existing cacheBuster interval
  // drives streamUrl changes, so this effect re-runs once per refresh.
  useEffect(() => {
    if (!enabled || !useBlobSnapshots) return;

    if (!streamUrl) {
      setImageSrc('');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bytes = await fetchMjpegSnapshot(streamUrl);
        if (cancelled) return;
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const previousUrl = blobUrlRef.current;
        blobUrlRef.current = url;
        setImageSrc(url);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
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
  }, [enabled, useBlobSnapshots, streamUrl, monitorId]);

  // Tauri desktop + streaming mode: the Rust reader owns the nph-zms socket and
  // pushes JPEG frames over a Channel. Each frame becomes a blob: URL; the
  // previous one is revoked. On error/EOF we reconnect with exponential backoff
  // by minting a fresh connkey (forceRegenerate), which re-runs this effect.
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
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const previousUrl = blobUrlRef.current;
      blobUrlRef.current = url;
      setImageSrc(url);
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
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

  // On unmount, revoke the last outstanding object URL so the final frame's
  // blob is not leaked.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, []);

  // Report which transport loads images so #150 can be diagnosed in the field:
  // 'native HTTP' means frames go through the Rust HTTP client (blob URL),
  // 'WebKit' means the <img> loads directly through the webview's own network
  // stack (WebKitGTK on Linux desktop, WKWebView on iOS, the browser on web).
  // Logged once per app session (module guard) and again only if it changes,
  // so the montage's many monitors do not each emit a line.
  useEffect(() => {
    if (!enabled) return;
    const transport = useBlobSnapshots
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
  }, [enabled, useBlobSnapshots, useRustStreaming, effectiveViewMode]);

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
