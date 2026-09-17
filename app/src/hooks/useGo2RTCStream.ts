/**
 * useGo2RTCStream Hook
 *
 * Manages streaming via Go2RTC server using video-rtc.js.
 * Video-rtc runs compatible protocols in parallel (MSE+WebRTC or HLS+WebRTC)
 * and uses whichever produces video first.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { VideoRTC } from '../lib/vendor/go2rtc/video-rtc';
import { getGo2RTCWebSocketUrl } from '../lib/zm/url-builder';
import { GO2RTC_CONNECT_DELAY_MS, GO2RTC_STUN_SERVERS } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

// Register VideoRTC custom element once
if (typeof window !== 'undefined' && !customElements.get('video-rtc')) {
  customElements.define('video-rtc', VideoRTC);
  log.videoPlayer('Registered VideoRTC custom element', LogLevel.DEBUG);
}

/**
 * Fully tear down a VideoRTC element so it cannot keep streaming after it
 * leaves the view. `ondisconnect()` closes the WebSocket and peer connection,
 * but on its own it is not enough:
 *  - WebRTC media flows over the RTCPeerConnection, not the ws, so the pc (and
 *    its tracks) must be closed/stopped, which `ondisconnect()` does but we also
 *    stop the video's MediaStream tracks defensively.
 *  - The element keeps internal reconnect/disconnect timers that can re-open a
 *    socket after we let go of it, so cancel them.
 *  - `background = true` (set in connect) disables the element's own teardown on
 *    DOM removal, so flip it off so removal can't leave it running.
 */
function destroyVideoRtc(el: VideoRTC): void {
  el.background = false;

  const timers = el as unknown as { reconnectTID?: number; disconnectTID?: number };
  if (timers.reconnectTID) {
    clearTimeout(timers.reconnectTID);
    timers.reconnectTID = 0;
  }
  if (timers.disconnectTID) {
    clearTimeout(timers.disconnectTID);
    timers.disconnectTID = 0;
  }

  // Capture the live stream before ondisconnect nulls srcObject. Feature-detect
  // via getTracks rather than `instanceof MediaStream` (not a global in jsdom).
  const video = el.video;
  const srcObject = video?.srcObject as MediaStream | null | undefined;
  const stream = srcObject && typeof srcObject.getTracks === 'function' ? srcObject : null;

  try {
    el.ondisconnect();
  } catch {
    // Element may be only partially initialized; the steps below still run.
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (video) {
    video.srcObject = null;
    video.removeAttribute('src');
  }

  el.parentNode?.removeChild(el);
}

export type StreamingProtocol = 'webrtc' | 'mse' | 'hls';
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export interface UseGo2RTCStreamOptions {
  go2rtcUrl: string;
  monitorId: string;
  channel?: string | number | null;
  containerRef: React.RefObject<HTMLElement | null>;
  protocols?: StreamingProtocol[];
  token?: string;
  /** The monitor's RTSPServer: whether `<Id>_ZoneMinderPrimary` exists. */
  rtspServer?: boolean;
  /** Configured portal hostname; warns if the token is sent to a different go2rtc host. */
  expectedHost?: string;
  enabled?: boolean;
  muted?: boolean;
  /** Fires when the user mutes or unmutes through the native controls. The
   *  hook's own writes (from the `muted` option) are filtered out, so the
   *  caller can persist every report as a user choice (refs #463). */
  onMutedChange?: (muted: boolean) => void;
  /** Show native video controls (play/pause, volume, fullscreen) */
  controls?: boolean;
  /**
   * Advertise STUN servers on the peer connection. Default false: LAN/portal
   * connect on host candidates, so STUN is unused and only adds console noise.
   * See GO2RTC_STUN_SERVERS.
   */
  useStun?: boolean;
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
    rtspServer = false,
    expectedHost,
    enabled = true,
    muted = false,
    controls = false,
    onMutedChange,
    useStun = false,
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
  const onMutedChangeRef = useRef(onMutedChange);
  onMutedChangeRef.current = onMutedChange;

  // One stable listener so re-adding it on the final video element (WebRTC
  // may replace the MSE element) is a no-op rather than a duplicate. A change
  // that lands on the value applyMuted just wrote is ours, not the user's.
  const handleVolumeChange = useCallback((e: Event) => {
    const video = e.currentTarget as HTMLVideoElement;
    if (video.muted !== mutedRef.current) onMutedChangeRef.current?.(video.muted);
  }, []);

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
      destroyVideoRtc(videoRtcRef.current);
      videoRtcRef.current = null;
    }

    // Sweep any stray VideoRTC the container still holds (for example one left
    // behind by a prior retry) so nothing keeps a WebSocket or peer connection
    // alive after the view is gone.
    const container = containerRef.current;
    if (container) {
      Array.from(container.children).forEach((child) => {
        if (child instanceof VideoRTC) destroyVideoRtc(child);
      });
    }
  }, [monitorId]);

  const connect = useCallback(() => {
    // Guard against a late connect after unmount. retry() (visibility resume,
    // freeze watchdog) can fire while the component is tearing down; without
    // this a tile that's already gone would open a fresh WebSocket that nothing
    // owns or closes, leaking a stream.
    if (!mountedRef.current) {
      log.videoPlayer('GO2RTC: Skipping connect, not mounted', LogLevel.DEBUG, { monitorId });
      return;
    }

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
      const wsUrl = getGo2RTCWebSocketUrl(go2rtcUrl, monitorId, channel, { token, expectedHost, rtspServer });
      const videoRtc = new VideoRTC();

      // Style element to fill container
      videoRtc.style.display = 'block';
      videoRtc.style.width = '100%';
      videoRtc.style.height = '100%';

      // Configure VideoRTC
      videoRtc.mode = modeString;
      videoRtc.media = 'video,audio';
      videoRtc.background = true;

      // Override the STUN servers video-rtc.js hardcodes into pcConfig. onwebrtc()
      // reads pcConfig lazily when it builds the pc (after the WebSocket opens),
      // so setting it here wins without editing the vendored file. Default is an
      // empty list (see GO2RTC_STUN_SERVERS); the per-profile webrtcUseStun
      // setting opts back into STUN for direct-to-internet go2rtc access.
      videoRtc.pcConfig = {
        ...videoRtc.pcConfig,
        iceServers: useStun ? GO2RTC_STUN_SERVERS : [],
      };

      // Apply muted and configure video element after creation
      const originalOninit = videoRtc.oninit.bind(videoRtc);
      videoRtc.oninit = () => {
        originalOninit();
        if (videoRtc.video) {
          videoRtc.video.addEventListener('volumechange', handleVolumeChange);
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
        // onopen reported whichever of MSE/HLS video-rtc started first. That
        // race is only decided here: the original handler adopts the WebRTC
        // stream and leaves pcState OPEN when it wins, or closes the peer
        // connection when it loses. Without this, the badge keeps saying MSE
        // while WebRTC carries the picture.
        if (videoRtc.pcState === WebSocket.OPEN) {
          setActiveProtocol('webrtc');
          log.videoPlayer('GO2RTC: WebRTC won the priority race', LogLevel.INFO, { monitorId });
        }
        applyMuted(videoRtc.video);  // Apply muted to the final video element
        videoRtc.video?.addEventListener('volumechange', handleVolumeChange);
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
  }, [cleanup, containerRef, monitorId, go2rtcUrl, token, expectedHost, rtspServer, protocols, channel, applyMuted, handleVolumeChange, useStun]);

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

    // Delay connection to survive React Strict Mode double-invoke. Montage tiles
    // all connect together (no stagger).
    connectTimeoutRef.current = setTimeout(() => {
      connectTimeoutRef.current = null;
      if (mountedRef.current) {
        connect();
      }
    }, GO2RTC_CONNECT_DELAY_MS);

    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, go2rtcUrl, monitorId, token, protocolsKey]);

  // Apply muted when prop changes
  useEffect(() => {
    applyMuted(videoRtcRef.current?.video);
  }, [muted, applyMuted]);

  return { state, error, activeProtocol, retry, stop, toggleMute, isMuted, getVideoElement };
}
