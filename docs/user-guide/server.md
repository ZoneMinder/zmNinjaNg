# Server

The Server page shows the health and configuration of your ZoneMinder server, or of every server in a multi-server cluster. Open it from the sidebar. The refresh button at the top reloads all metrics at once; otherwise they refresh on the interval set by your [Bandwidth mode](settings.md#bandwidth-settings).

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

## ZoneMinder control

Shows the current ZoneMinder run state and lets you apply a different one. Changing the run state takes effect on the server, so you can switch between configured states (for example a "Home" or "Away" state) without opening the ZoneMinder web console.

## Multi-server clusters

zmNinjaNg detects multi-server setups automatically through the `/servers.json` endpoint; single-server setups are unaffected. Each monitor is mapped to its own server for streaming, daemon checks, and event images, and every request routes to the correct server. See [Multi-Server](settings.md#multi-server) in Settings for how streaming URLs are routed across servers.
