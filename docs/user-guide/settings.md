# Settings

Settings are stored per profile. Each ZoneMinder server profile has its own independent settings.

## Appearance

| Setting | Description |
|---------|-------------|
| **Language** | Interface language (English, German, Spanish, French, Chinese) |
| **Theme** | Light, Cream, Dark, Slate, Amber, or System (follows system setting by default). The quick toggle is in the sidebar; see {doc}`getting-started`. |
| **Date format** | How dates are displayed throughout the app |
| **Time format** | 12-hour or 24-hour clock |
| **TV mode** | Larger touch targets and D-pad/remote navigation for TV and set-top devices. See [TV mode](#tv-mode). |
| **Thumbnail display** | Order of frame types to try when loading event thumbnails |
| **Hover preview** | Where an enlarged live or event preview appears on hover (long-press on mobile). See [Hover preview](#hover-preview). |

### Thumbnail display

Event thumbnails can come from different frame types in ZoneMinder: `alarm` (first alarmed frame), `snapshot` (representative frame), `objdetect` (object-detection frame from zmeventnotification), or a custom frame ID. Different ZoneMinder setups populate different frame types depending on motion and ML configuration, so a single fixed choice leaves some users with missing images.

The **Thumbnail display** setting lets you pick the order in which the app tries each frame type. Each row has a drag position (up/down arrows), an enable toggle, and the frame type label. The last row is a custom slot where you can type any frame ID your setup uses (for example `1` for the first frame). Disabled rows and empty custom rows are skipped.

When a thumbnail loads successfully, the winning frame type is cached for the session so the app doesn't re-try earlier entries for the same event. If every entry fails, a placeholder image is shown. At no point does the app flash a broken-image icon, the thumbnail area stays blank until a frame succeeds or the chain is exhausted.

The setting applies to every thumbnail surface in the app: events list, event montage, event detail hero, timeline scrubber, timeline preview popover, and notification history.

### TV mode

TV mode adapts the interface for televisions and set-top boxes (for example Fire TV or Android TV). It enlarges touch targets and enables D-pad and remote navigation, so you can move focus and select with a remote instead of a pointer. Turn it on when running zmNinjaNg on a TV; leave it off on phones, tablets, and desktops.

### Hover preview

Hover preview enlarges a feed or event in place when you hover over it on desktop, or long-press it on mobile. Each surface has its own toggle, so you can enable previews only where you want them:

- Events list and Events grid
- Monitors list and Monitors grid
- Dashboard
- Timeline
- Notifications

The **playback speed** control (0.5x, 1x, 1.5x, 2x, 4x) sets how fast an event preview plays. Live monitor previews open a fresh stream while the preview is on screen and close it when you move away.

## Hidden Monitors

Hide monitors you do not want to see in this profile. A hidden monitor is removed from the Monitors list, Montage, Dashboard, the Events list, and the Timeline, and its events are hidden too. The setting is per profile, so hiding a monitor in one profile does not affect another.

The **Hidden Monitors** section lists every monitor on the server, including ones you have already hidden, each with a toggle. Turn a toggle on to hide that monitor; turn it off to restore it. The count at the top of the section shows how many monitors are currently hidden.

Hiding a monitor does not change anything on the ZoneMinder server. It only controls what this app shows for the current profile.

## Bandwidth Settings

Control how often the app fetches data. Useful on mobile data or slow connections.

| Mode | Description |
|------|-------------|
| **Normal** | Standard refresh intervals (10–30s depending on the data type) |
| **Low** | Reduced refresh rates (2x slower) and lower image quality |

Low bandwidth mode affects:

- Monitor snapshot refresh rate
- Dashboard widget refresh intervals
- Event list polling
- Timeline/heatmap data loading
- Image quality and scale

:::{tip}
Switch to **Low bandwidth mode** when on mobile data or a slow connection. You can switch back to Normal when on WiFi.
:::

## Live Streaming

Settings that control live camera feeds:

| Setting | Description |
|---------|-------------|
| **Streaming Mode** | *Streaming* delivers continuous video. *Snapshot* fetches a periodic still image instead, lower bandwidth, lower frame rate. See [Streaming Mode](#streaming-mode) below for where this setting applies. |
| **Enable Go2RTC** | When on, the app tries WebRTC/MSE/HLS for each monitor and falls back to MJPEG. When off, all monitors use MJPEG. |
| **Streaming Protocols** | WebRTC, MSE, and HLS, tried in parallel when Go2RTC is configured. The first protocol to produce video wins. |
| **Snapshot interval** | How often to refresh the still image when Streaming Mode is set to *Snapshot* (1–30 seconds) |
| **Protocol Label** | Shows or hides the streaming protocol indicator (MJPEG/MSE/WebRTC) on video feeds across all pages |
| **Stream FPS** | Maximum frame rate for live MJPEG streams (1–30 fps, default 10; presets 5/10/15/30). Lower values reduce bandwidth and CPU. |
| **Stream Scale** | Server-side scaling applied to MJPEG frames before they are sent (10–100%, default 50; presets 25/50/75/100). Lower values reduce bandwidth. |

Switching to **Low bandwidth mode** resets Stream FPS, Stream Scale, and Snapshot interval to lower defaults.

### Streaming Protocols

When Go2RTC is enabled, zmNinjaNg tries WebRTC, MSE, and HLS in parallel. The first protocol to produce video wins and is used for the stream. If all Go2RTC protocols fail, the app falls back to MJPEG via ZoneMinder's ZMS. The protocol label (when enabled) shows which protocol is active on each feed.

You can configure which protocols to try in the Go2RTC protocol settings.

### Streaming Mode

The Streaming Mode toggle picks how live MJPEG feeds are fetched:

- **Streaming**: continuous MJPEG over a single open connection at the configured FPS. Smooth motion, higher bandwidth and CPU.
- **Snapshot**: a single JPEG fetched every *Snapshot interval* seconds. Lower bandwidth and CPU, choppier motion.

Streaming Mode interacts with the streaming protocol layer. When a monitor uses Go2RTC (WebRTC/MSE/HLS), it always delivers continuous video, the Streaming Mode setting is ignored for that monitor. The setting only changes behavior on the MJPEG path: either when Go2RTC is disabled globally, when it is disabled per-monitor, or when Go2RTC fails and the app falls back to MJPEG.

#### Default per device

A new profile picks a default based on the platform:

- **Phone, tablet, and web app**: default is **Snapshot**. The browser or app webview holds only about 6 live connections open to one server at a time, so a montage full of Streaming tiles stalls after the first few. Snapshot mode fetches a still on an interval instead of holding a connection, so every tile keeps updating no matter how many cameras are on screen.
- **Desktop app**: default is **Streaming**. The desktop app reads each MJPEG feed natively rather than through the webview, so the per-server connection limit does not apply and a montage can stream many cameras at once.

Changing the Streaming Mode toggle overrides the default for that profile.

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
On **iOS, Android, and the web app**, a ZoneMinder server keeps only about 6 live streams open at a time, so a montage with more than ~6 live tiles stalls after the first few. To show more than 6 live feeds at once, either keep **Snapshot** mode (the default on these platforms, which fetches a still on an interval instead of holding a connection) or enable multi-port streaming on the server by setting `ZM_MIN_STREAMING_PORT`. That spreads each camera across a different port, so the limit no longer applies. On **desktop** the app reads feeds natively, so this limit never applies. See [Multi-Server](#multi-server).
:::

#### Where Streaming Mode applies

| View | Affected? | Behavior |
|------|-----------|----------|
| Monitors list (grid/list of tiles) | Yes | Each tile honors the global setting. WebRTC tiles always stream; MJPEG tiles follow Streaming Mode. |
| Montage page | Yes | Same as Monitors list, per-tile behavior. |
| Dashboard monitor widgets | Yes | Each widget honors the global setting. |
| **Monitor Detail page** (single monitor view) | **No, always streams** | This page ignores Streaming Mode and always uses continuous video. The stream is closed (`CMD_QUIT` sent to ZoneMinder) when you leave the page. |
| Hover-preview popovers (over a monitor card) | No, always streams | Hardcoded to streaming for the brief time the popover is open. |
| Event playback (Event Detail, Timeline previews) | Not applicable | These play recorded video, not live feeds. |
| Notification thumbnails | Not applicable | Static event images, not live streams. |

#### Why Monitor Detail always streams

You opened one camera deliberately, so the bandwidth tradeoff that justifies Snapshot mode in dense grids does not apply. The page also tears the stream down on exit, so honoring snapshot mode here would just add latency without saving bandwidth.

### Per-Monitor Streaming Override

The global Go2RTC setting acts as the default for all monitors. To override it for a single monitor, open the monitor's Settings dialog (Video tab). When a monitor has Go2RTC enabled, a Go2RTC toggle appears. Turning it off forces MJPEG for that monitor only, leaving other monitors unaffected.

## Playback

Settings that affect event video playback and dashboard refresh:

| Setting | Description |
|---------|-------------|
| **Event autoplay** | Start video playback automatically when opening the Event Detail page |
| **Events per page** | How many events to load per page on the Events screen (10–1000, presets at 100/300/500) |
| **Dashboard refresh interval** | How often the dashboard widgets reload data (5–300 seconds, presets at 10/30/60) |

## Notification Settings

Configure how zmNinjaNg handles event notifications. See {doc}`notifications` for details.

## Advanced

The Advanced section is a single flat section containing the following controls (no subsection headings in the UI):

| Setting | Description |
|---------|-------------|
| **Allow self-signed certificates** | Shown only when the Portal URL uses HTTPS. Enable when your ZoneMinder server uses a self-signed certificate. On native platforms (iOS/Android/desktop) the app pins the certificate fingerprint on first connection; toggling this off and back on lets you re-pin. |
| **Disable log redaction** | Stop redacting URLs and credentials from logs. Enable only temporarily when sharing logs for troubleshooting. |
| **Auto-restart** (desktop only) | The desktop app's webview accumulates memory over long sessions that only a restart reclaims, so this is **on by default**: it restarts the app automatically on an interval, in minutes (default 120, minimum 1). Turn it off to disable. A **Restart now** button next to it restarts immediately. The window size and position are preserved across the restart. |
| **Component Logs** (collapsible) | Sets the global log level (the floor for everything) and per-component overrides. Includes a Reset button to clear all per-component overrides. |

For information about persistent log files, file locations, and the Share / Open / Clear buttons, see {doc}`logs`.

### Kiosk PIN

Manage the PIN used to lock and unlock kiosk mode. See {doc}`kiosk` for full details on kiosk mode.

| Action | Description |
|--------|-------------|
| **Set PIN** | Appears when no PIN is stored. Sets a new 4-digit PIN. |
| **Change PIN** | Requires verifying your current PIN or biometrics before setting a new one. |
| **Clear PIN** | Removes the PIN. Requires verifying the current PIN or biometrics first. |

## Multi-Server

zmNinjaNg detects multi-server ZoneMinder setups via the `/servers.json` API endpoint. Single-server setups are unaffected.

In a multi-server setup:

- Each monitor's ServerId is mapped to the correct server for streaming, daemon checks, and event images
- All API calls, ZMS streams, and portal URLs route to the appropriate server
- Multi-port streaming (`ZM_MIN_STREAMING_PORT`) is automatically applied to per-monitor URLs

For the full Server page (version, load, disk usage, daemon state, per-server metrics, storage areas, and run-state control), see {doc}`server`.

