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
import { getEventZmsUrl, getZmsControlUrl } from '../../lib/url-builder';
import { useZoomPan } from '../../hooks/useZoomPan';
import { ZoomControls } from '../ui/ZoomControls';
import { useBandwidthSettings } from '../../hooks/useBandwidthSettings';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';

// ZoneMinder stream command constants
const ZM_CMD = {
  PAUSE: 1,
  PLAY: 2,
  STOP: 3,
  FASTFWD: 4,
  SLOWFWD: 5,
  SLOWREV: 6,
  FASTREV: 7,
  PREV: 12,
  NEXT: 13,
  SEEK: 14,
  QUERY: 99,
} as const;

interface ZmsEventPlayerProps {
  portalUrl: string;
  eventId: string;
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
}

export function ZmsEventPlayer({
  portalUrl,
  eventId,
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
}: ZmsEventPlayerProps) {
  const { t } = useTranslation();
  const bandwidth = useBandwidthSettings();
  const { isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const [currentFrame, setCurrentFrame] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(100); // 100 = 1x speed

  // Generate unique connection key for this stream (regenerate on speed change)
  const connKey = useMemo(
    () => Math.floor(Math.random() * 1000000).toString(),
    [playbackSpeed]
  );

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

  // Build ZMS stream URL
  const zmsUrl = useMemo(() => {
    if (!isAccessTokenFresh) return '';
    return getEventZmsUrl(portalUrl, eventId, {
      token,
      apiUrl,
      frame: 1,
      rate: playbackSpeed,
      maxfps: 30,
      replay: 'single',
      connkey: connKey,
      minStreamingPort,
      monitorId,
    });
  }, [portalUrl, apiUrl, eventId, playbackSpeed, connKey, token, minStreamingPort, monitorId, isAccessTokenFresh]);

  // Send control command to the stream
  const sendCommand = useCallback(async (cmd: number, offset?: number) => {
    const url = getZmsControlUrl(portalUrl, cmd, connKey, { token, apiUrl, offset, minStreamingPort, monitorId });

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

  // Poll stream status to track playback position
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const queryStatus = useCallback(async () => {
    const url = getZmsControlUrl(portalUrl, ZM_CMD.QUERY, connKey, { token, apiUrl, minStreamingPort, monitorId });
    try {
      const resp = await httpGet<{ status?: { progress?: number; duration?: number } }>(url);
      const status = resp.data?.status;
      if (status && typeof status.progress === 'number' && typeof status.duration === 'number' && status.duration > 0) {
        const fraction = status.progress / status.duration;
        const frame = Math.max(1, Math.round(fraction * totalFrames));
        setCurrentFrame(frame);

        // Stop at end of event to prevent looping
        if (fraction >= 0.99) {
          sendCommand(ZM_CMD.PAUSE);
          setIsPlaying(false);
          setCurrentFrame(totalFrames);
        }
      }
    } catch {
      // Status query failed — ignore and retry next tick
    }
  }, [portalUrl, connKey, token, apiUrl, totalFrames, minStreamingPort, monitorId]);

  useEffect(() => {
    if (isPlaying) {
      pollTimer.current = setInterval(queryStatus, bandwidth.zmsStatusInterval);
    } else if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isPlaying, queryStatus, bandwidth.zmsStatusInterval]);

  // Calculate time offset from frame number
  const frameToOffset = useCallback((frame: number) => {
    return (frame / totalFrames) * eventLength;
  }, [totalFrames, eventLength]);

  // Handle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      sendCommand(ZM_CMD.PAUSE);
      setIsPlaying(false);
    } else {
      sendCommand(ZM_CMD.PLAY);
      setIsPlaying(true);
    }
  }, [isPlaying, sendCommand]);

  // Handle frame navigation
  const goToFrame = useCallback((frame: number) => {
    const newFrame = Math.max(1, Math.min(frame, totalFrames));
    setCurrentFrame(newFrame);

    // Seek to offset in seconds
    const offset = frameToOffset(newFrame);
    sendCommand(ZM_CMD.SEEK, offset);
  }, [totalFrames, frameToOffset, sendCommand]);

  const seekBack = useCallback(() => {
    // Seek back 5 seconds
    const targetOffset = Math.max(0, frameToOffset(currentFrame) - 5);
    const targetFrame = Math.max(1, Math.round((targetOffset / eventLength) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, eventLength, totalFrames, goToFrame]);

  const seekForward = useCallback(() => {
    // Seek forward 5 seconds
    const targetOffset = Math.min(eventLength, frameToOffset(currentFrame) + 5);
    const targetFrame = Math.min(totalFrames, Math.round((targetOffset / eventLength) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, eventLength, totalFrames, goToFrame]);

  const goToStart = useCallback(() => {
    goToFrame(1);
  }, [goToFrame]);

  const goToEnd = useCallback(() => {
    goToFrame(totalFrames);
  }, [goToFrame, totalFrames]);

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
  const zoomPan = useZoomPan({ maxScale: 4 });

  const speedPresets = [
    { label: '0.25x', value: 25 },
    { label: '0.5x', value: 50 },
    { label: '1x', value: 100 },
    { label: '2x', value: 200 },
    { label: '4x', value: 400 },
  ];

  return (
    <div className={className}>
      {/* Video Display */}
      <Card
        ref={zoomPan.ref}
        className="overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black touch-none relative"
      >
        <div className="aspect-video relative bg-black">
          {/* No-video placeholder — behind the stream, only visible when image fails */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <VideoOff className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <div ref={zoomPan.innerRef} className="relative z-10">
            <img
              src={zmsUrl}
              alt={t('event_detail.event_playback')}
              className="w-full h-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              onLoad={(e) => { (e.target as HTMLImageElement).style.display = ''; }}
            />
          </div>

          {/* Status Badge */}
          <div className="absolute top-4 left-4 z-10">
            <Badge variant="secondary" className="gap-2 bg-blue-500/80 text-white hover:bg-blue-500">
              <AlertCircle className="h-3 w-3" />
              {t('event_detail.zms_playback')}
            </Badge>
          </div>
        </div>
        <ZoomControls
          onZoomIn={zoomPan.zoomIn}
          onZoomOut={zoomPan.zoomOut}
          onReset={zoomPan.reset}
          onPanLeft={zoomPan.panLeft}
          onPanRight={zoomPan.panRight}
          onPanUp={zoomPan.panUp}
          onPanDown={zoomPan.panDown}
          isZoomed={zoomPan.isZoomed}
          scale={zoomPan.scale}
          className="bottom-2 left-2"
        />
      </Card>

      {/* Playback Controls */}
      <Card className="p-4 space-y-4 bg-card/95 backdrop-blur">
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

        {/* Progress Bar with Alarm Frames */}
        <EventProgressBar
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          alarmFrames={alarmFramePositions}
          onSeek={goToFrame}
          duration={eventLength}
        />

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
                size="sm"
                onClick={() => setPlaybackSpeed(preset.value)}
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

      {/* Alarm Frames Timeline */}
      {alarmFrames > 0 && alarmFrameId && (
        <Card className="p-4 mt-4">
          <h3 className="text-sm font-semibold mb-3">{t('event_detail.alarm_frames')}</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {/* First alarm frame */}
            <div
              className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={jumpToAlarmFrame}
            >
              <img
                src={isAccessTokenFresh ? getEventImageUrl(portalUrl, eventId, parseInt(alarmFrameId), {
                  token,
                  width: 120,
                  apiUrl,
                  minStreamingPort,
                  monitorId,
                }) : undefined}
                alt={t('event_detail.first_alarm_frame')}
                className="w-30 h-20 object-cover rounded border-2 border-destructive"
              />
              <p className="text-xs text-center mt-1 text-muted-foreground">
                {t('event_detail.frame')} {alarmFrameId}
              </p>
            </div>

            {/* Max score frame if different from alarm frame */}
            {maxScoreFrameId && maxScoreFrameId !== alarmFrameId && (
              <div
                className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={jumpToMaxScoreFrame}
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
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
