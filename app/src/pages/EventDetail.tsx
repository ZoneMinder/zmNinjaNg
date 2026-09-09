/**
 * Event Detail Page
 *
 * Displays detailed information about a specific event.
 * Includes video playback (or image fallback), metadata, and download options.
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { getEvent, getEventVideoUrl, getEventImageUrl, setEventArchived } from '../api/events';
import { usePermissions } from '../hooks/usePermissions';
import { canEditEvents } from '../lib/permissions/zm-permissions';
import { useDeniedControl } from '../hooks/useDeniedControl';
import { isPermissionDenied } from '../lib/permissions/permission-error';
import { isNotFound } from '../lib/http/types';
import { markPermissionDenied, useIsPermissionDenied } from '../stores/permissions';
import { getSession, tryGetCurrentSession } from '../services/sessions';
import type { ApiClient } from '../api/client';
import { eventHasAlarmFrame } from '../lib/event/thumbnail-chain';
import { resolveFallbackFids } from '../lib/event/thumbnail-chain';
import { resolveBackNavigation } from '../lib/back-navigation';
import { getMonitor } from '../api/monitors';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useProfileById } from '../hooks/useCurrentProfile';
import { useAutoFullscreen } from '../hooks/useAutoFullscreen';
import { FullscreenExitBar } from '../components/ui/fullscreen-exit-bar';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import type { ProfileId } from '../api/types';
import { useEventTagMapping } from '../hooks/useEventTags';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Mp4EventPlayer } from '../components/events/Mp4EventPlayer';
import { ZmsEventPlayer } from '../components/events/ZmsEventPlayer';
import { EventFrameCarousel } from '../components/events/EventFrameCarousel';
import { TagChip } from '../components/events/TagChip';
import { ArrowLeft, Calendar, Clock, HardDrive, AlertTriangle, Download, Archive, ArchiveRestore, Video, Star, Timer, Tag, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, ListVideo } from 'lucide-react';
import { getEventCauseIcon } from '../lib/event/event-icons';
import { getObjectClassIconFromList } from '../lib/event/object-class-icons';
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';
import { useTvMode } from '../hooks/useTvMode';
import { Platform } from '../lib/platform';
import { downloadEventVideo } from '../services/download';
import { getOrientedResolution } from '../lib/monitor/monitor-rotation';
import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settings';
import { useTranslation } from 'react-i18next';
import { log, LogLevel } from '../lib/logger';
import { generateEventMarkers, type VideoMarker } from '../lib/event/video-markers';
import { useEventFavoritesStore } from '../stores/eventFavorites';
import { useZoomPan } from '../hooks/useZoomPan';
import { useScrollPad } from '../hooks/useScrollPad';
import { ScrollPad } from '../components/ui/scroll-pad';
import { ZoomControls } from '../components/ui/zoom-controls';
import { ErrorBanner, DetailPageSkeleton } from '../components/ui/query-state';
import { useEventNavigation } from '../hooks/useEventNavigation';
import { useServerUrls } from '../hooks/useServerUrls';
import { cn } from '../lib/utils';
import { formatEventRelative } from '../lib/relative-time';
import { CONTINUOUS_PLAYBACK_TOAST_DURATION_MS } from '../lib/zmninja-ng-constants';

/**
 * Resolves the API client for this page's owning profile: the /all/ route's
 * profileId when present, else the current profile via tryGetCurrentSession
 * (never throws - this page can render while All mode has no single current
 * profile). Callers only invoke this once `enabled`/render guards confirm an
 * owning profile actually exists, so the null branch is defensive, not
 * expected in practice.
 */
function resolveClient(routeProfileId: ProfileId | undefined): ApiClient {
  const session = routeProfileId ? getSession(routeProfileId) : tryGetCurrentSession();
  if (!session) {
    throw new Error('EventDetail: no session available for the owning profile');
  }
  return session.client;
}

export default function EventDetail() {
  const params = useParams<{ id?: string; profileId?: string; eventId?: string }>();
  // Two route shapes render this page: single-mode `/events/:id` and the
  // All-mode deep route `/all/events/:profileId/:eventId` (refs #337). Only
  // one half of each pair is ever defined, depending on which matched.
  const id = params.id ?? params.eventId;
  const routeProfileId = params.profileId as ProfileId | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { fmtDate, fmtTime, fmtDateTime } = useDateTimeFormat();
  const { isTvMode } = useTvMode();

  // Check if user came from another page (navigation state tracking)
  const referrer = location.state?.from as string | undefined;
  const goBack = () => {
    // Pop history when possible so the events list restores its scroll position;
    // navigate(referrer) would push a new entry and lose it (refs #197).
    const action = resolveBackNavigation({ referrer, historyLength: window.history.length });
    if (action.type === 'pop') navigate(-1);
    else navigate(action.to);
  };
  const [useZmsFallback, setUseZmsFallback] = useState(isTvMode || Platform.isTVDevice);

  // Back to the baseline for every event: ZMS on TV devices (Fire Stick WebView
  // has video rendering issues), MP4 everywhere else. A fallback describes one
  // event's broken video, so continuous playback (#250) must not carry it to
  // the next event, whose video may well play (refs #340).
  useEffect(() => {
    setUseZmsFallback(isTvMode || Platform.isTVDevice);
  }, [id, isTvMode]);

  const queryClient = useQueryClient();
  // routeProfileId when present (All-mode deep route), else the current
  // profile - useProfileById already implements that fallback. ownerProfile
  // stays null (same as today's !ownerProfile) both when no profile is
  // selected at all AND when routeProfileId names an unknown profile, so the
  // existing error state below covers both cases without new branching
  // (refs #337).
  const { profile: ownerProfile, settings } = useProfileById(routeProfileId);
  // A primitive, so the archive callback depends on the id rather than on the
  // profile object identity.
  const ownerProfileId = ownerProfile?.id;
  const dataEnabled = !!id && !!ownerProfile;
  const { data: event, isLoading, error } = useQuery({
    queryKey: queryKeys.event(ownerProfile?.id, id),
    queryFn: () => getEvent(resolveClient(routeProfileId), id!),
    enabled: dataEnabled,
  });
  const { data: monitorData } = useQuery({
    queryKey: queryKeys.monitor(ownerProfile?.id, event?.Event.MonitorId),
    queryFn: () => getMonitor(resolveClient(routeProfileId), event!.Event.MonitorId),
    enabled: dataEnabled && !!event?.Event.MonitorId,
  });
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(routeProfileId);
  const effectiveMinStreamingPort = resolveMinStreamingPort(
    ownerProfile?.minStreamingPort,
    settings.forceDisableMultiPort,
  );

  // Resolve portal URL for the monitor's server (multi-server support)
  const { portalPath } = useServerUrls(monitorData?.Monitor?.ServerId, routeProfileId);
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : ownerProfile?.portalUrl || '';

  const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);

  // Subscribe to the derived boolean rather than to isFavorited itself: the getter's
  // identity never changes, so selecting it would compare equal on every store update
  // and the star would never flip.
  const isFav = useEventFavoritesStore((state) =>
    ownerProfile && event ? state.isFavorited(ownerProfile.id, event.Event.Id) : false
  );

  const {
    goToPrevEvent,
    goToNextEvent,
    isLoadingPrev,
    isLoadingNext,
  } = useEventNavigation({
    currentEventId: id,
    currentStartDateTime: event?.Event.StartDateTime,
    profileId: routeProfileId,
  });

  // Continuous playback (#250): when on, an event ending auto-advances to the
  // next event (honoring filters via goToNextEvent). Toggle and speed persist
  // per profile.
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const continuousPlay = settings.eventContinuousPlay;
  const toggleContinuousPlay = useCallback(() => {
    if (!ownerProfile) return;
    updateSettings(ownerProfile.id, { eventContinuousPlay: !continuousPlay });
  }, [ownerProfile, continuousPlay, updateSettings]);

  const handleRateChange = useCallback((rate: number) => {
    if (!ownerProfile) return;
    updateSettings(ownerProfile.id, { eventPlaybackRate: rate });
  }, [ownerProfile, updateSettings]);

  const handleMutedChange = useCallback((muted: boolean) => {
    if (!ownerProfile) return;
    updateSettings(ownerProfile.id, { eventPlaybackMuted: muted });
  }, [ownerProfile, updateSettings]);

  // Fullscreen on this page changes the session only. Entering used to turn
  // "Open events in fullscreen" on, which left every later event fullscreen
  // with Settings as the only way out (#476). The player's own fullscreen
  // button takes the page along (and back) through the same setter.
  const [isFullscreen, setFullscreen] = useAutoFullscreen({ startFullscreen: settings.eventPlaybackFullscreen });

  // Guards against a stray second 'ended' (video.js can emit it during teardown)
  // triggering a double advance. Re-armed for each event by the id-change effect.
  const advancingRef = useRef(false);
  useEffect(() => { advancingRef.current = false; }, [id]);
  const handleVideoEnded = useCallback(async () => {
    if (!continuousPlay || advancingRef.current) return;
    advancingRef.current = true;
    const advanced = await goToNextEvent({ continuousPlayback: true });
    if (!advanced) {
      advancingRef.current = false;
      toast.info(t('event_detail.no_more_videos'));
    }
  }, [continuousPlay, goToNextEvent, t]);

  const announcedContinuousEventRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!location.state?.continuousPlayback || !event || !monitorData?.Monitor) return;
    if (announcedContinuousEventRef.current === event.Event.Id) return;
    announcedContinuousEventRef.current = event.Event.Id;
    toast.info(
      <div>
        <div>{t('event_detail.continuous_playing', {
          monitor: monitorData.Monitor.Name,
          id: event.Event.MonitorId,
        })}</div>
        <div className="text-xs text-muted-foreground">
          {fmtDateTime(new Date(event.Event.StartDateTime.replace(' ', 'T')))}
        </div>
      </div>,
      { duration: CONTINUOUS_PLAYBACK_TOAST_DURATION_MS },
    );
  }, [event, fmtDateTime, location.state, monitorData, t]);

  // Fetch tags for this event
  const { getTagsForEvent } = useEventTagMapping({
    eventIds: id ? [id] : [],
    enabled: !!id,
    profileId: routeProfileId,
  });

  const eventTags = id ? getTagsForEvent(id) : [];

  const handleFavoriteToggle = useCallback(() => {
    if (ownerProfile && event) {
      toggleFavorite(ownerProfile.id, event.Event.Id);
      toast.success(
        isFav ? t('events.removed_from_favorites') : t('events.added_to_favorites')
      );
    }
  }, [ownerProfile, event, toggleFavorite, isFav, t]);

  const isArchived = event?.Event.Archived === '1';
  const [isArchiving, setIsArchiving] = useState(false);
  const handleArchiveToggle = useCallback(async () => {
    if (!event || isArchiving) return;
    const next = !isArchived;
    setIsArchiving(true);
    try {
      await setEventArchived(resolveClient(routeProfileId), event.Event.Id, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.event(ownerProfileId, event.Event.Id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events(ownerProfileId) }),
      ]);
      toast.success(next ? t('events.archived_success') : t('events.unarchived_success'));
    } catch (err) {
      log.eventDetail('Archive toggle failed', LogLevel.ERROR, { eventId: event.Event.Id, next, error: err });
      // The account may be too restricted to have been gated in advance, in
      // which case this refusal is the only explanation anyone gets (refs #344).
      if (isNotFound(err) && ownerProfileId) {
        // The event was deleted while this page was open, which a pruning
        // server does routinely. Refreshing lets the page say so through its
        // own error state instead of insisting the archive failed.
        void queryClient.invalidateQueries({ queryKey: queryKeys.events(ownerProfileId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.event(ownerProfileId, event.Event.Id) });
        toast.error(t('events.event_gone'));
      } else if (isPermissionDenied(err) && ownerProfileId) {
        markPermissionDenied(ownerProfileId, 'events-edit');
        toast.error(t('events.archive_permission_denied'));
      } else {
        toast.error(t('events.archive_failed'));
      }
    } finally {
      setIsArchiving(false);
    }
  }, [event, isArchived, isArchiving, routeProfileId, ownerProfileId, queryClient, t]);

  // Archiving needs Events: Edit. Greyed and still live, so hover, hold and tap
  // all say which permission is missing (refs #344).
  const { permissions } = usePermissions(ownerProfileId);
  const archiveRefused = useIsPermissionDenied(ownerProfileId, 'events-edit');
  const archiveProps = useDeniedControl({
    denied: canEditEvents(permissions) === 'denied' || archiveRefused,
    message: t('events.archive_permission_denied'),
    onClick: handleArchiveToggle,
    title: isArchived ? t('event_detail.unarchive') : t('event_detail.archive'),
    className: 'gap-2 h-8 sm:h-9',
  });

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
  // Page element for the tap-to-scroll affordance, shown when the player covers
  // the viewport and leaves no free surface to swipe (refs #365).
  // This page brings its own scroller rather than scrolling the app shell's
  // <main>, and the pad walks up from what it is given - so it takes that
  // container, not the page root, which has no scrolling ancestor (refs #365).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollPad, toggleScrollPad] = useScrollPad();

  // Pinch-to-zoom and pan for event video/image
  const zoomPan = useZoomPan({ maxScale: 4 });

  // Zoom belongs to the frame the user zoomed into, not to the page. Stepping
  // to another event keeps this component mounted (the route element is not
  // keyed on the id), so without this the next event arrived magnified and
  // panned to the previous one's framing (refs #382).
  const resetZoom = zoomPan.reset;
  useEffect(() => {
    resetZoom();
  }, [id, resetZoom]);

  // Frame carousel viewer (#272): the full-size image covers the player, so
  // playback pauses while it is open and resumes on close if it was running.
  // The player is held structurally so this page does not import video.js.
  const mp4PlayerRef = useRef<{
    paused: () => boolean;
    play: () => void | Promise<void>;
    pause: () => void;
  } | null>(null);
  const [frameViewerOpen, setFrameViewerOpen] = useState(false);
  const resumeAfterViewerRef = useRef(false);
  const handleFrameViewerOpenChange = useCallback((open: boolean) => {
    setFrameViewerOpen(open);
    const player = mp4PlayerRef.current;
    if (open) {
      resumeAfterViewerRef.current = !!player && !player.paused();
      player?.pause();
    } else if (resumeAfterViewerRef.current) {
      resumeAfterViewerRef.current = false;
      void player?.play();
    }
  }, []);

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

  // Hooks below must run on every render: keep them ABOVE the early returns.
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
    () => (ownerProfile && hasVideo && isAccessTokenFresh && eventIdForUrls
      ? getEventVideoUrl(resolvedPortalUrl, eventIdForUrls, accessToken || undefined, ownerProfile.apiUrl, isHlsEvent, effectiveMinStreamingPort, monitorIdForUrls)
      : ''),
    [ownerProfile, hasVideo, isAccessTokenFresh, resolvedPortalUrl, eventIdForUrls, accessToken, isHlsEvent, effectiveMinStreamingPort, monitorIdForUrls]
  );

  const posterUrl = useMemo(
    () => (ownerProfile && isAccessTokenFresh && eventIdForUrls
      ? getEventImageUrl(resolvedPortalUrl, eventIdForUrls, posterFid, {
        token: accessToken || undefined,
        apiUrl: ownerProfile.apiUrl,
        minStreamingPort: effectiveMinStreamingPort,
        monitorId: monitorIdForUrls,
      })
      : undefined),
    [ownerProfile, isAccessTokenFresh, resolvedPortalUrl, eventIdForUrls, posterFid, accessToken, effectiveMinStreamingPort, monitorIdForUrls]
  );

  // Per-monitor "always use ZMS" preference. Read from the event rather than
  // seeded into `useZmsFallback`: that state is created before the event query
  // resolves, so seeding it would show one MP4 frame before the monitor id is
  // known. Gating the branch here means the MP4 player is never mounted for a
  // forced monitor, so `handleVideoError` and its toast are unreachable.
  const forcedZmsMonitorId = monitorIdForUrls && settings.forceZmsMonitorIds.includes(monitorIdForUrls)
    ? monitorIdForUrls
    : null;
  const playThroughZms = useZmsFallback || forcedZmsMonitorId !== null;

  // The ZMS notice names an unexpected substitution: this event has a video,
  // but MP4 playback failed so we fell back to the stream. ZMS chosen
  // deliberately - TV mode, the per-monitor force setting, a JPEG-only event -
  // is not a surprise, and the badge covers the picture (#340).
  const fellBackFromVideo = useZmsFallback && !isTvMode && !Platform.isTVDevice;

  // Stable callback so Mp4EventPlayer's effect doesn't re-run on every parent render.
  const handleVideoError = useCallback(() => {
    log.eventDetail('Video playback failed, falling back to ZMS stream', LogLevel.INFO);
    toast.error(t('event_detail.video_playback_failed'));
    setUseZmsFallback(true);
  }, [t]);

  // Icon for the event's cause badge. Safe to compute before `event` exists
  // since getEventCauseIcon falls back gracefully on an empty cause.
  const EventCauseIcon = useMemo(
    () => getEventCauseIcon(event?.Event.Cause ?? ''),
    [event?.Event.Cause]
  );

  // "detected:<classList>|..." notes render an extra row with the detected
  // object class and icon; parse once and reuse for both the guard and the row.
  const detectedClassInfo = useMemo(() => {
    const notes = event?.Event.Notes;
    if (!notes || !notes.startsWith('detected:')) return null;
    const classList = notes.slice('detected:'.length).split('|')[0].trim();
    if (!classList) return null;
    return { classList, DetectIcon: getObjectClassIconFromList(classList) };
  }, [event?.Event.Notes]);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (error || !event) {
    return (
      <div className="p-8">
        <ErrorBanner icon={AlertTriangle} message={t('event_detail.load_error')} />
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

  if (forcedZmsMonitorId) {
    log.eventDetail(
      `Monitor ${forcedZmsMonitorId} is set to always use ZMS for events, so MP4 playback was not attempted`,
      LogLevel.INFO,
      { monitorId: forcedZmsMonitorId, eventId: event.Event.Id },
    );
  }

  const startTime = new Date(event.Event.StartDateTime.replace(' ', 'T'));
  const incomingSlide = location.state?.slideDirection as 'left' | 'right' | undefined;

  // The page itself goes fullscreen the way Monitor Detail does: header gone,
  // exit bar on top, player taking the height (refs #462). Not video.js's own
  // fullscreen: on iPhone that is a position:fixed full-window player, and a
  // transformed pinch-zoom container becomes its containing block, so pinch
  // behaved differently depending on which state it started from. The
  // player's own fullscreen button still does native fullscreen when tapped.
  const pageFullscreen = isFullscreen;

  return (
    <div className={cn('flex flex-col h-full', pageFullscreen ? 'fixed inset-0 z-50 bg-black' : 'bg-background')}>
      {pageFullscreen && (
        <FullscreenExitBar
          title={monitorData?.Monitor.Name ?? event.Event.Name}
          onExit={() => setFullscreen(false)}
          testIdPrefix="event-detail"
        />
      )}
      {/* Header */}
      {!pageFullscreen && (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 md:top-[var(--sai-top,env(safe-area-inset-top))] z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            title={t('common.go_back')}
            aria-label={t('common.go_back')}
            className="h-8 w-8"
            data-testid="event-detail-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevEvent}
            disabled={isLoadingPrev}
            title={t('common.previous')}
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
              <Badge variant="outline" className="text-[10px] h-4 gap-1">
                <EventCauseIcon className="h-3 w-3" />
                {event.Event.Cause}
              </Badge>
              {monitorData && (
                <span className="hidden sm:inline">{monitorData.Monitor.Name}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { void goToNextEvent(); }}
            disabled={isLoadingNext}
            title={t('common.next')}
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
            variant={showScrollPad ? 'default' : 'outline'}
            size="icon"
            title={t('common.scroll_buttons')}
            aria-label={t('common.scroll_buttons')}
            aria-pressed={showScrollPad}
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={toggleScrollPad}
            data-testid="scroll-pad-toggle"
          >
            <ChevronsUpDown className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <Button
            variant={isFav ? "default" : "outline"}
            aria-pressed={isFav}
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={handleFavoriteToggle}
            title={isFav ? t('events.unfavorite') : t('events.favorite')}
            aria-label={isFav ? t('events.unfavorite') : t('events.favorite')}
            data-testid="event-detail-favorite-button"
          >
            <Star className={isFav ? "h-4 w-4 fill-current" : "h-4 w-4"} />
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-8 sm:h-9" onClick={() => navigate(routeProfileId ? `/all/monitors/${routeProfileId}/${event.Event.MonitorId}` : `/monitors/${event.Event.MonitorId}`)} title={t('event_detail.view_camera')} data-testid="event-detail-view-camera">
            <Video className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.view_camera')}</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-8 sm:h-9" onClick={() => navigate(routeProfileId ? `/events?monitorId=${event.Event.MonitorId}&profileId=${routeProfileId}` : `/events?monitorId=${event.Event.MonitorId}`)} title={t('event_detail.all_events')} data-testid="event-detail-all-events">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.all_events')}</span>
          </Button>
          <Button
            variant={continuousPlay ? "default" : "outline"}
            size="sm"
            className="gap-2 h-8 sm:h-9"
            onClick={toggleContinuousPlay}
            title={t('event_detail.continuous_play')}
            aria-pressed={continuousPlay}
            data-testid="event-detail-continuous-play"
          >
            <ListVideo className="h-4 w-4" />
            <span className="hidden sm:inline">{t('event_detail.continuous_play')}</span>
          </Button>
          <Button
            variant="outline"
            aria-pressed={isArchived}
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9"
            {...archiveProps}
            disabled={isArchiving}
            aria-label={isArchived ? t('event_detail.unarchive') : t('event_detail.archive')}
            data-testid="event-detail-archive"
          >
            {/* Same idiom as the event card: the icon says archived, the button
                does not fill. A filled control here read as a white slab in the
                dark themes, where primary is near-white. */}
            {isArchived ? (
              <ArchiveRestore className="h-4 w-4 stroke-primary" data-testid="event-detail-archive-icon-on" />
            ) : (
              <Archive className="h-4 w-4" data-testid="event-detail-archive-icon-off" />
            )}
          </Button>
          {hasVideo && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => {
                if (hasVideo && ownerProfile) {
                  downloadEventVideo(
                    resolvedPortalUrl,
                    event.Event.Id,
                    event.Event.Name,
                    accessToken || undefined,
                    effectiveMinStreamingPort,
                    event.Event.MonitorId,
                  );
                  // Background task drawer will show download progress
                }
              }}
              title={t('event_detail.download_video')}
              aria-label={t('event_detail.download_video')}
              data-testid="download-video-button"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      )}

      {/* Main Content */}
      <div
        key={id}
        ref={scrollerRef}
        data-testid="event-detail-scroller"
        className={cn(
          'flex-1 flex flex-col items-center',
          pageFullscreen
            ? 'min-h-0 overflow-hidden pt-[calc(var(--fullscreen-toolbar-h)+var(--sai-top,env(safe-area-inset-top)))] pb-[var(--sai-bottom,env(safe-area-inset-bottom))] pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
            : 'overflow-y-auto p-2 sm:p-3 md:p-4 bg-muted/10',
          incomingSlide === 'left' && 'event-slide-left',
          incomingSlide === 'right' && 'event-slide-right',
        )}
      >
        <div className={cn('w-full', pageFullscreen ? 'h-full min-h-0' : 'max-w-5xl space-y-3 sm:space-y-4 md:space-y-6')}>
          {/* Video Player or ZMS Playback */}
          {hasVideo ? (
            playThroughZms ? (
              // ZMS playback with controls
              ownerProfile && (
                <ZmsEventPlayer
                  portalUrl={resolvedPortalUrl}
                  eventId={event.Event.Id}
                  profileId={ownerProfileId}
                  token={isAccessTokenFresh ? accessToken ?? undefined : undefined}
                  suspended={frameViewerOpen}
                  apiUrl={ownerProfile.apiUrl}
                  totalFrames={parseInt(event.Event.Frames)}
                  alarmFrames={parseInt(event.Event.AlarmFrames)}
                  alarmFrameId={event.Event.AlarmFrameId}
                  maxScoreFrameId={event.Event.MaxScoreFrameId}
                  eventLength={parseFloat(event.Event.Length)}
                  minStreamingPort={effectiveMinStreamingPort}
                  monitorId={event.Event.MonitorId}
                  onEnded={handleVideoEnded}
                  showNotice={fellBackFromVideo}
                  playbackRate={settings.eventPlaybackRate}
                  onRateChange={handleRateChange}
                  className="space-y-4"
                  fullscreen={pageFullscreen}
                />
              )
            ) : (
              // MP4 video playback
              <Card
                ref={zoomPan.ref}
                className={cn(
                  'overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black touch-none relative mx-auto',
                  pageFullscreen
                    ? 'w-full h-full rounded-none shadow-none ring-0'
                    : 'landscape:max-w-[calc((100svh-7rem)*16/9)]',
                )}
              >
                <div className={cn('relative', pageFullscreen ? 'h-full' : 'aspect-video')}>
                  <div ref={zoomPan.innerRef} className={cn(pageFullscreen && 'h-full')}>
                    {videoUrl ? (
                      <Mp4EventPlayer
                        src={videoUrl}
                        type={videoMimeType}
                        className="w-full h-full"
                        poster={posterUrl}
                        autoplay={settings.eventVideoAutoplay || continuousPlay}
                        markers={videoMarkers}
                        onMarkerClick={handleMarkerClick}
                        eventId={event.Event.Id}
                        onReady={(player) => { mp4PlayerRef.current = player; }}
                        onError={handleVideoError}
                        onEnded={handleVideoEnded}
                        playbackRate={settings.eventPlaybackRate}
                        onRateChange={handleRateChange}
                        muted={settings.eventPlaybackMuted}
                        onMutedChange={handleMutedChange}
                        fill={pageFullscreen}
                        onFullscreenChange={setFullscreen}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/70">
                        <Loader2 className="h-8 w-8 animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
                <ZoomControls zoomPan={zoomPan} className="bottom-12 left-2" />
              </Card>
            )
          ) : hasJPEGs ? (
            // ZMS playback for JPEG-only events
            ownerProfile && (
              <ZmsEventPlayer
                portalUrl={resolvedPortalUrl}
                eventId={event.Event.Id}
                profileId={ownerProfileId}
                token={accessToken || undefined}
                suspended={frameViewerOpen}
                apiUrl={ownerProfile.apiUrl}
                totalFrames={parseInt(event.Event.Frames)}
                alarmFrames={parseInt(event.Event.AlarmFrames)}
                alarmFrameId={event.Event.AlarmFrameId}
                maxScoreFrameId={event.Event.MaxScoreFrameId}
                eventLength={parseFloat(event.Event.Length)}
                minStreamingPort={effectiveMinStreamingPort}
                monitorId={event.Event.MonitorId}
                onEnded={handleVideoEnded}
                playbackRate={settings.eventPlaybackRate}
                onRateChange={handleRateChange}
                className="space-y-4"
                fullscreen={pageFullscreen}
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

          {/* Fullscreen is the player alone: the frames strip and the
              metadata cards would put content below the fold behind the
              overflow-hidden scroller (refs #462). */}
          {!pageFullscreen && (<>
          {/* Significant frames for this event (#272). Sits between the player
              and the metadata so the frames read as a detail of what is on
              screen above, rather than pushing the player itself below the
              fold. Gated on a fresh token so the thumbnails are not all
              dropped as failures during a refresh. */}
          {ownerProfile && isAccessTokenFresh && (
            <EventFrameCarousel
              portalUrl={resolvedPortalUrl}
              eventId={event.Event.Id}
              token={accessToken || undefined}
              apiUrl={ownerProfile.apiUrl}
              minStreamingPort={effectiveMinStreamingPort}
              monitorId={event.Event.MonitorId}
              hasAlarmFrame={eventHasAlarmFrame(event.Event)}
              onViewerOpenChange={handleFrameViewerOpenChange}
            />
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
                    <div className="text-xs text-muted-foreground/70" data-testid="event-detail-relative-time">
                      {formatEventRelative(startTime, i18n.language, t)}
                    </div>
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
                {detectedClassInfo && (
                  <div className="flex justify-between items-center py-1 border-b border-border/50" data-testid="event-detail-detected-row">
                    <span className="text-sm text-muted-foreground">{t('event_detail.detected')}</span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <detectedClassInfo.DetectIcon className="h-3.5 w-3.5 shrink-0" />
                      {detectedClassInfo.classList}
                    </span>
                  </div>
                )}
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
          </>)}
        </div>
      </div>

      {showScrollPad && <ScrollPad targetRef={scrollerRef} />}
    </div>
  );
}
