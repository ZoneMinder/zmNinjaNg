/**
 * ZMS Event Player Component
 *
 * Provides video playback controls for ZoneMinder events using ZMS streaming.
 * Includes play/pause, speed controls, frame navigation, and alarm frames display.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { EventProgressBar } from './EventProgressBar';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  VideoOff,
} from 'lucide-react';
import { getEventImageUrl } from '../../api/events';
import { useTranslation } from 'react-i18next';
import { httpGet } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { getEventZmsUrl, getZmsControlUrl } from '../../lib/zm/url-builder';
import { ZMS_COMMANDS, zmsCommandName } from '../../lib/zm/zm-constants';
import { API_REQUEST, EVENT_SEEK_FLUSH_DELAY_MS, EVENT_PLAYBACK_RATES, ZMS_PLAYBACK_BADGE_MS, ZMS_STREAM_DEAD_POLLS, ZMS_STREAM_MAX_RESTARTS } from '../../lib/zmninja-ng-constants';
import { sendDelayedCmdQuit, cancelPendingQuit } from '../../lib/zm/zms-quit';
import { useZoomPan } from '../../hooks/useZoomPan';
import { ZoomControls } from '../ui/zoom-controls';
import { useBandwidthSettings } from '../../hooks/useBandwidthSettings';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import type { ProfileId } from '../../api/types';
import { cn } from '../../lib/utils';

interface ZmsEventPlayerProps {
  portalUrl: string;
  eventId: string;
  /** Profile that owns this event, for token freshness. Required - not
   *  optional - because inside a server group there is no current profile to
   *  fall back to, and a call site that forgets it gets a player that never
   *  streams. EventDetail renders this component from two branches and only
   *  one of them was fixed the first time (refs #337). Pass `undefined`
   *  deliberately if a caller genuinely has no owning profile. */
  profileId: ProfileId | undefined;
  token?: string;
  apiUrl?: string;
  totalFrames: number;
  alarmFrames: number;
  alarmFrameId?: string;
  maxScoreFrameId?: string;
  eventLength: number; // Event duration in seconds
  minStreamingPort?: number;
  monitorId?: string;
  className?: string;
  /** Fired once when playback reaches the end of the event. Continuous
   * playback (#250) uses this to auto-advance to the next event. */
  onEnded?: () => void;
  /** Persisted playback speed multiplier (one of EVENT_PLAYBACK_RATES). The
   * initial stream and speed presets start here so speed carries across events. */
  playbackRate?: number;
  /** Called when the user picks a speed preset, so it can be persisted. */
  onRateChange?: (rate: number) => void;
  /** Pauses the stream while something covers it, such as the full-size frame
   * viewer (#272). Playback resumes on release only if it was running. */
  suspended?: boolean;
  /** App-level fullscreen (refs #462): the picture takes the height the page
   * gives it instead of a 16:9 box, with the transport controls kept below. */
  fullscreen?: boolean;
  /** Shows the "ZMS playback" notice. Only true when the page fell back here
   * after MP4 playback failed: that substitution is a surprise worth naming.
   * ZMS chosen deliberately (a JPEG-only event, TV mode, the per-monitor force
   * setting) needs no notice, and the badge covers the picture (#340). */
  showNotice?: boolean;
}

export function ZmsEventPlayer({
  portalUrl,
  eventId,
  profileId,
  token,
  apiUrl,
  totalFrames,
  alarmFrames,
  alarmFrameId,
  maxScoreFrameId,
  eventLength,
  minStreamingPort,
  monitorId,
  className,
  onEnded,
  playbackRate,
  onRateChange,
  suspended = false,
  showNotice = false,
  fullscreen = false,
}: ZmsEventPlayerProps) {
  const { t } = useTranslation();
  const bandwidth = useBandwidthSettings();
  // Parented to the event's OWNING profile (refs #337). Unparented this
  // resolves to the current profile, which inside a server group is an
  // aggregate id and therefore no profile at all: the auth store answers with
  // its empty slice (requiresAuth true, no token), `isFresh` never turns true,
  // and the stream URL below stays empty forever - JPEG-only events never
  // played in a group. The token itself already comes from the caller, which
  // resolved it against the same profile.
  const { isFresh: isAccessTokenFresh } = useFreshAccessToken(profileId);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [badgeVisible, setBadgeVisible] = useState(true);

  // The notice says "this event is a live re-stream, not the video file you
  // expected". Worth one look per event, then out of the way (#340).
  useEffect(() => {
    if (!showNotice) return;
    setBadgeVisible(true);
    const timer = setTimeout(() => setBadgeVisible(false), ZMS_PLAYBACK_BADGE_MS);
    return () => clearTimeout(timer);
  }, [eventId, showNotice]);
  // ZMS speed is a percentage (100 = 1x). Seed from the persisted multiplier so
  // the stream and presets open at the saved speed and carry it across events.
  const [playbackSpeed, setPlaybackSpeed] = useState(() => Math.round((playbackRate ?? 1) * 100));

  // Latest values in refs: the poll effect and the stream-URL memo read these
  // without taking them as deps (which would restart the stream on every change).
  const playbackSpeedRef = useRef(playbackSpeed);
  const onEndedRef = useRef(onEnded);
  const onRateChangeRef = useRef(onRateChange);
  const endedFiredRef = useRef(false);
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
    onEndedRef.current = onEnded;
    onRateChangeRef.current = onRateChange;
  }, [playbackSpeed, onEnded, onRateChange]);

  // zms exits when it cannot serve a frame: a decode failure paints an error
  // such as "Failed getting frame" into the MJPEG stream and quits. The <img>
  // then holds that last frame forever, and before this the only way out was
  // leaving the event and coming back. Once its process is gone, zms answers
  // the status query without playback state, so a run of stateless answers is
  // the signal to restart the stream on a fresh connkey. Restarts are capped:
  // a server that fails the same frame every time would restart forever.
  const missedStatusRef = useRef(0);
  const restartCountRef = useRef(0);
  const streamDeadRef = useRef(false);

  // Frame the stream starts on. A restart resumes where playback died rather
  // than at the top, or a deterministic failure ten seconds in would replay the
  // same ten seconds until the cap.
  const startFrameRef = useRef(1);
  const currentFrameRef = useRef(1);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);

  // New event: resume playing from the first frame and re-arm the end signal.
  // Without this, an event that ended leaves isPlaying=false, so continuous
  // playback would load the next event paused.
  useEffect(() => {
    setIsPlaying(true);
    setCurrentFrame(1);
    endedFiredRef.current = false;
    missedStatusRef.current = 0;
    restartCountRef.current = 0;
    streamDeadRef.current = false;
    startFrameRef.current = 1;
  }, [eventId]);

  // Duration in seconds as reported by the running ZMS stream. The DB event
  // Length and the stream's own duration can disagree (variable capture rate,
  // still-recording events), so seeks must use this value, not eventLength,
  // or the playhead lands at the wrong spot (refs #196).
  const [streamDuration, setStreamDuration] = useState<number | null>(null);
  const effectiveDuration = streamDuration && streamDuration > 0 ? streamDuration : eventLength;

  // While the user drags the scrub bar, the status poll must not write the
  // playhead back from the stream: that fight makes the cursor and video jump
  // around mid-drag (refs #196). Each scrub position is sent as a CMD_SEEK.
  const isScrubbingRef = useRef(false);

  // Pending "flush" repeat of the last settled seek. A paused/idle zms shows a
  // lone seek's frame ~5s late (see EVENT_SEEK_FLUSH_DELAY_MS); repeating the
  // seek makes a second frame flush the first. Kept in a ref so a newer seek can
  // cancel a still-pending flush (refs #196).
  const seekFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unique connection key for this stream. Speed changes are sent as
  // CMD_VARPLAY over the same connkey instead of restarting the stream; only a
  // stream zms has dropped gets a new one.
  const [connKey, setConnKey] = useState(() => Math.floor(Math.random() * 1000000).toString());

  // Calculate alarm frame positions for progress bar
  const alarmFramePositions = useMemo(() => {
    const positions = [];

    // Add first alarm frame
    if (alarmFrameId) {
      const frameNum = parseInt(alarmFrameId);
      positions.push({
        frameId: frameNum,
        position: (frameNum / totalFrames) * 100,
      });
    }

    // Add max score frame if different
    if (maxScoreFrameId && maxScoreFrameId !== alarmFrameId) {
      const frameNum = parseInt(maxScoreFrameId);
      positions.push({
        frameId: frameNum,
        position: (frameNum / totalFrames) * 100,
      });
    }

    return positions;
  }, [alarmFrameId, maxScoreFrameId, totalFrames]);

  // Build ZMS stream URL. Starts at the persisted speed (read from a ref so a
  // mid-event speed change does not recompute the URL); later speed changes go
  // through CMD_VARPLAY so the img src never changes after mount.
  const zmsUrl = useMemo(() => {
    if (!isAccessTokenFresh) return '';
    return getEventZmsUrl(portalUrl, eventId, {
      token,
      apiUrl,
      frame: startFrameRef.current,
      rate: playbackSpeedRef.current,
      maxfps: 30,
      replay: 'none',
      connkey: connKey,
      minStreamingPort,
      monitorId,
    });
  }, [portalUrl, apiUrl, eventId, connKey, token, minStreamingPort, monitorId, isAccessTokenFresh]);

  // The stream itself is an <img> load, so it never appears in the HTTP log the
  // way commands and status queries do: without this line a stream that never
  // starts is indistinguishable from one that was never requested. Host, port
  // and connkey are the three that actually differ between a working and a
  // broken setup (multi-port rewrites the port; refs #337).
  useEffect(() => {
    if (!zmsUrl) {
      log.zmsEventPlayer('No stream URL yet: waiting for a fresh token', LogLevel.DEBUG, {
        eventId,
        monitorId,
      });
      return;
    }
    try {
      const parsed = new URL(zmsUrl);
      log.zmsEventPlayer('Stream URL built', LogLevel.DEBUG, {
        origin: parsed.origin,
        path: parsed.pathname,
        eventId,
        monitorId,
        connkey: connKey,
        rate: parsed.searchParams.get('rate'),
        hasToken: parsed.searchParams.has('token'),
      });
    } catch {
      log.zmsEventPlayer('Stream URL built (unparseable)', LogLevel.WARN, { eventId, monitorId });
    }
  }, [zmsUrl, eventId, monitorId, connKey]);

  // Send control command to the stream
  const sendCommand = useCallback(async (cmd: number, opts?: { offset?: number; rate?: number }) => {
    const url = getZmsControlUrl(portalUrl, cmd, connKey, {
      token,
      apiUrl,
      offset: opts?.offset,
      rate: opts?.rate,
      minStreamingPort,
      monitorId,
    });

    // The seek/control request hits ZMS server-side (visible in ZM logs as
    // command=14&offset=...), so log it client-side too (refs #196). Token is
    // omitted; the URL would otherwise leak it. offset is only set for Seek and
    // rate only for VarPlay, so they are undefined for Play/Pause.
    log.zmsEventPlayer(`Sending stream command: ${zmsCommandName(cmd)}`, LogLevel.DEBUG, {
      command: cmd,
      commandName: zmsCommandName(cmd),
      offset: opts?.offset,
      rate: opts?.rate,
      connkey: connKey,
    });

    try {
      await httpGet(url);
    } catch (err) {
      log.zmsEventPlayer('Stream command failed', LogLevel.ERROR, {
        command: cmd,
        connkey: connKey,
        error: err,
      });
    }
  }, [portalUrl, apiUrl, connKey, token, minStreamingPort, monitorId]);

  // Send CMD_QUIT on unmount so the nph-zms process exits instead of idling.
  // Params are kept in a ref so the cleanup closure is never stale.
  // Teardown timeout, deliberately shorter than the API timeout: a wedged zms
  // never answers. See API_REQUEST.cmdQuitTimeoutSeconds.
  const cmdQuitTimeoutMs = API_REQUEST.cmdQuitTimeoutSeconds * 1000;
  const quitParamsRef = useRef({ portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs });
  useEffect(() => {
    quitParamsRef.current = { portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs };
  }, [portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs]);

  // Only quit a stream that actually started: the img onLoad flips this flag.
  // Guards against killing nothing (token never fresh, stream failed) and
  // against StrictMode's dev double-mount quitting the surviving mount's stream.
  const streamStartedRef = useRef(false);

  // Start a new stream for this event on a fresh connkey, resuming from the
  // frame playback reached. Clearing streamStartedRef means the replacement has
  // to deliver a frame of its own before it can be judged dead in turn, so a
  // stream that never starts cannot spin through the restart budget.
  const restartStream = useCallback(() => {
    startFrameRef.current = currentFrameRef.current;
    missedStatusRef.current = 0;
    streamDeadRef.current = false;
    streamStartedRef.current = false;
    setConnKey(Math.floor(Math.random() * 1000000).toString());
  }, []);

  useEffect(() => {
    // A remount that reuses the connkey (StrictMode dev double-mount) cancels
    // the quit scheduled by the previous cleanup.
    cancelPendingQuit(quitParamsRef.current.connKey);

    return () => {
      if (!streamStartedRef.current) return;
      const p = quitParamsRef.current;
      const url = getZmsControlUrl(p.portalUrl, ZMS_COMMANDS.cmdQuit, p.connKey, {
        token: p.token,
        apiUrl: p.apiUrl,
        minStreamingPort: p.minStreamingPort,
        monitorId: p.monitorId,
      });
      // Delayed fire-and-forget: release the server process unless a remount
      // cancels the quit within the grace window
      sendDelayedCmdQuit(url, p.connKey, {
        timeoutMs: p.cmdQuitTimeoutMs,
        logContext: { eventId: p.eventId },
      });
    };
  }, []); // Empty deps = only run on unmount

  // Poll stream status to track playback position.
  // Uses an AbortController shared with all in-flight httpGet calls so unmount
  // (or pause) immediately cancels pending requests and prevents setState on an
  // unmounted component.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isPlaying) return;

    const controller = new AbortController();
    const { signal } = controller;

    // One poll that learned nothing about playback. Enough of them in a row and
    // the stream is gone, so replace it; past the cap, stop and let the play
    // button ask for a new one.
    const noteMissedStatus = () => {
      missedStatusRef.current += 1;
      if (missedStatusRef.current < ZMS_STREAM_DEAD_POLLS || !streamStartedRef.current) return;

      if (restartCountRef.current >= ZMS_STREAM_MAX_RESTARTS) {
        streamDeadRef.current = true;
        setIsPlaying(false);
        log.zmsEventPlayer('Stream gone and restart limit reached', LogLevel.WARN, {
          eventId,
          monitorId,
          connkey: connKey,
          restarts: restartCountRef.current,
        });
        return;
      }

      restartCountRef.current += 1;
      log.zmsEventPlayer('Stream gone, restarting on a fresh connkey', LogLevel.INFO, {
        eventId,
        monitorId,
        connkey: connKey,
        frame: currentFrameRef.current,
        attempt: restartCountRef.current,
      });
      restartStream();
    };

    const tick = async () => {
      if (signal.aborted) return;
      // Don't query or move the playhead mid-scrub: the drag owns the position.
      if (isScrubbingRef.current) return;
      const url = getZmsControlUrl(portalUrl, ZMS_COMMANDS.cmdQuery, connKey, { token, apiUrl, minStreamingPort, monitorId });
      try {
        const resp = await httpGet<{ status?: { progress?: number; duration?: number } }>(url, { signal });
        if (signal.aborted || isScrubbingRef.current) return;
        const status = resp.data?.status;
        if (!status || typeof status.progress !== 'number' || typeof status.duration !== 'number') {
          // A running stream answers with progress/duration. Anything else means
          // ZMS has no process for this connkey, which is what a stream that
          // never started looks like from here (refs #337).
          log.zmsEventPlayer('Status query returned no playback state', LogLevel.DEBUG, {
            connkey: connKey,
            keys: resp.data && typeof resp.data === 'object' ? Object.keys(resp.data) : typeof resp.data,
          });
          noteMissedStatus();
        }
        if (status && typeof status.progress === 'number' && typeof status.duration === 'number' && status.duration > 0) {
          missedStatusRef.current = 0;
          setStreamDuration(status.duration);
          const fraction = status.progress / status.duration;
          const frame = Math.max(1, Math.round(fraction * totalFrames));
          setCurrentFrame(frame);

          if (fraction >= 0.99) {
            sendCommand(ZMS_COMMANDS.cmdPause);
            setIsPlaying(false);
            setCurrentFrame(totalFrames);
            // Fire the end signal once per event (the eventId effect re-arms it).
            if (!endedFiredRef.current) {
              endedFiredRef.current = true;
              onEndedRef.current?.();
            }
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        log.zmsEventPlayer('Status query failed', LogLevel.DEBUG, { error: err });
        noteMissedStatus();
      }
    };

    pollTimer.current = setInterval(tick, bandwidth.zmsStatusInterval);

    return () => {
      controller.abort();
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isPlaying, bandwidth.zmsStatusInterval, portalUrl, connKey, token, apiUrl, totalFrames, minStreamingPort, monitorId, sendCommand, restartStream, eventId]);

  // Calculate time offset from frame number. Uses the stream-reported duration
  // so the seek lands where the progress bar says it will (refs #196).
  const frameToOffset = useCallback((frame: number) => {
    return (frame / totalFrames) * effectiveDuration;
  }, [totalFrames, effectiveDuration]);

  // Handle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      sendCommand(ZMS_COMMANDS.cmdPause);
      setIsPlaying(false);
      return;
    }
    // Playing a stream zms already abandoned would command a connkey with no
    // process behind it. Start a fresh one instead, and give the user's own
    // retry a full restart budget again.
    if (streamDeadRef.current) {
      restartCountRef.current = 0;
      restartStream();
      setIsPlaying(true);
      return;
    }
    sendCommand(ZMS_COMMANDS.cmdPlay);
    setIsPlaying(true);
  }, [isPlaying, sendCommand, restartStream]);

  // Pause while suspended and resume on release, but only for a stream that was
  // running: a stream the user had paused stays paused. isPlaying and sendCommand
  // are read, not depended on, so a normal play/pause does not re-run this.
  const resumeAfterSuspendRef = useRef(false);
  useEffect(() => {
    if (suspended) {
      resumeAfterSuspendRef.current = isPlaying;
      if (isPlaying) {
        sendCommand(ZMS_COMMANDS.cmdPause);
        setIsPlaying(false);
      }
    } else if (resumeAfterSuspendRef.current) {
      resumeAfterSuspendRef.current = false;
      sendCommand(ZMS_COMMANDS.cmdPlay);
      setIsPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended]);

  // Change playback speed with CMD_VARPLAY on the existing connkey, matching
  // ZoneMinder's own event UI. zms resumes playing after a VARPLAY.
  const changeSpeed = useCallback((rate: number) => {
    setPlaybackSpeed(rate);
    sendCommand(ZMS_COMMANDS.cmdVarPlay, { rate });
    setIsPlaying(true);
    // Persist as a multiplier so it carries to the next event and the MP4 player.
    onRateChangeRef.current?.(rate / 100);
  }, [sendCommand]);

  // Handle frame navigation
  const goToFrame = useCallback((frame: number) => {
    const newFrame = Math.max(1, Math.min(frame, totalFrames));
    setCurrentFrame(newFrame);

    // Seek to offset in seconds
    const offset = frameToOffset(newFrame);
    // Log the frame->offset translation and which duration drove it, so a seek
    // that lands at the wrong spot can be traced to the inputs (refs #196).
    log.zmsEventPlayer('Seeking to frame', LogLevel.DEBUG, {
      frame: newFrame,
      totalFrames,
      offset,
      effectiveDuration,
      streamDuration,
      eventLength,
      usingStreamDuration: streamDuration != null && streamDuration > 0,
    });
    sendCommand(ZMS_COMMANDS.cmdSeek, { offset });

    // MJPEG in an <img> renders a frame only when the next multipart boundary
    // arrives, and a paused/idle zms only emits its next frame on the 5s
    // keepalive, so a lone seek's frame lands ~5s late. Newer zms sends the
    // sought frame twice to fix this; older servers (ZM 1.36) do not, so repeat
    // the seek to force a second, flushing frame. Skip it when the stream is
    // confirmed to be advancing on its own: a played frame already flushes the
    // seek, and repeating would yank playback backward (refs #196).
    if (seekFlushTimerRef.current) {
      clearTimeout(seekFlushTimerRef.current);
      seekFlushTimerRef.current = null;
    }
    const streamAdvancing = isPlaying && streamDuration != null && streamDuration > 0;
    if (!streamAdvancing) {
      seekFlushTimerRef.current = setTimeout(() => {
        seekFlushTimerRef.current = null;
        sendCommand(ZMS_COMMANDS.cmdSeek, { offset });
      }, EVENT_SEEK_FLUSH_DELAY_MS);
    }
  }, [totalFrames, frameToOffset, sendCommand, effectiveDuration, streamDuration, eventLength, isPlaying]);

  // Cancel any pending seek-flush repeat on unmount.
  useEffect(() => {
    return () => {
      if (seekFlushTimerRef.current) clearTimeout(seekFlushTimerRef.current);
    };
  }, []);

  const seekBack = useCallback(() => {
    // Seek back 5 seconds
    const targetOffset = Math.max(0, frameToOffset(currentFrame) - 5);
    const targetFrame = Math.max(1, Math.round((targetOffset / effectiveDuration) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, effectiveDuration, totalFrames, goToFrame]);

  const seekForward = useCallback(() => {
    // Seek forward 5 seconds
    const targetOffset = Math.min(effectiveDuration, frameToOffset(currentFrame) + 5);
    const targetFrame = Math.min(totalFrames, Math.round((targetOffset / effectiveDuration) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, effectiveDuration, totalFrames, goToFrame]);

  const goToStart = useCallback(() => {
    goToFrame(1);
  }, [goToFrame]);

  const goToEnd = useCallback(() => {
    goToFrame(totalFrames);
  }, [goToFrame, totalFrames]);

  // Grab the scrub bar: just silence the status poll so it does not write the
  // playhead back mid-drag. Each scrub position is a CMD_SEEK; ZMS handles the
  // seek without a surrounding pause/play, so we do not send them (refs #196).
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true;
  }, []);

  // Release: re-enable the status poll. Playback state is unchanged by scrubbing.
  const handleScrubEnd = useCallback(() => {
    isScrubbingRef.current = false;
  }, []);

  // Jump to alarm frame
  const jumpToAlarmFrame = useCallback(() => {
    if (alarmFrameId) {
      goToFrame(parseInt(alarmFrameId));
    }
  }, [alarmFrameId, goToFrame]);

  // Jump to max score frame
  const jumpToMaxScoreFrame = useCallback(() => {
    if (maxScoreFrameId) {
      goToFrame(parseInt(maxScoreFrameId));
    }
  }, [maxScoreFrameId, goToFrame]);

  // Speed presets
  // Pinch-to-zoom and pan for ZMS image
  const zoomPan = useZoomPan();

  // Shared with the MP4 speed menu (EVENT_PLAYBACK_RATES). ZMS uses percentages,
  // so each multiplier maps to rate * 100.
  const speedPresets = EVENT_PLAYBACK_RATES.map((rate) => ({
    label: `${rate}x`,
    value: rate * 100,
  }));

  // Transport and progress live in the controls card normally and as an
  // overlay on the picture in fullscreen, where the full card would leave a
  // landscape phone almost no room for the picture (refs #462).
  const transport = (
    <>
      {/* Transport Controls */}
      <div className="flex items-center justify-center gap-2">
        {/* Jump to start */}
        <Button
          variant="outline"
          size="icon"
          onClick={goToStart}
          disabled={currentFrame <= 1}
          title={t('event_detail.go_to_start')}
          data-testid="zms-go-to-start"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        {/* Seek back 5s */}
        <Button
          variant="outline"
          size="sm"
          onClick={seekBack}
          disabled={currentFrame <= 1}
          title={t('event_detail.rewind')}
          className="gap-1"
          data-testid="zms-seek-back"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs">{t('event_detail.seek_back')}</span>
        </Button>
        {/* Play/Pause */}
        <Button
          variant="default"
          size="icon"
          onClick={togglePlayPause}
          title={isPlaying ? t('event_detail.pause') : t('event_detail.play')}
          data-testid="zms-play-pause"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        {/* Seek forward 5s */}
        <Button
          variant="outline"
          size="sm"
          onClick={seekForward}
          disabled={currentFrame >= totalFrames}
          title={t('event_detail.fast_forward')}
          className="gap-1"
          data-testid="zms-seek-forward"
        >
          <span className="text-xs">{t('event_detail.seek_forward')}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {/* Jump to end */}
        <Button
          variant="outline"
          size="icon"
          onClick={goToEnd}
          disabled={currentFrame >= totalFrames}
          title={t('event_detail.go_to_end')}
          data-testid="zms-go-to-end"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
  const progress = (
    <>
      {/* Progress Bar with Alarm Frames */}
      <EventProgressBar
        currentFrame={currentFrame}
        totalFrames={totalFrames}
        alarmFrames={alarmFramePositions}
        onSeek={goToFrame}
        duration={effectiveDuration}
        onScrubStart={handleScrubStart}
        onScrubEnd={handleScrubEnd}
      />
    </>
  );

  return (
    <div className={cn(className, fullscreen && 'flex flex-col h-full min-h-0 gap-3')}>
      {/* Video Display */}
      <Card
        ref={zoomPan.ref}
        className={cn(
          'overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black touch-none relative',
          fullscreen && 'flex-1 min-h-0 rounded-none shadow-none ring-0',
        )}
      >
        <div className={cn('relative bg-black', fullscreen ? 'h-full' : 'aspect-video')} data-testid="zms-video-area">
          {/* No-video placeholder: behind the stream, only visible when image fails */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <VideoOff className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <div ref={zoomPan.innerRef} className={cn('relative z-10', fullscreen && 'h-full')}>
            {/* Nothing to render until there is a URL: an <img src=""> paints
                the browser's own broken-image glyph and alt text on top of the
                no-video placeholder this markup already provides. */}
            {zmsUrl && (
            <img
              src={zmsUrl}
              alt={t('event_detail.event_playback')}
              className="w-full h-full object-contain"
              onError={(e) => {
                // The only signal that ZMS refused the stream: no HTTP log line
                // exists for an image load (refs #337).
                log.zmsEventPlayer('Stream image failed to load', LogLevel.WARN, {
                  eventId,
                  monitorId,
                  connkey: connKey,
                });
                (e.target as HTMLImageElement).style.display = 'none';
              }}
              onLoad={(e) => {
                if (!streamStartedRef.current) {
                  log.zmsEventPlayer('Stream started', LogLevel.DEBUG, { eventId, monitorId, connkey: connKey });
                }
                streamStartedRef.current = true;
                (e.target as HTMLImageElement).style.display = '';
              }}
            />
            )}
          </div>

          {/* Fallback notice - fades out after a few seconds so it stops covering the picture (issue #340) */}
          {showNotice && (
            <div
              className={cn(
                'absolute top-4 left-4 z-10 pointer-events-none transition-opacity duration-1000',
                badgeVisible ? 'opacity-100' : 'opacity-0',
              )}
            >
              <Badge variant="secondary" className="gap-2 bg-blue-500/80 text-white">
                <AlertCircle className="h-3 w-3" />
                {t('event_detail.zms_playback')}
              </Badge>
            </div>
          )}
        </div>
        <ZoomControls zoomPan={zoomPan} className={fullscreen ? 'bottom-28 left-2' : 'bottom-2 left-2'} />
        {fullscreen && (
          <div
            className="absolute inset-x-0 bottom-0 z-20 space-y-2 bg-black/60 p-2 pb-[max(0.5rem,var(--sai-bottom,env(safe-area-inset-bottom)))] backdrop-blur-sm"
            data-testid="zms-fullscreen-controls"
          >
            {transport}
            {progress}
          </div>
        )}
      </Card>

      {/* Playback Controls */}
      {!fullscreen && (
      <Card className="p-4 space-y-4 bg-card/95 backdrop-blur">
        {transport}
        {progress}
        {/* Speed Controls */}
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            {t('event_detail.playback_speed')}
          </label>
          <div className="flex gap-2 justify-center flex-wrap">
            {speedPresets.map((preset) => (
              <Button
                key={preset.value}
                variant={playbackSpeed === preset.value ? 'default' : 'outline'}
                aria-pressed={playbackSpeed === preset.value}
                size="sm"
                onClick={() => changeSpeed(preset.value)}
                data-testid={`zms-speed-${preset.value}`}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Quick Jump Buttons */}
        {(alarmFrameId || maxScoreFrameId) && (
          <div className="flex gap-2 justify-center flex-wrap">
            {alarmFrameId && (
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToAlarmFrame}
                className="gap-2"
                data-testid="zms-quick-jump-alarm-frame"
              >
                <AlertCircle className="h-4 w-4 text-destructive" />
                {t('event_detail.first_alarm_frame')}
              </Button>
            )}
            {maxScoreFrameId && (
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToMaxScoreFrame}
                className="gap-2"
                data-testid="zms-quick-jump-max-score-frame"
              >
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                {t('event_detail.max_score_frame')}
              </Button>
            )}
          </div>
        )}

        {/* Alarm Frames Info */}
        {alarmFrames > 0 && (
          <div className="text-center text-sm text-muted-foreground">
            {t('event_detail.alarm_frames_count', { count: alarmFrames, total: totalFrames })}
          </div>
        )}
      </Card>
      )}

      {/* Max score frame. The first alarm frame is no longer shown here: the
          event frame carousel above the player already leads with it (refs
          #272), and the quick-jump button above still seeks to it. */}
      {!fullscreen && maxScoreFrameId && maxScoreFrameId !== alarmFrameId && (
        <Card className="p-4 mt-4">
          <h3 className="text-sm font-semibold mb-3">{t('event_detail.max_score_frame')}</h3>
          <button
            type="button"
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={jumpToMaxScoreFrame}
            data-testid="zms-jump-to-max-score-frame"
          >
            <img
              src={isAccessTokenFresh ? getEventImageUrl(portalUrl, eventId, parseInt(maxScoreFrameId), {
                token,
                width: 120,
                apiUrl,
                minStreamingPort,
                monitorId,
              }) : undefined}
              alt={t('event_detail.max_score_frame')}
              className="w-30 h-20 object-cover rounded border-2 border-yellow-500"
            />
            <p className="text-xs text-center mt-1 text-muted-foreground">
              {t('event_detail.frame')} {maxScoreFrameId}
            </p>
          </button>
        </Card>
      )}
    </div>
  );
}
