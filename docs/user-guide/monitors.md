# Monitors

The Monitors screen shows all cameras configured on your ZoneMinder server. Each monitor is displayed as a card with a live snapshot and status information.

## Monitor Cards

Each card shows:

- **Live snapshot** - A periodically refreshed image from the camera
- **Monitor name** - The name configured in ZoneMinder
- **Function** - The current monitoring mode (Monitor, Modect, Record, etc.)
- **Status** - Whether the monitor is online, in alarm, or offline
- **Event count** - Number of recent events

Tap a card to open the [Monitor Detail](#monitor-detail) view.

On desktop, hovering a monitor card for a moment opens a larger (400px wide) live preview next to the card. The preview uses its own streaming connection that is opened when the preview appears and closed the moment your cursor leaves. The underlying card remains clickable while the preview is visible.

## Filtering Monitors

Use the filter controls at the top of the screen to narrow down which monitors are shown:

- **Groups**: Filter by ZoneMinder monitor groups
- **Status**: Show only monitors in a specific state
- **Search**: Type to filter by monitor name

Filters persist across navigation within the same session.

## Monitor Detail

The detail view for a single monitor provides:

### Live View

A continuous live stream from the camera. The Monitor Detail page always uses streaming — the global *Streaming Mode* setting (Streaming/Snapshot) does not apply here, since you have opened a single camera at full attention. The connection is closed (`CMD_QUIT` sent to ZoneMinder) when you leave the page.

The actual transport depends on your server:

- **Go2RTC streaming** — used when Go2RTC is configured on your server and enabled for the monitor. The app tries WebRTC, MSE, and HLS in parallel and uses whichever produces video first.
  - WebRTC (lowest latency)
  - MSE (Media Source Extensions)
  - HLS (HTTP Live Streaming)
- **MJPEG streaming** — used when Go2RTC is disabled, unsupported, or fails. Continuous Motion JPEG via ZoneMinder's ZMS.

If Go2RTC connects but no video frames appear within 8 seconds, the app automatically falls back to MJPEG. Monitors that fail Go2RTC are cached for 5 minutes before the app retries Go2RTC on them.

The protocol label (enabled in {doc}`settings`) shows which streaming protocol is active on each feed. The Monitor Detail page also shows native video controls (play, pause, volume) for Go2RTC streams.

For tile views (Monitors list, Montage, Dashboard widgets), the *Streaming Mode* setting does apply — see {doc}`settings` for details.

#### Per-Monitor Override

You can force MJPEG for individual monitors via the monitor's Settings dialog (Video tab). When Go2RTC is enabled for a monitor, a toggle appears to turn it off for that monitor only. See {doc}`settings` for details.

### PTZ Controls

If the monitor has PTZ (Pan-Tilt-Zoom) configured in ZoneMinder, directional controls appear below the live view. Use these to pan, tilt, and zoom the camera.

### Recent Events

A list of recent events for this specific monitor, with thumbnails and timestamps.

### Monitor Info

Technical details about the monitor configuration (resolution, source type, function, etc.).

## Monitor Status Indicators

| Status | Meaning |
|--------|---------|
| Green | Monitor is online and functioning |
| Red | Monitor is in alarm state |
| Gray | Monitor is disabled or offline |
| Orange | Monitor is in an error state |

## Refresh Rate

Monitor snapshots refresh automatically. The interval depends on your bandwidth setting:

- **Normal mode**: Every 10 seconds
- **Low bandwidth mode**: Every 30 seconds

See {doc}`settings` to configure bandwidth mode.
