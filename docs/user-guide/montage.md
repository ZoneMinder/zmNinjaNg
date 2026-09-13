# Montage

The Montage view shows multiple camera feeds at once in a drag-and-drop grid.

## Toolbar

The toolbar appears above the grid. You can hide or show it using the eye icon in the app header (desktop sidebar or mobile top bar). The toolbar contains:

- **Group filter**: narrow the grid to cameras in a specific ZoneMinder group
- **Column presets**: set the number of columns (1, 2, 3, 4, 6, 8) or apply a saved layout
- **Fit**: choose whether feeds crop to fill each cell (Cover) or scale to fit without cropping (Fit)
- **Refresh**: manually reload all feeds
- **Edit Layout**: enter edit mode to drag and resize cells
- **Fullscreen**: expand the grid to fill the entire screen
- **More (⋮) → Show monitors**: uncheck a camera to drop its tile from the grid, check it again to bring it back. Nothing changes on the server, and the choice survives a reload

While aggregating, each entry in **Show monitors** names the server it comes
from, since two servers can have cameras with the same name. Hiding one
server's camera leaves the other server's camera of that name on screen.

While aggregating, the grid opens a limited number of tiles at once, since
each tile is a live connection and combining servers multiplies them. The
slots are shared out evenly between the servers in view, so every server is
represented rather than the first one filling the grid on its own. Past that
limit the remaining cameras collapse into an overflow notice above the grid
rather than opening more connections. Raise or lower the limit under
**Aggregate performance** in {doc}`settings`.

Every toolbar control works the same way while aggregating, including edit
mode, column presets and saved layouts. The arrangement is kept separately
from each profile's own, so rearranging the combined grid leaves each
server's single-profile layout alone. Tiles are tracked per server, so two
servers with a camera on the same ID keep separate cells.

## Edit Mode

Tap **Edit Layout** to rearrange the grid:

- **Drag** a feed cell to move it
- **Resize** a cell by dragging its corner handles
- **Fill Width**: stretch all cells to use the full grid width
- **Pin**: pin a cell to prevent it from being moved accidentally
- **Save Layout**: save the current arrangement under a name so you can reload it later
- **Scroll pad**: buttons on the right edge of the screen that move the grid

The ⋮ menu also carries how a feed fills its tile (**Fit whole image** or
**Crop to fill**) and **Analysis frames**, settings you pick once rather than
reach for.

In edit mode a drag anywhere on a cell moves that cell, so on a touch screen
there is nothing left to swipe when the cells fill the display. The scroll pad
sits on the right edge for as long as you are editing, with four buttons: jump
to the top, up one screen, down one screen, and jump to the bottom. It goes
away when you tap **Done**.

Outside edit mode you can call it up yourself: **Scroll buttons** in the ⋮ menu
shows and hides it, and that choice is remembered for the server. It is worth
turning on for a tablet, where a swipe lands on a tile rather than the page.

Tap **Done** to leave edit mode.

## Fullscreen Mode

Tap **Fullscreen** to expand the grid to fill the screen. In fullscreen mode:

- A thin translucent toolbar sits at the top with controls for refresh, monitor labels, kiosk lock, and exit
- Monitor name labels can be toggled on or off
- The exit button (red) returns to normal view

See {doc}`kiosk` to use the lock button in the fullscreen toolbar.

## Pinch to Zoom

On touch devices, pinch to zoom in or out on the grid. Zoom is disabled in fullscreen mode to avoid gesture conflicts.

## Streaming

Each tile honors the same streaming rules as elsewhere in the app:

- Monitors with Go2RTC enabled stream live video (WebRTC, MSE, or HLS).
- Monitors on MJPEG follow the global *Streaming Mode* setting, *Streaming* shows continuous MJPEG, *Snapshot* shows a periodic JPEG that refreshes on the configured interval. While aggregating, each tile follows its own server's setting unless you set the group's Streaming Mode in {doc}`settings`.

Go2RTC streams in the montage are muted by default. Tap the speaker icon on a tile to unmute it; the app remembers the choice per monitor, so that monitor starts unmuted next time until you mute it again. A tile's ⋮ menu also has **Monitor details**, the same capture-settings popover the Monitors page opens from its info button. The protocol label (MJPEG/MSE/WebRTC) visibility is controlled by the toolbar eye toggle. Monitors that cannot be reached display a VideoOff placeholder instead of a broken feed.

## Performance

On phones, tablets, and the web app, the webview holds only about 6 live connections open to one server, so a grid full of *Streaming* tiles stalls after the first few. Switch *Streaming Mode* to *Snapshot* in {doc}`settings` so each tile refreshes on an interval rather than holding an open stream. This trades motion smoothness for lower bandwidth and CPU. The desktop app reads each feed natively and is not subject to that limit, so it streams many cameras at once and defaults to *Streaming*. Go2RTC tiles continue to stream regardless and are unaffected by the setting.

For a per-platform breakdown of where the ~6-stream limit applies, see {ref}`Connection limits by platform <connection-limits-by-platform>`. On **iOS, Android, or the web**, to keep more than about 6 live tiles streaming at once, enable multi-port streaming on the ZoneMinder server by setting `ZM_MIN_STREAMING_PORT`.

:::{tip}
If you have many cameras, use **Low bandwidth mode** in Settings to reduce data usage. You can also filter to show only the cameras you need, or use saved layouts to switch between different subsets.
:::

### While aggregating

Combining servers multiplies all of the above, so **Aggregate performance**
in {doc}`settings` carries four switches that only apply to the combined
montage. None of them change any server's own settings, and none apply when
you are on a single server.

- **Stream tuning** set to *Reduced* asks every tile for 5 frames a second at
  quarter scale. A server already set below that keeps its own values.
- **Pause hidden streams** stops the tiles 30 seconds after the app goes to
  the background or the window is minimized, and closes the connections on
  each server rather than leaving them running. Coming back rebuilds them.
- **Pause off-screen tiles** does the same for one tile at a time: a camera
  scrolled a screen's worth past the edge of the grid closes its connection,
  and opens it again as you scroll back. A tile you scroll past keeps its
  connection for a second or two, so moving through a long grid does not
  reconnect everything you pass. This changes which cameras are streaming,
  never which are on the page: the stream limit still decides that, and
  scrolling does not bring an overflow camera in.
- **Idle timeout** drops the tiles to periodic snapshots after the minutes you
  set with no touch, click or keypress. Any interaction puts them back, and so
  does returning to the app from another tab or window. It works while **Keep
  screen awake** is on, which is the case it is for: a montage left up on a
  display nobody is watching.

Go2RTC tiles keep streaming through the frame rate, scale and idle settings,
the same way they ignore *Streaming Mode*. Only the two pause settings stop
them.

Where a tile is stopped for any of these reasons, it shows the same waiting
placeholder it does before a stream arrives, and picks up live again from
whatever the camera is showing when it comes back.

## Screen Size Warning

On very small screens, the montage view may show a warning if the screen is too narrow to display cameras usefully. Rotate to landscape, or use a larger device.
