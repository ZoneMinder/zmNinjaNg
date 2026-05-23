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
import { httpGet } from '../lib/http';
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
   * - In every case except Tauri desktop snapshot mode this equals `streamUrl`
   *   (set synchronously), so streaming and web/native snapshot behavior is
   *   byte-for-byte unchanged.
   * - On Tauri desktop in snapshot mode this is the latest `blob:` object URL
   *   produced by fetching the frame through the Rust HTTP client, or `''`
   *   until the first frame has been fetched.
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
  // The blob: URL of the frame currently bound to <img src>. Tracked so the
  // previous one can be revoked when a newer frame lands, preventing a memory
  // leak. Holds the latest URL only.
  const blobUrlRef = useRef<string>('');
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
  // here. Only Tauri desktop uses the blob path below.
  useEffect(() => {
    if (useBlobSnapshots) return;
    setImageSrc(streamUrl);
  }, [useBlobSnapshots, streamUrl]);

  // Tauri desktop + snapshot mode: fetch each frame through the Rust HTTP
  // client and hand the webview a blob: URL. The existing cacheBuster interval
  // drives streamUrl changes, so this effect re-runs once per refresh.
  useEffect(() => {
    if (!enabled || !useBlobSnapshots) return;

    if (!streamUrl) {
      setImageSrc('');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const { data: blob } = await httpGet<Blob>(streamUrl, {
          responseType: 'blob',
          signal: controller.signal,
          timeoutMs: ZM_INTEGRATION.snapshotFrameFetchTimeoutMs,
          // One request per frame per monitor would flood the HTTP log; the
          // transport is reported once below and failures are logged here.
          suppressLog: true,
        });
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        const previousUrl = blobUrlRef.current;
        blobUrlRef.current = url;
        setImageSrc(url);
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
      } catch (error) {
        // An aborted fetch is the normal outcome when a newer frame supersedes
        // this one or the component unmounts. Swallow it quietly; log anything
        // else (network failure, cert rejection) without crashing.
        if (controller.signal.aborted) return;
        log.monitor(
          `Snapshot frame fetch failed for monitor ${monitorId}`,
          LogLevel.WARN,
          { monitorId, error: error instanceof Error ? error.message : String(error) },
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, useBlobSnapshots, streamUrl, monitorId]);

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
    const transport = useBlobSnapshots ? 'native-http' : 'webkit';
    if (transport === lastLoggedImageTransport) return;
    lastLoggedImageTransport = transport;
    log.monitor(
      `Image transport: ${useBlobSnapshots ? 'native HTTP (Tauri Rust client)' : 'WebKit (webview <img>)'}`,
      LogLevel.INFO,
      { transport, viewMode: effectiveViewMode },
    );
  }, [enabled, useBlobSnapshots, effectiveViewMode]);

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
