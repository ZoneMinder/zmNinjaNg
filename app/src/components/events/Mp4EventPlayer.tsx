/**
 * Mp4EventPlayer. Video.js wrapper for recorded event playback (MP4 / HLS).
 * Handles markers, PiP, and authenticated source URLs.
 */

import { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import 'videojs-markers';

// Define Player type from the videojs function return type
// This avoids deep imports which can be problematic with some bundlers
type Player = ReturnType<typeof videojs>;
import { cn } from '../../lib/utils';
import { log, LogLevel } from '../../lib/logger';
import { Platform } from '../../lib/platform';
import { EVENT_PLAYBACK_RATES } from '../../lib/zmninja-ng-constants';
import { applyVideoJsMarkers, type VideoMarker, type VideoJsMarkersHost } from '../../lib/event/video-markers';
import type { MarkerConfig } from '../../types/videojs-markers';
import { usePip } from '../../contexts/PipContext';
import { Pip } from '../../plugins/pip';
import { useCapacitorListener } from '../../hooks/useCapacitorListener';

interface Mp4EventPlayerProps {
  /** The source URL of the video stream */
  src: string;
  /** The MIME type of the video (e.g., 'application/x-mpegURL') */
  type?: string;
  /** Optional poster image URL */
  poster?: string;
  /** Additional CSS classes */
  className?: string;
  /** Autoplay behavior */
  autoplay?: boolean | 'muted' | 'play' | 'any';
  /** Whether to show controls */
  controls?: boolean;
  /** Whether to mute the video */
  muted?: boolean;
  /** Aspect ratio (e.g., '16:9') */
  aspectRatio?: string;
  /** Timeline markers for alarm frames */
  markers?: VideoMarker[];
  /** Callback when a marker is clicked */
  onMarkerClick?: (marker: VideoMarker) => void;
  /** Callback when player is ready */
  onReady?: (player: Player) => void;
  /** Callback on error */
  onError?: (error: unknown) => void;
  /** Callback when playback reaches the end of the video (video.js 'ended').
   * Continuous playback (#250) uses this to auto-advance to the next event. */
  onEnded?: () => void;
  /** Playback speed multiplier (one of EVENT_PLAYBACK_RATES). Applied on load
   * and reapplied on source change so it carries across a continuous run. */
  playbackRate?: number;
  /** Called when the user changes speed via the video.js rate menu, so the
   * chosen rate can be persisted. Not called for programmatic reapplies. */
  onRateChange?: (rate: number) => void;
  /** Called when the user mutes or unmutes via the video.js volume control,
   * so the choice can be persisted. The player itself only ever sets muted
   * from the prop at construction, so every volumechange is the user's. */
  onMutedChange?: (muted: boolean) => void;
  /** Fill the parent box instead of sizing by aspect ratio (video.js `fill`
   * rather than `fluid`). The page uses it for its own fullscreen, where the
   * box is the screen (refs #462). */
  fill?: boolean;
  /** Called when the user enters or leaves fullscreen through the player's
   * own control. Nothing here changes fullscreen programmatically, so every
   * report is the user's (refs #462, #463). */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Event ID for PiP persistence: when provided, enables PiP survival across navigation */
  eventId?: string;
}

export function Mp4EventPlayer({
  src,
  type = 'application/x-mpegURL',
  poster,
  className,
  autoplay = false,
  controls = true,
  muted = true,
  aspectRatio = '16:9',
  markers,
  onMarkerClick,
  onReady,
  onError,
  onEnded,
  playbackRate,
  onRateChange,
  onMutedChange,
  fill = false,
  onFullscreenChange,
  eventId
}: Mp4EventPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { adoptForPip, reclaimFromPip, closePip, activePipEventId, enterAndroidPip, getAndroidPipPosition, isAndroid } = usePip();
  const adoptedForPip = useRef(false);

  // Callbacks held in refs so the init effect (mount-only) sees fresh values
  // without taking unstable callback identities as deps and re-initializing the
  // player on every parent render.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  const onRateChangeRef = useRef(onRateChange);
  const onMutedChangeRef = useRef(onMutedChange);
  const onFullscreenChangeRef = useRef(onFullscreenChange);
  const markersRef = useRef(markers);
  const onMarkerClickRef = useRef(onMarkerClick);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;
    onRateChangeRef.current = onRateChange;
    onMutedChangeRef.current = onMutedChange;
    onFullscreenChangeRef.current = onFullscreenChange;
    markersRef.current = markers;
    onMarkerClickRef.current = onMarkerClick;
  }, [onReady, onError, onEnded, onRateChange, onMutedChange, onFullscreenChange, markers, onMarkerClick]);

  // Last fullscreen state reported, so the three overlapping video.js events
  // produce one report per change.
  const reportedFullscreenRef = useRef(false);


  // Desired playback rate held in a ref so the mount-only 'ratechange' listener
  // can tell a genuine user menu change (rate differs from desired) from our own
  // programmatic reapply (rate equals desired). Setting defaultPlaybackRate on
  // apply keeps the rate across source changes, so no reset-to-1 fires here.
  const desiredRateRef = useRef(playbackRate);
  useEffect(() => { desiredRateRef.current = playbackRate; }, [playbackRate]);

  // True once the player has fired its ready callback. The markers plugin reads
  // the player DOM, so marker updates are gated on this. lastMarkerSig skips
  // redundant re-applies when the markers array identity changes but the values
  // do not (e.g. a react-query refetch).
  const playerReadyRef = useRef(false);
  const lastMarkerSigRef = useRef<string | null>(null);

  // Stable click handler wired in at plugin init time. Reads the latest
  // callback and markers from refs so it never goes stale and never forces a
  // plugin re-initialization.
  const handleMarkerClick = (marker: MarkerConfig) => {
    const player = playerRef.current;
    if (player && !player.isDisposed()) player.currentTime(marker.time);
    const cb = onMarkerClickRef.current;
    if (!cb) return;
    const original = (markersRef.current || []).find(
      m => m.time === marker.time && m.frameId === marker.frameId
    );
    if (original) cb(original);
  };

  const updateMarkers = (player: Player, markers: VideoMarker[]) => {
    if (!player || player.isDisposed()) return;

    const host = player as unknown as VideoJsMarkersHost;
    // Plugin not registered (e.g. import side effect missing). Nothing to do.
    if (typeof host.markers !== 'function' && typeof host.markers !== 'object') return;

    const markerConfigs: MarkerConfig[] = (markers || []).map(m => ({
      time: m.time,
      text: m.text,
      class: m.type === 'alarm' ? 'vjs-marker-alarm' : 'vjs-marker-max-score',
      frameId: m.frameId,
    }));

    // A function value means the plugin has not been initialized yet; after init
    // it is an API object.
    const alreadyInitialized = typeof host.markers !== 'function';
    const sig = JSON.stringify(markerConfigs);
    if (alreadyInitialized && sig === lastMarkerSigRef.current) return;

    try {
      applyVideoJsMarkers(host, markerConfigs, {
        markerTip: {
          display: true,
          text: (marker: MarkerConfig) => marker.text || `Frame ${marker.frameId || ''}`,
        },
        onMarkerClick: handleMarkerClick,
      });
      lastMarkerSigRef.current = sig;
      log.videoPlayer('Video markers updated', LogLevel.DEBUG, { count: markerConfigs.length });
    } catch (err) {
      log.videoPlayer('Failed to update video markers', LogLevel.ERROR, err);
    }
  };

  // Handle PiP reclaim or close on mount
  useEffect(() => {
    if (!eventId) return;

    if (activePipEventId === eventId) {
      // Same event: reclaim the player from PiP portal
      const reclaimed = reclaimFromPip();
      if (reclaimed && videoRef.current) {
        const wrapper = reclaimed.videoEl.closest('video-js') || reclaimed.videoEl.parentElement;
        if (wrapper) {
          videoRef.current.appendChild(wrapper);
        }
        playerRef.current = reclaimed.player;
        // A reclaimed player is already initialized and ready; the init effect's
        // ready callback will not fire for it, so mark it ready here.
        playerReadyRef.current = true;
        adoptedForPip.current = false;
      }
    } else if (activePipEventId) {
      // Different event: close existing PiP
      closePip();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user closes PiP from the OS while this Mp4EventPlayer is still
  // mounted, PipContext moves the wrapper back into our videoRef host and flips
  // activePipEventId to null. We just need to drop the adopted flag so the
  // unmount cleanup correctly disposes the player.
  useEffect(() => {
    if (adoptedForPip.current && activePipEventId === null) {
      adoptedForPip.current = false;
    }
  }, [activePipEventId]);

  // Init effect: create the player exactly once per mount.
  // Deliberately mount-only: prop updates are handled by the dedicated effect below.
  useEffect(() => {
    // Reclaimed-from-PiP path populates playerRef.current before this runs;
    // in that case we adopt the existing player and skip re-init.
    if (playerRef.current) return;

    const videoElement = document.createElement('video-js');
    videoElement.classList.add('vjs-big-play-centered');
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('webkit-playsinline', '');
    if (muted) videoElement.setAttribute('muted', '');

    if (videoRef.current) {
      videoRef.current.appendChild(videoElement);
    }

    // preferFullWindow:true puts Video.js into CSS-fullscreen instead of the real
    // Fullscreen API. Required on iOS because iOS native fullscreen shows the page
    // URL banner ("capacitor://...") which is unstyleable. On Android/web/Electron the
    // real Fullscreen API works correctly and gives a better immersive experience.
    const isIOS = Platform.isIOS;
    // overrideNative:true forces hls.js / MediaSource everywhere. On iOS WKWebView
    // native HLS via <video> is more battery-efficient and avoids MSE quirks. Keep
    // override on for other platforms (web/Android/Electron) where native HLS support
    // varies.
    const overrideNativeHls = !isIOS;

    const player = playerRef.current = videojs(videoElement, {
      autoplay,
      controls,
      responsive: true,
      fluid: !fill,
      fill,
      playsinline: true,
      preferFullWindow: isIOS,
      muted,
      // video.js's aspectRatio setter forces fluid mode, after fill has been
      // applied, so a filled player must not carry one (refs #462).
      aspectRatio: fill ? undefined : aspectRatio,
      poster,
      disablePictureInPicture: isAndroid,
      playbackRates: [...EVENT_PLAYBACK_RATES],
      controlBar: {
        pictureInPictureToggle: !isAndroid,
      },
      sources: src ? [{ src, type }] : [],
      html5: {
        vhs: {
          overrideNative: overrideNativeHls,
        },
        nativeAudioTracks: !overrideNativeHls,
        nativeVideoTracks: !overrideNativeHls,
      }
    }, () => {
      videojs.log('player is ready');
      playerReadyRef.current = true;

      const initialMarkers = markersRef.current;
      if (initialMarkers && initialMarkers.length > 0) {
        updateMarkers(player, initialMarkers);
        log.videoPlayer('Video markers initialized', LogLevel.INFO, { count: initialMarkers.length });
      }

      // Apply the persisted speed on first load. defaultPlaybackRate makes the
      // rate survive later source swaps (continuous playback), so the update
      // effect does not have to re-fight a reset-to-1 on every new event.
      const rate = desiredRateRef.current;
      if (rate && rate !== player.playbackRate()) {
        player.defaultPlaybackRate(rate);
        player.playbackRate(rate);
      }

      onReadyRef.current?.(player);
    });

    player.on('error', () => {
      const err = player.error();
      log.videoPlayer('VideoJS playback error', LogLevel.ERROR, err);
      setError(err?.message || 'An unknown error occurred');
      onErrorRef.current?.(err);
    });

    player.on('ended', () => {
      onEndedRef.current?.();
    });

    // Persist only user-initiated speed changes. A programmatic reapply lands on
    // desiredRateRef, so comparing against it filters our own writes out.
    player.on('ratechange', () => {
      const r = player.playbackRate();
      if (r && r !== desiredRateRef.current) {
        desiredRateRef.current = r;
        player.defaultPlaybackRate(r);
        onRateChangeRef.current?.(r);
      }
    });

    player.on('volumechange', () => {
      onMutedChangeRef.current?.(player.muted() ?? true);
    });

    // video.js only raises fullscreenchange for full-window mode on prefixed
    // browsers, so the two full-window events are listened to as well.
    const reportFullscreen = () => {
      const fs = player.isFullscreen() ?? false;
      if (fs !== reportedFullscreenRef.current) {
        reportedFullscreenRef.current = fs;
        onFullscreenChangeRef.current?.(fs);
      }
    };
    player.on(['fullscreenchange', 'enterFullWindow', 'exitFullWindow'], reportFullscreen);
  }, []);

  // Update effect: propagate src/poster/autoplay changes to the existing player
  // without re-initializing. Only writes when the value actually changed to avoid
  // mid-playback resets on token refresh, query refetch, etc.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) return;

    if (src) {
      // currentSrc() returns the resolved source URL after the player loads it.
      // Comparing against it avoids re-issuing player.src() with the same value,
      // which would otherwise reset playback state on iOS WKWebView.
      const currentSrc = player.currentSrc();
      if (currentSrc !== src) {
        player.src([{ src, type }]);
      }
    }

    if (poster !== undefined && poster !== player.poster()) {
      player.poster(poster);
    }

    if (autoplay !== player.autoplay()) {
      player.autoplay(autoplay);
    }

    // Fill follows the page's fullscreen: the box is the screen there, and
    // fluid's aspect-ratio padding would size the player off the width alone.
    // Compared on fluid(), since fill() can read true while aspectRatio has
    // already flipped the player back to fluid.
    if (player.fluid() === fill) {
      if (fill) player.fill(true);
      else player.fluid(true);
    }

    // Reapply the desired rate when it changes externally (e.g. a rate set on a
    // previous event carried over) or after a source swap. defaultPlaybackRate
    // set alongside keeps a freshly loaded source at this rate.
    if (playbackRate && playbackRate !== player.playbackRate()) {
      player.defaultPlaybackRate(playbackRate);
      player.playbackRate(playbackRate);
    }
  }, [src, type, poster, autoplay, playbackRate, fill]);

  // Update markers when they change, but only once the player is ready (the
  // markers plugin reads the player DOM). The ready callback applies the initial
  // markers; this effect handles later changes. onMarkerClick is read via a ref
  // inside the stable click handler, so it is intentionally not a dependency.
  useEffect(() => {
    const player = playerRef.current;
    if (player && playerReadyRef.current && markers) {
      updateMarkers(player, markers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  // Re-poke Video.js after rotation / safe-area changes.
  // Without this, .vjs-user-inactive can latch hidden after rotation (no mousemove
  // / touchmove fires inside WKWebView during the transition) and the player's
  // cached layout dimensions are stale relative to the new container box.
  // Listens to the native SafeArea plugin first (fires after iOS rotation completes
  // with correct insets), with screen.orientation.change and window resize as
  // fallbacks for Android / web / Electron.
  const wake = () => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) return;
    try {
      player.trigger('resize');
      player.userActive(true);
    } catch (err) {
      log.videoPlayer('Player wake on rotation failed', LogLevel.DEBUG, { error: err });
    }
  };

  // Native iOS path: lands at the right moment in the rotation timeline.
  // Native only: on web, resolving the getter assimilates the Capacitor plugin
  // proxy as a thenable (Promise resolution reads `.then` on it), which throws
  // "SafeArea.then() is not implemented on web" as an unhandled rejection. The
  // web/Android stub never fires this event anyway; the fallbacks below cover
  // those platforms.
  useCapacitorListener(
    () => import('../../plugins/safe-area').then((m) => ({ plugin: m.SafeArea })),
    'safeAreaInsetsChanged',
    wake,
    { enabled: Platform.isNative },
  );

  useEffect(() => {
    // Cross-platform fallbacks. On iOS these may fire mid-rotation with stale
    // dimensions; the SafeArea listener above lands at completion. Calling wake()
    // a second time on those is harmless and self-correcting.
    const orientation = typeof screen !== 'undefined' ? screen.orientation : undefined;
    orientation?.addEventListener?.('change', wake);
    window.addEventListener('resize', wake);

    return () => {
      orientation?.removeEventListener?.('change', wake);
      window.removeEventListener('resize', wake);
    };
    // wake only touches refs; identity is irrelevant.
  }, []);

  // Listen for PiP activation: browser API on desktop/iOS only.
  // Attaches inside player 'ready' so we know the underlying <video> tech exists.
  useEffect(() => {
    if (!eventId || isAndroid) return;
    const player = playerRef.current;
    if (!player || player.isDisposed()) return;

    let cleanedUp = false;
    let cleanup: (() => void) | null = null;

    const attach = () => {
      if (cleanedUp || player.isDisposed()) return;
      let videoEl: HTMLVideoElement | null = null;
      try {
        videoEl = player.tech({ IWillNotUseThisInPlugins: true })?.el() as HTMLVideoElement;
      } catch (err) {
        log.videoPlayer('Video tech access failed', LogLevel.DEBUG, { error: err });
        return;
      }
      if (!videoEl || !(videoEl instanceof HTMLVideoElement)) return;

      const handleEnterPip = () => {
        adoptForPip(player, videoEl!, eventId);
        adoptedForPip.current = true;
      };
      videoEl.addEventListener('enterpictureinpicture', handleEnterPip);
      cleanup = () => videoEl!.removeEventListener('enterpictureinpicture', handleEnterPip);
    };

    if (player.readyState() > 0 || player.isReady_) {
      attach();
    } else {
      player.one('ready', attach);
    }

    return () => {
      cleanedUp = true;
      cleanup?.();
    };
  }, [eventId, adoptForPip, isAndroid]);

  // Android: add custom PiP button that triggers native ExoPlayer PiP.
  // Pip.isPipSupported is async; the effect can be cleaned up before it resolves,
  // in which case we must not mutate the DOM or leak the button + listener.
  useEffect(() => {
    if (!isAndroid || !eventId) return;
    const player = playerRef.current;
    if (!player) return;

    let cancelled = false;
    let pipBtn: HTMLButtonElement | null = null;

    Pip.isPipSupported().then(({ supported }) => {
      if (cancelled || !supported || player.isDisposed()) return;

      const controlBar = (player as unknown as { controlBar?: { el(): HTMLElement | undefined } }).controlBar?.el();
      if (!controlBar) return;

      const btn = document.createElement('button');
      btn.className = 'vjs-control vjs-button';
      btn.title = 'Picture-in-Picture';
      btn.setAttribute('aria-label', 'Picture-in-Picture');
      btn.innerHTML = '<span class="vjs-icon-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" opacity="0.3"/></svg></span>';

      btn.addEventListener('click', async () => {
        if (player.isDisposed()) return;
        const currentTime = player.currentTime() || 0;
        const videoSrc = player.currentSrc();
        if (!videoSrc) return;
        player.pause();
        await enterAndroidPip(videoSrc, currentTime, eventId);
        if (player.isDisposed()) return;
        const returnedPosition = getAndroidPipPosition();
        if (returnedPosition > 0) {
          player.currentTime(returnedPosition);
        }
        player.play();
      });

      const fullscreenBtn = controlBar.querySelector('.vjs-fullscreen-control');
      if (fullscreenBtn) {
        controlBar.insertBefore(btn, fullscreenBtn);
      } else {
        controlBar.appendChild(btn);
      }
      pipBtn = btn;
    });

    return () => {
      cancelled = true;
      if (pipBtn?.parentNode) {
        pipBtn.parentNode.removeChild(pipBtn);
      }
    };
  }, [eventId, isAndroid, enterAndroidPip, getAndroidPipPosition]);

  // Dispose the player on unmount (skip if adopted for PiP).
  // Reads playerRef.current inside cleanup so reassignments (PiP reclaim) are honored.
  useEffect(() => {
    return () => {
      if (adoptedForPip.current) {
        playerRef.current = null;
        return;
      }
      const player = playerRef.current;
      if (player && !player.isDisposed()) {
        player.dispose();
      }
      playerRef.current = null;
    };
  }, []);


  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-black/10 text-destructive p-4 rounded-md", className)}>
        <p>Error loading video: {error}</p>
      </div>
    );
  }

  return (
    <div data-vjs-player className={cn(className)}>
      {/* h-full: in fill mode the player is 100% of this box. */}
      <div ref={videoRef} className="h-full" />
    </div>
  );
}

