# Native MJPEG frames on iOS and Android

Live MJPEG tiles on iOS and Android stop opening their socket from the webview.
Native code holds the `nph-zms` connection, splits the multipart stream into
JPEG frames, and the webview's `<img>` fetches those frames one at a time from
a custom URL scheme. The webview never has a connection to ZoneMinder open, so
WebKit's and Chromium's six-connections-per-host pool no longer bounds how many
tiles stream. Refs #156 (closed, reopened by this work) and #507.

## Why this and not the earlier attempt

#156 tried the same idea with one difference: it handed the webview the
multipart stream itself, through a custom scheme and then through a loopback
HTTP server. WKWebView painted nothing either way, while single JPEGs through
the same scheme handler rendered fine, snapshot montage included. #155 (Tauri,
WebKitGTK) parsed the multipart in Rust and pushed frames, and that worked. So
the rule this design follows is: native parses the multipart, the webview only
ever sees single `image/jpeg` responses.

Alternatives considered and dropped:

- HTTP/2 and `ZM_MIN_STREAMING_PORT` both lift the limit, both need the user to
  change their server. The app already supports multi-port.
- Wildcard public DNS (`m1.192-168-1-5.nip.io`) shards the host with no server
  change, but needs internet to resolve a LAN address, routers with DNS
  rebinding protection drop the answer, and TLS names never match.
- A service worker or `fetch()` proxy draws from the same pool as `<img>`.
- Base64 frames over the Capacitor bridge: 24 tiles at 5 fps is a few MB/s of
  string copies on the JS thread. The scheme handler moves bytes without JS
  touching them.

## Goals

- A streaming montage page of 24 tiles paints all 24 on iOS and Android, on
  http and https, including self-signed certificates.
- Leaving a tile closes its socket to ZoneMinder (not only CMD_QUIT).
- The tile component, the connkey lifecycle, backoff, visibility resume, and
  the no-video state keep working unchanged.

## Non-goals

- The web build (browser tab) and Electron. Electron already raises Chromium's
  per-host limit to 32; the web build stays at six.
- Snapshot mode. It is one JPEG per request already and works today.
- Removing the Streaming/Snapshot setting. The web build keeps the six-stream
  limit, and Snapshot stays the low-bandwidth, low-CPU option everywhere. What
  changes is the default: `recommendViewMode` learns whether the host lifts the
  limit (iOS and Android through this transport, Electron through its raised
  Chromium cap) and recommends Streaming there whatever the monitor count, with
  its own reason line in Settings. Today it ignores the platform, so Electron
  is told Snapshot past five cameras too.
- Event playback (`ZmsEventPlayer`) and the hover preview. Both are one stream
  at a time.

## How a frame travels

```
zms --multipart--> native reader --JPEG--> frame slot --zmframe:// --> <img>
                   (URLSession /            (one per        (scheme handler,
                    HttpURLConnection)       stream)         answers or parks)
```

zms writes one chunk per frame, forever:

```
--ZoneMinderFrame
Content-Type: image/jpeg
Content-Length: 23417

<23417 bytes>
```

1. `useMonitorStream` builds the `nph-zms` URL as it does today (connkey,
   token, scale, maxfps, multi-port). On iOS and Android in streaming mode it
   does not put that URL in the `<img>`. It calls `ZmStream.open({ url,
   stallTimeoutMs })` and receives a `streamId`.
2. Native opens the URL with its own HTTP client and parses the body
   incrementally: find the boundary line, read headers to the blank line, take
   `Content-Length` bytes, emit one frame. If a header block has no
   `Content-Length`, scan forward to the next boundary instead. Each frame
   replaces the stream's single slot and bumps its sequence number. There is no
   queue: the newest frame wins and a slow device drops frames, which is how an
   `<img>` on a multipart stream behaves today.
3. The `<img>` src is `zmframe://frames/<streamId>/<n>`. `n` is a counter the
   hook bumps on every `load`; it exists only so the image cache sees a new
   URL. Native decides which frame is returned.
4. The scheme handler (`WKURLSchemeHandler` on iOS, `shouldInterceptRequest` on
   Android) looks up the stream. If the slot holds a frame newer than the last
   one delivered for this stream, it answers at once: `200`, `Content-Type:
   image/jpeg`, `Content-Length`, `Cache-Control: no-store`. Otherwise it parks
   the request and the reader completes it when the next frame lands.
5. On `load` the hook bumps `n`, the `<img>` requests again, and the loop runs
   at the stream's own frame rate. Scheme loads do not sit in the per-host pool,
   so 24 parked requests cost nothing.
6. `ZmStream.close({ streamId })` cancels the native request, which closes the
   socket, fails any parked request, and forgets the slot. The hook calls it
   when the stream URL changes (new connkey, new token, new scale) and on
   unmount. CMD_QUIT still goes out through `useStreamLifecycle` as today.

### Errors and stalls

- Native request fails (refused, TLS rejected, non-200, body ends): the stream
  is marked dead. The parked request, and every later request for that
  `streamId`, gets a failure response (`404`) so the `<img>` fires `error`.
  The existing `reportStreamError` backoff runs, mints a new connkey, the URL
  changes, the hook closes the dead stream and opens a new one. The dead slot
  stays in the store until `close`, because the `<img>` keeps pointing at it
  through the backoff delay and must keep getting `404`, never park.
- `open` is a promise. If the URL changes or the tile unmounts before it
  resolves, the hook closes the `streamId` as soon as it arrives.
- A `load` that belongs to an earlier stream can land after a new `streamId`
  opened. The hook reads the element's `currentSrc` in the `load` handler and
  ignores a load whose URL names a `streamId` other than the current one.
- Backgrounding: no native suspend handling. iOS freezes the process and the
  sockets die on their own; the existing visibility resume regenerates every
  connkey, which closes each old stream and opens a new one.
- No frame within `stallTimeoutMs` while a request is parked: same failure
  response. The value comes from the hook, which passes the ZM integration
  constant for a stalled stream (a new entry in `ZM_INTEGRATION`, next to the
  snapshot in-flight ceiling), so it is tuned in one place.
- Visibility resume: unchanged. The hook already clears `loadedSrc` and
  regenerates the connkey, which closes and reopens the native stream.
- `hasFrame` in frame mode: `loadedSrc !== ''` since the current `streamId`
  opened. Today's rule (`loadedSrc === imageSrc`) cannot apply, because the
  src changes on every frame. Opening a new `streamId` resets `loadedSrc`, so a
  tile never shows a frame from a dead stream as live (refs #352).

### Transport details

- Cleartext: iOS already has `NSAllowsArbitraryLoads`; Android's
  `network_security_config.xml` permits cleartext. Both cover the native
  clients.
- Self-signed TLS, gated on the profile's self-signed setting exactly as
  CapacitorHttp is. On Android the reader uses `HttpsURLConnection`, whose
  default socket factory and hostname verifier `SSLTrustPlugin` replaces while
  trust is enabled, so the reader needs no trust code of its own; with trust
  off, a self-signed server fails the handshake, as the webview does today. On
  iOS the reader's `URLSession` delegate checks `SSLTrustPlugin.sslTrustEnabled`
  first: off means system validation (`isServerTrustValid`), on means
  `isCertTrustedForHTTP` (trust on first use). Calling `isCertTrustedForHTTP`
  bare would accept any certificate whenever no fingerprint is stored, with the
  setting off. With the gate in place this also removes the iOS-only blank tile
  over a self-signed cert that `agents/project/native.md` records (WKWebView
  never asks the delegate for a subresource).
- Per-host caps in the native clients are raised, or they would move the
  problem: `URLSessionConfiguration.httpMaximumConnectionsPerHost` defaults to
  six on iOS and is set to 64 on the reader's session; `HttpURLConnection` has
  no per-host cap (each reader is its own connection on its own thread).
- Token: the stream URL carries the access token in its query. It crosses the
  Capacitor bridge once, in `open`. Native code never logs it; every native log
  line near a URL or error carries the `// log-safe:` reason the contract gate
  demands.
- No new dependency on either platform.

## Native pieces

### iOS

- `ZmStreamPlugin.swift`: `CAPPlugin` with `open` and `close`. Registered in
  `ViewController.capacitorDidLoad` (the `ViewController` class lives in
  `AppDelegate.swift`) beside the other plugins.
- `MjpegReader.swift`: one per stream. `URLSession` with a data-task delegate
  (`didReceive data` feeds the parser), its own configuration
  (`httpMaximumConnectionsPerHost = 64`, no cookies, no cache), the trust
  delegate above. Cancel closes the socket.
- `FrameStore.swift`: a singleton map `streamId -> { frame, seq, delivered,
  parkedTask, deadline }`, guarded by a serial queue. The reader writes, the
  scheme handler reads.
- `ZmFrameSchemeHandler.swift`: `WKURLSchemeHandler` for `zmframe`.
  Registered by adding an override of `webViewConfiguration(for:)` to
  `ViewController` (none exists yet): call `super`, then
  `setURLSchemeHandler(_, forURLScheme: "zmframe")`.
  `WKURLSchemeTask` methods run on the main thread. When WebKit calls
  `stop(task)` (tile unmounted mid-request) the handler drops the parked task
  without touching it again; calling a stopped task throws.

### Android

- `ZmStreamPlugin.java`: `open` and `close`. Registered in
  `MainActivity.onCreate` with the others, before `super.onCreate`.
- `MjpegReader.java`: one per stream on its own thread, `HttpURLConnection`
  over the input stream, same parser. `close` disconnects and interrupts.
- `FrameStore.java`: same shape as iOS, synchronized.
- `ZmFrameWebViewClient.java extends BridgeWebViewClient`: overrides
  `shouldInterceptRequest`; for a `zmframe://` URL returns a
  `WebResourceResponse("image/jpeg", ...)` whose `InputStream` blocks in its
  first `read()` until a frame is available or the stall deadline passes
  (then throws `IOException`, which the WebView reports as a failed load).
  Everything else falls through to `super`. Installed with
  `getBridge().setWebViewClient(...)` after `super.onCreate`. Chromium calls
  `shouldInterceptRequest` on a pool of IO threads; the blocking happens in
  `read()`, not in the callback, so the callback returns at once.
  `SSLTrustPlugin` replaces the WebViewClient whenever self-signed trust is
  toggled (`installWebViewSslHandler`, `restoreWebViewSslHandler`), today with
  a bare `BridgeWebViewClient` or an anonymous subclass. Both methods construct
  a `ZmFrameWebViewClient` instead, which takes the trust flag and carries the
  `onReceivedSslError` override, so there is one WebViewClient subclass and a
  toggle never drops the `zmframe` interception.

### Parser

Same state machine on both platforms, written twice (Swift, Java): `boundary`,
`headers`, `body(remaining)`, with the no-`Content-Length` fallback. Each gets a
unit test fed from the same byte fixtures: one clean stream of three frames,
one with the frames split at arbitrary byte offsets, one without
`Content-Length`, one that ends mid-frame. Android's test runs under the
existing JUnit setup in `app/android/app/src/test` (`./gradlew test`). The
Xcode project has no test target, so the Swift parser lives in a local Swift
package, `app/ios/App/MjpegKit`, with a test target; `swift test` runs it on
the Mac, and the app links the package the way it links `LlamaKit`.

## JS pieces

- `app/src/plugins/zm-stream/{definitions,index,web}.ts`: the Capacitor
  plugin wrapper in the shape the other plugins use. The web implementation
  rejects `open`; the hook never reaches it because it gates on
  `Platform.isNative`.
- `app/src/hooks/useNativeMjpegFrames.ts`: new hook; `useMonitorStream` is
  already near the C2 file limit and owns the connkey, not the transport.
  Input: the stream URL (or `''`) and `enabled`. It
  imports the plugin dynamically behind the platform check (Native contract),
  opens on a new URL, closes the previous stream first, closes on unmount, and
  exposes `{ frameSrc, advance, resetKey }`: `frameSrc` is the `zmframe://`
  URL with the current `n`, `advance` bumps `n` (called from `load`), and
  `resetKey` changes when a new `streamId` opens so the caller can clear
  `loadedSrc`.
- `useMonitorStream`: in streaming mode on native, `imageSrc` comes from
  `useNativeMjpegFrames` instead of `streamUrl`; `reportStreamLoad` also calls
  `advance`; `hasFrame` uses the frame-mode rule above. Snapshot mode, web, and
  Electron are untouched.
- `LiveMonitorPlayer` is unchanged: it still binds `imageSrc`, `onLoad`,
  `onError`.
- Test mock for the plugin in `app/src/tests/setup.ts`, like the others.
- `useStreamLifecycle` blanks `img.src` on unmount today to free a browser
  connection; in frame mode that is harmless and stays.

## Tests

- Unit (proven red, P2): `useNativeMjpegFrames` opens with the URL it is
  given, closes the previous stream before opening the next, closes on unmount,
  advances `n` on demand, and resets its key on a new `streamId`;
  `useMonitorStream` on a mocked native platform exposes a `zmframe://` src and
  reports `hasFrame` only after a load since the current open; the native
  parser fixtures above.
- E2E: none. Chromium e2e never runs the native path.
- Device pass (manual, the maintainer runs it): on an iPhone and a Pixel, a
  streaming montage of 24 tiles against a) an http server, b) an https server
  with a self-signed cert, all tiles painting and moving; background and resume;
  leave the montage and confirm `zms` processes end on the server; a single
  monitor page; a tile whose camera is down shows no-video, not a stale frame.
  Frame rate against today's six-tile montage is the number that says whether
  the scheme handler keeps up.

## Order of work

iOS first, end to end, and a device check before Android starts. The one open
question in this design is whether WebKit runs 24 scheme loads concurrently at
frame rate; if it does not, nothing downstream matters. Android follows the
same shape once iOS is measured.

## Docs that move with this

- `docs/user-guide/settings.md`: the platform table (Android and iOS rows
  become "Read natively by the app, no limit") and the note under it.
- `docs/user-guide/montage.md`: the two paragraphs on the six-stream limit.
- `docs/developer-guide/call-flows.rst`, Flow 2: the native hop between the
  hook and `nph-zms`.
- `agents/project/domain-context.md` (the six-connection bullet) and
  `agents/project/native.md` (WKWebView and multipart, scheme-task `stop`,
  per-host caps in URLSession), through the self-improvement protocol in the
  same PR.

## Left to the builder

- Exact Swift/Java file names and whether the reader and store share a file.
- The `streamId` format (an integer counter is fine).
- The failure status code for a dead stream, as long as the `<img>` fires
  `error`.
- Whether `open` returns before or after the HTTP response headers arrive; the
  `<img>` tolerates either.
