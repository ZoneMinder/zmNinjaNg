Go2RTC WebRTC Streaming
=======================

ZoneMinder can publish a `go2rtc <https://github.com/AlexxIT/go2rtc>`__ endpoint
alongside its own MJPEG streamer (ZMS). When it does, zmNinjaNg plays live video
through go2rtc as an H.264/H.265 stream over MSE or WebRTC instead of a
JPEG-per-frame MJPEG stream. That cuts latency and moves decode to hardware, so
a montage tile no longer repaints a full JPEG per frame.

MJPEG stays on every path: it is the fallback for every way go2rtc can fail, and
it is the picture on screen while go2rtc is still connecting. The whole feature
hangs off one per-profile toggle (Settings, Live Streaming, "Enable
WebRTC/HLS/MSE"); everything below is what happens once that toggle is on.

The end-to-end trace of a tile starting a go2rtc stream is Flow 8 in
:doc:`call-flows`. This chapter is the reference behind that trace.

Choosing go2rtc or MJPEG
------------------------

``LiveMonitorPlayer`` is the only component that makes this decision. Montage
tiles, the monitor detail page, the dashboard monitor widget, and ``MonitorCard``
all render it rather than an ``<img>`` of their own, so the choice is made once.

.. code:: typescript

   // components/monitors/LiveMonitorPlayer.tsx
   const canUseWebRTC =
     userStreamingPreference !== 'mjpeg' &&
     monitor.Go2RTCEnabled === true &&
     !!profile?.go2rtcUrl;

   const method = canUseWebRTC ? 'webrtc' : 'mjpeg';

The profile setting (or a per-monitor override) must not force MJPEG, the
monitor must have ``Go2RTCEnabled`` set in ZoneMinder, and the profile must
carry a ``go2rtcUrl``; all three have to hold. There is no separate availability
boolean: the truthiness of ``go2rtcUrl`` is the check.

This runs inside ``useMemo``, a React hook that recomputes a value only when its
listed inputs change, so switching a monitor's override recomputes the method but
an unrelated re-render does not. The decision is logged once per
monitor-and-method pair (``log.videoPlayer('Streaming: WebRTC' | 'Streaming: MJPEG')``),
which is the first line to grep for when a monitor plays the wrong way.

``LiveMonitorPlayer`` owns the streaming decision and its watchdogs; see
:doc:`05-component-architecture` for how it sits among the other monitor
components.

Where ``go2rtcUrl`` comes from
------------------------------

Nothing probes the network for go2rtc. There is no port scan and no
``services/discovery.ts`` involvement. The URL is read from ZoneMinder's own
config during profile bootstrap.

``bootstrapGo2RTCPath`` runs as part of ``performBootstrap`` when a profile is
switched to or rehydrated from storage. It calls ``fetchGo2RTCPath()``, which
reads the ``ZM_GO2RTC_PATH`` config value from the API:

.. code:: typescript

   // api/auth.ts
   const response = await client.get<Go2RTCPathResponse>(
     '/configs/viewByName/ZM_GO2RTC_PATH.json'
   );
   const validated = Go2RTCPathResponseSchema.parse(response.data);
   const go2rtcPath = validated.config.Value;

An empty or missing value means go2rtc is not configured, and
``bootstrapGo2RTCPath`` clears ``profile.go2rtcUrl`` if it was set previously. A
present value is written to the profile, and every player picks it up from there.
Because the value comes from the server, an admin who turns go2rtc on in
ZoneMinder does not need the user to type a URL, and one who turns it off
demotes every tile to MJPEG on the next profile bootstrap. See
:doc:`07-api-and-data-fetching` for the config-fetch layer and
:doc:`11-application-lifecycle` for when bootstrap runs.

WebSocket URL and stream name
-----------------------------

``getGo2RTCWebSocketUrl`` in ``lib/zm/url-builder.ts`` turns the configured path
into a signaling URL. It takes the path, the monitor id, and a channel:

.. code:: typescript

   getGo2RTCWebSocketUrl(
     go2rtcPath: string,                  // ZM_GO2RTC_PATH, e.g. 'http://zm.example.com:1984'
     monitorId: string,
     channel: string | number = 0,        // 0 = primary, 1 = secondary
     options: { token?: string; expectedHost?: string } = {}
   ): string

   getGo2RTCWebSocketUrl('http://zm.example.com:1984', '1', 0)
   // 'ws://zm.example.com:1984/ws?src=1_0'

   getGo2RTCWebSocketUrl('http://zm.example.com:1984/go2rtc', '5', 1)
   // 'ws://zm.example.com:1984/go2rtc/ws?src=5_1'

``http`` becomes ``ws`` and ``https`` becomes ``wss``. ``/ws`` is appended to
whatever pathname ``ZM_GO2RTC_PATH`` already has, so a reverse-proxied go2rtc at
``/go2rtc`` keeps its prefix. And the stream name is always
``{monitorId}_{channel}``, matching ZoneMinder's own go2rtc naming.

The channel comes straight from the monitor:

.. code:: typescript

   // components/monitors/LiveMonitorPlayer.tsx
   channel: monitor.StreamChannel || 0,

``StreamChannel`` is a nullable string on ``MonitorSchema``. It picks which of a
camera's streams go2rtc should serve (primary versus a lower-resolution
substream). Monitors without one fall back to channel ``0``. Nothing reads
``RTSPStreamName``; that field exists on the schema because ZoneMinder returns
it, and the stream name is derived from the id and channel alone.

Protocol negotiation runs in parallel
-------------------------------------

``useGo2RTCStream`` joins the configured protocols into a single comma-separated
string and hands it to the vendored ``video-rtc`` custom element once:

.. code:: typescript

   // hooks/useGo2RTCStream.ts
   const modeString = protocols.join(',');   // default: 'webrtc,mse,hls'
   // ...
   videoRtc.mode = modeString;
   videoRtc.media = 'video,audio';
   videoRtc.background = true;

When the WebSocket opens, ``video-rtc``'s ``onopen()`` starts every compatible
protocol at once over that one socket. Reading the vendored source
(``lib/vendor/go2rtc/video-rtc.js``), the rules are:

- At most one of MSE, HLS, or MP4 is started, in that priority order. MSE
  requires ``MediaSource`` or ``ManagedMediaSource``; HLS requires the ``<video>``
  to report it can play ``application/vnd.apple.mpegurl``; the MP4 branch has no
  capability check at all. If no branch matches, none of the three starts. HLS is
  a fallback for browsers without MSE, not a step after WebRTC fails.
- WebRTC is started as well, alongside it, whenever ``webrtc`` is in the mode
  string and ``RTCPeerConnection`` exists.
- MJPEG is started only when nothing else started. If something else did start,
  ``mjpeg`` in the mode string instead registers a handler that starts MJPEG when
  the server reports an error for the first started mode. Either way it does not
  apply here: the app never puts ``mjpeg`` in the mode string. MJPEG fallback is
  ``LiveMonitorPlayer``'s job, not the element's.

Both then race to produce video. If the peer connection delivers a video track,
``onpcvideo()`` scores WebRTC against MSE (video plus audio beats video alone,
H.265 beats H.264, and a tie goes to WebRTC). The winner keeps playing and the
loser is closed. When WebRTC wins, the WebSocket itself is closed because media
now flows over the peer connection, a fact that makes teardown harder than
closing a socket (see below). If WebRTC never produces a track, MSE keeps
playing.

The protocol the UI reports is not necessarily the winner:

.. code:: typescript

   // hooks/useGo2RTCStream.ts, inside the wrapped onopen
   const modes = originalOnopen();
   setState('connected');
   if (modes && modes.length > 0) {
     setActiveProtocol(modes[0] as StreamingProtocol);
   }

``modes[0]`` is whichever of MSE/HLS/MP4 started, because ``video-rtc`` pushes it
before WebRTC. That is only the protocol attempted first. The race is decided
later, in ``onpcvideo``, which adopts the WebRTC stream and leaves ``pcState``
open when WebRTC wins, or closes the peer connection when it loses. The hook's
``onpcvideo`` wrapper reads that flag and promotes ``activeProtocol`` to
``webrtc``, so the badge names the protocol carrying the frames rather than the
one that started first. The badge is rendered only when the
``showProtocolLabel`` setting is on.

STUN servers
------------

``video-rtc.js`` hardcodes ``stun.cloudflare.com`` and ``stun.l.google.com``
into the browser ``RTCPeerConnection``. ``useGo2RTCStream`` overrides
``videoRtc.pcConfig.iceServers`` on the element instance before the connection
starts (the vendored file is left unchanged). ``onwebrtc()`` reads ``pcConfig``
lazily when it builds the peer connection, so the override wins.

.. code:: typescript

   videoRtc.pcConfig = {
     ...videoRtc.pcConfig,
     iceServers: useStun ? GO2RTC_STUN_SERVERS : [],
   };

The per-profile ``webrtcUseStun`` setting selects the list: off (the default)
applies ``[]``; on applies ``GO2RTC_STUN_SERVERS`` from
``lib/zmninja-ng-constants.ts``. It is off by default because LAN and portal/VPN
reach go2rtc on host candidates, so STUN is never on the path. An empty list also
stops Chromium from starting a STUN hostname lookup that it cancels when
video-rtc tears the peer connection down (the WebRTC/MSE race, or a montage tile
rotating), which otherwise logs ``Failed to resolve address for stun...
errorcode: -105`` even though DNS resolves. Turn it on only to reach go2rtc
directly over the public internet without a portal/VPN, where NAT traversal needs
a server-reflexive candidate.

Starting and stopping the connection
------------------------------------

``useGo2RTCStream`` owns the element's lifetime, using two React mechanisms: a
ref and an effect.

A **ref** is a mutable box React hands back on every render, and writing to it
does not re-render anything. The hook uses ``containerRef`` to reach the real
``<div>`` in the DOM (``video-rtc`` is a custom element, appended by hand rather
than rendered as JSX), ``videoRtcRef`` to hold the element across renders, and
``mountedRef`` to know whether the component is still alive. An **effect** is a
function React runs after render and again whenever its dependencies change,
returning a cleanup function it runs before the next pass and on unmount. Both are
covered in :doc:`02-react-fundamentals`.

.. code:: typescript

   // hooks/useGo2RTCStream.ts, connect effect (simplified: logging removed)
   useEffect(() => {
     mountedRef.current = true;
     if (!enabled) { stop(); return; }
     if (!go2rtcUrl || !monitorId || !containerRef.current) return;

     connectTimeoutRef.current = setTimeout(() => {
       connectTimeoutRef.current = null;
       if (mountedRef.current) connect();
     }, GO2RTC_CONNECT_DELAY_MS);

     return () => {
       mountedRef.current = false;
       cleanup();
     };
   }, [enabled, go2rtcUrl, monitorId, token, protocolsKey]);

``GO2RTC_CONNECT_DELAY_MS`` is 100 ms. The delay exists because React's Strict
Mode, in development only, mounts every component, unmounts it, and mounts it
again to surface effects that are not cleanup-safe. Without the delay each tile
would open a WebSocket, immediately tear it down, and open another. With it, the
first mount's timer is cleared by its own cleanup before it ever fires. Montage
tiles are not staggered beyond this one shared delay; they all connect together.

``protocolsKey`` is ``protocols.join(',')`` rather than the array itself, because
an array in a dependency list is compared by identity. ``LiveMonitorPlayer``
passes ``rawSettings?.webrtcProtocols``, and when a profile has never set it the
hook's own default parameter (``protocols = ['webrtc', 'mse', 'hls']``) mints a
fresh array on every render. Keying on the string stops a harmless re-render from
tearing the stream down and rebuilding it.

Falling back to MJPEG
---------------------

Everything in this section lives in ``LiveMonitorPlayer``, not in the hook. The
hook reports state; the component decides when to fall back to MJPEG.

MJPEG shows first. While go2rtc is selected but has produced no decoded
frames yet, the component renders the MJPEG ``<img>`` as the visible picture with
a blinking ellipsis badge over it (``data-testid="mse-connecting-badge"``):

.. code:: typescript

   const showMjpegPlaceholder = effectiveStreamingMethod === 'webrtc' && !hasVideoFrames;

When decoded frames appear (``videoWidth > 0``) the
component swaps to the ``<video>`` and drops the badge. A poll every
``GO2RTC_FRAME_POLL_MS`` (250 ms) makes that swap happen within a quarter
second of frames arriving rather than at the timeout deadline. ``derivePlayerViewState()`` folds
these signals into one named state (``connecting``, ``mjpeg-placeholder``,
``mse-playing``, ``mjpeg``, ``no-video``) that the render branches read.

go2rtc fails in three ways, and each latches ``go2rtcFailed``, which flips
``effectiveStreamingMethod`` to ``mjpeg`` for this player:

1. **The hook reported an error.** Any ``state === 'error'`` demotes on the next
   effect run. Usually the WebSocket never opened: ``video-rtc``'s ``onclose``
   fires while ``wsConnectedRef`` is still false. The hook also sets that state
   when the container ref is missing at connect time, and when building the
   element or its WebSocket URL throws.
2. **Connected, but no frames.** After the hook reports ``connected``, a timer
   of ``GO2RTC_VIDEO_TIMEOUT_S`` (15 seconds) checks the ``<video>`` for real
   dimensions. No dimensions means demote. Dimensions but a paused element means
   autoplay was blocked, so it calls ``play()`` and treats the stream as good.
3. **It froze after playing.** The first two checks stop running once frames
   arrive, so a stream that stalls later (source hiccup, MSE buffer underrun,
   missing keyframe, silent WebSocket stall) would sit frozen forever. A liveness
   check every ``GO2RTC_LIVENESS_CHECK_MS`` (3000 ms) watches ``currentTime``
   advance and ``readyState``. ``GO2RTC_FREEZE_THRESHOLD_S`` (7 seconds) without
   advance counts as a freeze: the hook retries, up to
   ``GO2RTC_MAX_FREEZE_RETRIES`` (2) times, and then demotes to MJPEG. Playing
   healthily for ``GO2RTC_FREEZE_RESET_S`` (60 seconds) after a freeze resets the
   counter, so one hiccup an hour does not permanently cost a monitor its
   hardware-decoded stream.

Failure cache
~~~~~~~~~~~~~

A monitor that fails go2rtc is recorded in a module-level ``Map`` and skipped for
``GO2RTC_RETRY_INTERVAL_MIN`` (5 minutes, declared at the top of
``LiveMonitorPlayer.tsx``). Being module-level, it is shared by every
``LiveMonitorPlayer`` instance and survives in-app navigation. An entry goes away
when ``isGo2rtcCachedFailure`` next reads it past its five-minute TTL and deletes
it, when the recovery paths below delete it, or on a full reload. This is what
stops a montage of twenty monitors from re-attempting a broken stream on every
tile, every time you open the page.

The single-monitor detail view passes ``bypassGo2rtcFailureCache`` so it neither
reads nor writes this cache. Montage opens many connections at once and some fail
under that load, marking those monitors failed. Without the bypass the detail view
would inherit that failure and skip go2rtc, showing the loading placeholder until a reload.
With the bypass the detail view always attempts go2rtc (a single connection
usually succeeds), and a failure there falls back to MJPEG locally without writing
to the montage cache.

Recovery
~~~~~~~~

Two things clear a latched failure. Toggling a monitor back to go2rtc deletes its
cache entry and retries at once. And ``useVisibilityResume``, when the page
returns from the background, resets the freeze counters, clears the latch, and
nudges a retry: the browser suspends video in a backgrounded tab, and the freeze
watchdog would otherwise have spent its retry budget on a stream that was never
actually broken.

Tearing the stream down
-----------------------

Leaving a live view (montage or single monitor) must stop the stream.
``connect()`` sets ``videoRtc.background = true`` so a tile keeps streaming when
the page is hidden: the flag makes ``oninit`` skip the ``visibilitychange``
listener that would otherwise disconnect a backgrounded tab. But the same flag
short-circuits the element's own ``disconnectedCallback``, so teardown is the
hook's job. WebRTC needs extra care: once it wins negotiation, media flows over
the ``RTCPeerConnection`` and the WebSocket is already closed, so closing the
socket alone does nothing.

Scroll-out pausing is a separate flag. ``visibilityThreshold`` defaults to ``0``
and the app never sets it, so tiles keep streaming off-screen too.

``cleanup()`` calls ``destroyVideoRtc()``, which:

- flips ``background`` back to false so DOM removal also triggers native teardown;
- cancels the element's ``reconnectTID``/``disconnectTID`` timers so no scheduled
  reconnect can re-open a socket after the view is gone;
- calls ``ondisconnect()`` (closes the WebSocket and peer connection) and stops
  the video's ``MediaStream`` tracks defensively;
- removes the element from the DOM.

``cleanup()`` also sweeps any stray ``VideoRTC`` left in the container, and
``connect()`` bails when the hook is no longer mounted, so a late ``retry()``
from the visibility resume or freeze watchdog cannot open a socket that nothing
owns. Without this, tiles unmounted in bulk (navigating away from montage) leak
their connections and keep pulling video in the background.

Settings that affect go2rtc
---------------------------

All of these are profile-scoped in ``ProfileSettings`` (``stores/settings.ts``)
and read through the settings store. See
:doc:`03-state-management-zustand` for how the store is subscribed to.

``streamingMethod: StreamingMethod``
  ``'auto' | 'mjpeg'``, default ``'auto'``. There is no ``'webrtc'`` value: the
  Live Streaming settings switch writes ``'auto'`` when on and ``'mjpeg'`` when
  off, and ``'auto'`` means "use go2rtc where the monitor and server support it".

``monitorStreamingOverrides: Record<string, StreamingMethod>``
  Per-monitor override, written by ``MonitorSettingsDialog`` and read by
  ``LiveMonitorPlayer`` ahead of the profile-level setting. Turning go2rtc off for
  one monitor stores ``'mjpeg'`` against its id; turning it back on deletes the
  entry so the monitor inherits the profile setting again.

``webrtcProtocols: WebRTCProtocol[]``
  ``('webrtc' | 'mse' | 'hls')[]``, default all three. This is the list joined
  into ``videoRtc.mode``. The settings UI exposes it as three checkboxes and
  refuses to save an empty list. Unchecking ``webrtc`` leaves MSE to carry the
  stream on its own.

``webrtcUseStun: boolean``
  Default false. Covered under `STUN servers`_ above.

``showProtocolLabel: boolean``
  Default true. Gates the protocol badge everywhere it renders: the monitor detail
  page, montage tiles, ``MonitorCard``, and the dashboard monitor widget. On an
  MJPEG player it reads ``MJPEG``. On a go2rtc player it reads the protocol
  carrying the frames, upper-cased (``MSE``, ``WEBRTC``, ``HLS``), or ``Go2RTC`` while no
  protocol has been reported yet.

``bypassGo2rtcFailureCache`` is not a setting. It is a prop, and only
``MonitorDetail`` passes it.

Video element
-------------

The hook wraps ``video-rtc``'s ``oninit`` to configure the ``<video>`` the moment
the element creates it, and wraps ``onpcvideo`` to re-apply muting after the
element has picked its winning protocol. When WebRTC wins, ``onpcvideo`` calls
``play()``, whose autoplay-rejection handler sets ``this.video.muted = true`` and
retries; an unmuted player would come back muted. Muting is applied at three
points for that reason: on ``oninit``, on ``onpcvideo``, and in an effect when the
``muted`` prop changes.

Native controls are enabled only where ``showControls`` is passed, which today is
only ``MonitorDetail``:

.. code:: typescript

   // hooks/useGo2RTCStream.ts, inside the wrapped oninit
   videoRtc.video.controls = controls;
   videoRtc.video.disablePictureInPicture = true;
   videoRtc.video.playsInline = true;
   if (controls) {
     videoRtc.video.setAttribute('controlsList', 'nodownload noplaybackrate');
     videoRtc.video.addEventListener('click', (e: Event) => e.stopPropagation());
   }

Picture-in-Picture is disabled on the go2rtc ``<video>``, on every platform. The
vendored ``video-rtc.js`` already does this in its own ``oninit``; the hook sets
it again after taking the element over. No comment or commit message in the source
records why, so treat the reason as unknown rather than inferring one. It is not a
blanket app policy: the recorded-event player (``Mp4EventPlayer``) disables PiP
only on Android and drives it through ``PipContext`` everywhere else. The click
handler stops propagation so that using the controls in montage does not also
navigate to monitor detail.

Snapshots come from the same element. ``LiveMonitorPlayer`` publishes it through
``externalMediaRef``, and ``downloadSnapshotFromElement`` draws an
``HTMLVideoElement`` onto a canvas and exports a JPEG. The canvas is not
cross-origin tainted here: the ``<video>`` is fed by a ``MediaStream`` or an MSE
buffer, not by a remote URL. A black snapshot means no decoded frames, not CORS.
(``wrapWithImageProxyIfNeeded`` in ``lib/zm/proxy-utils.ts`` applies to
URL-based downloads, and only when ``Platform.shouldUseProxy`` is true, which is
dev-mode web.) See :doc:`12-shared-services-and-components` for the download
service.

Type definitions
----------------

On ``Monitor`` (``api/types.ts``, validated by ``MonitorSchema``):

.. code:: typescript

   RTSPStreamName: z.string().nullable(),
   StreamChannel: z.string().nullable().optional(),
   Go2RTCEnabled: z.coerce.boolean().optional().default(false),
   RTSP2WebEnabled: z.coerce.boolean().optional().default(false),
   JanusEnabled: z.coerce.boolean().optional().default(false),

Only ``Go2RTCEnabled`` and ``StreamChannel`` are read by the app.
``RTSPStreamName``, ``RTSP2WebEnabled``, and ``JanusEnabled`` are parsed because
ZoneMinder returns them; there is no RTSP2Web or Janus support and none is
planned.

On ``Profile``:

.. code:: typescript

   go2rtcUrl?: string; // ZM_GO2RTC_PATH from server config (full URL)

Security
--------

**Authentication.** ``getGo2RTCWebSocketUrl`` accepts a ``token`` option and
appends it as a query parameter, but ``LiveMonitorPlayer`` does not pass one.
ZoneMinder authenticates the go2rtc WebSocket through credentials embedded in
``ZM_GO2RTC_PATH`` itself, in the form ``https://user:pass@host/...``. The URL
builder deliberately preserves those rather than stripping them, because
stripping them breaks WebRTC streaming on setups that rely on them.

**Host guard.** ``hardenGo2RTCUrl`` logs a warning via ``log.http`` when a token
*is* attached and the go2rtc hostname differs from the configured portal
hostname, so sending a token to a third-party host leaves a warning in the log.
``LiveMonitorPlayer`` passes ``expectedHost`` (the portal's hostname) for
this check. With no token in play today, the warning does not fire; the guard is
there for when one is.

**Secure context.** WebRTC requires HTTPS or localhost. A page served over HTTPS
cannot open a plaintext ``ws://`` socket, so an ``https`` portal needs an
``https`` ``ZM_GO2RTC_PATH``: the URL builder maps the scheme through, and mixed
content is blocked by the browser, not by the app.

Testing
-------

Unit tests, run with ``npm test`` from ``app/``:

- ``app/src/hooks/__tests__/useGo2RTCStream.test.ts``: connection lifecycle
  (idle, connecting, connected), the connect delay with no per-tile stagger,
  ``pcConfig.iceServers`` being emptied by default and populated when
  ``useStun`` is on, custom protocol order, WebSocket failure producing the error
  state, and teardown (element removed from the DOM, media tracks stopped,
  reconnect timers cancelled).
- ``app/src/lib/zm/__tests__/url-builder.test.ts``: ``getGo2RTCWebSocketUrl``,
  including scheme mapping, path prefixes, trailing slashes, embedded
  credentials, and the cross-host token warning.
- ``app/src/components/monitors/__tests__/LiveMonitorPlayer.test.tsx``: MJPEG
  error recovery, and failure-cache scoping (the detail view does not inherit a
  montage-recorded failure; montage tiles do share the cache).
- ``app/src/components/monitors/__tests__/derivePlayerViewState.test.ts``: the
  view-state table.

There is no go2rtc e2e feature file. ``app/tests/features/montage.feature`` and
``monitor-detail.feature`` exercise ``LiveMonitorPlayer`` but assert nothing about
which protocol carried the video, so protocol negotiation and the fallback paths
are covered by unit tests and manual checks only. See :doc:`06-testing-strategy`.

Troubleshooting
---------------

``log.videoPlayer`` carries the whole decision path.

**A monitor plays MJPEG when it should not.** Look for
``Streaming: MJPEG`` and its context object. It logs
``monitorGo2RTCEnabled``, so a false value there is a ZoneMinder setting, not an
app bug. If that flag is true, check ``profile.go2rtcUrl``: an empty
``ZM_GO2RTC_PATH`` on the server leaves it unset. Then check the profile's
``streamingMethod`` and any per-monitor override.

**It plays MJPEG only in montage.** That is the failure cache. Open the monitor's
detail page (which bypasses the cache) to confirm go2rtc works there, and look
for the log line that recorded the failure: ``Go2RTC error, falling back to
MJPEG``, or ``Go2RTC connected but no video frames, falling back to MJPEG``, or
``Go2RTC stream frozen, max retries reached, falling back to MJPEG``. The cache
entry expires after 5 minutes, or on a full reload.

**The badge reads MSE but I expected WebRTC.** WebRTC did not deliver a video
track, or lost the scoring in ``onpcvideo``, so MSE is carrying the frames. The
badge switches to ``WEBRTC`` only when WebRTC wins. See
`Protocol negotiation runs in parallel`_.

**"Go2RTC WebSocket connection failed".** The socket closed before it opened.
Confirm go2rtc is reachable at ``ZM_GO2RTC_PATH`` from the device (not just from
the server), and that a reverse proxy in front of it forwards WebSocket upgrade
headers on the ``/ws`` path.

**Connected, then falls back after 15 seconds.** The socket opened but no frames
decoded. The stream ``{monitorId}_{channel}`` must exist in go2rtc's config; a
monitor whose ``StreamChannel`` points at a substream the camera does not publish
produces this symptom.

**The stream freezes and recovers, repeatedly.** ``Go2RTC stream frozen, retrying
connection`` is the liveness watchdog retrying. It logs the reason
(``no-advance``, ``readyState``, ``ended``, or ``disconnected``) and how long the
video had been stalled.

**A downloaded snapshot is black.** The ``<video>`` had no decoded frames when the
canvas was drawn. Check ``videoWidth`` on the element. This is not a CORS problem.

References
----------

- `go2rtc <https://github.com/AlexxIT/go2rtc>`__
- `video-rtc.js source <https://github.com/AlexxIT/go2rtc/blob/master/www/video-rtc.js>`__
  (vendored at ``app/src/lib/vendor/go2rtc/video-rtc.js``)
- `WebRTC API <https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API>`__
- `Media Source Extensions <https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API>`__
