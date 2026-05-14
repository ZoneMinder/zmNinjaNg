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

  useEffect(() => {
    // Make sure Video.js player is only initialized once
    if (!playerRef.current) {
      // The Video.js player needs to be _inside_ the component el for React 18 Strict Mode. 
      const videoElement = document.createElement("video-js");

      videoElement.classList.add('vjs-big-play-centered');
      videoElement.setAttribute('playsinline', '');
      videoElement.setAttribute('webkit-playsinline', '');

      if (videoRef.current) {
        videoRef.current.appendChild(videoElement);
      }

      const player = playerRef.current = videojs(videoElement, {
        autoplay,
        controls,
        responsive: true,
        fluid: true,
        playsinline: true,
        preferFullWindow: true,
        muted,
        aspectRatio,
        poster,
        disablePictureInPicture: isAndroid,
        controlBar: {
          pictureInPictureToggle: !isAndroid,
        },
        sources: [{
          src,
          type
        }],
        html5: {
          vhs: {
            overrideNative: true
          },
          nativeAudioTracks: false,
          nativeVideoTracks: false
        }
      }, () => {
        videojs.log('player is ready');

        // Initialize markers if provided
        if (markers && markers.length > 0) {
          updateMarkers(player, markers);
          log.videoPlayer('Video markers initialized', LogLevel.INFO, { count: markers.length });
        }

        onReady && onReady(player);
      });

      // Handle errors
      player.on('error', () => {
        const err = player.error();
        log.videoPlayer('VideoJS playback error', LogLevel.ERROR, err);
        setError(err?.message || 'An unknown error occurred');
        if (onError) onError(err);
      });

    } else {
      const player = playerRef.current;

      // Update player if props change
      player.autoplay(autoplay);
      player.src([{ src, type }]);
      if (poster) player.poster(poster);
    }
  }, [src, type, poster, autoplay, controls, muted, aspectRatio, onReady, onError]);

  // Update markers when they change
  useEffect(() => {
    const player = playerRef.current;
    if (player && markers) {
      updateMarkers(player, markers);
    }
  }, [markers, onMarkerClick]);

  // Listen for PiP activation — browser API on desktop/iOS only
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !eventId || isAndroid) return;

    let videoEl: HTMLVideoElement | null = null;
    try {
      videoEl = player.tech({ IWillNotUseThisInPlugins: true })?.el() as HTMLVideoElement;
    } catch (error) {
      log.videoPlayer('Video tech access failed', LogLevel.DEBUG, { error });
      return;
    }
    if (!videoEl || !(videoEl instanceof HTMLVideoElement)) return;

    const handleEnterPip = () => {
      adoptForPip(player, videoEl!, eventId);
      adoptedForPip.current = true;
    };

    videoEl.addEventListener('enterpictureinpicture', handleEnterPip);
    return () => {
      videoEl!.removeEventListener('enterpictureinpicture', handleEnterPip);
    };
  }, [playerRef.current, eventId, adoptForPip, isAndroid]);

  // Android: add custom PiP button that triggers native ExoPlayer PiP
  useEffect(() => {
    if (!isAndroid || !playerRef.current || !eventId) return;
    const player = playerRef.current;
    let pipBtn: HTMLButtonElement | null = null;

    Pip.isPipSupported().then(({ supported }) => {
      if (!supported || !player || player.isDisposed()) return;

      const controlBar = (player as unknown as { controlBar?: { el(): HTMLElement | undefined } }).controlBar?.el();
      if (!controlBar) return;

      pipBtn = document.createElement('button');
      pipBtn.className = 'vjs-control vjs-button';
      pipBtn.title = 'Picture-in-Picture';
      pipBtn.setAttribute('aria-label', 'Picture-in-Picture');
      pipBtn.innerHTML = '<span class="vjs-icon-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" opacity="0.3"/></svg></span>';

      pipBtn.addEventListener('click', async () => {
        const currentTime = player.currentTime() || 0;
        const videoSrc = player.currentSrc();
        if (videoSrc) {
          player.pause();
          await enterAndroidPip(videoSrc, currentTime, eventId);
          const returnedPosition = getAndroidPipPosition();
          if (returnedPosition > 0) {
            player.currentTime(returnedPosition);
          }
          player.play();
        }
      });

      // Insert before fullscreen button
      const fullscreenBtn = controlBar.querySelector('.vjs-fullscreen-control');
      if (fullscreenBtn) {
        controlBar.insertBefore(pipBtn, fullscreenBtn);
      } else {
        controlBar.appendChild(pipBtn);
      }
    });

    return () => {
      if (pipBtn?.parentNode) {
        pipBtn.parentNode.removeChild(pipBtn);
      }
    };
  }, [playerRef.current, eventId, isAndroid, enterAndroidPip, getAndroidPipPosition]);

  // Dispose the player on unmount (skip if adopted for PiP)
  useEffect(() => {
    const player = playerRef.current;

    return () => {
      if (adoptedForPip.current) {
        // PiP is active — don't dispose, the PipProvider owns the player now
        playerRef.current = null;
        return;
      }
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [playerRef]);

  // iOS WKWebView pauses the HTML5 <video> element during the orientation
  // reflow, and Video.js's .vjs-user-inactive auto-hide can latch because
  // touch/mouse events don't re-fire on rotate. Capture play state before
  // rotation, then re-show controls and resume playback once the reflow
  // settles. refs #147.
  useEffect(() => {
    let wasPlayingBeforeRotate = false;
    const handleOrientationChange = () => {
      const player = playerRef.current;
      if (!player || player.isDisposed()) return;
      wasPlayingBeforeRotate = !player.paused();
      player.userActive(true);
      // Wait for the WebKit reflow to settle before resuming. 350ms covers
      // the iOS orientation animation (~300ms) plus a small buffer.
      setTimeout(() => {
        const p = playerRef.current;
        if (!p || p.isDisposed()) return;
        p.userActive(true);
        if (wasPlayingBeforeRotate && p.paused()) {
          const result = p.play();
          if (result && typeof result.catch === 'function') {
            result.catch(() => {
              // Autoplay-after-rotate can be blocked; ignore silently.
            });
          }
        }
      }, 350);
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
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

