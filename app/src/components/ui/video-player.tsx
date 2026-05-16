/**
 * Video Player Component
 *
 * A wrapper around Video.js to provide a consistent video playback experience.
 * Handles HLS streams, authenticated requests (via hooks), and cleanup.
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
import type { VideoMarker } from '../../lib/video-markers';
import type { MarkerConfig } from '../../types/videojs-markers';
import { usePip } from '../../contexts/PipContext';
import { Pip } from '../../plugins/pip';

interface VideoPlayerProps {
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
  /** Event ID for PiP persistence — when provided, enables PiP survival across navigation */
  eventId?: string;
}

/**
 * VideoPlayer component.
 *
 * @param props - Component properties
 * @param props.src - Video source URL
 * @param props.type - Video MIME type
 * @param props.poster - Poster image URL
 * @param props.className - CSS class names
 * @param props.autoplay - Autoplay setting
 * @param props.controls - Show controls
 * @param props.muted - Mute video
 * @param props.aspectRatio - Aspect ratio
 * @param props.markers - Timeline markers for alarm frames
 * @param props.onMarkerClick - Marker click callback
 * @param props.onReady - Ready callback
 * @param props.onError - Error callback
 * @param props.eventId - Event ID for PiP persistence
 */
export function VideoPlayer({
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
  eventId
}: VideoPlayerProps) {
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
  const markersRef = useRef(markers);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { markersRef.current = markers; }, [markers]);

  const updateMarkers = (player: Player, markers: VideoMarker[]) => {
    if (!player || player.isDisposed()) return;

    // Remove existing markers if the markers plugin is initialized
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- videojs-markers augments video.js Player interface but ReturnType<typeof videojs> does not pick up interface augmentation
    if (typeof (player as any).markers === 'function') {
      try {
        // Check if player has markers to remove
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason as above
        (player as any).markers?.removeAll?.();
      } catch (err) {
        // Ignore - markers plugin might not be fully initialized
      }
    }

    if (!markers || markers.length === 0) return;

    try {
      const markerConfigs: MarkerConfig[] = markers.map(m => ({
        time: m.time,
        text: m.text,
        class: m.type === 'alarm' ? 'vjs-marker-alarm' : 'vjs-marker-max-score',
        frameId: m.frameId,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason as above
      (player as any).markers({
        markerTip: {
          display: true,
          text: (marker: MarkerConfig) => marker.text || `Frame ${marker.frameId || ''}`,
        },
        onMarkerClick: (marker: MarkerConfig) => {
          player.currentTime(marker.time);
          if (onMarkerClick) {
            const originalMarker = markers.find(
              m => m.time === marker.time && m.frameId === marker.frameId
            );
            if (originalMarker) {
              onMarkerClick(originalMarker);
            }
          }
        },
        markers: markerConfigs,
      });

      log.videoPlayer('Video markers updated', LogLevel.DEBUG, { count: markers.length });
    } catch (err) {
      log.videoPlayer('Failed to update video markers', LogLevel.ERROR, err);
    }
  };

  // Handle PiP reclaim or close on mount
  useEffect(() => {
    if (!eventId) return;

    if (activePipEventId === eventId) {
      // Same event — reclaim the player from PiP portal
      const reclaimed = reclaimFromPip();
      if (reclaimed && videoRef.current) {
        const wrapper = reclaimed.videoEl.closest('video-js') || reclaimed.videoEl.parentElement;
        if (wrapper) {
          videoRef.current.appendChild(wrapper);
        }
        playerRef.current = reclaimed.player;
        adoptedForPip.current = false;
      }
    } else if (activePipEventId) {
      // Different event — close existing PiP
      closePip();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user closes PiP from the OS while this VideoPlayer is still
  // mounted, PipContext moves the wrapper back into our videoRef host and flips
  // activePipEventId to null. We just need to drop the adopted flag so the
  // unmount cleanup correctly disposes the player.
  useEffect(() => {
    if (adoptedForPip.current && activePipEventId === null) {
      adoptedForPip.current = false;
    }
  }, [activePipEventId]);

  // Init effect: create the player exactly once per mount.
  // Deliberately mount-only — prop updates are handled by the dedicated effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // URL banner ("capacitor://...") which is unstyleable. On Android/web/Tauri the
    // real Fullscreen API works correctly and gives a better immersive experience.
    const isIOS = Platform.isIOS;
    // overrideNative:true forces hls.js / MediaSource everywhere. On iOS WKWebView
    // native HLS via <video> is more battery-efficient and avoids MSE quirks. Keep
    // override on for other platforms (web/Android/Tauri) where native HLS support
    // varies.
    const overrideNativeHls = !isIOS;

    const player = playerRef.current = videojs(videoElement, {
      autoplay,
      controls,
      responsive: true,
      fluid: true,
      playsinline: true,
      preferFullWindow: isIOS,
      muted,
      aspectRatio,
      poster,
      disablePictureInPicture: isAndroid,
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

      const initialMarkers = markersRef.current;
      if (initialMarkers && initialMarkers.length > 0) {
        updateMarkers(player, initialMarkers);
        log.videoPlayer('Video markers initialized', LogLevel.INFO, { count: initialMarkers.length });
      }

      onReadyRef.current?.(player);
    });

    player.on('error', () => {
      const err = player.error();
      log.videoPlayer('VideoJS playback error', LogLevel.ERROR, err);
      setError(err?.message || 'An unknown error occurred');
      onErrorRef.current?.(err);
    });
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
  }, [src, type, poster, autoplay]);

  // Update markers when they change
  useEffect(() => {
    const player = playerRef.current;
    if (player && markers) {
      updateMarkers(player, markers);
    }
  }, [markers, onMarkerClick]);

  // Re-poke Video.js after rotation / safe-area changes.
  // Without this, .vjs-user-inactive can latch hidden after rotation (no mousemove
  // / touchmove fires inside WKWebView during the transition) and the player's
  // cached layout dimensions are stale relative to the new container box.
  // Listens to the native SafeArea plugin first (fires after iOS rotation completes
  // with correct insets), with screen.orientation.change and window resize as
  // fallbacks for Android / web / Tauri.
  useEffect(() => {
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

    let safeAreaHandle: { remove: () => void } | undefined;
    let cancelled = false;

    // Native iOS path — landed at the right moment in the rotation timeline.
    import('../../plugins/safe-area')
      .then(({ SafeArea }) => SafeArea.addListener('safeAreaInsetsChanged', wake))
      .then((handle) => {
        if (cancelled) {
          handle.remove();
        } else {
          safeAreaHandle = handle;
        }
      })
      .catch(() => {
        // Plugin unavailable on this platform — fallbacks below cover it.
      });

    // Cross-platform fallbacks. On iOS these may fire mid-rotation with stale
    // dimensions; the SafeArea listener above lands at completion. Calling wake()
    // a second time on those is harmless and self-correcting.
    const orientation = typeof screen !== 'undefined' ? screen.orientation : undefined;
    orientation?.addEventListener?.('change', wake);
    window.addEventListener('resize', wake);

    return () => {
      cancelled = true;
      safeAreaHandle?.remove();
      orientation?.removeEventListener?.('change', wake);
      window.removeEventListener('resize', wake);
    };
  }, []);

  // Listen for PiP activation — browser API on desktop/iOS only.
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
      <div ref={videoRef} />
    </div>
  );
}

