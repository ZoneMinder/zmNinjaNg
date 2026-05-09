# Timeline & Heatmap

The Timeline view shows events over time and lets you jump to specific time periods.

## Timeline

Events are drawn as colored bars on a horizontal time axis. Each monitor gets its own row.

- **Zoom** in and out to view different time spans (hours, days, weeks)
- **Pan** left and right to move through time
- **Tap an event bar** to jump to that event's detail view

## Heatmap

The heatmap shows event density over time as a colored grid. Darker colors indicate more events during that period, useful for spotting busy hours, quiet periods, and recurring activity.

## Live Mode

Tap the **Live** button (radio icon) in the toolbar to enable live mode. When active:

- New events appear on the timeline as they happen, without waiting for a full refresh
- The view auto-scrolls to keep the current time visible
- Newly arrived events pulse with a yellow halo for 5 seconds so you can spot them instantly

Live mode uses WebSocket notifications when enabled, or falls back to polling.

## Refresh

Timeline and heatmap data refreshes automatically:

- **Normal bandwidth**: Every 60 seconds
- **Low bandwidth**: Every 120 seconds

You can also pull to refresh manually on mobile.
