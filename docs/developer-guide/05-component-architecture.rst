Component Architecture
======================

This chapter follows the app's components through the features they build:
watching a live camera, playing back a recording, deleting a batch of events,
laying out a dashboard, hiding a monitor. Each section starts from something
the user does and works inward to the code.

Reference material for the shared building blocks (``components/ui/``,
``components/common/``, ``lib/``, ``services/``) lives in
:doc:`12-shared-services-and-components`. Generic React mechanisms are taught
once in :doc:`02-react-fundamentals` and linked from here at the point where
this app first depends on them. The surfaces that wrap the whole app rather
than a page (kiosk lock, TV mode, notifications, the assistant panel) are in
:doc:`16-platform-surfaces`.

How ``components/`` is organized
--------------------------------

``src/components/`` splits three ways. Feature folders (``monitors/``,
``montage/``, ``events/``, ``dashboard/``, ``kiosk/``, ``timeline/``,
``settings/``, ``notifications/``, ``filters/``, ``layout/``,
``monitor-detail/``, ``assistant/``) hold components that only make sense
inside that feature.
``ui/`` holds unstyled primitives, mostly shadcn/ui wrappers over Radix, that
know nothing about ZoneMinder. ``common/`` holds three app-aware but
feature-agnostic components (``RefreshButton``, ``PageContainer``,
``GridColumnsMenu``).

A handful of components sit at the top level because they are mounted once by
the app shell rather than by a feature: ``NotificationHandler``,
``BackgroundTaskDrawer``, ``CommandPalette``, ``ErrorBoundary``,
``RouteErrorBoundary``, ``QRScanner``, ``CertTrustDialog``, and the theme and
profile switchers.

Hooks do not all live in ``src/hooks/``. Domain-scoped hooks sit next to the
code that uses them: ``pages/hooks/`` (``usePTZControl``, ``useAlarmControl``)
and ``components/montage/hooks/`` (``useMontageGrid``, ``useContainerResize``,
``useFullscreenMode``). ``components/montage/index.ts`` re-exports those three
hooks along with ``GridLayoutControls``, ``FullscreenControls``,
``MontageKebabMenu``, and ``MontageTileErrorBoundary``. It does not export
``getMaxColsForWidth``; that helper lives in ``lib/event/event-utils.ts``.

For the ``app/src/`` tree as a whole, see the File organization table in
:doc:`index`.

Watching a live camera
----------------------

MonitorCard
~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorCard.tsx``

Open the Monitors page and each camera appears as a card: a live picture, a
colored status dot, resolution and FPS, and buttons for that monitor's events,
its settings, and a snapshot download. ``MonitorCard`` renders two layouts from
one component. With ``compact`` set it is a grid tile with the picture on top;
without it, a wide row with the picture on the left at 40% width.

``MonitorCard`` does not stream anything itself. It hands the monitor to
``LiveMonitorPlayer`` and lets that component pick a protocol:

.. code:: tsx

   const videoPlayer = (
     <LiveMonitorPlayer
       monitor={monitor}
       profile={currentProfile}
       className="w-full h-full"
       objectFit={resolvedFit}
       externalMediaRef={mediaRef}
       muted={isMuted}
       onProtocolChange={setProtocol}
     />
   );
   const wrappedVideo = showHover ? (
     <MonitorHoverPreview monitor={monitor}>{videoPlayer}</MonitorHoverPreview>
   ) : videoPlayer;

Information travels back out of the player as well. ``onProtocolChange``
reports the protocol that actually connected, which the card shows as a small
label in the corner when ``settings.showProtocolLabel`` is on.
``externalMediaRef`` is a ref
that the player attaches to whichever element it ended up rendering, an
``<img>`` for MJPEG or a ``<video>`` for go2rtc. A *ref* is React's escape hatch
to a real DOM node: a mutable box whose ``.current`` React fills in after it
commits the element to the page (:doc:`02-react-fundamentals`). The card needs
it because downloading a snapshot means reading pixels off the live element:

.. code:: tsx

   const handleDownloadSnapshot = async (e: React.MouseEvent) => {
     e.stopPropagation();
     if (mediaRef.current) {
       try {
         await downloadSnapshotFromElement(mediaRef.current, monitor.Name);
         toast.success(t('monitors.snapshot_downloaded'));
       } catch (error) {
         log.monitorCard('Failed to download snapshot', LogLevel.ERROR, error);
         toast.error(t('monitors.snapshot_failed'));
       }
     }
   };

The ``e.stopPropagation()`` is load-bearing. The picture and its wrapper are a
click target that navigates to ``/monitors/<id>``, and the download button sits
inside it. Without stopping the event, downloading a snapshot would also open
the monitor.

The Events button carries a ``monitor-new-events-badge`` counting events the
monitor recorded since the user last opened it. The count arrives as the
``newEventCount`` prop from ``useMonitorNewEvents`` on the Monitors page, and the
badge renders only when ``newEventCount !== undefined && newEventCount > 0``,
formatted by ``formatEventCount``. The ``undefined`` guard is not the same as a
count of 0: ``undefined`` is "the count query has not resolved yet", 0 is
"nothing new", and only the second should keep the badge off. Tapping the button
runs ``openEvents``, a thin wrapper over the shared ``useOpenMonitorEvents`` hook:
it stamps the watermark with ``markSeen`` from the cached newest timestamp, then
navigates to the events list filtered to the events the badge counted (a
``startDateTime`` one second past the old watermark). ``MontageMonitor`` renders
the same badge (``montage-new-events-badge``) and calls the same hook with
``from: '/montage'``, so both surfaces share one click behavior.
:doc:`call-flows` Flow 18 traces the count from the API to this render.

``useOpenMonitorEvents`` (``hooks/useOpenMonitorEvents.ts``) is the extracted
click handler both surfaces share. It takes ``{ monitorId, newEventCount,
newestEventAt, from }`` and returns nothing: it reads the old watermark before
``markSeen`` overwrites it, so the date filter it writes matches what the badge
counted rather than what "seen" becomes after the click. It drops the date param
entirely for a quiet monitor (``newEventCount`` is 0 or undefined) or a
never-seeded one (the watermark is ``null``, so the whole history is the new set).

``MonitorInfoPopover`` (``components/monitors/MonitorInfoPopover.tsx``) is the
info button beside the monitor name on both card layouts and in the
``MonitorDetail`` header. It replaced three icon-only badges whose meaning
lived in a hover ``title`` (invisible on touch) and gave ``Decoding`` its
first appearance in the UI: the popover lists the four capture-pipeline
fields ZM 1.38+ splits Function into, Decoding among them
(``monitor.Capturing !== undefined`` is the tell, the same one the card
used), or Function before that, then resolution and the frame-rate cap,
each with a label and nothing singled out. ``MonitorInfoContent`` is the
body alone; ``MontageMonitor`` renders it in a ``Popover`` anchored
(``PopoverAnchor``) to the tile's "..." button and opened from a menu item,
so the popover appears where the menu just closed. Radix's trigger toggles
on click, which serves touch and keyboard; a mouse gets hover in addition:
``pointerenter`` opens, ``pointerleave`` from trigger or content closes after
``HOVER_CLOSE_DELAY_MS``, and the click that follows a hover-open is
``preventDefault``-ed so Radix does not toggle it shut again (its handlers
are composed to skip on ``defaultPrevented``). Every handler stops
propagation, because the card around it navigates on click (refs #467).

``useMonitorMuted`` (``hooks/useMonitorMuted.ts``) is the other hook both tiles
share. A Go2RTC tile starts muted so a grid does not open as a cacophony, but
the choice used to live in component state and reset on every remount: a group
switch, a route change, or a relaunch put every unmuted monitor back to muted.
The hook is a thin inversion over ``useMonitorFlag``
(``hooks/useMonitorFlag.ts``), which turns membership in one of the profile's
monitor-id lists (``unmutedMonitorIds``, ``fullscreenMonitorIds``) into a
``[value, setValue]`` pair: read through ``getProfileSettings``, written back
with ``updateProfileSettings``, so the state survives remounts and syncs with
the rest of the profile. The key is the monitor id within one profile, which
is why the same id on a second server does not collide. Without a profile id
the value is false and the setter is a no-op. ``FullscreenExitBar`` (``components/ui/fullscreen-exit-bar.tsx``) is the strip
along the top of an app-level fullscreen page: subject name and the Exit
button, shared by ``MonitorDetail`` and ``EventDetail``. The event page goes
fullscreen the way Monitor Detail does for both players: ``ZmsEventPlayer``
takes a ``fullscreen`` prop that swaps its 16:9 box for the height the page
gives it, transport controls kept below, and ``Mp4EventPlayer`` takes
``fill`` (refs #462). ``MonitorDetail`` uses the same
mute hook, but its mute control is the browser's own (``showControls``), so
``useGo2RTCStream`` listens for ``volumechange`` on the video element and
reports through ``onMutedChange``. A change that lands on the value the hook
itself just wrote from the ``muted`` option is skipped, so only the user's
clicks reach the setting.

``useAutoFullscreen`` (``hooks/useAutoFullscreen.ts``) drives fullscreen on
the two player pages, ``MonitorDetail`` (seeded by the monitor's
``fullscreenMonitorIds`` entry, the "Open in fullscreen" switch in
``MonitorAppPreferences``) and ``EventDetail`` (seeded by
``eventPlaybackFullscreen``, "Open events in fullscreen" in
``PlaybackSection``). It returns ``[isFullscreen, setFullscreen]`` where
``isFullscreen`` is the setting OR a temporary landscape term, so a rotated
phone fills the screen and a desktop window, landscape all day, does not
(``(pointer: coarse)`` is the touch test; the orientation comes from
``screen.orientation`` where it exists, because iOS evaluates the
``(orientation: landscape)`` media query against the zoomed visual viewport
and a pinch briefly read as portrait, bouncing the page out of fullscreen
and back; the media query is only the fallback), OR
a session override from ``setFullscreen``, the page's own maximize/exit
button. The hook itself writes no setting; the pages do, and only on enter:
maximizing writes the monitor into ``fullscreenMonitorIds``, entering
fullscreen on the event player sets ``eventPlaybackFullscreen``. Exit is
session-only because exit is the only way off a fullscreen page, so a
remembered exit would end every visit by forgetting; the settings switches
are the off switches. ``monitorDetailFullscreen`` (Settings > Live Streaming)
is the every-monitor form and ORs in beside the per-monitor entry. The
override lasts until the next rotation or until ``resetKey`` (the monitor id)
changes, since the detail page stays mounted across monitors (refs #462,
#463).

``useZoomPan`` writes no ``transform`` or ``will-change`` at identity. Either
one makes the element the containing block for every ``position: fixed``
descendant, and video.js full-window mode (the fallback when the real
Fullscreen API refuses a request made without a gesture, so every rotation
and every "open in fullscreen") positions the player ``fixed``: with the
transform in place it filled the card, not the viewport (refs #462).

The whole component is wrapped in ``memo``:

.. code:: tsx

   export const MonitorCard = memo(MonitorCardComponent);

``memo`` tells React to skip re-rendering a component when its props are equal
to last time's. Skipping matters here because the Monitors page re-renders on
every status poll, and a re-render of ``MonitorCard`` would re-render
``LiveMonitorPlayer``, which would tear the stream down and build it back up.

MontageMonitor
~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MontageMonitor.tsx``

The montage grid shows many cameras at once, so its tile is stripped down: a
32px-tall header (``h-8``) with the status dot, the name, an events button, a
mute button for go2rtc monitors, and an overflow menu holding snapshot and
timeline. In fullscreen the header slides up out of view and returns on hover.
In edit mode the tile draws a 2px border overlay, yellow normally and blue when
the tile is pinned. That border is a separate absolutely-positioned ``div``
rather than a CSS ring on the card, because the compact grid styles override
ring utilities.

``MontageMonitor`` is also ``memo``-wrapped, and the source says why in the
same terms as above: grid layout changes re-render the parent, and the streams
must not be torn down and re-established because of it.

The tile pulses when its monitor alarms. It reads the notification store, but
only the slice it needs:

.. code:: tsx

   const monitorEvents = useNotificationStore(
     useShallow((state) => {
       const events = profileId ? state.profileEvents[profileId] : undefined;
       if (!events?.length) return NO_MONITOR_EVENTS;
       return events.filter((e) => String(e.MonitorId) === monitorId);
     })
   );

A Zustand selector runs on every store change and re-renders the component only
when what it returns differs from last time. ``filter`` builds a new array each
call, so a plain equality check would see a new reference every time any
monitor anywhere alarmed. ``useShallow`` compares the array element by element
instead, and ``NO_MONITOR_EVENTS`` is a module-level constant so the empty case
returns the same reference forever. Without both, an event on camera 4 would
re-render all twenty-five tiles. See :doc:`03-state-management-zustand`.

When a newly arrived event is younger than ``MONITOR_UI.alarmPulseMs``
(6000 ms), the tile sets ``isAlarming``, which adds the ``montage-alarm-pulse``
class to the header, and clears it on a timer.

MontageTileErrorBoundary
~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/montage/MontageTileErrorBoundary.tsx``

If one tile throws while rendering, the montage grid should lose that tile and
nothing else. ``Montage.tsx`` wraps every ``MontageMonitor`` in this boundary,
which swaps the crashed tile for an alert icon, the monitor's name, and the
``montage.tile_error`` string, and logs through ``log.montageMonitor`` at
``LogLevel.ERROR``. Without it, the error would keep bubbling to the route
boundary and unmount the entire page.

This is written as a class:

.. code:: tsx

   export class MontageTileErrorBoundary extends Component<Props, State> {
     public state: State = { hasError: false };

     public static getDerivedStateFromError(): State {
       return { hasError: true };
     }

     public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
       log.montageMonitor('Tile render error', LogLevel.ERROR, {
         monitorId: this.props.monitorId,
         monitorName: this.props.monitorName,
         error,
         componentStack: errorInfo.componentStack,
       });
     }

     public render(): ReactNode {
       if (this.state.hasError) {
         return <TileErrorFallback monitorName={this.props.monitorName} />;
       }
       return this.props.children;
     }
   }

Catching a render error is the one thing React never gave hooks. A hook runs
*inside* the render that throws, so it cannot observe its own failure;
``getDerivedStateFromError`` and ``componentDidCatch`` are lifecycle methods
that only exist on classes. Every class component in this codebase is an error
boundary for that reason, and there are exactly three: ``ErrorBoundary``
(app-wide), ``RouteErrorBoundary`` (per route), and this one (per tile). The
fallback carries ``data-testid="montage-tile-error"``.

MonitorHoverPreview
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorHoverPreview.tsx``

Mouse over a camera tile on the desktop Monitors page and a larger live preview
of that camera grows out of it. Hold a finger on the same tile on a phone and
the same preview appears. It is enabled per view through
``settings.hoverPreview.monitorsGrid`` and ``settings.hoverPreview.monitorsList``,
and it also wraps the dashboard's ``MonitorWidget``.

``MonitorHoverPreview`` is a thin adapter over the ``HoverPreview`` primitive
in ``components/ui/hover-preview.tsx`` (documented in
:doc:`12-shared-services-and-components`). It computes the monitor's aspect
ratio, honoring rotation, and passes a render prop:

.. code:: tsx

   <HoverPreview
     aspectRatio={aspectRatio}
     testId="monitor-hover-preview"
     renderPreview={() => <MonitorLivePreview monitor={monitor} />}
   >
     {children}
   </HoverPreview>

``HoverPreview`` draws the enlarged frame through a **portal**. A portal renders
a component's DOM output into a different place in the document while leaving
it where it is in the React tree, so it still receives props and
context from its parent. That matters because the preview is drawn from inside
a grid cell that has ``overflow: hidden`` and its own stacking context. Rendered
in place it would be clipped to the tile it is trying to escape; rendered
through a portal into ``document.body`` it floats over the page.

In that snippet, ``renderPreview`` is a function, not an element. ``HoverPreview`` calls it only while the preview is open, so
``MonitorLivePreview`` mounts on hover and unmounts on leave. That is what makes
the extra stream safe:

.. code:: tsx

   const { connKey } = useStreamLifecycle({
     monitorId: monitor.Id,
     monitorName: monitor.Name,
     portalUrl: currentProfile?.portalUrl,
     accessToken,
     viewMode: 'streaming',
     mediaRef: imgRef,
     logFn: log.monitor,
     enabled: true,
     minStreamingPort: effectiveMinStreamingPort,
     apiTimeoutSeconds: settings.apiTimeoutSeconds,
   });

Mounting mints a fresh ZMS connkey; unmounting fires ``useStreamLifecycle``'s
cleanup, which sends ``CMD_QUIT`` for it. The preview's ``nph-zms`` process dies
on the ZoneMinder server when the mouse leaves, instead of surviving as a
zombie.

Only two call sites use ``useStreamLifecycle`` directly: this component and
``hooks/useMonitorStream.ts``. Every other live view reaches it through
``useMonitorStream``, which ``LiveMonitorPlayer`` calls on the MJPEG path.
``useStreamLifecycle`` also registers each live stream with
``lib/monitor/active-streams.ts``, so a profile switch (``stores/profile.ts``)
can await ``quitAllActiveStreams()`` and quit every stream on the old server
while that server's token and TLS trust are still in effect.

How this goes wrong: zombie streams
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A connkey identifies one ``nph-zms`` process on the ZoneMinder server. The
number is generated in an effect, and effects run *after* React has painted the
first render. So on that first render ``connKey`` is still its initial ``0``. If
the ``<img src>`` is built unconditionally, the browser starts a stream with
``connkey=0``, then the effect sets a real key, the ``src`` changes, and the
browser starts a second stream. Only the second one has a key anyone can quit.
Viewing N monitors leaves N orphaned processes running until ZoneMinder's own
idle timeout reaps them.

The fix is a guard on the URL, not on the render. ``useMonitorStream`` never
produces a stream URL without a real key:

.. code:: tsx

   const streamUrl = currentProfile && connKey !== 0 && isAccessTokenFresh
     ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, { /* ... */ })
     : '';

The other half is teardown. Cleanup functions are created during render and
capture that render's values, so an unmount-only cleanup (``useEffect(..., [])``)
would close over the first render's ``connKey``, which is ``0``, and quit
nothing. ``useStreamLifecycle`` sidesteps this by writing the current values into
a ref on every change and reading the ref at unmount:

.. code:: tsx

   // Update cleanup params whenever they change
   useEffect(() => {
     if (!enabled) return;
     cleanupParamsRef.current = { monitorId, monitorName, connKey, portalUrl, /* ... */ };
   }, [enabled, monitorId, monitorName, connKey, portalUrl, /* ... */]);

   // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
   useEffect(() => {
     return () => {
       if (mediaElRef.current?.isConnected) return;
       const params = cleanupParamsRef.current;
       void quitStreamForParams(params, logFn, 'unmount');
       if (mediaElRef.current) {
         mediaElRef.current.removeAttribute('src');
       }
     };
   }, []); // Empty deps = only run on unmount

A ref is the same box on every render, so reading ``.current`` in the cleanup
sees the latest connkey rather than the one captured when the cleanup was
created. ``removeAttribute('src')`` rather than ``src = ''`` because an empty
``src`` resolves to the page URL on some engines and fires a spurious request.

The ``isConnected`` guard is there because the comment on the dependency array
is a wish, not a guarantee. React runs the cleanup of an ``[]`` effect against a
live, still-committed tree in three situations: the StrictMode mount
double-invoke, revealing a Suspense subtree that was hidden while something else
in the boundary loaded, and a Fast Refresh update in dev. None of them is an
unmount, and none is followed by a re-render, so a teardown there quits a stream
the user is still watching and strips a ``src`` React will never put back: its
virtual DOM still holds the same URL, so the next diff writes nothing and the
tile shows the browser's broken-image glyph forever. React detaches a real
unmount's DOM during the mutation phase, well before this passive cleanup runs,
so an element still connected to the document means the component is staying.
Any imperative DOM teardown in a cleanup needs this check; do not treat empty
deps as proof of an unmount.

:doc:`call-flows` walks this same code in "Montage opens and a live MJPEG stream
runs".

Analysis frames on a running stream
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``hooks/useAnalysisFrames.ts`` puts ZoneMinder's analysis image (the motion
overlay) on a live view. ZoneMinder has two ways to turn the overlay
on. ``analysis=1`` on the ``nph-zms`` URL is read once when the
process starts, so changing it means tearing the stream down and building a new
one. ``CMD_ANALYZE_ON`` and ``CMD_ANALYZE_OFF`` (19 and 20 in ``ZMS_COMMANDS``)
go to the running process over its command socket, and the frames swap in place
with no gap. A toggle wants the second.

The cost of the second is that the state lives in the ``nph-zms`` process rather
than in ZoneMinder, and this app replaces that process often: the reconnect
backoff in ``useMonitorStream``, a manual retry, and a visibility resume each
mint a new connkey, and every new process starts on normal frames. So the
setting, which is profile-scoped and remembered
(``showAnalysisFrames``), is applied from two places:

.. code:: tsx

   // The flip itself, against the connection the user is watching
   const prevShowRef = useRef(showAnalysis);
   useEffect(() => {
     if (prevShowRef.current === showAnalysis) return;
     prevShowRef.current = showAnalysis;
     apply();
   }, [showAnalysis]);

   // And again for each new connection, from useMonitorStream's load handler
   const reportStreamLoad = () => {
     analysisFrames.applyOnStreamLoad();
     /* ... backoff reset ... */
   };

The re-apply hangs off the load handler rather than off ``connKey`` changing
because ``zms-<connkey>w.sock`` does not exist until the process is up; the
first decoded frame is the earliest proof that it is. ``apply`` keeps a ref of
what it last sent and for which connkey, which is what stops a multipart
``<img>`` firing ``load`` per frame from turning into one request per frame per
tile, and what lets a fresh connection with the setting off cost no request at
all.

The hook sends nothing in two cases, on purpose. Snapshot mode sends nothing, because
``MonitorStream::SingleImage`` in ZoneMinder reads the capture buffer directly
and never looks at the frame type, so no parameter or command can put an overlay
on a single image; ``AnalysisFramesToggle`` disables the button there instead of
leaving a control with no effect. A go2rtc stream has no command socket, so the
hook only runs on the MJPEG path that ``useMonitorStream`` owns.

Video playback
--------------

Each delivery protocol gets its own player component. Live
monitor streams negotiate go2rtc (WebRTC / MSE / HLS) and fall back to MJPEG.
Recorded events come in two shapes: either ZoneMinder produced an MP4
(``Videoed === '1'``), in which case Video.js handles it as MP4 or HLS, or only
JPEG frames are stored and the only way to play them back is the ZMS streaming
endpoint. EventDetail also exposes a user toggle (TV mode defaults to on) that
forces the ZMS path even when an MP4 is available.

The player files sit next to their consumers. Live playback lives under
``components/monitors/``; event playback lives under ``components/events/``. The
file name carries the protocol so the selection at each call site is
self-evident from the import.

LiveMonitorPlayer
~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/LiveMonitorPlayer.tsx``

Live monitor player. Picks between go2rtc and MJPEG based on monitor
capabilities and user preference. Consumed by ``MonitorCard``,
``MontageMonitor``, the dashboard ``MonitorWidget``, and the ``MonitorDetail``
page.

Its props are declared as ``LiveMonitorPlayerProps`` in the same file. Three of
them carry the behavior described here and elsewhere in this chapter:
``externalMediaRef`` lets a parent reach the element the player ended up
rendering, ``onProtocolChange`` reports which protocol actually connected, and
``bypassGo2rtcFailureCache`` opts a call site out of the shared failure cache
below.

**Protocol selection.** go2rtc is used when the user's ``streamingMethod`` is
not ``'mjpeg'``, ``monitor.Go2RTCEnabled`` is true, and the profile has a
``go2rtcUrl``. A per-monitor override in ``monitorStreamingOverrides`` wins over
the global setting. Otherwise MJPEG. The go2rtc hook (``useGo2RTCStream``) tries
WebRTC then MSE then HLS in order and reports the active protocol back via
``onProtocolChange``.

**Failure cache.** A module-level ``go2rtcFailureCache`` records the last
failure timestamp per ``monitor.Id``. While that entry is younger than
``GO2RTC_RETRY_INTERVAL_MIN`` (5 minutes, declared at the top of
``LiveMonitorPlayer.tsx``), the player skips go2rtc entirely and starts on
MJPEG. This avoids montage grids re-attempting WebRTC on every tile every
render. The cache is cleared immediately when the user explicitly switches a
monitor's preference back to go2rtc, so a manual retry does not have to wait
out the window. ``MonitorDetail`` passes ``bypassGo2rtcFailureCache`` and so
neither reads nor writes the cache: a failure recorded under montage's
many-connections-at-once load should not condemn the detail view, where a
single connection usually succeeds.

**No-frame fallback.** After go2rtc reports ``connected``, the player arms a
timer for ``GO2RTC_VIDEO_TIMEOUT_S`` (15 seconds, in
``lib/zmninja-ng-constants.ts``; generous because in montage every tile connects
at once). When it fires the player inspects ``videoWidth`` / ``videoHeight`` on
the underlying ``<video>``. Zero dimensions count as a soft failure: the monitor
is marked failed and MJPEG takes over. Nonzero dimensions with the video paused
trigger a single ``video.play()`` attempt to recover from autoplay
restrictions. A separate poll every ``GO2RTC_FRAME_POLL_MS`` (250 ms) checks the
same dimensions while the MJPEG-first placeholder shows, so a healthy stream
swaps over as soon as frames decode rather than waiting out the 15 seconds.

**Test IDs.** The outer wrapper carries ``data-testid="video-player"``. Internal
states expose ``video-player-loading``, ``video-player-webrtc-container``,
``video-player-mjpeg``, ``mse-connecting-badge``, ``video-player-error``, and
``video-player-retry``. E2E step definitions in
``tests/steps/monitor-detail.steps.ts`` and ``tests/steps/events.steps.ts`` bind
to these IDs, so renaming any of them breaks the cross-platform suite.

Mp4EventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/Mp4EventPlayer.tsx``

Video.js wrapper for recorded event playback. Consumed only by ``EventDetail``,
on the MP4 / HLS branch. Its props (declared as ``Mp4EventPlayerProps`` at the
top of the file) are the usual media inputs (``src``, ``type``, ``poster``,
``autoplay``, ``muted``, ``aspectRatio``), the marker pair discussed below,
``onReady`` and ``onError``, the continuous-playback callbacks
(``onEnded``, ``playbackRate``, ``onRateChange``, refs #250), ``onMutedChange``,
and ``eventId``, which is what enables Picture-in-Picture survival across
navigation. ``onMutedChange`` fires on video.js ``volumechange`` with
``player.muted()``; the player only ever sets muted from its prop at
construction, so every such event is the user's, and ``EventDetail`` writes it
to the ``eventPlaybackMuted`` setting for the next event to read (refs #463).
``fill`` switches video.js from ``fluid`` (size by aspect ratio) to ``fill``
(size by the parent box), which ``EventDetail`` sets for its own page-level
fullscreen. The page never asks video.js for fullscreen itself: on iPhone
that is a ``position: fixed`` full-window player, and the pinch-zoom
container around it, once transformed, becomes that element's containing
block, so pinch behaved one way or the other depending on the state it
started from (refs #462). ``onFullscreenChange`` reports the user's own
fullscreen button from the ``fullscreenchange`` / ``enterFullWindow`` /
``exitFullWindow`` events, deduplicated; the page follows it in and out and
records an entry in ``eventPlaybackFullscreen``.

Markers are rendered by ``videojs-markers``: the ``markers`` array maps to the
alarm and max-score frames on the event timeline, and ``onMarkerClick`` seeks
to a frame. Getting them onto the player is fussier than it looks, and getting
it wrong produced a recurring "Failed to update video markers" error on every
event that had markers.

The cause is ``this``-binding. ``videojs-markers`` (v1.x) is a Video.js *basic*
plugin registered with ``videojs.plugin()``, and the first thing its plugin
function does is read ``this`` as the player
(``S = this; S.on('loadedmetadata', ...)``). It therefore only works when
invoked as a method: ``player.markers(opts)``. Pull the function off the player
first (``const f = player.markers; f(opts)``) and ``this`` is undefined, the
``.on`` call throws, and no markers appear. Initialization also happens exactly
once, because on init the plugin overwrites ``player.markers`` with an API
object; a function value sitting there means "not initialized yet".

``applyVideoJsMarkers`` (``lib/event/video-markers.ts``) is the one place that
knows all of that. It initializes through a method call, holds that first call
back until there is at least one marker so the tooltip and click options are
wired up alongside real markers, and switches to ``removeAll()`` / ``add()``
for every later update.

``Mp4EventPlayer`` adds the guards that keep the helper from being called at a
bad moment. Marker updates wait for the player's ready callback, because the
plugin reads the player's DOM. ``onMarkerClick`` is read through a ref inside a
stable click handler, so a changing callback identity does not force a re-init.
A value signature skips redundant re-applies when a react-query refetch hands
back a fresh ``markers`` array holding the same values. Source, poster, and
autoplay changes propagate through a separate update effect that diffs against
``player.currentSrc()`` before reassigning, so a token refresh does not restart
playback on iOS WKWebView.

Picture-in-Picture, and why it uses Context
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/contexts/PipContext.tsx``

Start an event playing, pop it out to Picture-in-Picture, then navigate back to
the events list. The little floating window keeps playing. That works because
the ``<video>`` element is physically moved out of the page that is about to
unmount.

``PipProvider`` wraps the app in ``App.tsx`` and renders a hidden ``div`` as a
sibling of the router:

.. code:: tsx

   <PipContext.Provider value={{ adoptForPip, reclaimFromPip, closePip, activePipEventId, /* ... */ }}>
     {children}
     {/* Hidden portal for adopted PiP elements: sibling of children, outside router */}
     <div ref={portalRef} style={{ display: 'none' }} data-testid="pip-portal" />
   </PipContext.Provider>

``adoptForPip(player, videoEl, eventId)`` finds the ``video-js`` wrapper around
the ``<video>``, remembers the DOM node it currently lives under
(``originHost``), and appends it to that hidden div. Because the div belongs to
the provider and not to the route, unmounting ``EventDetail`` does not take the
video with it. ``reclaimFromPip()`` hands the player and element back when the
same event is opened again; ``closePip()`` disposes both.

Chapter 3 taught Zustand for state shared across the tree, and PiP is shared
state, so why Context here? Because what is shared is not data. It is a live
``HTMLVideoElement``, a Video.js ``Player`` instance, and the identity of a DOM
node that only exists because a component rendered it. Zustand stores hold plain
values that selectors compare and components re-render on; none of that applies
to an element handle. React **Context** is the mechanism for a component to
publish something to its whole subtree, and here the thing being published is
tied to the provider's own DOM output. ``usePip()`` reads it:

.. code:: tsx

   export function usePip(): PipContextValue {
     const ctx = useContext(PipContext);
     if (!ctx) throw new Error('usePip must be used within PipProvider');
     return ctx;
   }

Unlike a store, a context has no selector: any component calling ``usePip()``
re-renders whenever the provider's value changes. That is affordable only
because the value changes on PiP enter and exit and nothing else.

``Mp4EventPlayer`` is the only consumer, gated on its ``eventId`` prop. Android
uses a custom control-bar button that triggers native ExoPlayer PiP via
``enterAndroidPip``; desktop and iOS use the browser ``enterpictureinpicture``
event. ``LiveMonitorPlayer`` does not use PiP.

ZmsEventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/ZmsEventPlayer.tsx``

Player for events backed by ZoneMinder's ZMS streaming endpoint
(``cgi-bin/nph-zms``). ZMS serves a progressive JPEG stream and accepts control
commands (PAUSE, PLAY, SEEK, FASTFWD, etc.) over a separate URL keyed by
``connkey``. Consumed only by ``EventDetail``, on the JPEG-only branch and on
the user-forced-ZMS branch.

Its props (``ZmsEventPlayerProps``, top of the file) are the stream
coordinates, the frame counts the scrubber needs, and three behavior flags:
``suspended``, plus ``playbackRate`` / ``onRateChange``, which carry the
chosen speed across events during continuous playback.

``suspended`` pauses the stream while something covers it, currently the
full-size viewer in ``EventFrameCarousel``. The effect remembers whether the
stream was running when suspension began and only sends ``CMD_PLAY`` on release
if it was, so a stream the user paused stays paused. It depends on ``suspended``
alone and reads ``isPlaying`` without depending on it; taking ``isPlaying`` as a
dependency would re-run the effect on every ordinary play/pause.

The player exposes transport controls (start, seek back 5s, play / pause, seek
forward 5s, end), speed presets (0.25x, 0.5x, 1x, 2x, 4x), a frame-position
scrubber with alarm-frame markers, and jump buttons for the first alarm frame
and the max-score frame. Below the player sits a thumbnail for the max-score
frame, shown only when that frame differs from the alarm frame. The alarm frame
had a thumbnail here too until ``EventFrameCarousel`` began leading with it
above the player (refs #272); the quick-jump button still seeks to it, so
nothing was lost with the picture. Playback position is tracked by polling
``ZMS_COMMANDS.cmdQuery`` (``lib/zm/zm-constants.ts``) through
``getZmsControlUrl`` at the bandwidth-aware ``zmsStatusInterval``; the poll
shares an ``AbortController`` with its in-flight ``httpGet`` calls so unmount
cancels them.

Seeks use the duration the stream reports back in that query, not the DB
``eventLength`` prop. The two can disagree on variable-rate or still-recording
events, and seeking against ``eventLength`` lands the playhead at the wrong spot
(refs #196). ``eventLength`` is the fallback until the first query returns. While
the scrub bar is held (``onScrubStart``/``onScrubEnd`` on ``EventProgressBar``),
the status poll is suspended so it does not fight the drag. Each scrub position
is a bare ``CMD_SEEK``; the seek drives playback by itself, with no surrounding
pause or resume.

A settled seek is repeated once to the same offset after
``EVENT_SEEK_FLUSH_DELAY_MS`` (400 ms) unless the stream is confirmed to be
advancing (``isPlaying`` with a known ``streamDuration``). MJPEG in an ``<img>``
only paints a multipart part once the next part's boundary starts arriving, and
a paused or idle zms only emits its next frame on its ``MAX_STREAM_DELAY``
keepalive (5 s), so a lone seek to a stopped stream shows its frame about 5 s
late. Newer zms sends the sought frame twice to fix this server-side; ZM 1.36
does not, so the repeat supplies the second frame that flushes the first. A
newer seek cancels a still-pending repeat, so a drag only flushes its final
resting position.

URL construction is gated on a fresh access token via ``useFreshAccessToken``.
When the token is stale, ``zmsUrl`` evaluates to ``''`` and the ``<img>`` does
not render until the auth store returns a refreshed value. See the access-token
freshness gate in :doc:`07-api-and-data-fetching` for why this gate exists and
what counts as fresh.

EventFrameCarousel
~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/events/EventFrameCarousel.tsx``

Strip of the significant still frames for an event, rendered above the player in
``EventDetail`` (refs #272). The candidates are ``EVENT_FRAME_TYPES``
(``lib/zmninja-ng-constants.ts``), rendered in that array's order, most
informative first: ``objdetect``, ``alarm``, ``snapshot``. Each
one becomes a thumbnail through ``getEventImageUrl`` at
``EVENT_FRAME_THUMB_WIDTH`` (240 px), and the full-size viewer requests the same
URL without a width.

**Props:** ``portalUrl``, ``eventId``, ``token``, ``apiUrl``,
``minStreamingPort``, ``monitorId``, ``hasAlarmFrame``, ``onViewerOpenChange``.

ZoneMinder has no endpoint that reports which of these frames a given event has.
``objdetect`` only exists when the Event Server or ``zm_detect`` wrote one, and
the alarm frame only exists for an event that alarmed. So presence is discovered
by rendering: a thumbnail whose ``<img>`` fires ``onError`` adds its type to a
``failed`` list and disappears, and the component returns ``null`` once nothing
is left, which removes the card entirely. ``hasAlarmFrame`` skips the alarm
candidate up front when the event carries no ``AlarmFrameId``, so the common
non-alarm case costs no failed request. ``EventDetail`` renders the carousel
only while ``isAccessTokenFresh``, otherwise a token refresh would fail every
image at once and hide the card for the rest of the visit.

Collapse state lives in ``CollapsibleCard`` under
``EVENT_FRAMES_OPEN_STORAGE_KEY``, so it is a device preference in
``localStorage`` rather than a profile setting: it describes screen layout, not
server behavior.

``onViewerOpenChange`` is how the covered player gets stopped. ``EventDetail``
holds the Video.js instance from ``Mp4EventPlayer``'s ``onReady`` in a ref typed
structurally (``paused``/``play``/``pause``) so the page does not import
``video.js`` itself, pauses it when the viewer opens, and resumes it on close
only if it had been playing. The ZMS branches receive the same state through
``suspended``.

Player selection in EventDetail
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The branch in ``src/pages/EventDetail.tsx`` reduces to:

.. code:: tsx

   {hasVideo ? (
     useZmsFallback ? (
       <ZmsEventPlayer ... />
     ) : (
       <Mp4EventPlayer src={videoUrl} ... />
     )
   ) : hasJPEGs ? (
     <ZmsEventPlayer ... />
   ) : (
     /* no media */
   )}

``hasVideo`` is ``!!(event?.Event.DefaultVideo || event?.Event.Videoed === '1')``.
``hasJPEGs`` is ``event.Event.SaveJPEGs !== null && event.Event.SaveJPEGs !== '0'``.
``useZmsFallback`` initializes to ``isTvMode || Platform.isTVDevice`` and is
toggleable from the EventDetail header; an effect forces it back on whenever
``isTvMode`` becomes true, because the Fire Stick WebView renders MP4 poorly.

Working with events
-------------------

CompactEventRow
~~~~~~~~~~~~~~~

**Location**: ``src/components/events/CompactEventRow.tsx``

One row in the recent-events list under a monitor's live view: thumbnail, what
was detected, event id, start time, relative time, score, delete button.
Clicking it (or pressing Enter or Space while it is focused) opens
``/events/<id>`` with ``state: { from: '/monitors/<monitorId>' }``, so the event
page's back action returns to the monitor rather than the events list.

The primary text line comes from ``parseDetectedObjects(event.Notes)``
(``src/lib/event/event-detection.ts``). ZoneMinder writes detections into the
free-text ``Notes`` field as ``"detected:person,car|Motion: All"``; the function
matches everything after ``detected:``, splits on commas, and keeps only the
part before ``|`` in each entry, returning ``[]`` when there is no ``detected:``
segment. Classes it finds are joined with commas and shown with an icon from
``getObjectClassIconFromList``; otherwise the row falls back to ``event.Cause``.

The second line is the start time via ``fmtTime`` from ``useDateTimeFormat()``,
followed by a relative time (``formatEventRelative``) when the event falls
within ``RELATIVE_TIME_LIST_WINDOW_DAYS`` (7 days, checked with ``isWithinDays``).
User-visible times always go through the hook so the profile's date and time
format settings apply.

**Test ids**: row ``compact-event-row``, thumbnail ``compact-event-thumbnail``.

The row reads ``selectedForDelete`` from ``useDeleteSelectionStore`` and adds
``ring-2 ring-destructive/60 bg-destructive/5`` when the event is queued for
deletion. That class is listed after the return-flash classes in the row's
``cn(...)`` call, so a queued row that is also mid-flash shows the destructive
ring rather than the flash styling.

Return highlight
~~~~~~~~~~~~~~~~

**Location**: ``src/stores/returnHighlight.ts``, ``src/hooks/useReturnFlash.ts``,
``src/components/events/ReturnFlashArrow.tsx``

Open an event from a list, then navigate back. The row you came from blinks for
four seconds so you can find your place again. A store, a hook, and an icon
component do the work.

``useReturnHighlightStore`` is a Zustand store holding
``lastViewedEventId: string | null``, with ``markViewed(eventId)`` and ``clear()``
actions. It is session-only and not persisted. ``CompactEventRow``, ``EventCard``
and the grid view's ``EventMontageTile`` all call ``markViewed(event.Id)`` in
their open handler, before ``navigate``. The first two also do it on Enter/Space
activation.

``useReturnFlash(eventId: string): boolean`` subscribes reactively to
``lastViewedEventId``. When that id becomes ``eventId``, the hook flips its
returned boolean to ``true`` and starts a ``window.setTimeout`` that flips it
back after ``RETURN_FLASH_MS`` (4000 ms, in ``lib/zmninja-ng-constants.ts``). It
reacts to the store rather than capturing the id at mount because the returning
row's mount does not reliably line up with when the id is set, so a mount-time
read saw the wrong value. The id is consumed (``clear()``) when the flash ends,
and only if it still matches ``eventId``, so exactly one row flashes once per
return. The timer is cancelled only on unmount: the row that set the id then
navigates away, and dropping its pending timer without consuming keeps the id
available for the row that flashes on return.

``ReturnFlashArrow`` renders a decorative ``Triangle`` icon (``aria-hidden``,
test id ``return-flash-indicator``), absolutely positioned at ``-top-1.5`` and
centered, so it sits just above its anchor and points down at it. The blink is
``motion-safe:animate-blink``: the ``motion-safe:`` gate gives users with
``prefers-reduced-motion`` a static arrow instead of a blinking one, so it must
not be removed. Because the arrow is absolutely positioned, its parent needs
``relative``: in ``CompactEventRow`` and ``EventCard`` that is the ``relative``
wrapper around the thumbnail, which does not clip. ``EventMontageTile``'s
``Card`` does clip (``overflow-hidden``), so the arrow is rendered as a sibling
of the ``Card`` inside a ``relative`` wrapper. Putting it inside would clip the
half that overhangs the top edge. All three render ``<ReturnFlashArrow />``
when their local ``flash`` boolean is ``true``, half above the thumbnail.

Hooks cannot be called from inside a ``.map()`` callback, so a grid or list that
needs a per-row ``useReturnFlash`` must give each row its own component.
``EventMontageView`` extracts ``EventMontageTile`` for this reason, the same way
``EventListView`` extracts ``EventItem``.

Bulk event delete
~~~~~~~~~~~~~~~~~

Deleting events is a batch operation (refs #213): clicking the trash icon on a
row queues it rather than opening a per-event confirm dialog. A bar floats up
from the bottom with the count and a Delete button. A selection store, the
row-level toggle, the floating bar, and the delete hook implement that.

``useDeleteSelectionStore`` (``src/stores/deleteSelection.ts``) holds
``selectedKeys: string[]`` with ``toggle(key)``, ``remove(keys)`` and
``clear()``. It is session-only, not persisted, and survives navigation on
purpose: opening an event from the queued list does not clear the selection. It
clears on Cancel, or drops the events a delete actually removed.

The selection does not survive a profile change.
``switchProfile``, ``deleteProfile`` and ``deleteAllProfiles``
(``stores/profile.ts``) clear the selection, as does ``setProfileDisabled``
when it disables a profile (re-enabling one leaves the queue alone, since
nothing goes out of view). ``DeleteBatchBar``
lives in ``AppLayout`` and never unmounts. Without that, ticking an event on
one server and then switching servers left the bar showing its count with
nothing marked under it, and confirming would have deleted events on a server
the user was no longer looking at. Those actions clear the whole queue rather
than filtering out one profile's keys: the profile list just changed under a
destructive queue, and dropping it is the safe direction.

The entries are *not* raw ZoneMinder event ids. An event id is only unique
within one server, so while aggregating, ticking event 1234 on profile A also
ticked event 1234 on profile B and would have deleted both. The store keys on
``eventSelectionKey(profileId, eventId)``, which is ``` `${profileId}:${eventId}` ```
(refs #337) and mirrors ``monitorCacheKey`` in ``stores/monitors.ts``. With no
profile in hand it falls back to the bare event id, which is the key
single mode used before. ``parseEventSelectionKey`` splits it back apart on the
first ``':'``, the same convention ``resolveOwnMonitorIds`` uses for the
composite monitor-filter tokens.

``EventDeleteButton`` (``src/components/events/EventDeleteButton.tsx``) is a
trash icon toggle, not a dialog trigger. It builds its selection key from
``eventId`` plus ``profileId``, reads whether that key is in ``selectedKeys``,
and calls ``toggle`` on click, stopping propagation so it never fires the parent
row's click-to-navigate handler. Selected state fills the icon
(``fill-destructive text-destructive``) and sets ``aria-pressed``. Used by both
``CompactEventRow`` and ``EventCard``; each resolves the owning profile the same
way (``profileId ?? currentProfile?.id``), so one event ticked from either
surface is one selection entry rather than two.

**Props**: ``eventId``, ``profileId`` (owning profile, optional),
``size`` (``'sm' | 'md'``, default ``'md'``), ``className``.
**Test id**: ``event-delete-button``.

``DeleteBatchBar`` (``src/components/events/DeleteBatchBar.tsx``) is rendered
once, in ``AppLayout``, so it floats above every page rather than being
duplicated inside each list. It reads ``selectedKeys`` and renders nothing when
the array is empty. Otherwise it shows a pill with the queued count
(``events.delete_selected``, pluralized), a Cancel button calling ``clear()``,
and a Delete button that passes the keys to ``useBulkDeleteEvents`` and feeds
what came back to ``remove()``. Deleting only what the hook confirms leaves the
events that failed queued for a retry instead of silently dropping them. Delete
is disabled while ``isDeleting``. **Test ids**: ``delete-batch-bar``,
``delete-batch-cancel``, ``delete-batch-confirm``.

``useBulkDeleteEvents`` (``src/hooks/useBulkDeleteEvents.ts``) exposes
``deleteEvents(selectionKeys: string[]): Promise<string[]>`` (the keys it
actually deleted) and ``isDeleting``. It first groups the keys by owning
profile, because a delete has to go to the server the event lives on:

.. code:: tsx

   const byProfile = new Map<ProfileId, OwnedEvent[]>();
   for (const key of selectionKeys) {
     const { profileId: owner, eventId } = parseEventSelectionKey(key);
     const target = owner ?? effectiveProfileId;   // bare key: the current profile
     ...
   }

That grouping fixes a crash. Resolving one client up front with
``getCurrentSession()`` throws while aggregating, because the current id is an
aggregate, which has no session. With only a ``try``/``finally`` around that
call, confirming a bulk delete produced an unhandled rejection: no toast,
nothing deleted, the selection still there. Each profile's ``getSession`` call
is wrapped, and a profile that cannot produce a client
counts its events as failed rather than taking the whole batch down. The
Aggregation contract (``AGENTS.project.md``) states the rule directly: never
``getCurrentSession`` where an aggregate can be current.

Per profile it calls the API layer's ``deleteEvent`` (imported as
``apiDeleteEvent`` to avoid a name clash) for every id through
``Promise.allSettled``, so one failed deletion does not stop the rest, then
edits that profile's cache twice, for two different reasons:

.. code:: tsx

   // Remove the successfully deleted events from cached lists right away so
   // the UI reflects the deletion immediately, then invalidate to reconcile.
   queryClient.setQueriesData(
     { predicate: (q) => isEventListQueryFor(q.queryKey, owner) },
     (old) => removeFromEventsCache(old, deletedIds)
   );

   await Promise.all([
     queryClient.invalidateQueries({ queryKey: queryKeys.events(owner) }),
     ...deleted.map((e) =>
       queryClient.invalidateQueries({ queryKey: queryKeys.event(owner, e.eventId) })),
     queryClient.invalidateQueries({
       predicate: (q) => q.queryKey[0] === 'monitorRecentEvents' && q.queryKey[1] === owner,
     }),
   ]);

React Query keeps a cache of server responses keyed by an array
(:doc:`07-api-and-data-fetching`). ``setQueriesData`` rewrites the cached value
in place, so the rows vanish on the next paint. ``invalidateQueries`` marks the
same queries stale and refetches them, which reconciles with whatever the server
actually did. Doing only the second would leave deleted rows on screen for a
round trip; doing only the first would let a failed server-side delete disappear
from the UI and stay gone.

Both predicates check the profile id, not just the domain name. Every events
key puts the profile id at index 1, so matching on it keeps deleting profile A's
event 1234 from evicting profile B's identically numbered event out of the
cache, which is the same collision the composite selection key fixes one layer
up. The keys themselves come from the ``queryKeys`` factory in
``lib/query/query-keys.ts``, never written inline. The last invalidation uses a
predicate rather than a key because it has to reach every monitor's
recent-events query for that profile, not just this event's monitor.

If any deletion failed, the hook logs via ``log.eventCard`` and toasts
``events.delete_failed``; otherwise it toasts ``events.delete_selected_success``,
pluralized on the count. It never rejects. Deleting is destructive, and a
rejected promise reaching the bar's ``onClick`` is a failure the user never
sees, which is what the old All-mode crash looked like.

The cache work sits in its own ``try``/``catch`` for a related reason. By the
time it runs the server has already dropped the events, so a cache error must
not unsay that. Letting it fall through to the outer ``catch`` would report
nothing deleted, the bar would keep the dead events queued, and every retry
would ``404`` forever. It logs and moves on instead.

MonitorRecentEvents
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorRecentEvents.tsx``,
``src/hooks/useMonitorRecentEvents.ts``

Below the live view on a monitor's page, and below the PTZ controls when the
camera has them, sits a collapsible list of that monitor's newest events. The
header (title, refresh button, collapse toggle, "All events" link) always
renders; the body collapses, and the collapsed state is remembered per monitor.

Collapsing does more than hide the rows. The body unmounts and the query behind
it is disabled, so a collapsed list issues no requests and no background
refreshes:

.. code:: tsx

   const { data, isLoading, isError, isFetching, refetch } = useQuery({
     queryKey: queryKeys.monitorRecentEvents(currentProfile?.id, monitorId, count),
     queryFn: () => getEvents({ monitorId, limit: count, sort: 'StartDateTime', direction: 'desc' }),
     enabled: !!currentProfile && isAuthenticated && !hidden,
     refetchInterval: hidden ? false : bandwidth.monitorRecentEventsInterval,
   });

``sort: 'StartDateTime', direction: 'desc'`` puts the newest first regardless of
the server's default sort. ``count`` is
``clampRecentEventsCount(settings.monitorDetailRecentEventsCount)`` and is part
of the key, so changing the row count is a different query rather than a
re-slice of an old one. ``refetchInterval`` comes from ``useBandwidthSettings()``
(30 seconds normally, 60 seconds in low-bandwidth mode, per
``BANDWIDTH_SETTINGS``), never a hardcoded number.

``toggleHidden()`` flips the collapsed state for this monitor and persists it
through ``updateProfileSettings``, so it is scoped to the active profile.

React Query v5 reports ``isLoading`` as ``false`` for a disabled query. That is
harmless here because ``MonitorRecentEvents`` only renders the body, and only
reads ``isLoading``, when ``hidden`` is ``false``.

**Test ids**: root ``monitor-recent-events``, collapse toggle
``monitor-recent-events-toggle``, refresh ``monitor-recent-events-refresh``,
"All events" ``monitor-recent-events-all``, body ``monitor-recent-events-body``.

Dashboard
---------

DashboardWidget
~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardWidget.tsx``

Every dashboard tile is wrapped in ``DashboardWidget``, which supplies the card
chrome and, in edit mode, a pencil, an X, and a drag handle. The two buttons
overlap the drag surface, so both of their handlers stop propagation twice:

.. code:: tsx

   <Button
     onClick={(e) => {
       e.stopPropagation(); // Prevent drag start
       setEditDialogOpen(true);
     }}
     onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
   >

``react-grid-layout`` begins a drag on ``mousedown``, not on ``click``, so
stopping only the click would still drag the widget out from under the cursor
while opening the dialog.

DashboardLayout and the store/grid sync loop
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardLayout.tsx``

``DashboardLayout`` renders the widgets into ``react-grid-layout``. Widget
positions live in the Zustand dashboard store (they persist across reloads), but
the grid library wants to own a ``layout`` array in component state and calls
``onLayoutChange`` whenever it moves anything. That is two sources of truth
pointed at each other, and wiring them naively spins forever:

1. Store changes, so the sync effect runs and calls ``setLayout``.
2. The grid sees a new layout and calls ``handleLayoutChange``.
3. ``handleLayoutChange`` writes to the store.
4. Back to step 1.

The break is a ref that records whether the current ``setLayout`` originated
from the store or from the user:

.. code:: tsx

   useEffect(() => {
     // Mark that we're syncing from store - this prevents handleLayoutChange from
     // writing back to store and causing an infinite loop
     isSyncingFromStoreRef.current = true;
     setLayout((prev) => (areLayoutsEqual(prev, layouts) ? prev : layouts));
     // Reset the flag after React has processed the state update
     // Use requestAnimationFrame for more predictable timing than queueMicrotask
     requestAnimationFrame(() => {
       isSyncingFromStoreRef.current = false;
     });
   }, [layouts, areLayoutsEqual]);

   const handleLayoutChange = useCallback((nextLayout: Layout[]) => {
     setLayout((prev) => (areLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
     if (!isEditing || isSyncingFromStoreRef.current) return;
     updateLayouts(profileIdRef.current, { lg: nextLayout });
   }, [areLayoutsEqual, isEditing]);

The flag has to stay up long enough for the grid's callback to run and no
longer. ``queueMicrotask`` can fire before React finishes processing the state
update, and ``setTimeout(..., 0)`` is at the mercy of the task queue.
``requestAnimationFrame`` fires after the current frame's DOM updates, by which
point React has committed the change and the grid has already called back.
``areLayoutsEqual`` is belt and braces: it returns the previous array reference
when nothing moved, so an identical layout does not even produce a re-render.

The store subscription itself uses ``useShallow`` for the same reason
``MontageMonitor`` does, and ``profileId`` is minted with ``asProfileId()``
because ``'default'`` (the no-profile-selected placeholder) is not a real
profile id. :doc:`call-flows` traces a widget end to end in "A Dashboard
widget".

Widget types
~~~~~~~~~~~~

Each widget is a child of ``DashboardWidget`` and reads its own configuration
out of ``widget.settings``:

- **MonitorWidget** (``widgets/MonitorWidget.tsx``): live streams for one or
  more monitors, via ``LiveMonitorPlayer`` (wrapped in ``MonitorHoverPreview``).
  Configuration: ``monitorIds``, ``feedFit``.
- **EventsWidget** (``widgets/EventsWidget.tsx``): a recent-events list.
  Configuration: ``monitorIds``, ``eventCount``, ``refreshInterval``,
  ``onlyDetectedObjects``, ``tagIds``.
- **HeatmapWidget** (``widgets/HeatmapWidget.tsx``): event frequency by day and
  hour.
- **TimelineWidget** (``widgets/TimelineWidget.tsx``): event timeline.

Invisible overlays block taps on iOS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``MonitorWidget`` draws a caption strip over the bottom of each stream that
fades in on hover. On desktop, hover makes it visible before any click lands, so
nothing is amiss. On iOS there is no hover: the strip stays at ``opacity-0``,
and an ``opacity-0`` element still hit-tests. Tapping the monitor hits the
invisible strip and the tap goes nowhere.

The fix is on the element, not the parent:

.. code:: tsx

   <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">

Any ``opacity-0`` element sitting over interactive content needs
``pointer-events-none``. Add ``group-hover:pointer-events-auto`` back if it must
accept input once visible. ``EventHeatmap``'s tooltip carries the same pair.
Invisible is not the same as non-interactive, and only a real iOS device shows
the difference.

Tuning the aggregate
--------------------

AllServersPerformanceSection
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/settings/AllServersPerformanceSection.tsx``

Every guardrail that bounds All-mode fan-out is a row here: the montage stream
cap, the Live Activity watch cap and poll floor, the notification grouping
window, and the three connection knobs. Settings.tsx renders it only while
``isAllMode``, above the profile picker, next to
``AllServersStreamingSection``, because these bound the aggregate rather than
the server picked below.

Each row's value lives in the current aggregate's settings bucket and its
default is the constant its consumer used to hardcode, so
``DEFAULT_SETTINGS.allModeMaxStreams`` is ``MONTAGE_GRID.allModeMaxStreams``
and resetting a row writes that constant back. The editable range comes from
``ALL_MODE_PERFORMANCE`` in ``src/lib/zmninja-ng-constants.ts``, and
``mergeProfileSettings`` clamps to it on every read: persisted settings are a
trust boundary (AGENTS.md I1), so a consumer never has to range-check what it
reads.

Number rows bind through ``useClampedNumberField``
(``src/hooks/useClampedNumberField.ts``), shared with
``LiveActivitySettingsDialog``. It keeps a local text draft and commits on blur
or Enter rather than per keystroke. Committing per keystroke cannot work here:
the commit clamps, the clamped value flows back into the input, and the next
keystroke appends to the clamped string instead of what was typed. The hook's
own comment works the failure through digit by digit.

The reset button renders only while a row differs from its default, so an
untouched section shows none at all. Because the hook resyncs its draft from
the store whenever the field is unfocused, a reset writing the default is
picked up by the input without any extra wiring.

**Test ids**: ``all-mode-max-streams-input``/``-reset``,
``all-mode-max-watched-input``/``-reset``, ``all-mode-poll-floor-input``/``-reset``,
``all-mode-burst-window-input``/``-reset``, ``all-mode-stream-tuning-select``,
``all-mode-pause-hidden-switch``, ``all-mode-idle-minutes-input``/``-reset``.

Hiding monitors
---------------

HiddenMonitorsSection
~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/settings/HiddenMonitorsSection.tsx``

A per-profile control to hide and restore monitors. Hidden monitors drop out of
monitor lists, events, montage, and timeline for the active profile. The setting
is ``excludedMonitorIds`` on the profile's settings.

The section has to list every monitor including the hidden ones, or a hidden
monitor could never be restored. It fetches the unfiltered list under its own
key so the result never overwrites the filtered monitors cache the rest of the
app reads:

.. code:: tsx

   const { data } = useQuery({
     queryKey: queryKeys.monitorsAllIncludingExcluded(currentProfile?.id),
     queryFn: () => getMonitors({ includeExcluded: true }),
     enabled: !!currentProfile && isAuthenticated,
   });

``queryKeys.monitorsAllIncludingExcluded`` produces
``['monitors', profileId, 'all-including-excluded']``, which sits *under* the
``['monitors', profileId]`` domain prefix. React Query invalidates by prefix, so
invalidating the monitors domain reaches this query too, while a fetch of this
query cannot clobber the domain-level cache entry.

Toggling a row updates ``excludedMonitorIds``, then invalidates
``queryKeys.monitors``, ``queryKeys.events``, ``queryKeys.monitorEventsSinceAll``,
``queryKeys.timelineEvents``, and ``queryKeys.eventMontage`` for the current
profile, so every dependent view refetches with the new exclusion applied.

**Test ids**: ``hidden-monitors-list``, ``hidden-monitors-count``,
``hidden-monitor-row-<id>``, ``hidden-monitor-toggle-<id>``.

Forgetting deleted monitors
~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/hooks/useReconcileDeletedMonitors.ts``,
``src/lib/monitor/prune-deleted-monitors.ts``

Monitor ids are persisted in four places: ``excludedMonitorIds``, each montage
group's ``hiddenMonitorIds`` and ``workingLayout``, and dashboard widget
settings. Deleting a monitor in ZoneMinder removes it from the API but from
none of those, so it lingers as a ghost. A hidden monitor that no longer exists
was the worst case: still counted in the hidden total, absent from the list
that would let you un-hide it, and therefore permanently stuck.

``AppLayout`` mounts ``useReconcileDeletedMonitors`` once. It reads the same
``monitorsAllIncludingExcluded`` query the section above uses, so it adds no
second fetch, and drops any stored id the response does not contain.

Two things about it are deliberate and easy to get wrong when editing it:

- It must read the list that **includes** excluded monitors. The ordinary
  monitors query has already removed the hidden ones, and reconciling the
  hidden list against a list built by removing it would delete every entry.
- It prunes nothing unless the query succeeded and returned at least one
  monitor. An empty or failed response looks exactly like "every monitor was
  deleted", and acting on it would destroy the user's configuration.

Named montage ``savedLayouts`` are left alone. They are arrangements the user
saved and may reload later; an entry for a monitor that is gone renders
nothing, which is a better trade than editing saved work.

Whole-app surfaces
------------------

Kiosk mode, TV d-pad support, the notification pipeline, and the in-app
assistant are not page components: each one sits over or beside the entire
app. They are documented together in :doc:`16-platform-surfaces`.

Test attributes
---------------

Interactive elements carry ``data-testid`` in kebab-case, and e2e steps bind to
those ids rather than to text or CSS classes:

.. code:: tsx

   <Card data-testid="monitor-card">
     <div data-testid="monitor-player" />
     <span data-testid="monitor-status" />
     <div data-testid="monitor-name">{monitor.Name}</div>
     <Button data-testid="monitor-events-button">{t('sidebar.events')}</Button>
     <Button data-testid="monitor-settings-button">{t('sidebar.settings')}</Button>
     <Button data-testid="monitor-download-button" />
   </Card>

Feature files stay in the language of the user:

.. code:: gherkin

   When I click on the first monitor card
   Then I should see the monitor player

Step definitions live in ``tests/steps/<screen>.steps.ts``, one file per screen
(``monitors.steps.ts``, ``monitor-detail.steps.ts``, ``montage.steps.ts``,
``events.steps.ts``, and so on), never a single shared module:

.. code:: tsx

   // tests/steps/monitors.steps.ts
   When('I click on the first monitor card', async ({ page }) => {
     await page.locator('[data-testid="monitor-card"]').first().click();
   });

See :doc:`06-testing-strategy` for how the same steps run against Chromium,
Android, and iOS.

Where the rest lives
--------------------

The shared primitives in ``components/ui/`` and ``components/common/``,
``NotificationBadge``, and the ``services/`` and ``lib/`` layers are documented
in :doc:`12-shared-services-and-components`. The React mechanisms used above
(``memo``, refs, effect cleanup, Context, portals, error boundaries, event
propagation) are taught from first principles in :doc:`02-react-fundamentals`,
and Zustand's selector model in :doc:`03-state-management-zustand`.
