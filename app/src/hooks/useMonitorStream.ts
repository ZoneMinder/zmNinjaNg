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
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useProfileById } from './useCurrentProfile';
import { useViewPrefs } from './useViewPrefs';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useStreamLifecycle } from './useStreamLifecycle';
import { useAnalysisFrames } from './useAnalysisFrames';
import { useFreshAccessToken } from './useFreshAccessToken';
import { useServerUrls } from './useServerUrls';
import { useVisibilityResume } from './useVisibilityResume';
import { useAuthStore, useAuthSlice } from '../stores/auth';
import { log, LogLevel } from '../lib/logger';
import { planReconnect } from '../lib/monitor/reconnect-backoff';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import { ZMS_FRAMES_PARAM_MIN_VERSION, ZM_DECODING_ALWAYS } from '../lib/zm/zm-constants';
import { isZmVersionAtLeast } from '../lib/zm/zm-version';
import type { StreamOptions, ProfileId } from '../api/types';

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
  /**
   * Profile that owns this monitor. Defaults to the current profile. An
   * All-mode tile owned by a non-current profile passes that profile's id so
   * the stream URL, minStreamingPort and token all resolve against it
   * instead of the globally-selected profile.
   */
  profileId?: ProfileId | null;
  /**
   * The monitor's ZM `Decoding` value, when the server reports one. Only
   * snapshot polling reads it: a monitor that decodes on demand needs a
   * different request shape (see snapshotSendsOneJpeg below).
   */
  decoding?: string;
}

interface UseMonitorStreamReturn {
  streamUrl: string;
  /**
   * The value to bind to the `<img src>`. Equal to streamUrl once a connkey
   * has been minted; empty string before that.
   */
  imageSrc: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** Manual retry: reset the backoff counter and mint a fresh connkey. */
  regenerateConnection: () => void;
  /**
   * Call from the `<img onError>` handler. Schedules a backoff reconnect that
   * releases the errored connkey (CMD_QUIT) before minting a new one. Caps at
   * mjpegReconnectMaxAttempts unless insomnia is on; releases the connkey when
   * it gives up.
   */
  reportStreamError: () => void;
  /**
   * Call from the `<img onLoad>` handler. Resets the backoff counter so a later
   * independent drop starts fresh. A stream that never loads never resets, so
   * the give-up cap still applies to a permanently dead feed.
   */
  reportStreamLoad: () => void;
  /**
   * Whether the `<img>` has produced a frame for the src it currently holds.
   * Not "a stream URL exists": a minted connkey proves nothing has been
   * decoded yet, and an element showing a stale or half-written frame is
   * indistinguishable from a live one until this says so. The consumer keeps
   * the element unpaintable while this is false. refs #352
   */
  hasFrame: boolean;
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
  profileId,
  decoding,
}: UseMonitorStreamOptions): UseMonitorStreamReturn {
  const { profile: currentProfile, settings } = useProfileById(profileId);
  // Streaming Mode and analysis frames are view preferences, so the active
  // aggregate's bucket governs them while aggregating even though every other
  // setting here still comes from the server that owns this monitor (#337).
  const viewPrefs = useViewPrefs(profileId);
  const bandwidth = useBandwidthSettings();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(profileId);
  const { recordingUrl, portalPath } = useServerUrls(serverId, profileId);
  // portalUrl for stream lifecycle = portalPath without /index.php
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : currentProfile?.portalUrl;

  const effectiveViewMode = viewModeOverride ?? viewPrefs.viewMode;
  // Snapshot polling shape. mode=single reads the shared-memory image without
  // marking the monitor as viewed, so a monitor that only decodes on demand
  // stops decoding between polls and its picture freezes (refs #383). A jpeg
  // stream capped at one frame runs one pass of the streaming loop, which does
  // mark the monitor viewed, so those monitors poll that way instead. Monitors
  // on Decoding=Always never stop decoding and stay on the cheaper mode=single,
  // as do servers that report no Decoding at all: no Decoding field means a ZM
  // too old to understand frames=, which it would log as unknown and then
  // stream forever. The version check covers the 1.37 development builds that
  // grew Decoding before zms grew frames=.
  const zmVersion = useAuthSlice(currentProfile?.id ?? null).version;
  const snapshotSendsOneJpeg =
    effectiveViewMode === 'snapshot' &&
    !!decoding &&
    decoding !== ZM_DECODING_ALWAYS &&
    isZmVersionAtLeast(zmVersion, ZMS_FRAMES_PARAM_MIN_VERSION);
  // Multi-port only applies in streaming mode, and only when not force-disabled.
  const effectiveMinStreamingPort =
    effectiveViewMode === 'streaming'
      ? resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)
      : undefined;

  const [cacheBuster, setCacheBuster] = useState(() => Date.now());
  const imgRef = useRef<HTMLImageElement>(null);

  const reconnectAttemptRef = useRef(0);
  // When this stream first had a URL to try. A failure close to that moment is
  // usually a server still freeing slots rather than a server that is gone,
  // and gets the quicker schedule (see lib/monitor/reconnect-backoff).
  const streamStartedAtRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror settings.insomnia into a ref so the scheduleReconnect closure
  // reads the latest value without re-running its effect.
  const insomniaRef = useRef(settings.insomnia);
  insomniaRef.current = settings.insomnia;
  const [imageSrc, setImageSrc] = useState<string>('');
  // The src that last fired `load`. Compared against the current one rather
  // than kept as a boolean flag, so a src swap withdraws the frame during the
  // same render that introduces it. A flag reset from an effect would not: an
  // effect runs after paint, which is one painted frame of the old picture
  // under the new connection. refs #352. The two deliberate exceptions, where
  // the old picture is worth keeping, are read off the gate below.
  const [loadedSrc, setLoadedSrc] = useState<string>('');

  // Stream lifecycle: connKey generation, CMD_QUIT on regen/unmount, media abort
  // What this stream asks zms to resize to. The caller's own value wins over
  // the bandwidth mode's, the same precedence the URL below spreads in, and it
  // is computed here because the lifecycle needs it too: a scale change has to
  // re-open the stream, not just re-point the <img> (refs #478).
  const effectiveScale = streamOptions.scale ?? bandwidth.imageScale;

  // Set when a scale change re-opens the stream, so the frame gate below keeps
  // the picture on screen until the replacement decodes (refs #478).
  const [holdFrameForRestart, setHoldFrameForRestart] = useState(false);
  const prevScaleRef = useRef(effectiveScale);
  useEffect(() => {
    const previous = prevScaleRef.current;
    if (previous === effectiveScale) return;
    prevScaleRef.current = effectiveScale;
    setHoldFrameForRestart(true);
    log.monitor(
      `Stream scale changed from ${previous} to ${effectiveScale}, re-opening stream for monitor ${monitorId}`,
      LogLevel.INFO,
      { monitorId, previousScale: previous, scale: effectiveScale },
    );
  }, [effectiveScale, monitorId]);

  // The hold is a courtesy, not a promise. A restart that never produces a
  // frame must stop borrowing the old one, or a dead feed reads as a live one.
  useEffect(() => {
    if (!holdFrameForRestart) return;
    const timer = setTimeout(
      () => setHoldFrameForRestart(false),
      ZM_INTEGRATION.plannedRestartHoldMs,
    );
    return () => clearTimeout(timer);
  }, [holdFrameForRestart]);

  const { connKey, forceRegenerate, releaseConnection } = useStreamLifecycle({
    monitorId,
    portalUrl: resolvedPortalUrl,
    accessToken,
    viewMode: effectiveViewMode,
    mediaRef: imgRef,
    logFn: log.monitor,
    enabled,
    minStreamingPort: effectiveMinStreamingPort,
    profileId: currentProfile?.id,
    scale: effectiveScale,
  });

  // Analysis frames: applied to the live connection by command, and re-applied
  // from the load handler below whenever a fresh connkey replaces it.
  const analysisFrames = useAnalysisFrames({
    monitorId,
    portalUrl: resolvedPortalUrl,
    accessToken,
    connKey,
    viewMode: effectiveViewMode,
    enabled,
    showAnalysis: viewPrefs.showAnalysisFrames,
    minStreamingPort: effectiveMinStreamingPort,
    apiTimeoutSeconds: settings.apiTimeoutSeconds,
  });

  // An armed backoff must not survive a disable. The disable teardown quits the
  // connkey and zeroes it, so a timer firing afterwards would forceRegenerate a
  // key while disabled: nothing can stream on it (streamUrl is gated on
  // enabled), and re-enabling would reuse that dead key instead of minting a
  // fresh one. Resetting the counter too means the next enable starts on a clean
  // backoff rather than partway up the old stream's ladder.
  useEffect(() => {
    if (enabled) return;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [enabled]);

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

  // Build stream URL - ONLY when we have a valid connKey to prevent zombie
  // streams, and only while enabled: a disabled hook exposes no URL, so nothing
  // can mount an <img> on a connkey the disable teardown has already quit.
  const streamUrl = enabled && currentProfile && connKey !== 0 && isAccessTokenFresh
    ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
      mode: effectiveViewMode === 'snapshot' && !snapshotSendsOneJpeg ? 'single' : 'jpeg',
      frames: snapshotSendsOneJpeg ? 1 : undefined,
      scale: effectiveScale,
      maxfps:
        effectiveViewMode === 'streaming'
          ? settings.streamMaxFps
          : undefined,
      token: accessToken || undefined,
      // Streaming only: a snapshot request has no command channel to name, and
      // zms opens a socket per connkey once the request is a jpeg stream.
      connkey: effectiveViewMode === 'snapshot' ? undefined : connKey,
      // Only use cacheBuster in snapshot mode to force refresh; streaming mode uses only connkey
      cacheBuster: effectiveViewMode === 'snapshot' ? cacheBuster : undefined,
      // Only use multi-port in streaming mode, not snapshot (and not force-disabled)
      minStreamingPort: effectiveMinStreamingPort,
      ...streamOptions,
      // A snapshot has no frame rate; the caller's maxfps (LiveMonitorPlayer
      // always passes one) must not put it back after the spread (refs #461).
      ...(effectiveViewMode === 'snapshot' ? { maxfps: undefined } : {}),
    })
    : '';

  // The `<img>` points straight at streamUrl. We mirror it into imageSrc so the
  // consumer binds to a single field; reconnect logic below depends on the
  // <img>'s native onError handler which the consuming player wires up.
  useEffect(() => {
    setImageSrc(streamUrl);
    if (streamUrl && streamStartedAtRef.current === 0) {
      streamStartedAtRef.current = Date.now();
    }
  }, [streamUrl]);

  // MJPEG reconnect on stream error. Wired to the consumer's <img onError> via
  // reportStreamError below. Backoff doubles from mjpegReconnectBaseDelayMs up
  // to mjpegReconnectMaxDelayMs and caps at mjpegReconnectMaxAttempts unless
  // insomnia is on. The reconnect uses killPrevious so the errored connkey is
  // CMD_QUIT'd before a new one is minted (an <img> error can't tell a dead
  // server process from a dropped-but-alive one); on give-up the final connkey
  // is released too, instead of being orphaned until unmount.
  const scheduleReconnect = () => {
    // Whatever the element is holding, it is not a frame off a working
    // connection any more.
    setLoadedSrc('');
    setHoldFrameForRestart(false);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const attempt = reconnectAttemptRef.current;
    const insomniaOn = insomniaRef.current;
    const startedAt = streamStartedAtRef.current;
    const plan = planReconnect(attempt, startedAt === 0 ? 0 : Date.now() - startedAt);
    if (!insomniaOn && plan.countsTowardCap && attempt >= ZM_INTEGRATION.mjpegReconnectMaxAttempts) {
      log.monitor(
        `MJPEG stream gave up after ${attempt} reconnect attempts for monitor ${monitorId}`,
        LogLevel.ERROR,
        { monitorId },
      );
      releaseConnection();
      return;
    }
    if (plan.countsTowardCap) reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      forceRegenerate({ killPrevious: true });
    }, plan.delayMs);
  };

  // Reset the backoff counter (and cancel any pending reconnect) once a frame
  // loads, so a later independent drop starts a fresh backoff. A frame is also
  // the first proof that this connection's zms command socket exists, which is
  // when a remembered analysis setting can be applied to it.
  const reportStreamLoad = () => {
    analysisFrames.applyOnStreamLoad();
    setLoadedSrc(imageSrc);
    setHoldFrameForRestart(false);
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
    // Before anything async. A stream that died while the app was suspended
    // fires no `error` on the `<img>` - it keeps its last frame, which may be
    // half written - so the resume is the only moment that knows the picture is
    // stale, and the consumer must be told now rather than after the token
    // round trip below. refs #352
    setLoadedSrc('');
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const refresh = currentProfile
      ? useAuthStore.getState().getFreshAccessToken(currentProfile.id)
      : Promise.resolve(null);
    void refresh.finally(() => {
      // killPrevious closes the old nph-zms process on ZM. The server side
      // may still be alive (just throttled with us during the suspend), so
      // without this each resume would orphan a connkey.
      forceRegenerate({ killPrevious: true });
    });
  }, { enabled: enabled && effectiveViewMode === 'streaming' });

  // Snapshot mode swaps the src on every refresh tick (a fresh cacheBuster) and
  // the still frame already on screen stays good until the next one decodes, so
  // matching the src there would blink the tile once per interval. A snapshot
  // that starts failing does fire `error`, which clears loadedSrc, so it still
  // falls back to the placeholder.
  //
  // A planned restart is the same case for the same reason: the scale changed,
  // so the src changed, but the frame on screen came off a healthy stream and
  // the browser holds it until the new one decodes. An error reconnect never
  // holds - scheduleReconnect clears loadedSrc precisely because what the
  // element is showing is no longer a frame off a working connection.
  const hasFrame =
    imageSrc !== '' &&
    loadedSrc !== '' &&
    (effectiveViewMode === 'snapshot' || holdFrameForRestart || loadedSrc === imageSrc);

  return {
    streamUrl,
    imageSrc,
    imgRef,
    regenerateConnection,
    reportStreamError: scheduleReconnect,
    reportStreamLoad,
    hasFrame,
  };
}
