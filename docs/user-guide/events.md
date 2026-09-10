# Events

The Events screen lets you browse and play back recorded events from your ZoneMinder server.

## Event List

Events are displayed as cards showing:

- **Thumbnail** - A snapshot from the event
- **Monitor name** - Which camera captured the event
- **Date and time** - When the event occurred
- **Duration** - Length of the event
- **Frames** - Number of frames in the event
- **Tags** - Any tags applied to the event in ZoneMinder

Events from the last 7 days also show how long ago they occurred, displayed next to the date and time.

Older events load automatically as you scroll.

On desktop, hovering over a thumbnail for a moment shows a 400px-wide preview anchored next to the row. The preview loads a higher-resolution image from the server. The underlying card remains clickable while the preview is visible, so you can still click to open the event.

## Deleting Multiple Events

Each event card has a trash icon. Tap it to queue that event for deletion without opening it, the card dims and tints red to show it is selected. Tap the icon again to remove it from the selection.

Once at least one event is selected, a floating bar appears showing how many events are queued (for example, "Delete 3 events"), with **Cancel** and **Delete** buttons:

- **Cancel** - Clears the selection without deleting anything
- **Delete** - Permanently deletes all selected events from your ZoneMinder server

Deletion is permanent and cannot be undone. If some events fail to delete (for example, a server error), the app shows an error and leaves the successful ones deleted.

The same selection and delete flow is available in the Recent Events list on a monitor's detail page.

## Filtering Events

Filter events using the controls at the top:

- **Date range** - Select a start and end date
- **Monitor** - Show events from a specific camera only. In a {doc}`profiles` group the picker groups cameras by server, and picking from one server narrows the list to that server's events - the other servers drop out rather than showing everything they have.
- **Groups** - Filter by monitor group
- **Favorites only** - Show only events you have starred. This works across all your favorites, including ones older than the first page of results.
- **Tags** - Show only events carrying the tags you pick (if your server supports tags). Select several tags to see events with any of them, or "All" for events with any tag. Like favorites, this covers tagged events older than the first page. In a {doc}`profiles` group the list offers each tag name once, however many servers in it define it, and picking one matches that name on every server. A server that has no tag by that name contributes no events, so filtering by a tag only one of your servers uses shows you only that server's events.
- **Archived only** - Restrict the list to archived events. To archive an event, open it in the event detail screen and use the archive action.

The crop button in the toolbar switches event thumbnails between showing the
whole image and filling their tile.

## Event Playback

Tap an event to open the event detail view, which includes:

### Event Frames

Above the player is a strip of the significant still frames ZoneMinder keeps for the event, in order: the annotated object-detection image if machine learning wrote one, the alarm frame, then the snapshot. Only the frames the server actually has appear, so an event without object detection shows two entries and an event with no stored stills shows no strip at all.

Tap a frame to see it full size. Pinch, scroll the mouse wheel, or use the zoom buttons to magnify it, then drag to move around the image, the same as on the live monitor view. Playback stops while the image is open and resumes when you close it, unless you had already paused it.

Tap the strip's header to collapse or expand it. That choice is remembered for the next event you open.

### Video Player

The event player selects the playback mode based on the event's format:

- **HLS events** - Events with an `.m3u8` DefaultVideo use HLS playback via video.js
- **MP4 events** - Events with MP4 recordings use standard video playback

If video.js playback fails (network error, unsupported codec, etc.), the player automatically falls back to ZMS playback, which streams JPEG frames from ZoneMinder.

#### ZMS Fallback

ZMS playback renders frames one at a time from ZoneMinder's streaming server. Controls include:

- **Play/Pause** - Start or stop frame-by-frame playback
- **Seek** - Jump to any point in the event
- **Playback speed** - Adjust speed

ZoneMinder's streaming server sometimes gives up part way through an event and leaves an error such as "Failed getting frame" on screen. The player notices the stream has stopped and starts a new one from the frame it stopped on, so playback continues without leaving the event. If the server fails at the same point every time, playback stops there after a few attempts; press Play to try again.

#### Standard Controls

For video-based playback (HLS or MP4), the player provides:

- **Play/Pause** - Start or stop playback
- **Scrub bar** - Jump to any point in the event
- **Playback speed** - Adjust speed (1x, 2x, etc.)

### Event Info

Details about the event:

- Start and end time
- Duration
- Number of alarm and total frames
- Monitor name and ID

### Scroll Pad

The player is a zoom and pan surface, so a swipe over it zooms or pans rather
than scrolling the page. The up/down arrows in the header put four buttons on the
right edge: jump to the top, up one screen, down one screen, and jump to the
bottom. The choice is remembered for that server.

### Navigation

- **Previous/Next** buttons to move between events without going back to the list

### Continue

The Continue button (list-video icon, next to All Events) plays events back-to-back for hands-free review. When it is on, an event finishing advances to the next event automatically, following the same filters as the Previous/Next buttons. A four-second message names the new monitor, its ID, and event time. When there are no more matching events, a "No more videos to play" message appears and playback stops.

The toggle is remembered per profile: once turned on it stays on for future events. The playback speed you pick is also remembered and reused for each event in a run, on both the MP4 and ZMS players. So is the MP4 player's mute state: unmute once and every event you open afterwards on that profile starts with audio on, until you mute again. Fullscreen is not remembered: entering or leaving it changes only the event you are watching. To have every event open fullscreen, turn on **Open events in fullscreen** under Playback in {doc}`settings`. Turning a phone to landscape also plays the event fullscreen for as long as it stays landscape. Either way the page itself goes fullscreen, MP4 or ZMS: the picture fills the screen with the player controls below it and a translucent close button in the top corner, and pinch to zoom keeps working. The MP4 player's own fullscreen button still uses the device's native fullscreen for the event you are watching.

## Event Montage

View events from multiple cameras at the same time, useful for reviewing an incident across several camera angles.

## Downloads

You can download event recordings:

1. Open an event
2. Tap the download button
3. The video file is saved to your device

On mobile, downloads go to the device's Documents or Downloads folder. A progress indicator shows status.

:::{note}
Downloads run in the background, you can continue using the app.
:::
