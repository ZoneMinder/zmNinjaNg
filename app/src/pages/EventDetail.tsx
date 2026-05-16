/**
 * Event Detail Page
 *
 * Displays detailed information about a specific event.
 * Includes video playback (or image fallback), metadata, and download options.
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getEvent, getEventVideoUrl, getEventImageUrl } from '../api/events';
import { resolveFallbackFids } from '../lib/thumbnail-chain';
import { getMonitor } from '../api/monitors';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { useEventTagMapping } from '../hooks/useEventTags';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Mp4EventPlayer } from '../components/events/Mp4EventPlayer';
import { ZmsEventPlayer } from '../components/events/ZmsEventPlayer';
import { TagChip } from '../components/events/TagChip';
import { ArrowLeft, Calendar, Clock, HardDrive, AlertTriangle, Download, Archive, Video, Star, Timer, Tag, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { getEventCauseIcon } from '../lib/event-icons';
import { getObjectClassIconFromList } from '../lib/object-class-icons';
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';
import { useTvMode } from '../hooks/useTvMode';
import { Platform } from '../lib/platform';
import { downloadEventVideo } from '../lib/download';
import { getOrientedResolution } from '../lib/monitor-rotation';
import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { log, LogLevel } from '../lib/logger';
import { generateEventMarkers, type VideoMarker } from '../lib/video-markers';
import { useEventFavoritesStore } from '../stores/eventFavorites';
import { useZoomPan } from '../hooks/useZoomPan';
import { ZoomControls } from '../components/ui/ZoomControls';
import { useEventNavigation } from '../hooks/useEventNavigation';
import { useServerUrls } from '../hooks/useServerUrls';
import { cn } from '../lib/utils';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { fmtDate, fmtTime } = useDateTimeFormat();
  const { isTvMode } = useTvMode();

  // Check if user came from another page (navigation state tracking)
  const referrer = location.state?.from as string | undefined;
  const canGoBack = referrer || window.history.length > 1;
  const goBack = () => referrer ? navigate(referrer) : canGoBack ? navigate(-1) : navigate('/events');
  const [useZmsFallback, setUseZmsFallback] = useState(isTvMode || Platform.isTVDevice);

  // On TV devices, use ZMS stream instead of MP4 (Fire Stick WebView has video rendering issues)
  useEffect(() => {
    if (isTvMode) setUseZmsFallback(true);
  }, [isTvMode]);

  const { data: event, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: () => getEvent(id!),
    enabled: !!id,
  });
  const { data: monitorData } = useQuery({
    queryKey: ['monitor', event?.Event.MonitorId],
    queryFn: () => getMonitor(event!.Event.MonitorId),
    enabled: !!event?.Event.MonitorId,
  });

  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();

  // Resolve portal URL for the monitor's server (multi-server support)
  const { portalPath } = useServerUrls(monitorData?.Monitor?.ServerId);
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : currentProfile?.portalUrl || '';

  const { isFavorited, toggleFavorite } = useEventFavoritesStore();
  const {
    goToPrevEvent,
    goToNextEvent,
    isLoadingPrev,
    isLoadingNext,
  } = useEventNavigation({
    currentEventId: id,
    currentStartDateTime: event?.Event.StartDateTime,
  });

  const isFav = currentProfile && event ? isFavorited(currentProfile.id, event.Event.Id) : false;

  // Fetch tags for this event
  const { getTagsForEvent } = useEventTagMapping({
    eventIds: id ? [id] : [],
    enabled: !!id,
  });

  const eventTags = id ? getTagsForEvent(id) : [];

  const handleFavoriteToggle = useCallback(() => {
    if (currentProfile && event) {
      toggleFavorite(currentProfile.id, event.Event.Id);
      toast.success(
        isFav ? t('events.removed_from_favorites') : t('events.added_to_favorites')
      );
    }
  }, [currentProfile, event, toggleFavorite, isFav, t]);

  // Generate video markers for alarm frames
  // NOTE: This hook must be called before any conditional returns
  const videoMarkers = useMemo(() => {
    if (!event) return [];
    const markers = generateEventMarkers(event.Event);

    // Add internationalized text to markers
    return markers.map(marker => ({
      ...marker,
      text: marker.type === 'alarm'
        ? t('event_detail.alarm_frame_marker', { frameId: marker.frameId })
        : t('event_detail.max_score_marker', { frameId: marker.frameId })
    }));
  }, [event, t]);

  // Handle marker clicks
  // NOTE: This hook must be called before any conditional returns
  const handleMarkerClick = useCallback((marker: VideoMarker) => {
    log.eventDetail('Video marker clicked', LogLevel.INFO, {
      frameId: marker.frameId,
      type: marker.type
    });
    toast.info(t('event_detail.marker_jumped', { text: marker.text }));
  }, [t]);

  // Set document title for iOS fullscreen banner (shows instead of raw URL)
  useEffect(() => {
    const monitorName = monitorData?.Monitor.Name;
    document.title = monitorName
      ? `${monitorName} – Event ${id}`
      : `Event ${id}`;
    return () => { document.title = 'zmNinjaNg'; };
  }, [id, monitorData]);

  // Pinch-to-zoom and pan for event video/image
  const zoomPan = useZoomPan({ maxScale: 4 });

  const orientedResolution = useMemo(
    () => getOrientedResolution(
      event?.Event.Width ?? monitorData?.Monitor.Width,
      event?.Event.Height ?? monitorData?.Monitor.Height,
      event?.Event.Orientation ?? monitorData?.Monitor.Orientation
    ),
    [
      event?.Event.Height,
      event?.Event.Orientation,
      event?.Event.Width,
      monitorData?.Monitor.Height,
      monitorData?.Monitor.Orientation,
      monitorData?.Monitor.Width,
    ]
  );

  // Hooks below must run on every render — keep them ABOVE the early returns.
  // Reading event?.Event optionally so they're safe pre-data; consumers below
  // already gate on `hasVideo` / `event` which are derived after the returns.
  const hasVideo = !!(event?.Event.DefaultVideo || event?.Event.Videoed === '1');
  const isHlsEvent = event?.Event.DefaultVideo?.endsWith('.m3u8') === true;
  const eventIdForUrls = event?.Event.Id;
  const monitorIdForUrls = event?.Event.MonitorId;
  const posterFid = resolveFallbackFids(settings.thumbnailFallbackChain)[0] ?? 'snapshot';

  // Memoize so identity is stable across re-renders that don't touch the inputs.
  // Without memoization the Mp4EventPlayer's update effect calls player.src() mid-playback
  // every time the parent re-renders for unrelated reasons (toast state, query refetch).
  const videoUrl = useMemo(
    () => (currentProfile && hasVideo && isAccessTokenFresh && eventIdForUrls
      ? getEventVideoUrl(resolvedPortalUrl, eventIdForUrls, accessToken || undefined, currentProfile.apiUrl, isHlsEvent, currentProfile.minStreamingPort, monitorIdForUrls)
      : ''),
    [currentProfile, hasVideo, isAccessTokenFresh, resolvedPortalUrl, eventIdForUrls, accessToken, isHlsEvent, monitorIdForUrls]
  );

  const posterUrl = useMemo(
    () => (currentProfile && isAccessTokenFresh && eventIdForUrls
      ? getEventImageUrl(resolvedPortalUrl, eventIdForUrls, posterFid, {
        token: accessToken || undefined,
        apiUrl: currentProfile.apiUrl,
        minStreamingPort: currentProfile.minStreamingPort,
        monitorId: monitorIdForUrls,
      })
      : undefined),
    [currentProfile, isAccessTokenFresh, resolvedPortalUrl, eventIdForUrls, posterFid, accessToken, monitorIdForUrls]
  );

  // Stable callback so Mp4EventPlayer's effect doesn't re-run on every parent render.
  const handleVideoError = useCallback(() => {
    log.eventDetail('Video playback failed, falling back to ZMS stream', LogLevel.INFO);
    toast.error(t('event_detail.video_playback_failed'));
    setUseZmsFallback(true);
  }, [t]);

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
        <div className="aspect-video w-full max-w-4xl bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="p-8">
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          {t('event_detail.load_error')}
        </div>
        <Button onClick={goBack} className="mt-4">
          {t('common.go_back')}
        </Button>
      </div>
    );
  }

  const hasJPEGs = event.Event.SaveJPEGs !== null && event.Event.SaveJPEGs !== '0';
  const videoMimeType = isHlsEvent ? 'application/x-mpegURL' : 'video/mp4';

  log.eventDetail('Event details', LogLevel.DEBUG, {
    eventId: event.Event.Id,
    defaultVideo: event.Event.DefaultVideo,
    videoed: event.Event.Videoed,
    saveJPEGs: event.Event.SaveJPEGs,
    hasVideo,
    hasJPEGs
  });

  const startTime = new Date(event.Event.StartDateTime.replace(' ', 'T'));
  const incomingSlide = location.state?.slideDirection as 'left' | 'right' | undefined;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label={t('common.go_back')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevEvent}
            disabled={isLoadingPrev}
            aria-label={t('common.previous')}
            className="h-7 w-7"
            data-testid="event-detail-prev"
          >
            {isLoadingPrev ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
          <div>
            <h1 className="text-sm sm:text-base font-semibold truncate max-w-[200px] sm:max-w-none">{event.Event.Name}</h1>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
              {(() => {
                const CauseIcon = getEventCauseIcon(event.Event.Cause);
                return (
                  <Badge variant="outline" className="text-[10px] h-4 gap-1">
                    <CauseIcon className="h-3 w-3" />
                    {event.Event.Cause}
                  </Badge>
                );
              })()}
              {monitorData && (
                <span className="hidden sm:inline">{monitorData.Monitor.Name}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextEvent}
            disabled={isLoadingNext}
            aria-label={t('common.next')}
            className="h-7 w-7"
            data-testid="event-detail-next"
          >
            {isLoadingNext ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <Button
            variant={isFav ? "default" : "outline"}
            size="sm"
            className="gap-2 h-8 sm:h-9"
            onClick={handleFavoriteToggle}
            title={isFav ? t('events.unfavorite') : t('events.favorite')}
            data-testid="event-detail-favorite-button"
          >
            <Star className={isFav ? "h-4 w-4 fill-current" : "h-4 w-4"} />
            <span className="hidden sm:inline">{isFav ? t('events.favorited') : t('events.favorite')}</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-8 sm:h-9" onClick={() => navigate(`/monitors/${event.Event.MonitorId}`)} title={t('event_detail.view_camera')} data-testid="event-detail-view-camera">
            <Video className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.view_camera')}</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-8 sm:h-9" onClick={() => navigate(`/events?monitorId=${event.Event.MonitorId}`)} title={t('event_detail.all_events')} data-testid="event-detail-all-events">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.all_events')}</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-8 sm:h-9" title={t('event_detail.archive')} data-testid="event-detail-archive">
            <Archive className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.archive')}</span>
          </Button>
          {hasVideo && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-8 sm:h-9"
              onClick={() => {
                if (hasVideo && currentProfile) {
                  downloadEventVideo(
                    resolvedPortalUrl,
                    event.Event.Id,
                    event.Event.Name,
                    accessToken || undefined,
                    currentProfile?.minStreamingPort,
                    event.Event.MonitorId,
                  );
                  // Background task drawer will show download progress
                }
              }}
              title={t('event_detail.download_video')}
              data-testid="download-video-button"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t('event_detail.download_video')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div
        key={id}
        className={cn(
          'flex-1 p-2 sm:p-3 md:p-4 flex flex-col items-center bg-muted/10 overflow-y-auto',
          incomingSlide === 'left' && 'event-slide-left',
          incomingSlide === 'right' && 'event-slide-right',
        )}
      >
        <div className="w-full max-w-5xl space-y-3 sm:space-y-4 md:space-y-6">
          {/* Video Player or ZMS Playback */}
          {hasVideo ? (
            useZmsFallback ? (
              // ZMS playback with controls
              currentProfile && (
                <ZmsEventPlayer
                  portalUrl={resolvedPortalUrl}
                  eventId={event.Event.Id}
                  token={isAccessTokenFresh ? accessToken ?? undefined : undefined}
                  apiUrl={currentProfile.apiUrl}
                  totalFrames={parseInt(event.Event.Frames)}
                  alarmFrames={parseInt(event.Event.AlarmFrames)}
                  alarmFrameId={event.Event.AlarmFrameId}
                  maxScoreFrameId={event.Event.MaxScoreFrameId}
                  eventLength={parseFloat(event.Event.Length)}
                  minStreamingPort={currentProfile.minStreamingPort}
                  monitorId={event.Event.MonitorId}
                  className="space-y-4"
                />
              )
            ) : (
              // MP4 video playback
              <Card
                ref={zoomPan.ref}
                className="overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black touch-none relative mx-auto landscape:max-w-[calc((100svh-7rem)*16/9)]"
              >
                <div className="aspect-video relative">
                  <div ref={zoomPan.innerRef}>
                    {videoUrl ? (
                      <Mp4EventPlayer
                        src={videoUrl}
                        type={videoMimeType}
                        className="w-full h-full"
                        poster={posterUrl}
                        autoplay={settings.eventVideoAutoplay}
                        markers={videoMarkers}
                        onMarkerClick={handleMarkerClick}
                        eventId={event.Event.Id}
                        onError={handleVideoError}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/70">
                        <Loader2 className="h-8 w-8 animate-spin" />
                      </div>
                    )}
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
                  className="bottom-12 left-2"
                />
              </Card>
            )
          ) : hasJPEGs ? (
            // ZMS playback for JPEG-only events
            currentProfile && (
              <ZmsEventPlayer
                portalUrl={resolvedPortalUrl}
                eventId={event.Event.Id}
                token={accessToken || undefined}
                apiUrl={currentProfile.apiUrl}
                totalFrames={parseInt(event.Event.Frames)}
                alarmFrames={parseInt(event.Event.AlarmFrames)}
                alarmFrameId={event.Event.AlarmFrameId}
                maxScoreFrameId={event.Event.MaxScoreFrameId}
                eventLength={parseFloat(event.Event.Length)}
                minStreamingPort={currentProfile.minStreamingPort}
                monitorId={event.Event.MonitorId}
                className="space-y-4"
              />
            )
          ) : (
            // No media available
            <Card className="overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black">
              <div className="aspect-video relative">
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('event_detail.no_media')}</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">{t('event_detail.timing')}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{t('event_detail.date')}</div>
                    <div className="text-sm text-muted-foreground">{fmtDate(startTime)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{t('event_detail.time')}</div>
                    <div className="text-sm text-muted-foreground">{fmtTime(startTime)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Timer className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{t('event_detail.duration')}</div>
                    <div className="text-sm text-muted-foreground">{event.Event.Length} {t('event_detail.seconds')}</div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">{t('event_detail.details')}</h3>
              <div className="space-y-3">
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">{t('event_detail.event_id')}</span>
                  <span className="text-sm font-medium">{event.Event.Id}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">{t('event_detail.frames')}</span>
                  <span className="text-sm font-medium">{event.Event.Frames} ({event.Event.AlarmFrames} {t('event_detail.alarm')})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">{t('event_detail.score')}</span>
                  <span className="text-sm font-medium">{event.Event.AvgScore} / {event.Event.MaxScore}</span>
                </div>
                {event.Event.Notes && event.Event.Notes.startsWith('detected:') && (() => {
                  const classList = event.Event.Notes.slice('detected:'.length).split('|')[0].trim();
                  if (!classList) return null;
                  const DetectIcon = getObjectClassIconFromList(classList);
                  return (
                    <div className="flex justify-between items-center py-1 border-b border-border/50" data-testid="event-detail-detected-row">
                      <span className="text-sm text-muted-foreground">{t('event_detail.detected')}</span>
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <DetectIcon className="h-3.5 w-3.5 shrink-0" />
                        {classList}
                      </span>
                    </div>
                  );
                })()}
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">{t('event_detail.resolution')}</span>
                  <span className="text-sm font-medium">{orientedResolution}</span>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">{t('event_detail.storage')}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <HardDrive className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{t('event_detail.disk_usage')}</div>
                    <div className="text-sm text-muted-foreground">{event.Event.DiskSpace || t('common.unknown')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Archive className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{t('event_detail.storage_id')}</div>
                    <div className="text-sm text-muted-foreground">{event.Event.StorageId || t('common.default')}</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Tags Section */}
          {eventTags.length > 0 && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                  {t('event_detail.tags')}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {eventTags.map((tag) => (
                  <TagChip key={tag.Id} tag={tag} size="md" />
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
