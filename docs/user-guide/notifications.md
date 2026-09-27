# Notifications

zmNinjaNg can notify you when ZoneMinder detects events. There are two notification modes, plus in-app toast notifications.

## Notification Modes

zmNinjaNg supports two notification modes. You choose the mode in **Notification Settings** based on your ZoneMinder setup.

### Event Server (ES) Mode

Uses a WebSocket connection to the [ZoneMinder Event Notification Server](https://github.com/ZoneMinder/zmeventnotificationNg) (zmeventnotification). Choose this mode if you run ES.

- **Desktop/Web**: WebSocket delivers events in real time while the app is open; toast notifications shown in-app.
- **Mobile (iOS/Android)**: ES sends FCM push notifications for background delivery. When the app is in the foreground, events arrive via WebSocket and are shown as in-app toasts; FCM duplicates are suppressed automatically.

### Direct Mode

Uses ZoneMinder's built-in Notifications REST API (no Event Server required). Choose this mode if you do not run ES but still want notifications. Requires ZoneMinder with the Notifications API (see ZM PR #4685).

- **Desktop/Web**: zmNinjaNg polls the ZM events API at a configurable interval (10s–120s). Events appear as in-app toasts while the app is open.
- **Mobile (iOS/Android)**: ZoneMinder sends FCM push notifications directly. Notifications work even when the app is closed or in the background. When the app is in the foreground, push events are shown as in-app toasts.

## Push Notifications (Mobile)

Both modes support native push notifications on iOS and Android via Firebase Cloud Messaging (FCM). Push works with the App Store and Google Play builds, no Firebase setup required on your end.

### Requirements

1. **ES mode**: The [Event Notification Server](https://github.com/ZoneMinder/zmeventnotificationNg) with FCM support
2. **Direct mode**: ZoneMinder with the Notifications REST API

:::{tip}
If you build the app from source and want push notifications, you will need to provide your own Firebase credentials. See the {doc}`../building/ANDROID` and {doc}`../building/IOS` build guides.
:::

### Setup

1. In zmNinjaNg **Notification Settings**, enable notifications and select your mode (ES or Direct)
2. The app registers its FCM token with the appropriate backend (ES via WebSocket, or ZM via REST API)

For custom-built mobile apps, add your own Firebase project first: create a Firebase project, enable Cloud Messaging, and drop `google-services.json` (Android) or `GoogleService-Info.plist` (iOS) into the appropriate directory before building. See the {doc}`../building/ANDROID` and {doc}`../building/IOS` guides.

### Per-Monitor Configuration

You can configure notifications per monitor:

- Enable or disable notifications for individual cameras
- Useful for silencing cameras that would otherwise generate too many alerts

### Direct Mode Options

When using Direct mode, additional settings are available:

- **Polling interval** (desktop only): How often to check for new events (10s–120s)
- **Only detected events**: Filter to only notify for events processed by object detection (zm_detect)

## In a virtual profile group

Each profile keeps its own notification setup - mode, host, monitor filters, everything on this page - even while aggregating in a {doc}`profiles` group. Notification Settings adds an overview above the usual controls, listing every profile's own mode and live connection status, and a profile picker to inspect or change one server's settings at a time.

A single notifications setting named after the group, separate from any one profile's settings, controls how those per-server connections behave while aggregating:

- **Live**: every server connects and shows toasts and sound as events arrive, same as single-profile mode.
- **Muted**: every server stays connected and the badge and history keep updating, but toasts and sound are suppressed.
- **Off**: no server connects while aggregating, so nothing updates until you switch this back on.

In Live or Muted mode, events arriving close together from different servers coalesce into one summary toast instead of flooding the screen with one per event, within the **Notification grouping** window in the group's performance section (for example **All Servers performance**) under Live Streaming in [Settings](settings.md#group-performance), and toast/sound display still honors each server's own settings underneath the aggregate mode. On mobile, push notifications are unaffected: FCM already delivers every profile's events regardless of which one is active, so a group opens no extra connections there.

## Notification History

zmNinjaNg keeps a history of the last 100 notifications received. Access it from the **View History** button on the Notification Settings page.

Each history entry shows:

- Monitor name
- Event cause and timestamp
- Event thumbnail (if available)

Tap a notification entry to jump to the corresponding event.

## Troubleshooting

**No in-app notifications (ES mode)**
- Verify the Event Notification Server is running and accessible
- Check the connection status badge in Notification Settings
- Ensure the server hostname is correct
- Check app logs for WebSocket connection errors

The connection to the Event Server drops while the app is backgrounded or the phone is locked, because the operating system suspends the app. Reopening the app reconnects it, and the status badge returns to connected within a few seconds. Push notifications are delivered over a separate channel, so they keep arriving even during that gap.

**No in-app notifications (Direct mode, desktop)**
- Verify ZoneMinder's Notifications API is available (the Direct option will be greyed out if not detected)
- Check that the polling interval is configured
- Check app logs for polling errors

**No push notifications (mobile)**
- Check that FCM token registration succeeded (check app logs)
- ES mode: Verify the Event Notification Server has FCM support and is configured to send to zmNinjaNg
- Direct mode: Verify ZoneMinder's Notifications API is available
- On Android, check that battery optimization isn't killing the app in the background
- Custom builds only: verify you embedded your own Firebase credentials before building
