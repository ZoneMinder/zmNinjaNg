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

## Edit Mode

Tap **Edit Layout** to rearrange the grid:

- **Drag** a feed cell to move it
- **Resize** a cell by dragging its corner handles
- **Fill Width**: stretch all cells to use the full grid width
- **Pin**: pin a cell to prevent it from being moved accidentally
- **Save Layout**: save the current arrangement under a name so you can reload it later

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
- Monitors on MJPEG follow the global *Streaming Mode* setting — *Streaming* shows continuous MJPEG, *Snapshot* shows a periodic JPEG that refreshes on the configured interval.

Go2RTC streams in the montage are muted by default. The protocol label (MJPEG/MSE/WebRTC) visibility is controlled by the toolbar eye toggle. Monitors that cannot be reached display a VideoOff placeholder instead of a broken feed.

## Performance

When you have many cameras open at once, switch *Streaming Mode* to *Snapshot* in {doc}`settings` so each tile refreshes on an interval rather than holding an open stream. This trades motion smoothness for lower bandwidth and CPU. Go2RTC tiles continue to stream regardless and are unaffected by the setting.

:::{tip}
If you have many cameras, use **Low bandwidth mode** in Settings to reduce data usage. You can also filter to show only the cameras you need, or use saved layouts to switch between different subsets.
:::

## Screen Size Warning

On very small screens, the montage view may show a warning if the screen is too narrow to display cameras usefully. Rotate to landscape, or use a larger device.
