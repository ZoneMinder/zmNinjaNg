# Dashboard

The Dashboard is the main screen after login. It shows configurable widgets giving an overview of your ZoneMinder system.

## Widgets

The dashboard supports several widget types:

| Widget | Description |
|--------|-------------|
| **Monitor** | Live camera feeds, single or multiple monitors in a grid. Each feed honors the global *Streaming Mode* setting (continuous video or periodic snapshot, see {doc}`settings`); Go2RTC monitors always stream regardless. On desktop, hovering a feed opens a larger live preview that tears down its stream on mouse leave. |
| **Recent Events** | Latest events, filterable by one or more selected monitors |
| **Timeline** | Event counts over time as a bar chart |
| **Heatmap** | Event activity heatmap showing busy hours and days |

## In a virtual profile group

While aggregating in a {doc}`profiles` group, the header has a stacking button (the layers icon) that splits the widgets by server. The Recent Events widget sections its list per server, the Timeline widget stacks each bar from one shade per server (the tooltip names them), and the Heatmap widget draws one heatmap per server under the server's name. Monitor widgets do not change. The button shares its on/off state with the one on Events.

In a group, a Monitor or Recent Events widget can hold monitors from more than one server. The add and edit dialogs list the monitors of every server in the group, under a heading with each server's name. Two servers can have a monitor with the same id, and the widget keeps them apart. A Monitor widget plays each feed from its own server. A Recent Events widget asks only the servers you picked monitors on, each for those monitors' events. With no monitor picked, it shows events from every server in the group.

## Customizing the Layout

The dashboard uses a drag-and-drop grid layout:

- Drag a widget's header to move it
- Drag the bottom-right corner of a widget to resize it
- Tap the add button to place a new widget
- Tap the close button on a widget's header to remove it

Your layout is saved automatically per profile.

## Mobile Layout

On mobile devices (portrait orientation), widgets stack vertically in a single column. The layout adapts automatically based on screen width.

In landscape mode, the grid layout is used, similar to the desktop view.

## Refreshing Data

Dashboard widgets refresh automatically based on your bandwidth settings:

- **Normal mode**: Widgets refresh every 30 seconds
- **Low bandwidth mode**: Widgets refresh every 60 seconds

You can also pull down to manually refresh on mobile devices.

See {doc}`settings` for bandwidth configuration.
