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

import { useState, useEffect, useRef, useCallback } from 'react';
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

// Frames are decoded with WebCodecs ImageDecoder, which takes the raw bytes
// directly. We deliberately avoid constructing a Blob per frame: WebKitGTK's
// blob registry lives in the network process and never frees the backing bytes
// (even on revokeObjectURL or GC), so a Blob per frame grew that process at
// ~24 MB/min. ImageDecoder has no such registry. ImageDecoder is not in every
// TS DOM lib, so reach it through a minimal typed view of the global.
type DecodedImage = { displayWidth: number; displayHeight: number; close(): void };
type ImageDecoderInstance = { decode(): Promise<{ image: DecodedImage }>; close(): void };
type ImageDecoderCtor = new (init: { data: ArrayBuffer | ArrayBufferView; type: string }) => ImageDecoderInstance;
function getImageDecoder(): ImageDecoderCtor | undefined {
  return (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
}

// Base64-encode raw bytes for the data: URL fallback (used only when the webview
// lacks ImageDecoder). data: URLs are parsed inline and never touch the blob
// registry, so this stays Blob-free.
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
   * - On Tauri desktop (snapshot and streaming) this stays `''`; frames are drawn
   *   to the `<canvas>` at `canvasRef` instead (see `useCanvas`).
   * - In all other cases this equals `streamUrl` (set synchronously), so web and
   *   native (iOS/Android) behavior is byte-for-byte unchanged.
   */
  imageSrc: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  /**
   * The `<canvas>` to draw frames into on Tauri desktop, in both snapshot and
   * streaming mode (`useCanvas` is true); null elsewhere. Frames are decoded with
   * createImageBitmap and drawn here, avoiding `blob:` URLs whose bytes WebKitGTK
   * retained in the network process.
   */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True when the consumer should render the `<canvas>` instead of the `<img>`. */
  useCanvas: boolean;
  /** True once there is something to display (first frame drawn or imageSrc set). */
  hasFrame: boolean;
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
  // client (so WebKitGTK's network process never opens a socket to ZoneMinder,
  // which it leaks in CLOSE_WAIT, refs #150) and draw it to the canvas.
  const useTauriSnapshot = Platform.isTauri && effectiveViewMode === 'snapshot';
  // On Tauri desktop in streaming mode, the persistent MJPEG connection is owned
  // by the Rust reader (mjpeg_start). Frames arrive over a Channel, so the webview
  // never opens the nph-zms socket that WebKitGTK leaks in CLOSE_WAIT (refs #155,
  // #150) and are drawn to the canvas.
  const useRustStreaming = Platform.isTauri && effectiveViewMode === 'streaming';
  // Both Tauri paths render to a <canvas> via createImageBitmap rather than a
  // blob: <img>, because WebKitGTK retained the decoded blob bytes in its network
  // process (it grew ~24 MB/min during streaming). Web and native keep the <img>.
  const useCanvas = useTauriSnapshot || useRustStreaming;
  const streamIdRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imageSrc, setImageSrc] = useState<string>('');
  // Canvas target for the Tauri paths. Frames are decoded and drawn here, then
  // the bitmap is closed. hasFrameRef guards the one-time setHasCanvasFrame(true)
  // so we do not re-render on every frame.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasFrameRef = useRef(false);
  const [hasCanvasFrame, setHasCanvasFrame] = useState(false);

  // Decode one JPEG frame and draw it to the canvas. Used by both the snapshot
  // (one frame per refresh) and streaming (continuous) paths. No Blob is created
  // (see ImageDecoderClass note above). Returns after the frame is drawn or
  // silently skips an undecodable frame.
  const drawFrame = useCallback(async (bytes: ArrayBuffer, isCancelled: () => boolean) => {
    const paint = (source: CanvasImageSource, width: number, height: number) => {
      const canvas = canvasRef.current;
      if (isCancelled() || !canvas) return false;
      if (width && canvas.width !== width) canvas.width = width;
      if (height && canvas.height !== height) canvas.height = height;
      canvas.getContext('2d')?.drawImage(source, 0, 0);
      return true;
    };

    try {
      let drawn = false;
      const ImageDecoderClass = getImageDecoder();
      if (ImageDecoderClass) {
        const decoder = new ImageDecoderClass({ data: bytes, type: 'image/jpeg' });
        try {
          const { image } = await decoder.decode();
          drawn = paint(image as unknown as CanvasImageSource, image.displayWidth, image.displayHeight);
          image.close();
        } finally {
          decoder.close();
        }
      } else {
        // Fallback for webviews without WebCodecs: data: URL <img>, still Blob-free.
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image decode failed'));
          img.src = `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
        });
        drawn = paint(img, img.naturalWidth, img.naturalHeight);
      }
      if (!drawn) return;
    } catch {
      return; // skip an undecodable frame
    }

    if (!hasFrameRef.current) {
      hasFrameRef.current = true;
      setHasCanvasFrame(true);
    }
  }, []);

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
  // here. Only Tauri desktop uses the canvas path below.
  useEffect(() => {
    if (useCanvas) return;
    setImageSrc(streamUrl);
  }, [useCanvas, streamUrl]);

  // Tauri desktop + snapshot mode: fetch each frame through the Rust HTTP client
  // and draw it to the canvas. The cacheBuster interval drives streamUrl changes,
  // so this effect re-runs once per refresh.
  useEffect(() => {
    if (!enabled || !useTauriSnapshot) return;

    if (!streamUrl) {
      hasFrameRef.current = false;
      setHasCanvasFrame(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bytes = await fetchMjpegSnapshot(streamUrl);
        if (cancelled) return;
        await drawFrame(bytes, () => cancelled);
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
  }, [enabled, useTauriSnapshot, streamUrl, monitorId, drawFrame]);

  // Tauri desktop + streaming mode: the Rust reader owns the nph-zms socket and
  // pushes JPEG frames over a Channel. Each frame is decoded with
  // createImageBitmap and drawn to a reused <canvas>, then the bitmap is closed.
  // This avoids blob: URLs, whose decoded bytes WebKitGTK retained in the network
  // process (the <img src=blob:> path leaked there at ~24 MB/min). On error/EOF we
  // reconnect with exponential backoff by minting a fresh connkey (forceRegenerate),
  // which re-runs this effect.
  useEffect(() => {
    if (!enabled || !useRustStreaming) return;
    if (!streamUrl) {
      hasFrameRef.current = false;
      setHasCanvasFrame(false);
      return;
    }

    let cancelled = false;
    let localId: number | null = null;
    // Latest-frame-wins: hold only the newest frame and drop any that arrive
    // while a decode is in flight, so a slow decode never builds a backlog.
    let latest: ArrayBuffer | null = null;
    let decoding = false;

    const pump = async () => {
      if (decoding) return;
      decoding = true;
      try {
        while (!cancelled && latest) {
          const bytes = latest;
          latest = null;
          await drawFrame(bytes, () => cancelled);
        }
      } finally {
        decoding = false;
      }
    };

    const onFrame = (bytes: ArrayBuffer) => {
      if (cancelled) return;
      reconnectAttemptRef.current = 0;
      latest = bytes;
      void pump();
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
      latest = null;
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
  }, [enabled, useRustStreaming, streamUrl, monitorId, drawFrame]);

  // Report which transport loads images so #150 can be diagnosed in the field:
  // 'native HTTP' means frames go through the Rust HTTP client (snapshot canvas),
  // 'rust-mjpeg' means the Rust Channel reader (streaming canvas), and 'WebKit'
  // means the <img> loads directly through the webview's own network stack
  // (WKWebView on iOS, the browser on web). Logged once per app session (module
  // guard) and again only if it changes, so the montage's many monitors do not
  // each emit a line.
  useEffect(() => {
    if (!enabled) return;
    const transport = useTauriSnapshot
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
  }, [enabled, useTauriSnapshot, useRustStreaming, effectiveViewMode]);

  const regenerateConnection = () => {
    log.monitor(`Manually regenerating connection for monitor ${monitorId}`, LogLevel.WARN);
    forceRegenerate();
    setCacheBuster(Date.now());
  };

  return {
    streamUrl,
    imageSrc,
    imgRef,
    canvasRef,
    useCanvas,
    hasFrame: useCanvas ? hasCanvasFrame : !!imageSrc,
    regenerateConnection,
  };
}
