/**
 * PiP Context
 *
 * Manages a persistent Picture-in-Picture video that survives React route changes.
 * Holds both the video.js Player instance and the raw <video> element in a hidden
 * portal div outside the router tree.
 */

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Pip } from '../plugins/pip';
import type videojs from 'video.js';

type Player = ReturnType<typeof videojs>;

interface PipState {
  player: Player;
  videoEl: HTMLVideoElement;
  eventId: string;
  /** The DOM node the wrapper was moved out of when adopted. If still attached
   * at PiP exit time, the wrapper is moved back here instead of being disposed,
   * so the inline VideoPlayer that originally owned it stays functional. */
  originHost: HTMLElement | null;
}

interface PipContextValue {
  /** Move a player + video element into the PiP portal for persistence */
  adoptForPip: (player: Player, videoEl: HTMLVideoElement, eventId: string) => void;
  /** Reclaim the adopted player + element back for inline playback */
  reclaimFromPip: () => PipState | null;
  /** Close any active PiP, dispose the player, clean up */
  closePip: () => void;
  /** The event ID of the currently active PiP video, or null */
  activePipEventId: string | null;
  /** Enter Android native PiP mode with a video URL */
  enterAndroidPip: (url: string, position: number, eventId: string) => Promise<void>;
  /** Get the last known playback position from Android PiP */
  getAndroidPipPosition: () => number;
  /** Whether the current platform is Android */
  isAndroid: boolean;
}

const PipContext = createContext<PipContextValue | null>(null);

export function usePip(): PipContextValue {
  const ctx = useContext(PipContext);
  if (!ctx) throw new Error('usePip must be used within PipProvider');
  return ctx;
}

export function PipProvider({ children }: { children: ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  const pipStateRef = useRef<PipState | null>(null);
  const [activePipEventId, setActivePipEventId] = useState<string | null>(null);

  const cleanupListener = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    // Remove the leavepictureinpicture listener
    if (cleanupListener.current) {
      cleanupListener.current();
      cleanupListener.current = null;
    }

    const state = pipStateRef.current;
    if (state) {
      // Dispose the video.js player (this also removes the video element)
      if (!state.player.isDisposed()) {
        state.player.dispose();
      }
      pipStateRef.current = null;
    }

    // Clear any remaining children from the portal
    if (portalRef.current) {
      portalRef.current.innerHTML = '';
    }

    setActivePipEventId(null);
  }, []);

  const adoptForPip = useCallback((player: Player, videoEl: HTMLVideoElement, eventId: string) => {
    // Close any existing PiP first
    if (pipStateRef.current) {
      cleanup();
    }

    // Move the video element's parent (video-js wrapper) into the portal,
    // remembering where it came from so we can return it on PiP exit.
    const wrapper = videoEl.closest('video-js') || videoEl.parentElement;
    const originHost = wrapper?.parentElement ?? null;
    if (wrapper && portalRef.current) {
      portalRef.current.appendChild(wrapper);
    }

    pipStateRef.current = { player, videoEl, eventId, originHost };
    setActivePipEventId(eventId);

    // Listen for PiP ending (user closes the PiP window). If the original
    // inline host is still in the DOM, move the wrapper back so the inline
    // VideoPlayer continues to work. Otherwise the owner has navigated away,
    // and we dispose to avoid leaks.
    const handleLeavePip = () => {
      const state = pipStateRef.current;
      if (!state) return;
      const movedBack = !!(state.originHost && state.originHost.isConnected && wrapper);
      if (movedBack) {
        state.originHost!.appendChild(wrapper!);
        // The inline VideoPlayer reads activePipEventId; flipping to null tells
        // it to clear its adoptedForPip flag so its own unmount will dispose.
        if (cleanupListener.current) {
          cleanupListener.current();
          cleanupListener.current = null;
        }
        pipStateRef.current = null;
        setActivePipEventId(null);
      } else {
        cleanup();
      }
    };
    videoEl.addEventListener('leavepictureinpicture', handleLeavePip);
    cleanupListener.current = () => {
      videoEl.removeEventListener('leavepictureinpicture', handleLeavePip);
    };
  }, [cleanup]);

  const reclaimFromPip = useCallback((): PipState | null => {
    const state = pipStateRef.current;
    if (!state) return null;

    // Remove the leavepictureinpicture listener (we're reclaiming, not cleaning up)
    if (cleanupListener.current) {
      cleanupListener.current();
      cleanupListener.current = null;
    }

    // Exit PiP mode
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }

    pipStateRef.current = null;
    setActivePipEventId(null);

    return state;
  }, []);

  const closePip = useCallback(() => {
    // Exit PiP mode first
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    cleanup();
  }, [cleanup]);

  const androidPipPositionRef = useRef<number>(0);

  const enterAndroidPip = useCallback(async (url: string, position: number, eventId: string) => {
    // Close any existing browser PiP first
    if (pipStateRef.current) {
      cleanup();
    }

    setActivePipEventId(eventId);
    androidPipPositionRef.current = position;

    try {
      const result = await Pip.enterPip({ url, position, aspectRatio: '16:9' });
      androidPipPositionRef.current = result.position;
    } catch {
      // Native PiP failed or was cancelled
    } finally {
      setActivePipEventId(null);
    }
  }, [cleanup]);

  const getAndroidPipPosition = useCallback(() => {
    return androidPipPositionRef.current;
  }, []);

  const isAndroid = Capacitor.getPlatform() === 'android';

  return (
    <PipContext.Provider value={{ adoptForPip, reclaimFromPip, closePip, activePipEventId, enterAndroidPip, getAndroidPipPosition, isAndroid }}>
      {children}
      {/* Hidden portal for adopted PiP elements — sibling of children, outside router */}
      <div ref={portalRef} style={{ display: 'none' }} data-testid="pip-portal" />
    </PipContext.Provider>
  );
}
