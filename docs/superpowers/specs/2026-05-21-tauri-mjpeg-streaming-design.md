# Tauri MJPEG streaming via Rust reader

## Problem

On Tauri desktop, opening individual monitor live views leaks a TCP socket per
view. Each single-monitor view (and montage in streaming mode) renders the live
feed with `<img src="…nph-zms?mode=jpeg…">`, a `multipart/x-mixed-replace` MJPEG
stream owned by the WebKitGTK network process. When the view unmounts the hook
sends CMD_QUIT to the server and blanks `img.src`, but WebKitGTK/libsoup does not
release the underlying socket for an aborted multipart response. The socket sits
in CLOSE_WAIT and holds a slot in libsoup's per-host connection pool. After about
6 to 8 opened monitors the pool is exhausted and new streams never load. Montage
itself keeps working because commit `7e12114` (refs #150) already routes its
snapshot frames through the Rust HTTP client as blob URLs, so the webview never
opens those sockets.

CMD_QUIT does not fix the leak. It tells the server to stop streaming, which
makes the server close its end and produces the CLOSE_WAIT on the client. The
leak is in WebKitGTK's socket handling, not the server.

The snapshot blob fix does not transfer directly to streaming. Snapshot mode is
discrete (`mode=single`, one JPEG per GET, request completes). Streaming is
`mode=jpeg`, a response that never ends, so a single blob fetch can never resolve.

## Approach

Read the MJPEG stream in Rust. A Rust command opens the `multipart/x-mixed-replace`
connection with reqwest, parses the multipart boundaries, and pushes each JPEG
frame to the webview over a Tauri `Channel`. The persistent socket lives in Rust,
where hyper closes it cleanly when the task is cancelled. The webview never opens
a socket to ZoneMinder, so nothing can leak into CLOSE_WAIT and the per-host
ceiling is removed.

## Decisions

- **Scope**: fix in `useMonitorStream`, so every Tauri consumer with
  `effectiveViewMode === 'streaming'` uses the Rust reader. This also covers
  montage when a user sets the global view mode to streaming (it leaks the same
  way today). One code path.
- **Transport**: a single Tauri `Channel` whose messages are either a raw binary
  JPEG frame or a JSON control message. Frames are sent as raw bytes
  (`tauri::ipc::InvokeResponseBody::Raw`) and arrive in JS as an `ArrayBuffer`;
  errors are sent as JSON and arrive as an object. JS discriminates by checking
  whether the payload is an `ArrayBuffer`. No base64 overhead, lowest CPU and
  bandwidth.
- **Platforms**: all Tauri desktop (Linux, macOS, Windows), mirroring the #150
  snapshot fix which gates on `Platform.isTauri`. One uniform path, no per-OS
  branching.
- **Reconnect**: Rust signals an error over the Channel and stops; the hook
  reuses its existing connkey-regenerate lifecycle to restart with backoff.
  Retry policy stays in one place (JS).

## Architecture

### Rust: `app/src-tauri/src/mjpeg.rs`

Registered in `lib.rs` `invoke_handler` alongside the existing biometric commands.

- `mjpeg_start(url, conn_key, accept_invalid_certs, on_frame: Channel<…>) -> Result<u64, String>`
  Opens the stream with a reqwest client (TLS verification disabled when
  `accept_invalid_certs` is true, matching `isTauriSslTrustEnabled()`), spawns a
  tokio task that parses multipart frames and sends each JPEG byte slice down the
  Channel. Returns a `stream_id`. Returns `Err` for immediate failures (bad URL,
  TLS handshake failure, connection refused, non-200 status).
- `mjpeg_stop(stream_id)` Cancels the task for that id.

**Cancellation registry**: `Mutex<HashMap<u64, CancellationToken>>` in Tauri
managed state. `start` inserts a token, `stop` cancels and removes it, the task
removes its own entry on exit. Dropping the reqwest response closes the socket.

**Dependencies** (`Cargo.toml`): `reqwest` with streaming support, `tokio`,
`tokio-util` for `CancellationToken`. Pin to versions Tauri 2.10.2 already
resolves. When updating, keep `@tauri-apps/*` and `tauri-plugin-*` versions
aligned per AGENTS.md rule 16.

### JS: `app/src/lib/tauri-mjpeg.ts`

Thin wrapper hiding the `invoke` + `Channel` plumbing and the SSL-trust flag:

- `startMjpegStream(url, connKey, onFrame, onError) => Promise<streamId>`
- `stopMjpegStream(id) => Promise<void>`

### JS: `app/src/hooks/useMonitorStream.ts`

New gate `useRustStreaming = Platform.isTauri && effectiveViewMode === 'streaming'`,
parallel to the existing `useBlobSnapshots`. When on, the hook calls
`startMjpegStream` instead of `setImageSrc(streamUrl)` and manages the stream id.

The existing CMD_QUIT lifecycle in `useStreamLifecycle` stays unchanged. It is
harmless (still tells the server to stop) and is now redundant for socket
cleanup, which Rust owns.

## Data flow

1. `useMonitorStream` builds `streamUrl` as today (`mode=jpeg`, `connkey`,
   `maxfps` from `settings.streamMaxFps`, token). ZM continues to pace frames.
2. With `useRustStreaming` on, the hook calls
   `startMjpegStream(streamUrl, connKey, onFrame, onError)`.
3. Rust reads the multipart body and sends each `image/jpeg` part's bytes as an
   ArrayBuffer down the Channel.
4. `onFrame(bytes)` builds `URL.createObjectURL(new Blob([bytes], {type:'image/jpeg'}))`,
   calls `setImageSrc(url)`, then revokes the previous URL. Reuses the existing
   `blobUrlRef` and unmount-revoke effect (`useMonitorStream.ts:97, 218-225`).

### Teardown

- The hook tracks the active `stream_id`. On unmount and on `connKey`
  regeneration it calls `stopMjpegStream(id)` and revokes the last blob URL.
- `mjpeg_stop` cancels the tokio task; the dropped reqwest response closes the
  TCP socket in Rust/hyper. No webview socket is opened, so nothing lands in
  CLOSE_WAIT. The per-host ceiling is gone.
- Backpressure: forward every frame ZM sends (already throttled by `maxfps`). No
  frame-dropping logic in v1.

## Error handling and reconnect

The Channel carries either a raw binary frame (ArrayBuffer in JS) or a JSON
error message `{type:'error', message}`. Rust emits the error JSON and exits on
connection failure, non-200 status, malformed multipart, or stream EOF.
`mjpeg_start` also returns `Err` for immediate failures so the hook sees
synchronous failure. JS routes ArrayBuffer payloads to `onFrame` and JSON
payloads to `onError`.

On `onError` the hook treats it like today's stream death: it calls
`forceRegenerate()` (`useStreamLifecycle.ts:204`) to mint a fresh `connKey`,
which re-triggers the start effect. Backoff is exponential from new constants
(base 1s, cap ~15s) with a capped attempt count. After max attempts it surfaces
the existing stream-error UI state instead of looping. Each reconnect calls
`stopMjpegStream` on the old id first.

Logging uses `log.monitor` with explicit `LogLevel`, deduped like the existing
connkey chatter (`useStreamLifecycle.ts:109`). Transport is reported once per
stream, matching commit `c065d87`.

## Constants

To `lib/zmninja-ng-constants.ts`: reconnect backoff base, cap, and max attempts.
No magic numbers inline.

## Testing

### Rust unit tests (`mjpeg.rs` `#[cfg(test)]`)

- Multipart parser: feed a synthetic `multipart/x-mixed-replace` buffer (2-3 JPEG
  parts with boundaries, headers, `Content-Length`) and assert exact frame byte
  slices. Cover a frame split across two read chunks and a trailing partial frame.
- Cancellation: start a task against a local stub stream, cancel it, assert the
  task exits and the registry entry is removed.

### JS unit tests

- `lib/__tests__/tauri-mjpeg.test.ts` and `hooks/__tests__/useMonitorStream.test.ts`.
- Mock `@tauri-apps/api` `invoke` and `Channel` in `tests/setup.ts`.
- Assert: streaming mode on Tauri calls `startMjpegStream`, not
  `setImageSrc(streamUrl)`; each frame creates a blob URL and revokes the
  previous; unmount and connKey-regen both call `stopMjpegStream` and revoke the
  last URL; `onError` triggers `forceRegenerate` with backoff.

### E2E

The leak is Tauri-only, so automated web e2e cannot exercise it. Add a `@tauri`
scenario (open monitor, see live frames, go back, repeat 10 times, monitor still
displays) kept manual-invoke per the device-e2e policy. Web e2e stays green since
the non-Tauri path is unchanged.

## Documentation

- `docs/developer-guide/07-api-and-data-fetching.rst`: document `mjpeg_start` /
  `mjpeg_stop` and the `tauri-mjpeg.ts` wrapper, with the WebKitGTK socket-leak
  rationale (refs #150).
- Document new constants where they live.

## i18n

No new user-facing strings expected; reconnect reuses the existing stream-error
UI. Any new string updates all 5 locales (en, de, es, fr, zh).

## Out of scope

- Frame-dropping / backpressure beyond ZM's `maxfps`.
- Changing web, iOS, or Android transport (the leak is WebKitGTK-specific; those
  paths are unchanged).
- Removing the CMD_QUIT lifecycle.
