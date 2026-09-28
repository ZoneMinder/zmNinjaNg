# Settings

The Settings page has six sections: General, Live Streaming, Events & Playback, Network, Ninjii (Beta) - AI chatbot, and More settings. Each section heading collapses. Click or tap a heading to fold that section away, and the app remembers which sections you left closed. All sections start open.

To find a setting, tap the search icon at the top right of the page and type part of its name, its description, or its current value. Only the matching settings stay on screen, including ones in sections you have collapsed and in folded rows such as Previews or Advanced streaming. Typing a section's name shows that whole section, and with a group selected, typing a server's name shows every setting for that server. Tap the X or press Esc to clear the search. The sections you collapsed are still collapsed afterwards.

## Your settings and server settings

Most sections have two parts. The rows at the top are about how you use the app, such as the theme or whether video opens in fullscreen. The rows after them are one server's settings, such as how it sends video. The whole Ninjii section is server settings.

With one profile (one saved server) selected, both parts save to that profile and read as one list, with no server name and no picker.

With a Virtual Profile Group selected, such as the built-in All Servers:

- A **Profile** picker sits at the top of the page, above General. A thin line marked **For** and the server's name shows where each section's server rows start. The picker chooses which server those rows show and edit. It starts on the first server in the group. The picker stays visible while you search.
- The rows above the server rows save to the group itself. A group keeps its own copy of these settings, starting from the defaults, so a change you make here applies while that group is selected. Only the server rows change a member server's settings.
- Live Streaming ends with a few more rows, marked **For** and the group's name, for settings that only exist in a group. See [In a Virtual Profile Group](#settings-group-streaming-mode) and [Group performance](#group-performance).

A few settings apply to the whole app on this device, whichever profile or group is selected: **Language**, **Kiosk PIN**, and **Show developer notices**.

## General

| Setting | Description |
|---------|-------------|
| **Language** | Interface language (English, German, Spanish, Persian, French, Italian, Chinese, Russian). |
| **Theme** | Light, Cream, Dark, Slate, Amber, or System (follows the device setting). This is the same choice as the theme button in the sidebar, so changing one changes the other. See {doc}`getting-started`. |
| **Start Screen** | Which screen the app opens on: Last used, Dashboard, Monitors, Montage, Live Activity, Events, or Timeline. Last used is the default and reopens the page you left, down to a specific monitor or event. Each server and each group remembers its own choice. |
| **Date Format** | How dates are displayed throughout the app. Pick a preset or Custom to type your own pattern. |
| **Time Format** | 12-hour or 24-hour clock, or Custom. |
| **Previews** | Which screens show an enlarged live or event preview on hover (long-press on mobile), and how fast event previews play. Folded by default. See [Previews](#previews). |
| **Insomnia** | Keeps the screen awake while viewing. This is the same setting as the Insomnia toggle in the sidebar. |
| **Fullscreen when turned sideways** | Phones and tablets only. On by default. See [Fullscreen when turned sideways](#fullscreen-when-turned-sideways). |
| **TV mode** | Larger touch targets and D-pad/remote navigation for TV and set-top devices. See [TV mode](#tv-mode). |
| **Kiosk PIN** | Set, change, or clear the PIN that locks kiosk mode. See [Kiosk PIN](#kiosk-pin). |
| **Show developer notices** | Shows maintainer announcements in the app. |
| **Log level** | DEBUG, INFO, WARN, or ERROR. The lowest level of entry the app records. Changing it also clears every component level below it. This is the same setting as the level picker on the Logs page. See {doc}`logs`. |
| **Component Logs** | Folded by default. Its summary shows the log level and how many components are set differently. Open it to give one component its own level (DEBUG, INFO, WARN, ERROR, or NONE). **Reset** puts every component back on the log level. |
| **Disable Log Redaction** | Shows passwords and tokens in logs instead of scrubbing them. An orange warning shows while it is on. Turn it off when you are done. See [What gets redacted](logs.md#what-gets-redacted). |

The server rows under General hold **Hidden Monitors**. See [Hidden Monitors](#hidden-monitors).

### Previews

Previews enlarge a feed or event in place when you hover over it on desktop, or long-press it on mobile. Each screen has its own checkbox, so you can turn previews on only where you want them:

- Events (list) and Events (grid)
- Monitors (list) and Monitors (grid)
- Dashboard
- Timeline
- Notifications
- Assistant cards (the event cards under a Ninjii answer)
- Live Activity tiles (off by default: the tile already streams that camera, so the preview opens a second connection for a larger copy)
- Nearby events

The **Playback speed** control (0.5x, 1x, 1.5x, 2x, 4x) sets how fast an event preview plays. Live monitor previews open a fresh stream while the preview is on screen and close it when you move away.

### Fullscreen when turned sideways

When this is on, turning a phone or tablet sideways makes the player fill the screen on a monitor's live view and on event playback. Turning it upright again brings the page back. When it is off, turning the device does not make the player fullscreen. A rotation still cancels a maximize or exit you did with the page's own button, so the page goes back to what your fullscreen settings say.

This switch only covers rotation. **Open live view in fullscreen**, **Open events in fullscreen**, a monitor's own **Open in fullscreen** setting, and the maximize button on the page work whether this switch is on or off. On a desktop computer the setting has no effect.

### TV mode

TV mode adapts the interface for televisions and set-top boxes (for example Fire TV or Android TV). It enlarges touch targets and enables D-pad and remote navigation, so you can move focus and select with a remote instead of a pointer. Turn it on when running zmNinjaNg on a TV; leave it off on phones, tablets, and desktops.

### Kiosk PIN

Manage the PIN used to lock and unlock kiosk mode. See {doc}`kiosk` for full details on kiosk mode.

| Action | Description |
|--------|-------------|
| **Set PIN** | Appears when no PIN is stored. Sets a new 4-digit PIN. |
| **Change PIN** | Requires verifying your current PIN or biometrics before setting a new one. |
| **Clear PIN** | Removes the PIN. Requires verifying the current PIN or biometrics first. |

### Hidden Monitors

Hide monitors you do not want to see. A hidden monitor is removed from the Monitors list, Montage, Dashboard, the Events list, and the Timeline, and its events are hidden too. The list belongs to one server, so hiding a monitor on one server does not affect another.

The button on the **Hidden Monitors** row opens a list of every monitor on the server, including ones you have already hidden, each with a checkbox. Tick a monitor to hide it; clear the tick to restore it. The button shows how many monitors are currently hidden.

Hiding a monitor does not change anything on the ZoneMinder server. It only controls what this app shows.

## Live Streaming

| Setting | Description |
|---------|-------------|
| **Monitors per page** | How many monitors the Montage and the Monitors screen show at once, with arrows to step through the pages (0 turns paging off, the default; presets 6/12/24). Useful with many monitors (over 30) when the server has no multi-port streaming. See [Paging a long list](montage.md#paging-a-long-list). |
| **Skip offline monitors** | Monitors whose capture or function is set to None are left out of the grid, the montage, and live-view swiping. |
| **Open live view in fullscreen** | Every monitor's detail page opens maximized. For one monitor only, use **Open in fullscreen** in that monitor's Settings dialog instead. |

The server rows under Live Streaming set how that server sends live video:

| Setting | Description |
|---------|-------------|
| **Streaming Mode** | *Streaming* delivers continuous video. *Snapshot* fetches a periodic still image instead, with lower bandwidth and a lower frame rate. See [Streaming Mode](#streaming-mode). |
| **Refresh Interval** | Shown only in Snapshot mode. How often to refresh the still image (1 to 30 seconds, default 3; presets 1/3/5). |
| **Stream FPS** | Maximum frame rate for live MJPEG streams (1 to 30 fps, default 10; presets 5/10/15/30). Lower values reduce bandwidth and CPU. |
| **Stream Scale** | Server-side scaling applied to MJPEG frames before they are sent (10 to 100%, default 50; presets 25/50/75/100). Lower values reduce bandwidth. |
| **Advanced streaming** | Folded by default. Holds the five rows below. |
| **Enable WebRTC/HLS/MSE** | When on, the app tries WebRTC, MSE, and HLS through go2rtc for each monitor and falls back to MJPEG. When off, all monitors on this server use MJPEG. |
| **Streaming Protocols** | WebRTC, MSE, and HLS, tried in parallel when go2rtc is configured. The first protocol to produce video wins. |
| **STUN Servers** | Enable only when you reach go2rtc directly over the internet. Leave it off on a LAN or VPN. |
| **Protocol Label** | Shows or hides the streaming protocol indicator (MJPEG/MSE/WebRTC) on this server's video feeds. |
| **Force disable multi-port streaming** | Off by default: when the server reports `ZM_MIN_STREAMING_PORT`, the app routes each monitor to its own port (`base port + monitor ID`). Turn this on to ignore that config and use the portal's default port for all streams. Use it when the per-monitor ports are not reachable (firewall, reverse proxy, or partial server config). |

With one profile selected, switching **Bandwidth Mode** (under Network) resets Stream FPS, Stream Scale, and Refresh Interval to that mode's defaults.

### Streaming Protocols

When WebRTC/HLS/MSE is enabled, zmNinjaNg tries WebRTC, MSE, and HLS in parallel. The first protocol to produce video wins and is used for the stream. If all go2rtc protocols fail, the app falls back to MJPEG via ZoneMinder's ZMS. The protocol label (when enabled) shows which protocol is active on each feed.

### Streaming Mode

The Streaming Mode toggle picks how live MJPEG feeds are fetched:

- **Streaming**: continuous MJPEG over a single open connection at the configured FPS. Smooth motion, higher bandwidth and CPU.
- **Snapshot**: a single JPEG fetched every *Refresh Interval* seconds. Lower bandwidth and CPU, choppier motion.

Streaming Mode interacts with the streaming protocol layer. When a monitor uses go2rtc (WebRTC/MSE/HLS), it always delivers continuous video, and the Streaming Mode setting is ignored for that monitor. The setting only changes behavior on the MJPEG path: when WebRTC/HLS/MSE is disabled for the server, when it is disabled for the monitor, or when go2rtc fails and the app falls back to MJPEG.

#### What a new profile starts with

A new profile picks its Streaming Mode from the server it just connected to:

- **5 or fewer monitors**: **Streaming**. A browser or app webview keeps only about 6 connections open to one server, so up to 5 live feeds fit with one connection left for the app's other requests.
- **Multi-port streaming configured** (`ZM_MIN_STREAMING_PORT`): **Streaming**, whatever the monitor count. Each camera streams on its own port, so the per-server connection limit no longer applies.
- **6 or more monitors and no multi-port streaming**: **Snapshot**. Streaming that many feeds would stall after the first few; snapshot mode fetches a still on an interval instead of holding a connection, so every tile keeps updating.

Snapshot mode needs a decoded image waiting on the server. For a monitor whose *Decoding* is *On demand*, ZoneMinder stops decoding about ten seconds after the last viewer, so the app asks such monitors for their stills in a way that counts as watching and keeps them decoding. That request is heavier on the server, and on a large montage of *On demand* cameras it makes tiles fill slowly. Monitors set to *Always*, *KeyFrames* or *KeyFrames + On demand* always have a recent picture decoded, so they get the light request; with the two keyframe settings the still advances one keyframe at a time. That request only exists in ZoneMinder 1.37.61 and later. On older servers a monitor set to *On demand* decoding freezes its snapshot tile on one frame: set it to *Decoding: Always*, or use Streaming mode for it.

The count is the monitors the app shows for that server: deleted and hidden monitors are left out, disabled ones still count because they still get a tile. If the app cannot list the monitors on first connect, the mode stays at Snapshot until a later connect can decide. A profile with *Force disable multi-port streaming* on (Live Streaming, under Advanced streaming) is treated as if the server had none.

The row shows which mode is recommended for the server and a line explaining why. The recommendation is only the starting value: changing the toggle overrides it for that profile, and no later connection changes it back.

(settings-group-streaming-mode)=

#### In a Virtual Profile Group

With a group selected, the Streaming Mode toggle in the server rows belongs to the server chosen in the Profile picker. The group's own rows, after the server rows and marked with the group's name, include a separate Streaming Mode row with three options: **Per server** (the default, each server's tiles follow that server's own toggle), **Streaming**, and **Snapshot**. The last two impose one choice on every tile in the group for as long as the group is selected. Neither changes any server's own setting, and neither carries over to another group.

(connection-limits-by-platform)=

#### Connection limits by platform

How a live MJPEG feed reaches the screen differs by platform, and that decides whether the per-server stream limit applies:

| Platform | How live feeds load | ~6 simultaneous live streams limit? |
|----------|---------------------|-------------------------------------|
| Web browser | Loaded directly from ZoneMinder by the browser | Yes, about 6 per server |
| Android | Loaded directly through the app WebView | Yes, about 6 per server |
| iOS / iPadOS | Loaded directly through the app WebView | Yes, about 6 per server |
| Desktop (Windows, macOS, Linux) | Read natively by the app, not through the webview | No limit |

:::{note}
On **iOS, Android, and the web app**, a ZoneMinder server keeps only about 6 live streams open at a time, so a montage with more than ~6 live tiles stalls after the first few. To show more than 6 live feeds at once, either keep **Snapshot** mode (which fetches a still on an interval instead of holding a connection) or enable multi-port streaming on the server by setting `ZM_MIN_STREAMING_PORT`. That spreads each camera across a different port, so the limit no longer applies. On **desktop** the app reads feeds natively, so this limit never applies. See [Multi-Server](#multi-server).
:::

#### Where Streaming Mode applies

| View | Affected? | Behavior |
|------|-----------|----------|
| Monitors list (grid/list of tiles) | Yes | Each tile honors its server's setting, or the group's Streaming Mode when a group imposes one (see [In a Virtual Profile Group](#settings-group-streaming-mode)). WebRTC tiles always stream; MJPEG tiles follow Streaming Mode. |
| Montage page | Yes | Same as Monitors list, per-tile behavior. |
| Dashboard monitor widgets | Yes | Each widget honors its server's setting, or the group's Streaming Mode when a group imposes one. |
| **Monitor Detail page** (single monitor view) | **No, always streams** | This page ignores Streaming Mode and always uses continuous video. The stream is closed (`CMD_QUIT` sent to ZoneMinder) when you leave the page. |
| Hover-preview popovers (over a monitor card) | No, always streams | Hardcoded to streaming for the brief time the popover is open. |
| Event playback (Event Detail, Timeline previews) | Not applicable | These play recorded video, not live feeds. |
| Notification thumbnails | Not applicable | Static event images, not live streams. |

#### Why Monitor Detail always streams

You opened one camera deliberately, so the bandwidth tradeoff that justifies Snapshot mode in dense grids does not apply. The page also tears the stream down on exit, so honoring snapshot mode here would add latency without saving bandwidth.

### Per-Monitor Streaming Override

The server's **Enable WebRTC/HLS/MSE** setting is the default for its monitors. To override it for a single monitor, open the monitor's Settings dialog (Video tab). When a monitor has go2rtc enabled, a Go2RTC toggle appears. Turning it off forces MJPEG for that monitor only, leaving other monitors unaffected.

### Group performance

With a Virtual Profile Group selected, the group's rows under Live Streaming also include a folded row named after the group, for example *All Servers performance*. Every setting in it governs the combined view rather than one server, and its values belong to that group. Each row shows its default, and a reset button appears once you change it.

Combining several servers multiplies work that one server does once: every tile is a separate live connection, and every watched camera is a separate request on every poll. The values that suit you depend on how many servers you combine and what your network and servers will take.

| Setting | Default | What it does |
|---|---|---|
| **Maximum live streams** | 16 | Tiles the montage opens across every server at once. The slots are shared out evenly, so a server with many cameras cannot take the whole budget and leave another with none. The rest collapse into an overflow notice at the top of the grid. |
| **Monitors watched for alarms** | 24 | Cameras {doc}`live-activity` polls across every server, drawn evenly from each so one busy server can't crowd the rest out. |
| **Fastest alarm polling** | 10 seconds | A floor under the Live Activity check interval while a group is selected. A slower interval set on that page still applies; this only stops the combined poll running faster than this. |
| **Notification grouping** | 3 seconds | Events arriving from different servers within this window collapse into one summary notification instead of one each. |
| **Stream tuning** | Off | On *Reduced*, montage tiles ask their server for 5 frames a second at quarter scale instead of what that server normally sends. A server you have already set lower than that keeps its own values, so this only ever asks for less. go2rtc tiles are unaffected. |
| **Pause hidden streams** | Off | Stops montage streams once the app has been in the background, or the window minimized, for 30 seconds, including when it opens that way. They come back when you do. A window merely covered by another window still counts as visible. |
| **Pause off-screen tiles** | Off | Stops a montage tile once it has been scrolled a screen's worth past the edge of the grid, and starts it again as it comes back. The limit above still decides which cameras are on the page, so scrolling never brings an overflow camera in. |
| **Idle timeout** | 0 (never) | Drops montage tiles to periodic snapshots after this many minutes with no touch, click or keypress. Any interaction puts them back on live streams, as does returning to the app. This runs whether or not *Insomnia* is on, which is the case it exists for. |

None of these change any server's own settings. With one profile selected the group rows do not appear, since a single server has nothing to combine.

## Events & Playback

| Setting | Description |
|---------|-------------|
| **Events Per Page** | How many events to load per page on the Events screen (10 to 1000, default 100; presets 100/300/500). |
| **Event Video Autoplay** | Start video playback automatically when opening the Event Detail page. |
| **Open events in fullscreen** | Play event video fullscreen as soon as the Event Detail page opens. Going fullscreen on the player itself lasts only for that event. |
| **Recent events on monitor** | How many recent events a monitor's live view lists under the video (1 to 50, default 20; presets 10/20/50). |
| **Nearby events** | The default time window and cameras for nearby events. See [Nearby](events.md#nearby). |

The server rows under Events & Playback hold **Event thumbnails**.

### Event thumbnails

Event thumbnails can come from different frame types in ZoneMinder: `alarm` (first alarmed frame), `snapshot` (representative frame), `objdetect` (object-detection frame from zmeventnotification), or a custom frame ID. Different ZoneMinder setups populate different frame types depending on motion and ML configuration, so a single fixed choice leaves some users with missing images. Because this depends on the server, each server keeps its own order.

The **Event thumbnails** row folds open to let you pick the order in which the app tries each frame type. Each row has up and down arrows to move it, a checkbox to enable it, and the frame type label. The last row is a custom slot where you can type any frame ID your setup uses (for example `1` for the first frame). Disabled rows and empty custom rows are skipped.

When a thumbnail loads successfully, the winning frame type is cached for the session so the app doesn't re-try earlier entries for the same event. If every entry fails, a placeholder image is shown. The app never flashes a broken-image icon: the thumbnail area stays blank until a frame succeeds or the list runs out.

The setting applies to every thumbnail surface in the app: events list, event montage, event detail hero, timeline scrubber, timeline preview popover, and notification history. Each event's thumbnail follows the order set for the server that recorded it.

## Network

| Setting | Description |
|---------|-------------|
| **Bandwidth Mode** | *Normal* or *Low*. Controls how often the app fetches data. See [Bandwidth Mode](#bandwidth-mode). |

The server rows under Network set how the app reaches that server:

| Setting | Description |
|---------|-------------|
| **Allow Self-Signed Certificates** | Shown only when the Portal URL uses HTTPS. Enable when your ZoneMinder server uses a self-signed certificate. On native platforms (iOS/Android/desktop) the app pins the certificate fingerprint on first connection; toggling this off and back on lets you re-pin. |
| **API timeout** | Seconds to wait for a server API request before it is aborted, so a stalled request errors and retries instead of leaving a screen stuck loading. Default 15. Set `0` to disable the timeout (wait forever). Does not apply to downloads. |

### Bandwidth Mode

Bandwidth Mode controls how often the app fetches data.

| Mode | Description |
|------|-------------|
| **Normal** | Standard refresh intervals (10 to 30 seconds depending on the data type) |
| **Low** | Reduced refresh rates (2x slower) and lower image quality |

Low bandwidth mode affects:

- Monitor snapshot refresh rate
- Dashboard widget refresh intervals
- Event list polling
- Timeline/heatmap data loading
- Image quality and scale

Dashboard widgets have no refresh setting of their own. They refresh on the Bandwidth Mode schedule; see {doc}`dashboard`.

With one profile selected, switching the mode also resets that profile's Stream FPS, Stream Scale, and Refresh Interval (under Live Streaming) to the mode's defaults. With a Virtual Profile Group selected, the mode belongs to the group and switching it leaves every server's stream values alone.

:::{tip}
Switch to **Low** when on mobile data or a slow connection. You can switch back to Normal when on WiFi.
:::

## Ninjii (Beta) - AI chatbot

Enable and configure Ninjii, the chat assistant that answers questions about your cameras and events. It is read-only: it can look things up and take you to a screen, and cannot arm a monitor, change the run state, or delete an event. The model runs either on your device or on an Ollama server you run yourself. The whole section is server settings, so each server has its own Ninjii settings. See {doc}`assistant` for the full guide, including the backend choice, the advanced dials, and what stays on your device.

## More settings

This section has one link, to the **Notifications** page, which keeps its own settings for how zmNinjaNg handles event notifications. See {doc}`notifications`.

## Multi-Server

zmNinjaNg detects multi-server ZoneMinder setups via the `/servers.json` API endpoint. Single-server setups are unaffected.

In a multi-server setup:

- Each monitor's ServerId is mapped to the correct server for streaming, daemon checks, and event images
- All API calls, ZMS streams, and portal URLs route to the appropriate server
- Multi-port streaming (`ZM_MIN_STREAMING_PORT`) is automatically applied to per-monitor URLs

For the full Server page (version, load, disk usage, daemon state, per-server metrics, storage areas, and run-state control), see {doc}`server`.
