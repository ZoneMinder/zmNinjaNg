/**
 * Native MJPEG frame loop (iOS and Android).
 *
 * Native code holds the ZoneMinder stream and serves one JPEG at a time from
 * zmframe://frames/<streamId>/<n>. The <img> loads a frame, fires `load`, and
 * the caller calls `advance` so `n` bumps and the element requests the next
 * one. `n` only defeats the image cache; native decides which frame comes back.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import { zmFrameStreamId, zmFrameUrl } from '../plugins/zm-stream';

export interface NativeMjpegFrames {
  /** zmframe URL for the current streamId and n, or '' before open resolves / when inactive. */
  frameSrc: string;
  /** Call from the <img> load handler with the element; ignored when its currentSrc names another stream. Returns true when accepted. */
  advance(img: HTMLImageElement | null): boolean;
  /** The current streamId or null. Changes whenever a new stream opens. */
  streamId: string | null;
}

interface FrameState {
  streamId: string | null;
  n: number;
}

const NO_STREAM: FrameState = { streamId: null, n: 0 };

// Resolve with the module, never the plugin: a registerPlugin proxy is a thenable and hangs the awaiter.
// One shared import so tiles mounting together all see the same module instance.
let modulePromise: ReturnType<typeof importModule> | null = null;
const importModule = () => import('../plugins/zm-stream');
const loadModule = () => (modulePromise ??= importModule());

// One reclaim per page load. A crash or hard reload runs no teardown, so the
// native side may still hold streams from the previous page.
let reclaimed: Promise<void> | null = null;

function reclaimOnce(): Promise<void> {
  reclaimed ??= loadModule()
    .then(({ ZmStream }) => ZmStream.closeAll())
    .catch((error) => log.monitor('reclaiming native streams failed', LogLevel.WARN, { error }));
  return reclaimed;
}

/** Test seam: forget that this page already reclaimed. */
export function resetNativeReclaimForTests(): void {
  reclaimed = null;
}

function closeAllNow(): void {
  loadModule()
    .then(({ ZmStream }) => ZmStream.closeAll())
    .catch((error) => log.monitor('closing native streams failed', LogLevel.WARN, { error }));
}

/**
 * @param onOpenFailed Called when native refuses the stream. The `<img>` src
 * is still '' at that point, so no `error` fires and the caller's reconnect
 * would never run.
 */
export function useNativeMjpegFrames(
  streamUrl: string,
  active: boolean,
  onOpenFailed?: () => void
): NativeMjpegFrames {
  const [state, setState] = useState<FrameState>(NO_STREAM);
  const enabled = active && Platform.isNative;
  // Mirrored so a caller's inline closure does not re-run the open effect.
  const onOpenFailedRef = useRef(onOpenFailed);
  useEffect(() => {
    onOpenFailedRef.current = onOpenFailed;
  });

  useEffect(() => {
    if (!enabled) return;
    // A closure per tile: a shared reference would be one listener, and the first unmount would remove it for all.
    const onHide = () => closeAllNow();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !streamUrl) return;
    let cancelled = false;
    let openedId: string | null = null;
    let closeOpened = () => {};

    (async () => {
      const { ZmStream: zm } = await loadModule();
      const closeStream = (streamId: string) =>
        zm
          .close({ streamId })
          .catch((error) => log.monitor('closing native stream failed', LogLevel.WARN, { error }));
      closeOpened = () => openedId && void closeStream(openedId);
      await reclaimOnce();
      if (cancelled) return;
      const { streamId } = await zm.open({
        url: streamUrl,
        stallTimeoutMs: ZM_INTEGRATION.nativeFrameStallMs,
      });
      if (cancelled) {
        void closeStream(streamId);
        return;
      }
      openedId = streamId;
      setState({ streamId, n: 0 });
    })().catch((error) => {
      log.monitor('opening native stream failed', LogLevel.WARN, { error });
      if (!cancelled) onOpenFailedRef.current?.();
    });

    return () => {
      cancelled = true;
      closeOpened();
      setState(NO_STREAM);
    };
  }, [enabled, streamUrl]);

  const { streamId, n } = state;
  const live = enabled && !!streamUrl && streamId !== null;

  const advance = useCallback(
    (img: HTMLImageElement | null): boolean => {
      if (!streamId || zmFrameStreamId(img?.currentSrc ?? '') !== streamId) return false;
      setState((s) => (s.streamId === streamId ? { streamId, n: s.n + 1 } : s));
      return true;
    },
    [streamId]
  );

  return {
    frameSrc: live ? zmFrameUrl(streamId, n) : '',
    advance,
    streamId: live ? streamId : null,
  };
}
