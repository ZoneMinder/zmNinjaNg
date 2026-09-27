# Server

The Server page shows the health and configuration of your ZoneMinder server, or of every server in a multi-server cluster. Open it from the sidebar. The refresh button at the top reloads all metrics at once; otherwise they refresh on the interval set by your [Bandwidth Mode](settings.md#bandwidth-mode).

## Version information

- **ZoneMinder version**: the server's ZM release.
- **API version**: the version of the ZoneMinder API the app is talking to.
- **Timezone**: the server's configured timezone, used to align event times correctly.

## Load average

The server's CPU load average. Sustained high load can cause dropped frames or slow event recording.

## Disk usage

Disk usage for the server's event storage, shown in GB and as a percentage.

## Status

Shows whether the ZoneMinder capture daemon is running or stopped, along with the server hostname.

## Servers / Details

In a single-server setup this card shows the server's details. In a multi-server cluster it lists every server with per-server metrics:

- **CPU load**
- **Total memory** and **Free memory**

## Storage areas

Each enabled storage area is listed with:

- Its name and filesystem path
- Used and total space in GB, with a usage bar
- The server it belongs to (in multi-server setups)

## Account permissions

Lists what the ZoneMinder account this profile signs in as is allowed to do: its System, Monitors, Stream, Events, Control and Groups levels. These come from the account's own ZoneMinder user record, and only an administrator can change them, in Options then Users in the ZoneMinder web console.

Where a level reads "Not determined", the app could not read it. ZoneMinder only lets an account read its own permissions when it has at least System View, so an account below that is told what is known about it, which is that it has no system access.

These levels explain what the rest of the app does or does not offer you. See [What your account can do](#what-your-account-can-do) below.

## ZoneMinder control

Shows the current ZoneMinder run state and lets you apply a different one. Changing the run state takes effect on the server, so you can switch between configured states (for example a "Home" or "Away" state) without opening the ZoneMinder web console.

Applying a state needs System: Edit. Without it the Apply button is greyed; tap or hover it and it says which permission is missing. Below System: View the whole card is hidden, because ZoneMinder will not list the states at all.

## What your account can do

A restricted ZoneMinder account can use the app, and the app tries to say so rather than appearing broken. What changes:

- **Camera settings**: without System: Edit, the gear on a monitor opens a read-only panel. The app's own per-monitor settings stay usable there, including "Always use ZMS" and the Go2RTC override, along with resolution, colours and linked monitors. The camera's source address, username and password are not shown.
- **Live video**: Stream is a separate permission from Monitors. An account that can list a camera but not stream it sees a message in place of the video instead of a picture that never loads.
- **PTZ**: the pan, tilt and zoom pad needs the Control permission. Without it the pad is not shown, even for a camera that supports it.
- **Events**: archiving and deleting need Events: Edit. Those buttons stay visible but greyed, and say what is missing when you tap, hover or hold them.
- **Logs**: the Logs page needs System: View. Without it the entry is not in the sidebar.
- **Groups**: the group filter needs the Groups permission, which is separate from monitor access.

If a camera or event list is empty, check the matching permission here before assuming the server has nothing to show.

## Multi-server clusters

zmNinjaNg detects multi-server setups automatically through the `/servers.json` endpoint; single-server setups are unaffected. Each monitor is mapped to its own server for streaming, daemon checks, and event images, and every request routes to the correct server. See [Multi-Server](settings.md#multi-server) in Settings for how streaming URLs are routed across servers.
