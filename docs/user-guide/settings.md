# Settings

Settings are stored per profile. Each ZoneMinder server profile has its own independent settings.

## Appearance

| Setting | Description |
|---------|-------------|
| **Language** | Interface language (English, German, Spanish, French, Chinese) |
| **Theme** | Light, Cream, Dark, Slate, Amber, or System (follows system setting by default) |
| **Date format** | How dates are displayed throughout the app |
| **Time format** | 12-hour or 24-hour clock |
| **Thumbnail display** | Order of frame types to try when loading event thumbnails |

### Thumbnail display

Event thumbnails can come from different frame types in ZoneMinder: `alarm` (first alarmed frame), `snapshot` (representative frame), `objdetect` (object-detection frame from zmeventnotification), or a custom frame ID. Different ZoneMinder setups populate different frame types depending on motion and ML configuration, so a single fixed choice leaves some users with missing images.

The **Thumbnail display** setting lets you pick the order in which the app tries each frame type. Each row has a drag position (up/down arrows), an enable toggle, and the frame type label. The last row is a custom slot where you can type any frame ID your setup uses (for example `1` for the first frame). Disabled rows and empty custom rows are skipped.

When a thumbnail loads successfully, the winning frame type is cached for the session so the app doesn't re-try earlier entries for the same event. If every entry fails, a placeholder image is shown. At no point does the app flash a broken-image icon — the thumbnail area stays blank until a frame succeeds or the chain is exhausted.

The setting applies to every thumbnail surface in the app: events list, event montage, event detail hero, timeline scrubber, timeline preview popover, and notification history.

## Bandwidth Settings

Control how frequently the app fetches data from your server. Useful for mobile data or slow connections.

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
| **Streaming Mode** | *Streaming* delivers continuous video. *Snapshot* fetches a periodic still image instead — lower bandwidth, lower frame rate. See [Streaming Mode](#streaming-mode) below for where this setting applies. |
| **Streaming protocol** | WebRTC (lowest latency), MSE, or HLS — tried in order if go2rtc is configured |
| **Snapshot interval** | How often to refresh the still image when Streaming Mode is set to *Snapshot* (1–30 seconds) |
| **Protocol Label** | Shows or hides the streaming protocol indicator (MJPEG/MSE/WebRTC) on video feeds across all pages |

### Streaming Protocols

When Go2RTC is enabled, zmNinjaNg tries WebRTC, MSE, and HLS in parallel. The first protocol to produce video wins and is used for the stream. If all Go2RTC protocols fail, the app falls back to MJPEG via ZoneMinder's ZMS. The protocol label (when enabled) shows which protocol is active on each feed.

You can configure which protocols to try in the Go2RTC protocol settings.

### Streaming Mode

The Streaming Mode toggle picks how live MJPEG feeds are fetched:

- **Streaming** — continuous MJPEG over a single open connection at the configured FPS. Smooth motion, higher bandwidth and CPU.
- **Snapshot** — a single JPEG fetched every *Snapshot interval* seconds. Lower bandwidth and CPU, choppier motion.

Streaming Mode interacts with the streaming protocol layer. When a monitor uses Go2RTC (WebRTC/MSE/HLS), it always delivers continuous video — the Streaming Mode setting is ignored for that monitor. The setting only changes behavior on the MJPEG path: either when Go2RTC is disabled globally, when it is disabled per-monitor, or when Go2RTC fails and the app falls back to MJPEG.

#### Where Streaming Mode applies

| View | Affected? | Behavior |
|------|-----------|----------|
| Monitors list (grid/list of tiles) | Yes | Each tile honors the global setting. WebRTC tiles always stream; MJPEG tiles follow Streaming Mode. |
| Montage page | Yes | Same as Monitors list — per-tile behavior. |
| Dashboard monitor widgets | Yes | Each widget honors the global setting. |
| **Monitor Detail page** (single monitor view) | **No — always streams** | This page ignores Streaming Mode and always uses continuous video. The stream is closed (`CMD_QUIT` sent to ZoneMinder) when you leave the page. |
| Hover-preview popovers (over a monitor card) | No — always streams | Hardcoded to streaming for the brief time the popover is open. |
| Event playback (Event Detail, Timeline previews) | Not applicable | These play recorded video, not live feeds. |
| Notification thumbnails | Not applicable | Static event images, not live streams. |

#### Why Monitor Detail always streams

When you tap a single monitor for full-screen viewing you have explicitly asked for one camera at full attention, so the bandwidth tradeoff that justifies Snapshot mode in dense grids does not apply. The page also tears the stream down on exit, so leaving snapshot mode running there would just add latency without saving bandwidth.

### Per-Monitor Streaming Override

The global Go2RTC setting acts as the default for all monitors. To override it for a single monitor, open the monitor's Settings dialog (Video tab). When a monitor has Go2RTC enabled, a Go2RTC toggle appears. Turning it off forces MJPEG for that monitor only, leaving other monitors unaffected.

## Playback

Settings that affect event video playback:

| Setting | Description |
|---------|-------------|
| **Dashboard refresh interval** | How often the dashboard widgets reload data (5–300 seconds) |

## Notification Settings

Configure how zmNinjaNg handles event notifications. See {doc}`notifications` for details.

## Advanced

### Connection

| Setting | Description |
|---------|-------------|
| **Allow self-signed certificates** | Enable when your ZoneMinder server uses a self-signed HTTPS certificate (iOS/Android only) |

### Log Redaction

Redact sensitive values (URLs, credentials) from logs. Disable only when sharing logs for troubleshooting.

### Persistent Logs

Log entries that pass your filter settings are written to disk so they survive app restarts:

- **iOS / Android:** in the app's data directory. Use the **Share** button on the Logs page to send the `.log` file via system share sheet.
- **Desktop (Tauri):** at `~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log` (macOS) or the equivalent app-log directory on Windows/Linux. Use the **Open Location** button to reveal it in Finder/Explorer.
- **Web (browser, dev only):** no persistence; the Share button downloads a one-shot text file.

The file is capped at 10,000 entries; the oldest half is dropped automatically when the cap is hit. **Clear** zeros the file and the in-memory buffer.

### Kiosk PIN

Manage the PIN used to lock and unlock kiosk mode. See {doc}`kiosk` for full details on kiosk mode.

| Action | Description |
|--------|-------------|
| **Set PIN** | Appears when no PIN is stored. Sets a new 4-digit PIN. |
| **Change PIN** | Requires verifying your current PIN or biometrics before setting a new one. |
| **Clear PIN** | Removes the PIN. Requires verifying the current PIN or biometrics first. |

## Multi-Server

zmNinjaNg automatically detects multi-server ZoneMinder setups via the `/servers.json` API endpoint. Single-server setups are unaffected — no behavior change occurs.

In a multi-server setup:

- Each monitor's ServerId is mapped to the correct server for streaming, daemon checks, and event images
- All API calls, ZMS streams, and portal URLs route to the appropriate server
- Multi-port streaming (`ZM_MIN_STREAMING_PORT`) is automatically applied to per-monitor URLs

### Server Page

The Server page (accessible from the sidebar) shows all servers in the cluster with per-server status including CPU, memory, and disk usage. Storage areas are displayed with disk usage and their server association.

## Server Information

For single-server setups, the Server screen shows:

- Server version
- API version
- Daemon status

## Resetting Settings

Settings can be reset to defaults from the Settings screen. This affects only the current profile's settings, not your connection details or other profiles.
