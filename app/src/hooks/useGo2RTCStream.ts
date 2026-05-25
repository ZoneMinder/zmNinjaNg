/**
 * useGo2RTCStream Hook
 *
 * Manages streaming via Go2RTC server using video-rtc.js.
 * Video-rtc runs compatible protocols in parallel (MSE+WebRTC or HLS+WebRTC)
 * and uses whichever produces video first.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { VideoRTC } from '../lib/vendor/go2rtc/video-rtc';
import { getGo2RTCWebSocketUrl } from '../lib/url-builder';
import { GO2RTC_CONNECT_DELAY_MS, GO2RTC_MONTAGE_STAGGER_MS } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

// Register VideoRTC custom element once
if (typeof window !== 'undefined' && !customElements.get('video-rtc')) {
  customElements.define('video-rtc', VideoRTC);
  log.videoPlayer('Registered VideoRTC custom element', LogLevel.DEBUG);
}

export type StreamingProtocol = 'webrtc' | 'mse' | 'hls';
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export interface UseGo2RTCStreamOptions {
  go2rtcUrl: string;
  monitorId: string;
  channel?: string | number;
  containerRef: React.RefObject<HTMLElement | null>;
  protocols?: StreamingProtocol[];
  token?: string;
  enabled?: boolean;
  muted?: boolean;
  /** Show native video controls (play/pause, volume, fullscreen) */
  controls?: boolean;
  /**
   * Grid position used to stagger connection starts in montage so all tiles
   * don't open their WebSockets at once. The connect delay is offset by
   * `staggerIndex * GO2RTC_MONTAGE_STAGGER_MS`. Defaults to 0 (no extra delay),
   * so single-monitor callers are unaffected.
   */
  staggerIndex?: number;
}

export interface UseGo2RTCStreamResult {
  state: ConnectionState;
  error: string | null;
  activeProtocol: StreamingProtocol | null;
  retry: () => void;
  stop: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
  getVideoElement: () => HTMLVideoElement | null;
}

export function useGo2RTCStream(options: UseGo2RTCStreamOptions): UseGo2RTCStreamResult {
  const {
    go2rtcUrl,
    monitorId,
    channel = 0,
    containerRef,
    protocols = ['webrtc', 'mse', 'hls'],
    token,
    enabled = true,
    muted = false,
    controls = false,
    staggerIndex = 0,
  } = options;

  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeProtocol, setActiveProtocol] = useState<StreamingProtocol | null>(null);

  const videoRtcRef = useRef<VideoRTC | null>(null);
  const mountedRef = useRef(false);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsConnectedRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Helper to apply muted state to video element
  const applyMuted = useCallback((video: HTMLVideoElement | undefined | null) => {
    if (!video) return;
    video.muted = mutedRef.current;
    video.volume = mutedRef.current ? 0 : 1;
  }, []);

  const cleanup = useCallback(() => {
    log.videoPlayer('GO2RTC: Cleaning up', LogLevel.DEBUG, { monitorId });

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }

    wsConnectedRef.current = false;
    setActiveProtocol(null);

    if (videoRtcRef.current) {
      try {
        videoRtcRef.current.ondisconnect();
      } catch (err) {
        log.videoPlayer('GO2RTC: Error disconnecting', LogLevel.WARN, { monitorId, error: err });
      }

      if (videoRtcRef.current.parentNode) {
        videoRtcRef.current.parentNode.removeChild(videoRtcRef.current);
      }
      videoRtcRef.current = null;
    }
  }, [monitorId]);

  const connect = useCallback(() => {
    cleanup();

    if (!containerRef.current) {
      log.videoPlayer('GO2RTC: Container ref not available', LogLevel.WARN, { monitorId });
      setState('error');
      setError('Container element not available');
      return;
    }

    const modeString = protocols.join(',');
    log.videoPlayer('GO2RTC: Connecting', LogLevel.INFO, { monitorId, mode: modeString, go2rtcUrl });

    setState('connecting');
    setError(null);

    try {
      const wsUrl = getGo2RTCWebSocketUrl(go2rtcUrl, monitorId, channel, { token });
      const videoRtc = new VideoRTC();

      // Style element to fill container
      videoRtc.style.display = 'block';
      videoRtc.style.width = '100%';
      videoRtc.style.height = '100%';

      // Configure VideoRTC
      videoRtc.mode = modeString;
      videoRtc.media = 'video,audio';
      videoRtc.background = true;

      // Apply muted and configure video element after creation
      const originalOninit = videoRtc.oninit.bind(videoRtc);
      videoRtc.oninit = () => {
        originalOninit();
        if (videoRtc.video) {
          videoRtc.video.controls = controls;
          videoRtc.video.disablePictureInPicture = true;
          videoRtc.video.playsInline = true;
          if (controls) {
            videoRtc.video.setAttribute('controlsList', 'nodownload noplaybackrate');
            // Prevent clicks on video controls from navigating to monitor detail
            videoRtc.video.addEventListener('click', (e: Event) => e.stopPropagation());
          }
        }
        applyMuted(videoRtc.video);
      };

      // Track WebSocket connection
      const originalOnopen = videoRtc.onopen.bind(videoRtc);
      videoRtc.onopen = () => {
        wsConnectedRef.current = true;
        log.videoPlayer('GO2RTC: WebSocket connected', LogLevel.INFO, { monitorId });
        const modes = originalOnopen();
        setState('connected');
        if (modes && modes.length > 0) {
          setActiveProtocol(modes[0] as StreamingProtocol);
          log.videoPlayer('GO2RTC: Active protocol', LogLevel.INFO, { monitorId, protocol: modes[0] });
        }
        return modes;
      };

      // Track disconnection
      const originalOndisconnect = videoRtc.ondisconnect.bind(videoRtc);
      videoRtc.ondisconnect = () => {
        log.videoPlayer('GO2RTC: Disconnected', LogLevel.DEBUG, { monitorId });
        originalOndisconnect();
        setState('disconnected');
      };

      // Track WebSocket close for MJPEG fallback
      const originalOnclose = videoRtc.onclose.bind(videoRtc);
      videoRtc.onclose = () => {
        log.videoPlayer('GO2RTC: WebSocket closed', LogLevel.DEBUG, { monitorId, wasConnected: wsConnectedRef.current });
        if (!wsConnectedRef.current) {
          log.videoPlayer('GO2RTC: WebSocket failed to connect', LogLevel.WARN, { monitorId });
          setState('error');
          setError('Go2RTC WebSocket connection failed');
          return false;
        }
        return originalOnclose();
      };

      // Apply muted when video track arrives - wrap original handler to preserve MSE/WebRTC priority logic
      const originalOnpcvideo = videoRtc.onpcvideo.bind(videoRtc);
      videoRtc.onpcvideo = (video: HTMLVideoElement) => {
        log.videoPlayer('GO2RTC: Video track received', LogLevel.INFO, { monitorId, videoWidth: video.videoWidth, videoHeight: video.videoHeight });
        originalOnpcvideo(video);  // Call original first - handles MSE vs WebRTC priority
        applyMuted(videoRtc.video);  // Apply muted to the final video element
      };

      // Add to DOM and start connection
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(videoRtc);
      videoRtcRef.current = videoRtc;
      videoRtc.src = wsUrl;
    } catch (err) {
      log.videoPlayer('GO2RTC: Connection failed', LogLevel.ERROR, { monitorId, error: err });
      setState('error');
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [cleanup, containerRef, monitorId, go2rtcUrl, token, protocols, channel, applyMuted]);

  const retry = useCallback(() => {
    log.videoPlayer('GO2RTC: Retry requested', LogLevel.INFO, { monitorId });
    connect();
  }, [monitorId, connect]);

  const stop = useCallback(() => {
    log.videoPlayer('GO2RTC: Stop requested', LogLevel.INFO, { monitorId });
    cleanup();
    setState('idle');
    setError(null);
  }, [cleanup, monitorId]);

  const toggleMute = useCallback(() => {
    const video = videoRtcRef.current?.video;
    if (video) {
      video.muted = !video.muted;
      return video.muted;
    }
    return true;
  }, []);

  const isMuted = useCallback(() => videoRtcRef.current?.video?.muted ?? true, []);

  const getVideoElement = useCallback(() => videoRtcRef.current?.video ?? null, []);

  // Stable protocol key to prevent reconnect on array reference changes
  const protocolsKey = protocols.join(',');

  // Connect when enabled
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      stop();
      return;
    }

    if (!go2rtcUrl || !monitorId || !containerRef.current) {
      return;
    }

    // Delay connection to survive React Strict Mode double-invoke, plus a
    // per-tile stagger in montage so all streams don't open at once.
    const connectDelay = GO2RTC_CONNECT_DELAY_MS + Math.max(0, staggerIndex) * GO2RTC_MONTAGE_STAGGER_MS;
    connectTimeoutRef.current = setTimeout(() => {
      connectTimeoutRef.current = null;
      if (mountedRef.current) {
        connect();
      }
    }, connectDelay);

    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, go2rtcUrl, monitorId, token, protocolsKey, staggerIndex]);

  // Apply muted when prop changes
  useEffect(() => {
    applyMuted(videoRtcRef.current?.video);
  }, [muted, applyMuted]);

  return { state, error, activeProtocol, retry, stop, toggleMute, isMuted, getVideoElement };
}
