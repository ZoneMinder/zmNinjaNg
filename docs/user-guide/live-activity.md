# Live Activity

Live Activity shows only the cameras that ZoneMinder currently reports as alarming, as live video tiles. Instead of scanning a full grid of quiet monitors, you see just the ones that need attention right now.

Tapping a tile's video opens that camera's monitor page, the same as tapping one in Montage; on a computer the tile outlines itself as you hover to show it will. The X in the corner dismisses a tile instead, and the buttons in its header still do their own jobs.

On a computer, hovering a tile can also open an enlarged live preview, the same one the monitor and event lists offer. It is off here by default, since a tile is already streaming that camera at size and the preview opens a second connection for a bigger copy; turn it on under Settings ▸ Appearance ▸ Hover preview ▸ **Live Activity tiles**.

## Why a monitor lingers after its alarm clears

A monitor does not disappear the instant its alarm clears. It stays on screen for a short dwell window (30 seconds by default) after its last alarm, then leaves. This is not just to avoid a jarring flicker: each tile that appears or disappears opens or closes a live video connection to the server. A monitor that flickered in and out of alarm every few seconds would open and close that connection just as fast, which is unnecessary load on the server. The dwell window smooths that out.

Any new alarm during the dwell window resets the timer and keeps the tile on screen.

## Reading a tile

Each tile header shows an icon for the monitor's current state next to the camera name: a bell while it is alarming, a raised shield while ZoneMinder is part way into an alarm decision, and a struck-out shield while it is cooling down toward leaving the page. Hover the icon, or read it with a screen reader, to get the state in words. Cooling tiles are drawn at full colour like any other, so this icon is the only sign that a tile is on its way out.

Next to the counter, a tile may also say what ZoneMinder gave as the cause of the alarm, such as "Motion: All" or "Forced Web". That wording only reaches the app through a notification, so a monitor the page found by checking alarm state alone shows no cause. Nothing else about the tile depends on it.

Each tile is the shape of its own camera. A widescreen camera gets a wide tile, a 4:3 camera a taller one, and a camera mounted sideways gets a portrait tile, so the picture is never squeezed or cut off to fit a shared box. Cameras of different shapes therefore give tiles of different heights, and each tile takes only the height it needs: a short tile sits directly above the next tile in its column instead of leaving a gap the height of the tallest camera beside it. Tiles still read left to right, most recent first.

The counter in the bottom corner of each tile says how long the current alarm episode has been running, as minutes and seconds (hours appear once there are any). It counts from the start of the episode rather than from the last alarming moment, so a camera whose event flickers through its tail keeps counting up instead of resetting.

## Fullscreen

The fullscreen button next to the gear hides the heading, the grid controls and the gear, leaving the tiles and a thin bar with the way back out. This is what you want on a wall display or a TV stick. The page remembers the choice per profile, and it is remembered separately from the Montage page's own fullscreen state, so putting one in fullscreen does not move the other.

## Clearing a tile you have already looked at

The small cross in a tile's top corner removes that camera from the page now, instead of waiting out its dwell window and holding a slot you no longer need. Clearing it closes its video connection like any other tile leaving.

A camera that is still alarming would normally be put straight back on the next check, so a cleared tile stays cleared until that camera genuinely stops alarming. Its next alarm after that appears as usual. Clearing is per visit: leave the page and come back, and nothing is remembered.

## Order and overflow

The camera that alarmed most recently sits at the top, and the ones that have gone quiet sink toward the bottom as they cool. Two cameras that alarm in the same check keep a fixed order between them rather than swapping around. Tiles slide to their new positions where your browser supports it, so a reorder is visible rather than an instant jump. If more monitors are alarming than the page can show, the extra ones collapse into a "+N more active" line instead of overcrowding the grid, which means the tiles you keep are the most recent activity.

## Settings

Open the gear icon at the top of the page to configure:

- **Check every**: how often, in seconds, the page checks each watched monitor's alarm state. Low bandwidth mode raises the minimum you can set here.
- **Keep on screen for**: the dwell window described above, in seconds. Raise it if tiles disappear and reappear too often; lower it to clear tiles faster once an alarm ends. The minimum is 5 seconds, because a zero-second window is what the dwell window exists to prevent.
- **Maximum tiles**: how many tiles the grid shows at once before the rest collapse into the overflow count.
- **Monitors to watch**: a per-monitor switch that keeps a monitor off this page only. It stays visible everywhere else in the app. This is separate from the hidden monitors list in {doc}`settings`, which hides a monitor from the whole app.

Every monitor is watched by default, including cameras set to record continuously. A camera that always records is always inside an event, but an event is not an alarm: ZoneMinder still reports such a camera as idle until motion is detected, so it appears here only when something actually happens. Turn one off with the switch if you would rather not see it on this page.

A push notification for a monitor promotes it onto the page immediately, rather than waiting for the next scheduled check.

## In a virtual profile group

While aggregating in a {doc}`profiles` group, the page watches every member's monitors at once, each tile carrying a chip naming its server. The total watched across the group is capped, drawn round-robin from each member so one busy server can't crowd the rest out; hitting the cap adds an overflow line reporting how many monitors aren't being watched, on top of the usual "+N more active" overflow for tiles that are alarming but don't fit the grid. That cap is **Monitors watched for alarms** under **Aggregate performance** in {doc}`settings`, alongside **Fastest alarm polling**, which stops the combined poll running faster than a set interval however low you set the check interval here. Check interval, dwell window, and maximum tiles stay one shared group-wide setting. **Monitors to watch** is still per server: the gear icon's ignore-list section gets its own profile picker while aggregating, so turning a monitor off here only affects that one server's list.

The stacking button in the header (the layers icon) sections the tiles by server, each server under its own heading that folds away. It shares its on/off state with the same button on Monitors and Montage.

## When the server cannot be reached

While the page is waiting for its first answer it shows placeholder tiles, and if it cannot reach the server it shows the error instead of the "All quiet" message. "All quiet" means the server was asked and said nothing is alarming, so the page never shows it on a guess.

A monitor whose check fails keeps the last alarm state the server reported, rather than dropping off the page. A single dropped request on a weak connection therefore does not end an alarm and restart it as a new one.
