/**
 * LiveMonitorPlayer. Selects WebRTC (Go2RTC) or MJPEG based on user
 * preferences and monitor capabilities.
 *
 * Protocol negotiation: video-rtc offers every compatible protocol over one
 * WebSocket, not one at a time. MSE, HLS and MP4 are mutually exclusive branches
 * picked from browser capability, and WebRTC is offered alongside the chosen one.
 * Whichever delivers video first wins, resolved by a priority comparison in
 * `onpcvideo`; the badge names the protocol that ends up carrying the picture.
 *
 * MJPEG is the fallback, on any of three triggers: a stream error, no decoded
 * frame within GO2RTC_VIDEO_TIMEOUT_S of connecting, or the freeze watchdog.
 */

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Monitor, Profile, ProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { monitorCacheKey } from '../../stores/monitors';
import { useGo2RTCStream } from '../../hooks/useGo2RTCStream';
import { useMonitorStream } from '../../hooks/useMonitorStream';
import { tunedStreamOptions } from '../../lib/monitor/stream-tuning';
import { useVisibilityResume } from '../../hooks/useVisibilityResume';
import { log, LogLevel } from '../../lib/logger';
import {
  GO2RTC_VIDEO_TIMEOUT_S,
  GO2RTC_FRAME_POLL_MS,
  GO2RTC_LIVENESS_CHECK_MS,
  GO2RTC_FREEZE_THRESHOLD_S,
  GO2RTC_MAX_FREEZE_RETRIES,
  GO2RTC_FREEZE_RESET_S,
  GO2RTC_RETRY_INTERVAL_MIN,
} from '../../lib/zmninja-ng-constants';
import { ZMS_FULL_SCALE } from '../../lib/zm/zm-constants';
import { Button } from '../ui/button';
import { VideoOff, ShieldOff } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { canViewStream } from '../../lib/permissions/zm-permissions';

/**
 * Cache of monitors where Go2RTC failed: skip straight to MJPEG until TTL
 * expires. Keyed by profileId:monitorId (monitorCacheKey, shared with the
 * connKeys store) rather than monitorId alone - two profiles on independent
 * ZM servers can report the same monitor id, and without profile scoping a
 * Go2RTC failure recorded for one profile's monitor would wrongly skip
 * Go2RTC for another profile's unrelated monitor of the same id (refs #337).
 */
const go2rtcFailureCache = new Map<string, number>();

function isGo2rtcCachedFailure(profileId: ProfileId | undefined, monitorId: string): boolean {
  const key = monitorCacheKey(profileId, monitorId);
  const failedAt = go2rtcFailureCache.get(key);
  if (!failedAt) return false;
  if (Date.now() - failedAt > GO2RTC_RETRY_INTERVAL_MIN * 60 * 1000) {
    go2rtcFailureCache.delete(key);
    return false;
  }
  return true;
}

function markGo2rtcFailed(profileId: ProfileId | undefined, monitorId: string): void {
  go2rtcFailureCache.set(monitorCacheKey(profileId, monitorId), Date.now());
}

/**
 * Explicit content view state for the player. Replaces the previously scattered
 * showMjpeg / showConnectingBadge / showNoVideo render booleans with one named
 * value derived from the streaming signals.
 *
 * State machine (content layer; the WebRTC container mount and the error overlay
 * are separate concerns handled directly in render, see below):
 *
 *   connecting        WebRTC selected, negotiating, no decoded frame and no MJPEG
 *                     placeholder frame yet. Shows the VideoOff placeholder + the
 *                     connecting badge.
 *   mjpeg-placeholder WebRTC selected, negotiating (no decoded frame yet), MJPEG
 *                     placeholder frame available. Shows the MJPEG <img> under the
 *                     (empty) <video> container + the connecting badge.
 *   mse-playing       WebRTC decoded frames flowing. Shows the <video> only.
 *   mjpeg             MJPEG is the real stream and a frame is available.
 *   no-video          MJPEG is the real stream but no frame yet / errored. Shows
 *                     the VideoOff placeholder.
 *
 * Transitions are driven by the effect-managed signals, not by this function:
 *   isWebRTC        flips false when go2rtcFailed latches (Go2RTC error, no-frame
 *                   timeout, or freeze-watchdog max retries) -> webrtc path leaves.
 *   hasVideoFrames  flips true when the frame poll / timeout sees videoWidth>0;
 *                   flips false when the freeze watchdog retries the connection.
 *   hasMjpegFrame   tracks the MJPEG <img> having a live, non-errored connkey.
 *
 * The error overlay (Go2RTC 'error' state) composites on top of these and is kept
 * as a direct status.state check in render rather than a mutually-exclusive state,
 * because it does not unmount the underlying content layer.
 */
export type PlayerViewState =
  | 'connecting'
  | 'mjpeg-placeholder'
  | 'mse-playing'
  | 'mjpeg'
  | 'no-video';

export function derivePlayerViewState(input: {
  isWebRTC: boolean;
  hasVideoFrames: boolean;
  hasMjpegFrame: boolean;
}): PlayerViewState {
  if (input.isWebRTC) {
    if (input.hasVideoFrames) return 'mse-playing';
    return input.hasMjpegFrame ? 'mjpeg-placeholder' : 'connecting';
  }
  return input.hasMjpegFrame ? 'mjpeg' : 'no-video';
}

export interface LiveMonitorPlayerProps {
  monitor: Monitor;
  profile: Profile | null;
  /**
   * Id of the profile that owns this monitor, threaded to useMonitorStream so
   * the MJPEG stream URL/token resolve against that profile instead of the
   * globally-selected one. Defaults to the current profile when omitted
   * (single mode). Callers passing a non-current `profile` (All mode) must
   * pass its id here too - `profile` alone only affects go2rtc/WebRTC, which
   * read straight off the prop.
   */
  profileId?: ProfileId | null;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /** Show native video controls on Go2RTC streams (mute, fullscreen) */
  showControls?: boolean;
  externalMediaRef?: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  muted?: boolean;
  /** User mute/unmute through the native controls (Go2RTC only), for callers
   *  that persist the choice (refs #463). */
  onMutedChange?: (muted: boolean) => void;
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
   * Opt out of the shared, module-level Go2RTC failure cache. When true this
   * player neither reads nor writes the cache: it always attempts Go2RTC, and a
   * failure here is not recorded for other instances. The single-monitor detail
   * view sets this so a failure recorded under montage's many-connections-at-once
   * load is not inherited by the detail view, where a single connection succeeds.
   * Defaults to false (montage tiles share the cache).
   */
  bypassGo2rtcFailureCache?: boolean;
  /**
   * Ask ZM for the monitor's own frame size instead of the profile's Stream
   * scale, because the user has zoomed into this picture and magnifying a
   * downscaled frame only magnifies the downscaling. Set while the view is
   * zoomed and cleared on reset, which re-opens the stream each way. A no-op
   * on the go2rtc/WebRTC path, which is already served at the camera's own
   * resolution (refs #478).
   */
  fullResolution?: boolean;
  /**
   * Ask ZM for a cheaper MJPEG stream than the owning profile normally wants
   * (All-mode "reduced" stream tuning, refs #337). The caller decides: the
   * montage page sets it while aggregating, the monitor detail view and Live
   * Activity never do. Off by default, and a no-op on the go2rtc/WebRTC path,
   * which those parameters do not reach - see stream-tuning.ts.
   */
  reduceStream?: boolean;
  /**
   * Stop streaming entirely: no MJPEG connection, no go2rtc connection
   * (All-mode pause-while-hidden, refs #337). Both stream hooks tear their
   * connections down on the way into this state - MJPEG through the connkey's
   * CMD_QUIT, go2rtc through its own stop() - and rebuild them when it lifts,
   * so a paused tile leaves nothing running on the server. Off by default.
   */
  paused?: boolean;
}

export function LiveMonitorPlayer({
  monitor,
  profile,
  profileId,
  className = '',
  objectFit = 'contain',
  showControls = false,
  externalMediaRef,
  muted = true,
  onMutedChange,
  onLoad,
  onProtocolChange,
  forceViewMode,
  bypassGo2rtcFailureCache = false,
  reduceStream = false,
  fullResolution = false,
  paused = false,
}: LiveMonitorPlayerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings[profile?.id || ''])
  );
  const globalStreamingMethod = rawSettings?.streamingMethod ?? 'auto';
  // Per-monitor override takes precedence over global setting
  const monitorOverride = rawSettings?.monitorStreamingOverrides?.[monitor.Id];
  const userStreamingPreference = monitorOverride ?? globalStreamingMethod;

  // Streaming is a ZoneMinder permission of its own: zms.cpp checks Stream for
  // a live monitor, independently of Monitors. Denied, the stream is an image
  // that never loads - there is no failing request to catch - so the probe is
  // the only thing that can tell the user why (refs #344).
  const { permissions: accountPermissions } = usePermissions(profileId ?? profile?.id);
  const streamDenied = canViewStream(accountPermissions) === 'denied';

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

  const [go2rtcFailed, setGo2rtcFailed] = useState(() =>
    bypassGo2rtcFailureCache ? false : isGo2rtcCachedFailure(profile?.id, monitor.Id)
  );
  const [hasVideoFrames, setHasVideoFrames] = useState(false);

  // A paused tile holds no connection, so it has no frames whatever the last
  // ones were. Derived rather than stored: the go2rtc hook stops in its own
  // effect, so its last "connected, frames flowing" answer outlives the render
  // that paused the tile, and the freeze watchdog must not keep running (and
  // eventually "recover" a stream nobody asked for) against a connection the
  // pause already closed.
  const hasLiveVideoFrames = hasVideoFrames && !paused;

  // Going into a pause also drops the stored frame state, so the resume starts
  // from cold: placeholder, then the pre-frame timeout that allows a full
  // GO2RTC_VIDEO_TIMEOUT_S for the first frame. Carrying "has frames" across
  // the pause would instead arm the freeze watchdog against a connection that
  // has not finished negotiating, and its GO2RTC_FREEZE_THRESHOLD_S clock
  // would run out before any frame could arrive. Derived during render, in
  // the same style as the streamingMethod reset above.
  const prevPausedRef = useRef(paused);
  if (paused && !prevPausedRef.current && hasVideoFrames) {
    setHasVideoFrames(false);
  }
  prevPausedRef.current = paused;

  // Record a Go2RTC failure in the shared cache, unless this player opts out.
  // The local go2rtcFailed state still flips so this instance falls back to
  // MJPEG; only the cross-instance cache write is suppressed.
  const recordGo2rtcFailure = useCallback((id: string) => {
    if (!bypassGo2rtcFailureCache) markGo2rtcFailed(profile?.id, id);
  }, [bypassGo2rtcFailureCache, profile?.id]);

  // When user explicitly enables Go2RTC (streamingMethod changes to webrtc),
  // clear the failure cache so it retries immediately
  const prevStreamingMethodRef = useRef(streamingMethod);
  if (streamingMethod === 'webrtc' && prevStreamingMethodRef.current === 'mjpeg') {
    go2rtcFailureCache.delete(monitorCacheKey(profile?.id, monitor.Id));
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

  let portalHost: string | undefined;
  try {
    portalHost = profile?.portalUrl ? new URL(profile.portalUrl).hostname : undefined;
  } catch {
    portalHost = undefined;
  }

  const go2rtcStream = useGo2RTCStream({
    go2rtcUrl: profile?.go2rtcUrl || '',
    monitorId: monitor.Id,
    channel: monitor.StreamChannel || 0,
    containerRef,
    protocols: rawSettings?.webrtcProtocols,
    expectedHost: portalHost,
    enabled: streamingMethod === 'webrtc' && !!profile?.go2rtcUrl && !go2rtcFailed && !paused && !streamDenied,
    muted,
    onMutedChange,
    controls: showControls,
    useStun: rawSettings?.webrtcUseStun ?? false,
  });

  // Fall back to MJPEG when Go2RTC reports error state
  useEffect(() => {
    if (streamingMethod === 'webrtc' && go2rtcStream.state === 'error' && !go2rtcFailed) {
      log.videoPlayer('Go2RTC error, falling back to MJPEG', LogLevel.WARN, {
        monitorId: monitor.Id,
        error: go2rtcStream.error,
      });
      recordGo2rtcFailure(monitor.Id);
      setGo2rtcFailed(true);
    }
  }, [streamingMethod, go2rtcStream.state, go2rtcStream.error, go2rtcFailed, monitor.Id, recordGo2rtcFailure]);

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
      // Start timeout: if no frames arrive, fall back
      clearVideoTimeout();
      videoTimeoutRef.current = setTimeout(() => {
        // Check for video frames by inspecting the video element
        const video = go2rtcStream.getVideoElement();
        const hasFrames = video && video.videoWidth > 0 && video.videoHeight > 0;

        if (hasFrames && video.paused) {
          // Autoplay was blocked: try to play programmatically
          log.videoPlayer('Go2RTC has frames but paused, attempting play', LogLevel.INFO, { monitorId: monitor.Id });
          video.play().catch(() => {
            // Play failed: still has frames so mark as success
          });
          setHasVideoFrames(true);
        } else if (!hasFrames) {
          log.videoPlayer('Go2RTC connected but no video frames, falling back to MJPEG', LogLevel.WARN, {
            monitorId: monitor.Id,
            protocol: go2rtcStream.activeProtocol,
            videoWidth: video?.videoWidth,
            videoHeight: video?.videoHeight,
          });
          recordGo2rtcFailure(monitor.Id);
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
  }, [streamingMethod, go2rtcFailed, go2rtcStream.state, hasVideoFrames, go2rtcStream, monitor.Id, clearVideoTimeout, recordGo2rtcFailure]);

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

  // Keep the latest go2rtc stream handle in a ref so the watchdog interval reads
  // current methods/state without re-subscribing every render (the hook returns
  // a new object each render, which would otherwise reset the freeze timer).
  const go2rtcStreamRef = useRef(go2rtcStream);
  go2rtcStreamRef.current = go2rtcStream;

  useEffect(() => {
    if (effectiveStreamingMethod !== 'webrtc' || !hasLiveVideoFrames || go2rtcFailed) {
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
        recordGo2rtcFailure(monitorId);
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
      go2rtcStreamRef.current.retry();
    };

    const interval = setInterval(() => {
      // A silent WebSocket stall surfaces as the hook's 'disconnected' state
      // after frames were already flowing. Treat it as a freeze immediately.
      if (go2rtcStreamRef.current.state === 'disconnected') {
        handleFreeze('disconnected', { state: go2rtcStreamRef.current.state });
        return;
      }

      const video = go2rtcStreamRef.current.getVideoElement();
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
  }, [effectiveStreamingMethod, hasLiveVideoFrames, go2rtcFailed, monitorId, recordGo2rtcFailure]);

  // Reset failure state when monitor (or its owning profile) changes (check
  // cache for the new monitor/profile pair)
  useEffect(() => {
    setGo2rtcFailed(bypassGo2rtcFailureCache ? false : isGo2rtcCachedFailure(profile?.id, monitor.Id));
    setHasVideoFrames(false);
    freezeRetryCountRef.current = 0;
    lastFreezeAtRef.current = 0;
  }, [monitor.Id, profile?.id, bypassGo2rtcFailureCache]);

  // When the page returns from background, the freeze watchdog may have
  // exhausted its retry budget while the browser was suspending the player.
  // Reset the freeze counters, clear any latched permanent MJPEG fallback,
  // and nudge the WebRTC stream to retry. The MJPEG visibility resume is
  // handled inside useMonitorStream. refs #150
  const go2rtcRetry = go2rtcStream.retry;
  useVisibilityResume(() => {
    if (streamingMethod !== 'webrtc') return;
    log.videoPlayer('Resuming WebRTC stream after visibility return', LogLevel.INFO, {
      monitorId: monitor.Id,
      go2rtcFailed,
      go2rtcState: go2rtcStream.state,
      freezeRetries: freezeRetryCountRef.current,
    });
    freezeRetryCountRef.current = 0;
    lastFreezeAtRef.current = 0;
    if (go2rtcFailed) {
      go2rtcFailureCache.delete(monitorCacheKey(profile?.id, monitor.Id));
      setGo2rtcFailed(false);
      setHasVideoFrames(false);
    }
    if (go2rtcStream.state === 'error' || go2rtcStream.state === 'disconnected') {
      go2rtcRetry();
    }
  });

  const mjpegStream = useMonitorStream({
    monitorId: monitor.Id,
    serverId: monitor.ServerId,
    streamOptions: tunedStreamOptions(
      {
        maxfps: rawSettings?.streamMaxFps,
        scale: fullResolution ? ZMS_FULL_SCALE : rawSettings?.streamScale,
      },
      // A zoomed picture is one the user is reading detail off, so the economy
      // ceiling stands down for as long as they are in it.
      reduceStream && !fullResolution,
    ),
    enabled: (effectiveStreamingMethod === 'mjpeg' || showMjpegPlaceholder) && !paused && !streamDenied,
    viewModeOverride: forceViewMode,
    profileId,
    decoding: monitor.Decoding,
  });

  // Track MJPEG image error state. Clear it whenever a new connection is minted
  // (imageSrc carries the connkey). When the window is occluded the <img>
  // connection drops and onError latches this true, which unmounts the <img>.
  // The visibility/focus resume then regenerates the connkey; without imageSrc
  // in the deps the error stayed latched and the tile never recovered until a
  // full remount (route change). refs #150
  const [mjpegError, setMjpegError] = useState(false);

  // Undoes the inline hide handleMjpegError applies below. React never clears
  // an imperatively set style key on its own (it only diffs the keys its own
  // style prop carried), and the visibility prop on the <img> can hold the same
  // value either side of a hide, so the load handler clears it explicitly. That
  // matters when the element is never unmounted in between: a multipart stream
  // can fire error and then load in the same task, and React batches both, so
  // the load handler runs on the still-mounted, still-hidden element and its
  // setMjpegError(false) keeps it mounted. Without this the tile would go
  // permanently blank.
  //
  // Depends on mjpegStream.imgRef, not mjpegStream: useMonitorStream returns a
  // bare object literal, so the hook result is a new reference every render.
  // Depending on it would make this callback new every render too, and the
  // reset effect below lists it, so that effect would re-run after every
  // render and clear the error latch immediately. The <img> would then remount
  // against the same dead connkey and error again, burning the reconnect
  // backoff at error-loop speed on every page that streams. The ref object
  // itself is stable.
  const imgRef = mjpegStream.imgRef;
  const showMjpegImg = useCallback(() => {
    const img = imgRef.current;
    if (img) img.style.visibility = '';
  }, [imgRef]);

  // A fresh connkey unlatches the error, so the tile recovers instead of
  // sitting on the placeholder until a full remount. refs #150
  useEffect(() => {
    if (effectiveStreamingMethod === 'mjpeg' || showMjpegPlaceholder) {
      setMjpegError(false);
    }
  }, [effectiveStreamingMethod, showMjpegPlaceholder, monitor.Id, mjpegStream.imageSrc]);

  const handleMjpegLoad = useCallback(() => {
    showMjpegImg();
    setMjpegError(false);
    // A good frame resets the reconnect backoff so a later drop starts fresh.
    mjpegStream.reportStreamLoad();
    onLoad?.();
  }, [onLoad, mjpegStream, showMjpegImg]);

  const handleMjpegError = useCallback(() => {
    // Log so an occlusion-induced drop is visible. The <img> onError is
    // otherwise silent, which made this look like "0 logs". refs #150
    log.videoPlayer('MJPEG stream error', LogLevel.WARN, { monitorId: monitor.Id });
    // Chromium paints its broken-image glyph the moment the load fails. React's
    // error event is default priority, not discrete, so the commit that swaps
    // in the VideoOff placeholder lands a frame or more later, and anything
    // that snapshots the page in between freezes that glyph on screen. Hiding
    // the element here, synchronously, means the next paint is already clean;
    // the React commit below still does the real state change.
    const img = mjpegStream.imgRef.current;
    if (img) img.style.visibility = 'hidden';
    setMjpegError(true);
    // Schedule an auto-reconnect with backoff. This releases the errored
    // connkey before minting a new one, so a dropped feed recovers without a
    // manual Retry. refs #187
    mjpegStream.reportStreamError();
  }, [monitor.Id, mjpegStream]);

  // Sync media ref for snapshot capture
  useEffect(() => {
    if (!externalMediaRef) return;
    const ref = externalMediaRef as React.MutableRefObject<HTMLImageElement | HTMLVideoElement | null>;

    if (effectiveStreamingMethod === 'mjpeg' && mjpegStream.imgRef.current) {
      ref.current = mjpegStream.imgRef.current;
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
  // MJPEG-first placeholder while MSE connects. It stays mounted whenever a
  // stream URL exists and no error is latched - an unmounted element can never
  // load - but only paints once that src has actually produced a frame.
  const showMjpegElement =
    (effectiveStreamingMethod === 'mjpeg' || showMjpegPlaceholder) &&
    !!mjpegStream.imageSrc &&
    !mjpegError;

  // Whether the element has a picture worth showing. A minted connkey is not a
  // frame: on a mobile resume the element still holds the dead connection's
  // last frame, which may be half written, and WebKit re-fetching an evicted
  // image against a dead connkey paints its broken-image glyph before any error
  // event lands. Both used to count as "has a frame" here. refs #352
  const hasMjpegFrame = showMjpegElement && mjpegStream.hasFrame;

  // Single named content state feeding the render branches below. See the
  // PlayerViewState doc comment for the state machine and what drives each
  // transition. showMjpegPlaceholder (used above by the stream hooks/effects)
  // is retained as an input; the error overlay stays a direct status check.
  const viewState = derivePlayerViewState({
    isWebRTC,
    hasVideoFrames: hasLiveVideoFrames,
    hasMjpegFrame,
  });

  if (streamDenied) {
    return (
      <div
        className="relative w-full h-full flex flex-col items-center justify-center gap-2 bg-muted/30 p-3 text-center"
        data-testid="video-player-no-permission"
      >
        <ShieldOff className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">{t('monitors.stream_permission_denied')}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" data-testid="video-player">
      {/* VideoOff placeholder: waiting for video (WebRTC negotiating with no
          placeholder frame, or MJPEG with no frame yet / errored). */}
      {(viewState === 'connecting' || viewState === 'no-video') && (
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

      {showMjpegElement && (
        <img
          ref={mjpegStream.imgRef}
          className={`w-full h-full ${className}`}
          // visibility, not conditional mounting: the element has to be in the
          // tree to load at all, and it must not paint until it has a frame.
          // Always passing the key keeps React's diff in charge of it.
          style={
            showMjpegPlaceholder
              ? {
                objectFit,
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                visibility: hasMjpegFrame ? 'visible' : 'hidden',
              }
              : { objectFit, visibility: hasMjpegFrame ? 'visible' : 'hidden' }
          }
          data-testid="video-player-mjpeg"
          src={mjpegStream.imageSrc}
          // Empty: a failing load with alt text makes WebKit draw its glyph
          // beside the text, and nothing describes a live feed in words. The
          // surrounding tile carries the monitor name.
          alt=""
          // Disable the browser's native image drag so a mouse drag pans the
          // zoomed view instead of dragging a ghost of the picture (issue #191).
          draggable={false}
          onLoad={handleMjpegLoad}
          onError={handleMjpegError}
        />
      )}

      {/* MSE-connecting badge: blinking dots while WebRTC negotiates (connecting
          or showing the MJPEG placeholder) and the stream has not errored. */}
      {(viewState === 'connecting' || viewState === 'mjpeg-placeholder') && status.state !== 'error' && (
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
