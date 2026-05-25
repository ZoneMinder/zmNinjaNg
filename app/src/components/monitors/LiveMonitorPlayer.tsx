/**
 * LiveMonitorPlayer. Selects WebRTC (Go2RTC) or MJPEG based on user
 * preferences and monitor capabilities.
 *
 * Protocol negotiation: Go2RTC tries protocols in order (WebRTC → MSE → HLS).
 * If connected but no video frames arrive within a timeout, falls back to MJPEG.
 * The status badge updates in real-time to show which protocol is being tried.
 */

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Monitor, Profile } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { useGo2RTCStream } from '../../hooks/useGo2RTCStream';
import { useMonitorStream } from '../../hooks/useMonitorStream';
import { log, LogLevel } from '../../lib/logger';
import {
  GO2RTC_VIDEO_TIMEOUT_S,
  GO2RTC_FRAME_POLL_MS,
  GO2RTC_LIVENESS_CHECK_MS,
  GO2RTC_FREEZE_THRESHOLD_S,
  GO2RTC_MAX_FREEZE_RETRIES,
  GO2RTC_FREEZE_RESET_S,
} from '../../lib/zmninja-ng-constants';
import { Button } from '../ui/button';
import { VideoOff } from 'lucide-react';

/** Minutes before retrying Go2RTC on a monitor that previously failed */
const GO2RTC_RETRY_INTERVAL_MIN = 5;

/** Cache of monitors where Go2RTC failed — skip straight to MJPEG until TTL expires */
const go2rtcFailureCache = new Map<string, number>();

function isGo2rtcCachedFailure(monitorId: string): boolean {
  const failedAt = go2rtcFailureCache.get(monitorId);
  if (!failedAt) return false;
  if (Date.now() - failedAt > GO2RTC_RETRY_INTERVAL_MIN * 60 * 1000) {
    go2rtcFailureCache.delete(monitorId);
    return false;
  }
  return true;
}

function markGo2rtcFailed(monitorId: string): void {
  go2rtcFailureCache.set(monitorId, Date.now());
}

export interface LiveMonitorPlayerProps {
  monitor: Monitor;
  profile: Profile | null;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /** Show native video controls on Go2RTC streams (mute, fullscreen) */
  showControls?: boolean;
  externalMediaRef?: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  muted?: boolean;
  onLoad?: () => void;
  /** Called when the effective streaming protocol changes (e.g., 'MSE', 'WebRTC', 'MJPEG') */
  onProtocolChange?: (protocol: string) => void;
  /**
   * Force a specific MJPEG view mode regardless of the global Streaming Mode
   * setting. The single-monitor page uses 'streaming' so it never falls back
   * to periodic snapshots.
   */
  forceViewMode?: 'streaming' | 'snapshot';
  /**
   * Grid position in montage, used to stagger Go2RTC connection starts.
   * Defaults to 0 (no stagger) for single-monitor callers.
   */
  staggerIndex?: number;
}

export function LiveMonitorPlayer({
  monitor,
  profile,
  className = '',
  objectFit = 'contain',
  showControls = false,
  externalMediaRef,
  muted = true,
  onLoad,
  onProtocolChange,
  forceViewMode,
  staggerIndex = 0,
}: LiveMonitorPlayerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const rawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings[profile?.id || ''])
  );
  const globalStreamingMethod = rawSettings?.streamingMethod ?? 'auto';
  // Per-monitor override takes precedence over global setting
  const monitorOverride = rawSettings?.monitorStreamingOverrides?.[monitor.Id];
  const userStreamingPreference = monitorOverride ?? globalStreamingMethod;

  // Determine streaming method: WebRTC if supported and enabled, otherwise MJPEG
  const lastLoggedRef = useRef<string>('');
  const streamingMethod = useMemo(() => {
    const canUseWebRTC =
      userStreamingPreference !== 'mjpeg' &&
      monitor.Go2RTCEnabled === true &&
      !!profile?.go2rtcUrl;

    const method = canUseWebRTC ? 'webrtc' : 'mjpeg';

    // Log once per monitor/method combination
    const logKey = `${monitor.Id}-${method}`;
    if (lastLoggedRef.current !== logKey) {
      lastLoggedRef.current = logKey;
      log.videoPlayer(`Streaming: ${method === 'webrtc' ? 'WebRTC' : 'MJPEG'}`, LogLevel.INFO, {
        monitorId: monitor.Id,
        monitorName: monitor.Name,
        monitorGo2RTCEnabled: monitor.Go2RTCEnabled,
        ...(method === 'webrtc' && { go2rtcUrl: profile?.go2rtcUrl }),
      });
    }

    return method;
  }, [userStreamingPreference, monitor.Go2RTCEnabled, monitor.Id, monitor.Name, profile?.go2rtcUrl]);

  const [go2rtcFailed, setGo2rtcFailed] = useState(() => isGo2rtcCachedFailure(monitor.Id));
  const [hasVideoFrames, setHasVideoFrames] = useState(false);

  // When user explicitly enables Go2RTC (streamingMethod changes to webrtc),
  // clear the failure cache so it retries immediately
  const prevStreamingMethodRef = useRef(streamingMethod);
  if (streamingMethod === 'webrtc' && prevStreamingMethodRef.current === 'mjpeg') {
    go2rtcFailureCache.delete(monitor.Id);
    if (go2rtcFailed) {
      setGo2rtcFailed(false);
      setHasVideoFrames(false);
    }
  }
  prevStreamingMethodRef.current = streamingMethod;

  const effectiveStreamingMethod = go2rtcFailed ? 'mjpeg' : streamingMethod;

  // MJPEG-first: while the go2rtc/MSE stream is still establishing (selected,
  // not yet failed, no decoded frames yet), show the MJPEG stream immediately as
  // a placeholder so the tile isn't blank. Once MSE produces frames we swap to
  // the <video>; if MSE times out/fails, effectiveStreamingMethod flips to
  // 'mjpeg' and MJPEG becomes the real stream.
  const showMjpegPlaceholder = effectiveStreamingMethod === 'webrtc' && !hasVideoFrames;

  const go2rtcStream = useGo2RTCStream({
    go2rtcUrl: profile?.go2rtcUrl || '',
    monitorId: monitor.Id,
    channel: monitor.StreamChannel || 0,
    containerRef,
    protocols: rawSettings?.webrtcProtocols,
    enabled: streamingMethod === 'webrtc' && !!profile?.go2rtcUrl && !go2rtcFailed,
    muted,
    controls: showControls,
    staggerIndex,
  });

  // Fall back to MJPEG when Go2RTC reports error state
  useEffect(() => {
    if (streamingMethod === 'webrtc' && go2rtcStream.state === 'error' && !go2rtcFailed) {
      log.videoPlayer('Go2RTC error, falling back to MJPEG', LogLevel.WARN, {
        monitorId: monitor.Id,
        error: go2rtcStream.error,
      });
      markGo2rtcFailed(monitor.Id);
      setGo2rtcFailed(true);
    }
  }, [streamingMethod, go2rtcStream.state, go2rtcStream.error, go2rtcFailed, monitor.Id]);

  // Fall back to MJPEG when Go2RTC connects but no video frames arrive
  const videoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearVideoTimeout = useCallback(() => {
    if (videoTimeoutRef.current) {
      clearTimeout(videoTimeoutRef.current);
      videoTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (streamingMethod !== 'webrtc' || go2rtcFailed) {
      clearVideoTimeout();
      return;
    }

    if (go2rtcStream.state === 'connected' && !hasVideoFrames) {
      // Start timeout — if no frames arrive, fall back
      clearVideoTimeout();
      videoTimeoutRef.current = setTimeout(() => {
        // Check for video frames by inspecting the video element
        const video = go2rtcStream.getVideoElement();
        const hasFrames = video && video.videoWidth > 0 && video.videoHeight > 0;

        if (hasFrames && video.paused) {
          // Autoplay was blocked — try to play programmatically
          log.videoPlayer('Go2RTC has frames but paused, attempting play', LogLevel.INFO, { monitorId: monitor.Id });
          video.play().catch(() => {
            // Play failed — still has frames so mark as success
          });
          setHasVideoFrames(true);
        } else if (!hasFrames) {
          log.videoPlayer('Go2RTC connected but no video frames, falling back to MJPEG', LogLevel.WARN, {
            monitorId: monitor.Id,
            protocol: go2rtcStream.activeProtocol,
            videoWidth: video?.videoWidth,
            videoHeight: video?.videoHeight,
          });
          markGo2rtcFailed(monitor.Id);
          setGo2rtcFailed(true);
        } else {
          setHasVideoFrames(true);
        }
      }, GO2RTC_VIDEO_TIMEOUT_S * 1000);
    }

    if (hasVideoFrames) {
      clearVideoTimeout();
    }

    return clearVideoTimeout;
  }, [streamingMethod, go2rtcFailed, go2rtcStream.state, hasVideoFrames, go2rtcStream, monitor.Id, clearVideoTimeout]);

  // Swap from the MJPEG-first placeholder to the MSE <video> as soon as decoded
  // frames are available, rather than waiting for the timeout deadline. Polls
  // videoWidth/videoHeight while connected and not yet showing frames.
  useEffect(() => {
    if (streamingMethod !== 'webrtc' || go2rtcFailed || hasVideoFrames) return;
    if (go2rtcStream.state !== 'connected') return;

    const poll = setInterval(() => {
      const video = go2rtcStream.getVideoElement();
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        if (video.paused) {
          video.play().catch(() => { /* still has frames; treat as success */ });
        }
        setHasVideoFrames(true);
      }
    }, GO2RTC_FRAME_POLL_MS);

    return () => clearInterval(poll);
  }, [streamingMethod, go2rtcFailed, hasVideoFrames, go2rtcStream.state, go2rtcStream]);

  // Post-first-frame liveness watchdog. The pre-frame timeout/poll effects above
  // only run until the first decoded frame. Once MSE is playing they bail, so a
  // stream that freezes afterwards (source hiccup, MSE buffer underrun, missing
  // keyframe, silent WebSocket stall) would sit frozen forever. This effect runs
  // only while MSE is actually playing and detects that case.
  const freezeRetryCountRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastAdvanceAtRef = useRef(0);
  const lastFreezeAtRef = useRef(0);
  const monitorId = monitor.Id;

  useEffect(() => {
    if (effectiveStreamingMethod !== 'webrtc' || !hasVideoFrames || go2rtcFailed) {
      return;
    }

    // Seed the freeze tracker on (re)entry so the first tick has a baseline.
    const now0 = Date.now();
    lastVideoTimeRef.current = -1;
    lastAdvanceAtRef.current = now0;

    const handleFreeze = (reason: string, detail: Record<string, unknown>) => {
      freezeRetryCountRef.current += 1;
      lastFreezeAtRef.current = Date.now();
      const retries = freezeRetryCountRef.current;

      if (retries > GO2RTC_MAX_FREEZE_RETRIES) {
        log.videoPlayer('Go2RTC stream frozen, max retries reached, falling back to MJPEG', LogLevel.WARN, {
          monitorId,
          reason,
          retries,
          ...detail,
        });
        markGo2rtcFailed(monitorId);
        setGo2rtcFailed(true);
        return;
      }

      log.videoPlayer('Go2RTC stream frozen, retrying connection', LogLevel.WARN, {
        monitorId,
        reason,
        retries,
        ...detail,
      });
      // Show the placeholder/connecting badge again while the stream reconnects.
      setHasVideoFrames(false);
      go2rtcStream.retry();
    };

    const interval = setInterval(() => {
      // A silent WebSocket stall surfaces as the hook's 'disconnected' state
      // after frames were already flowing. Treat it as a freeze immediately.
      if (go2rtcStream.state === 'disconnected') {
        handleFreeze('disconnected', { state: go2rtcStream.state });
        return;
      }

      const video = go2rtcStream.getVideoElement();
      if (!video) return;

      const now = Date.now();
      const stalledReadyState = video.readyState < 3; // < HAVE_FUTURE_DATA
      const advanced = !video.ended && !stalledReadyState && video.currentTime > lastVideoTimeRef.current;

      if (advanced) {
        lastVideoTimeRef.current = video.currentTime;
        lastAdvanceAtRef.current = now;
        // Once the stream has been advancing healthily for long enough after the
        // last freeze, forget earlier hiccups so an occasional freeze hours apart
        // doesn't permanently demote the stream to MJPEG.
        if (
          freezeRetryCountRef.current > 0 &&
          now - lastFreezeAtRef.current >= GO2RTC_FREEZE_RESET_S * 1000
        ) {
          freezeRetryCountRef.current = 0;
        }
        return;
      }

      const frozenForMs = now - lastAdvanceAtRef.current;
      if (frozenForMs >= GO2RTC_FREEZE_THRESHOLD_S * 1000) {
        handleFreeze(video.ended ? 'ended' : stalledReadyState ? 'readyState' : 'no-advance', {
          currentTime: video.currentTime,
          readyState: video.readyState,
          ended: video.ended,
          frozenForMs,
        });
      }
    }, GO2RTC_LIVENESS_CHECK_MS);

    return () => clearInterval(interval);
  }, [effectiveStreamingMethod, hasVideoFrames, go2rtcFailed, go2rtcStream, monitorId]);

  // Reset failure state when monitor changes (check cache for new monitor)
  useEffect(() => {
    setGo2rtcFailed(isGo2rtcCachedFailure(monitor.Id));
    setHasVideoFrames(false);
    freezeRetryCountRef.current = 0;
    lastFreezeAtRef.current = 0;
  }, [monitor.Id]);

  const mjpegStream = useMonitorStream({
    monitorId: monitor.Id,
    serverId: monitor.ServerId,
    streamOptions: {
      maxfps: rawSettings?.streamMaxFps,
      scale: rawSettings?.streamScale,
    },
    enabled: effectiveStreamingMethod === 'mjpeg' || showMjpegPlaceholder,
    viewModeOverride: forceViewMode,
  });

  // Track MJPEG image error state
  const [mjpegError, setMjpegError] = useState(false);
  useEffect(() => {
    if (effectiveStreamingMethod === 'mjpeg' || showMjpegPlaceholder) {
      setMjpegError(false);
    }
  }, [effectiveStreamingMethod, showMjpegPlaceholder, monitor.Id]);

  const handleMjpegLoad = useCallback(() => {
    setMjpegError(false);
    onLoad?.();
  }, [onLoad]);

  const handleMjpegError = useCallback(() => {
    setMjpegError(true);
  }, []);

  // Sync media ref for snapshot capture
  useEffect(() => {
    if (!externalMediaRef) return;
    const ref = externalMediaRef as React.MutableRefObject<HTMLImageElement | HTMLVideoElement | null>;

    if (effectiveStreamingMethod === 'mjpeg' && imgRef.current) {
      ref.current = imgRef.current;
    } else if (effectiveStreamingMethod === 'webrtc') {
      ref.current = go2rtcStream.getVideoElement();
    }
  }, [externalMediaRef, effectiveStreamingMethod, mjpegStream.streamUrl, go2rtcStream.state, go2rtcStream]);

  // Derive current status
  const isWebRTC = effectiveStreamingMethod === 'webrtc';
  const status = useMemo(() => ({
    state: isWebRTC ? go2rtcStream.state : (mjpegStream.streamUrl ? 'connected' : 'connecting'),
    error: isWebRTC ? go2rtcStream.error : null,
    protocol: isWebRTC ? (go2rtcStream.activeProtocol || 'go2rtc') : 'mjpeg',
  }), [isWebRTC, go2rtcStream.state, go2rtcStream.error, go2rtcStream.activeProtocol, mjpegStream.streamUrl]);

  const handleRetry = () => {
    log.videoPlayer('Retry requested', LogLevel.INFO, { monitorId: monitor.Id, go2rtcFailed });

    if (go2rtcFailed) {
      setGo2rtcFailed(false);
      setHasVideoFrames(false);
      go2rtcStream.retry();
    } else if (isWebRTC) {
      go2rtcStream.retry();
    } else {
      mjpegStream.regenerateConnection();
    }
  };

  // Derive display protocol label
  const displayProtocol = isWebRTC
    ? (go2rtcStream.activeProtocol?.toUpperCase() || 'Go2RTC')
    : 'MJPEG';

  // Notify parent when protocol changes
  useEffect(() => {
    onProtocolChange?.(displayProtocol);
  }, [displayProtocol, onProtocolChange]);

  // Log status changes
  useEffect(() => {
    log.videoPlayer('Stream status', LogLevel.DEBUG, {
      method: effectiveStreamingMethod,
      state: status.state,
      protocol: status.protocol,
      monitorId: monitor.Id,
    });
  }, [effectiveStreamingMethod, status.state, status.protocol, monitor.Id]);

  // Notify parent when stream is connected (WebRTC path)
  useEffect(() => {
    if (isWebRTC && status.state === 'connected' && hasVideoFrames) {
      onLoad?.();
    }
  }, [isWebRTC, status.state, hasVideoFrames, onLoad]);

  // The MJPEG <img> is rendered both when MJPEG is the real stream and as the
  // MJPEG-first placeholder while MSE connects. It has a frame to show whenever
  // the stream is configured and not errored.
  const hasMjpegFrame = !!mjpegStream.streamUrl && !!mjpegStream.imageSrc && !mjpegError;
  const showMjpeg = !isWebRTC || showMjpegPlaceholder;

  // The MSE "connecting" badge shows while we display the MJPEG placeholder and
  // the go2rtc stream is still establishing (not yet failed/errored). Once MSE
  // has frames we swap to <video> and showMjpegPlaceholder is false; if MSE
  // fails, effectiveStreamingMethod flips to 'mjpeg' so isWebRTC is false.
  const showConnectingBadge = isWebRTC && showMjpegPlaceholder && status.state !== 'error';

  // Whether we're in a "waiting for video" state
  // Show VideoOff placeholder only when truly no video:
  // - Go2RTC connecting and the MJPEG placeholder has no frame yet either
  // - MJPEG with no stream configured, no frame yet, or an error.
  //   imageSrc is empty during the Tauri-snapshot first-frame gap (the frame is
  //   being fetched through the Rust HTTP client); for every other case imageSrc
  //   equals streamUrl, so this matches the previous behavior.
  const showNoVideo = (isWebRTC && !hasVideoFrames && !hasMjpegFrame) ||
    (!isWebRTC && (!mjpegStream.streamUrl || !mjpegStream.imageSrc || mjpegError));

  return (
    <div className="relative w-full h-full" data-testid="video-player">
      {/* Background placeholder — shown until video/image loads */}
      {showNoVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30" data-testid="video-player-loading">
          <VideoOff className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}

      {isWebRTC && (
        <div
          ref={containerRef}
          className={`w-full h-full ${className}`}
          style={{ objectFit, position: 'relative', zIndex: 0 } as React.CSSProperties}
          data-testid="video-player-webrtc-container"
        />
      )}

      {showMjpeg && hasMjpegFrame && (
        <img
          ref={imgRef}
          className={`w-full h-full ${className}`}
          style={
            showMjpegPlaceholder
              ? { objectFit, position: 'absolute', inset: 0, zIndex: 1 }
              : { objectFit }
          }
          data-testid="video-player-mjpeg"
          src={mjpegStream.imageSrc}
          alt={monitor.Name}
          onLoad={handleMjpegLoad}
          onError={handleMjpegError}
        />
      )}

      {/* MSE-connecting badge — blinking dots while MJPEG placeholder is shown */}
      {showConnectingBadge && (
        <div
          className="absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded bg-black/50 text-white/90 text-xs font-bold leading-none animate-pulse pointer-events-none"
          data-testid="mse-connecting-badge"
          aria-hidden="true"
        >
          …
        </div>
      )}

      {/* Error overlay */}
      {status.state === 'error' && status.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white p-4" data-testid="video-player-error">
          <VideoOff className="h-10 w-10 text-white/60 mb-3" />
          <p className="text-center text-sm mb-2">{t('video.connection_failed')}</p>
          <p className="text-xs text-gray-300 mb-4">{status.error}</p>
          <Button onClick={handleRetry} variant="secondary" size="sm" data-testid="video-player-retry">
            {t('video.retry_connection')}
          </Button>
        </div>
      )}
    </div>
  );
}
