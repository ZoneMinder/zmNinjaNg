/**
 * Monitor Stream Hook
 *
 * Manages the lifecycle of a ZoneMinder video stream or snapshot sequence.
 * Handles connection keys (connkey) so multiple simultaneous streams can run.
 * Implements cache busting and periodic refreshing for snapshot mode.
 *
 * Features:
 * - Supports 'streaming' (MJPEG) and 'snapshot' (periodic JPEG) modes
 * - Sends CMD_QUIT to ZM on unmount to prevent zombie nph-zms processes
 * - Reconnects MJPEG with exponential backoff on stream error
 * - Refetches and rebinds on visibility return (page resumed from background)
 */

import { useState, useEffect, useRef } from 'react';
import { getStreamUrl } from '../api/monitors';
import { useCurrentProfile } from './useCurrentProfile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useStreamLifecycle } from './useStreamLifecycle';
import { useFreshAccessToken } from './useFreshAccessToken';
import { useServerUrls } from './useServerUrls';
import { useVisibilityResume } from './useVisibilityResume';
import { useAuthStore } from '../stores/auth';
import { log, LogLevel } from '../lib/logger';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import type { StreamOptions } from '../api/types';

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
   * The value to bind to the `<img src>`. Equal to streamUrl once a connkey
   * has been minted; empty string before that.
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

  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror settings.insomnia into a ref so the scheduleReconnect closure
  // reads the latest value without re-running its effect.
  const insomniaRef = useRef(settings.insomnia);
  insomniaRef.current = settings.insomnia;
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

  // The `<img>` points straight at streamUrl. We mirror it into imageSrc so the
  // consumer binds to a single field; reconnect logic below depends on the
  // <img>'s native onError handler which the consuming player wires up.
  useEffect(() => {
    setImageSrc(streamUrl);
  }, [streamUrl]);

  // MJPEG reconnect: scheduleReconnect is exposed via regenerateConnection
  // (manual) and the visibility-resume callback; the <img onError> handler in
  // LiveMonitorPlayer also calls regenerateConnection. The retry counter caps
  // at mjpegReconnectMaxAttempts unless insomnia is on.
  const scheduleReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const attempt = reconnectAttemptRef.current;
    const insomniaOn = insomniaRef.current;
    if (!insomniaOn && attempt >= ZM_INTEGRATION.mjpegReconnectMaxAttempts) {
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
      forceRegenerate();
    }, delay);
  };

  const regenerateConnection = () => {
    log.monitor(`Manually regenerating connection for monitor ${monitorId}`, LogLevel.WARN);
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // killPrevious: the user clicked Retry but the old stream may still be
    // running on ZM (they might click Retry preemptively, not after an error).
    // Close it so we don't orphan a connkey.
    forceRegenerate({ killPrevious: true });
    setCacheBuster(Date.now());
  };

  // Cleanup pending reconnect on unmount
  useEffect(() => () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Suppress unused-warning while we keep the reconnect helper available for
  // future <img onError> wiring; LiveMonitorPlayer currently calls
  // regenerateConnection directly which exercises the same path.
  void scheduleReconnect;

  // When the page returns from background, MJPEG streams may have stalled
  // while the browser was throttling timers. The token may also have lapsed
  // mid-suspension. Reset the retry counter, refresh the token defensively,
  // then mint a fresh connkey so the stream reconnects. Snapshot mode
  // self-heals on its next interval tick, so the resume is streaming-only.
  // refs #150
  useVisibilityResume(() => {
    if (!enabled || effectiveViewMode !== 'streaming') return;
    log.dedupe('stream-visibility-resume', 3000, (suffix) =>
      log.monitor(`Resuming streams after visibility return${suffix}`, LogLevel.INFO, {
        monitorId,
        reconnectAttempts: reconnectAttemptRef.current,
      }),
    );
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    void useAuthStore.getState().getFreshAccessToken().finally(() => {
      // killPrevious closes the old nph-zms process on ZM. The server side
      // may still be alive (just throttled with us during the suspend), so
      // without this each resume would orphan a connkey.
      forceRegenerate({ killPrevious: true });
    });
  }, { enabled: enabled && effectiveViewMode === 'streaming' });

  return {
    streamUrl,
    imageSrc,
    imgRef,
    regenerateConnection,
  };
}
