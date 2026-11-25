# Stream path probe

Issue #603. Live view fails silently when a profile's CGI path (the URL of
`nph-zms`) is wrong. In #584 discovery fell back to `<portal>/cgi-bin/nph-zms`
because ZM 1.39.45 returns an empty `ZM_PATH_ZMS` from the API
(ZoneMinder/zoneminder#8237), and the server's real path was
`/cgi-bin-zm/nph-zms`.

An `<img>` playing MJPEG fires the same `onError` for a 404, a 403 and a
dropped connection, so the stream element can't report the cause. The app
probes the stream URL with its own request instead.

## What nph-zms returns

Measured on a 1.39.45 server with `curl`, `mode=single`:

| Request | Status | Content type |
|---|---|---|
| right path, valid token | 200 | `image/jpeg` |
| right path, no token or a bad token | 403 | none, empty body |
| wrong path | 404 | `text/html` (Apache page) |
| right path, monitor id that doesn't exist | 200 | `image/jpeg` ("Not connected" placeholder) |

The last row means a probe proves the path and auth work, not that a given
monitor is capturing. That is all this feature claims.

## Probe

`probeZms(recordingUrl, monitorId, token)` in `app/src/lib/zm/zms-probe.ts`
builds the URL with `getStreamUrl(..., { mode: 'single', token, scale })`
and sends one GET through `lib/http.ts`, reading the body as binary so a
JPEG is never parsed as JSON. It returns one of:

- `ok`: 2xx with an `image/*` content type.
- `failed` with `status` and the URL path (no query string, so no token): a
  4xx or 5xx, or a 2xx that isn't an image (an Apache that serves the CGI
  binary as a download).
- `unknown` with a reason: network error, timeout, CORS block, or no status.
  Unknown never shows red.

The token comes from `getFreshAccessToken` for the profile, so an expired
token doesn't read as a 403.

## Which URLs get probed

For a profile, the monitors query already on screen is grouped by
`resolveMonitorUrls(...).recordingUrl`. Each distinct URL is probed once,
through the first monitor on it whose `Capturing` isn't `None` (any monitor
if none qualify). A single-server profile probes one URL; a multi-server
profile probes one per server. No monitors means no probe.

`useZmsProbes(profileIds)` runs these through `useQueries` with keys from
`queryKeys.zmsProbe(asProfileId(id), recordingUrl)`. A long `staleTime`
constant (no refetch interval) keeps it to one request per URL per few
minutes. Changing the profile's CGI path changes the key, so the next view
probes the new path.

## Where it shows

1. Settings > Live Streaming, server rows: one compact line per probed URL
   for the selected server. Green text with a check icon when `ok`. A red
   background (`bg-destructive`, `text-destructive-foreground`) with the
   status and URL path when `failed`. Muted text while checking or when
   `unknown`. Text truncates with a `title` so it fits 320px.
2. Monitors, Montage and Monitor detail: an `ErrorBanner` when any profile
   whose monitors are on the page has a `failed` probe. It names the server
   (in a group), the status and path, and says to check the CGI path in the
   profile. Nothing for `ok` or `unknown`.
3. Profile setup: `DiscoveryResult` gains `cgiUrlSource: 'server' | 'default'`.
   When it is `default`, the form shows a warning toast after it saves the
   profile, saying the path is a guess because the server didn't report
   `ZM_PATH_ZMS`. A toast and not a hint by the CGI path field: that field is
   hidden while discovery runs, and the form navigates away on success. The
   Settings row and the live-page banner then show whether the guess works.

## Out of scope

Trying other common paths on a 404 and offering to switch. It can follow
once the probe exists.
