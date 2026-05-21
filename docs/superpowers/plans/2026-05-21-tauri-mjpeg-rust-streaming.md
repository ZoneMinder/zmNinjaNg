# Tauri MJPEG Streaming via Rust Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream live MJPEG frames through a Rust multipart reader on Tauri desktop so the webview never opens an `nph-zms` socket, fixing the WebKitGTK CLOSE_WAIT leak that kills monitor views after ~8 opens.

**Architecture:** A Rust Tauri command opens the `multipart/x-mixed-replace` connection with reqwest, demuxes JPEG frames (scanning SOI/EOI markers), and pushes each frame to the webview over a Tauri `Channel` as raw bytes. `useMonitorStream` gates on `Platform.isTauri && effectiveViewMode === 'streaming'` and renders frames as blob URLs, reusing the existing `blobUrlRef` lifecycle from the #150 snapshot fix. Errors flow back over the same Channel as JSON; the hook reconnects with exponential backoff via the existing `forceRegenerate` connkey lifecycle.

**Tech Stack:** Rust (Tauri 2.10.2, reqwest 0.12, tokio, tokio-util `CancellationToken`), TypeScript/React, Vitest.

**Issue:** refs #155 refs #150
**Spec:** `docs/superpowers/specs/2026-05-21-tauri-mjpeg-streaming-design.md`

**Refinements vs spec (intentional):**
- The frame demuxer scans JPEG SOI (`FF D8`) / EOI (`FF D9`) markers instead of parsing multipart boundary strings + `Content-Length`. This makes the parser a pure, chunk-split-safe function trivial to unit test, and is a common MJPEG demux approach. Multipart part headers are ignored.
- The Rust command does not take a `conn_key` parameter (it is already embedded in the stream URL). One less argument to thread.

---

## File Structure

**Rust (`app/src-tauri/`):**
- Create `src/mjpeg.rs` — the `MjpegParser` demuxer, `MjpegState` cancellation registry, and `mjpeg_start` / `mjpeg_stop` commands. One responsibility: own the MJPEG socket and feed frames to the webview.
- Modify `src/lib.rs` — register the module, manage `MjpegState`, add the two commands to `generate_handler!`.
- Modify `Cargo.toml` — add `reqwest`, `tokio`, `tokio-util`.

**TypeScript (`app/src/`):**
- Create `lib/tauri-mjpeg.ts` — thin `startMjpegStream` / `stopMjpegStream` wrapper hiding `invoke` + `Channel` + the SSL-trust flag.
- Create `lib/__tests__/tauri-mjpeg.test.ts` — wrapper unit tests.
- Modify `hooks/useMonitorStream.ts` — add the `useRustStreaming` gate, the start/stop effect, reconnect, and transport logging.
- Modify `lib/zmninja-ng-constants.ts` — add reconnect backoff constants to `ZM_INTEGRATION`.
- Create `hooks/__tests__/useMonitorStream.rust-streaming.test.ts` — hook streaming-path tests.
- Modify `hooks/__tests__/useMonitorStream.blob-snapshot.test.ts` — update the now-inverted streaming assertion and mock the new wrapper.
- Modify `tests/setup.ts` — extend the `@tauri-apps/api/core` handling so `invoke` / `Channel` are available to mocks.

**Docs / E2E:**
- Modify `docs/developer-guide/07-api-and-data-fetching.rst` — document the commands and wrapper.
- Create `tests/features/monitor-streaming-tauri.feature` + steps — manual-invoke `@tauri` regression scenario.

---

## Task 1: Rust MJPEG frame demuxer (`MjpegParser`)

**Files:**
- Create: `app/src-tauri/src/mjpeg.rs`

- [ ] **Step 1: Write the failing tests**

Create `app/src-tauri/src/mjpeg.rs` with only the parser and its tests:

```rust
//! MJPEG streaming for Tauri desktop.
//!
//! WebKitGTK/libsoup leaks the TCP socket of an aborted multipart/x-mixed-replace
//! response (CLOSE_WAIT), so an <img> pointed at nph-zms in streaming mode
//! exhausts the per-host connection pool after ~8 monitors (refs #155, #150).
//! Here Rust owns the socket: it reads the MJPEG stream, demuxes JPEG frames, and
//! pushes them to the webview over a Channel. Dropping the response closes the
//! socket cleanly, so the webview never opens one.

/// Demuxes a multipart/x-mixed-replace MJPEG byte stream into individual JPEG
/// frames by scanning for SOI (0xFFD8) and EOI (0xFFD9) markers. Multipart part
/// headers between frames are ignored. Safe across arbitrary chunk boundaries:
/// push() buffers a partial frame until its EOI arrives.
pub struct MjpegParser {
    buf: Vec<u8>,
}

impl MjpegParser {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Append a chunk and return every complete JPEG frame now available.
    pub fn push(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(data);
        let mut frames = Vec::new();
        loop {
            let Some(start) = find(&self.buf, &[0xFF, 0xD8]) else {
                // No frame start yet. Keep at most one trailing byte so an
                // 0xFF split across chunks can still pair with a following 0xD8.
                if self.buf.len() > 1 {
                    self.buf.drain(0..self.buf.len() - 1);
                }
                break;
            };
            let Some(rel_end) = find(&self.buf[start + 2..], &[0xFF, 0xD9]) else {
                // Have a start but no end yet: drop junk before SOI, keep partial.
                if start > 0 {
                    self.buf.drain(0..start);
                }
                break;
            };
            let end = start + 2 + rel_end + 2; // inclusive of EOI
            frames.push(self.buf[start..end].to_vec());
            self.buf.drain(0..end);
        }
        frames
    }
}

/// Index of the first occurrence of `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOI: [u8; 2] = [0xFF, 0xD8];
    const EOI: [u8; 2] = [0xFF, 0xD9];

    fn frame(payload: &[u8]) -> Vec<u8> {
        let mut f = SOI.to_vec();
        f.extend_from_slice(payload);
        f.extend_from_slice(&EOI);
        f
    }

    #[test]
    fn extracts_two_full_frames_from_one_chunk() {
        let mut p = MjpegParser::new();
        let a = frame(b"aaaa");
        let b = frame(b"bbbb");
        let mut chunk = b"--boundary\r\nContent-Type: image/jpeg\r\n\r\n".to_vec();
        chunk.extend_from_slice(&a);
        chunk.extend_from_slice(b"\r\n--boundary\r\n\r\n");
        chunk.extend_from_slice(&b);
        let frames = p.push(&chunk);
        assert_eq!(frames, vec![a, b]);
    }

    #[test]
    fn reassembles_a_frame_split_across_two_chunks() {
        let mut p = MjpegParser::new();
        let f = frame(b"splitpayload");
        let (head, tail) = f.split_at(5);
        assert!(p.push(head).is_empty());
        let frames = p.push(tail);
        assert_eq!(frames, vec![f]);
    }

    #[test]
    fn keeps_trailing_partial_frame_buffered() {
        let mut p = MjpegParser::new();
        let complete = frame(b"one");
        let mut chunk = complete.clone();
        chunk.extend_from_slice(&SOI); // start of a second, incomplete frame
        chunk.extend_from_slice(b"partial");
        let frames = p.push(&chunk);
        assert_eq!(frames, vec![complete]);
        // Finish the second frame on the next chunk.
        let frames = p.push(&EOI);
        assert_eq!(frames, vec![frame(b"partial")]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail to compile/run**

Run: `cd app/src-tauri && cargo test mjpeg::tests 2>&1 | tail -20`
Expected: fails — `mjpeg` module is not yet declared in `lib.rs`, so `cargo test` does not compile it. (Proceed; Step 3 wires the module so the tests compile and the assertions are exercised.)

- [ ] **Step 3: Declare the module so the tests compile**

In `app/src-tauri/src/lib.rs`, add the module declaration at the top, after the existing `mod biometric;` (line 1):

```rust
mod biometric;
mod mjpeg;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/src-tauri && cargo test mjpeg::tests 2>&1 | tail -20`
Expected: `test result: ok. 3 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/mjpeg.rs app/src-tauri/src/lib.rs
git commit -m "feat(tauri): MJPEG frame demuxer for Rust streaming reader

refs #155"
```

---

## Task 2: Rust streaming commands + cancellation registry

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/mjpeg.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies**

In `app/src-tauri/Cargo.toml`, under `[dependencies]` (after the `tauri-plugin-dialog` line), add:

```toml
reqwest = { version = "0.12", features = ["stream"] }
tokio = { version = "1", features = ["macros", "rt"] }
tokio-util = "0.7"
```

(reqwest 0.12 matches the version `tauri-plugin-http` 2.5.7 already resolves; feature unification keeps a single copy. Per AGENTS.md rule 16, keep `@tauri-apps/*` and `tauri-plugin-*` JS/Rust versions aligned when bumping.)

- [ ] **Step 2: Write the failing cancellation-registry test**

In `app/src-tauri/src/mjpeg.rs`, add to the existing `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn cancel_signals_token_and_removes_entry() {
        let state = MjpegState::default();
        let id = state.next_id();
        let token = tokio_util::sync::CancellationToken::new();
        state.insert(id, token.clone());
        assert!(!token.is_cancelled());

        state.cancel(id);

        assert!(token.is_cancelled());
        assert!(state.map.lock().unwrap().is_empty());
    }

    #[test]
    fn ids_are_unique_and_increasing() {
        let state = MjpegState::default();
        let a = state.next_id();
        let b = state.next_id();
        assert!(b > a);
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app/src-tauri && cargo test mjpeg::tests 2>&1 | tail -20`
Expected: FAIL — `MjpegState` is not defined.

- [ ] **Step 4: Implement the registry and commands**

In `app/src-tauri/src/mjpeg.rs`, add above the `#[cfg(test)]` block:

```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio_util::sync::CancellationToken;

/// Per-app registry mapping a stream id to its cancellation token. Cloneable so
/// the streaming task can capture it and remove its own entry on exit.
#[derive(Clone, Default)]
pub struct MjpegState {
    next: Arc<AtomicU64>,
    map: Arc<Mutex<HashMap<u64, CancellationToken>>>,
}

impl MjpegState {
    fn next_id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn insert(&self, id: u64, token: CancellationToken) {
        self.map.lock().unwrap().insert(id, token);
    }

    fn remove(&self, id: u64) {
        self.map.lock().unwrap().remove(&id);
    }

    fn cancel(&self, id: u64) {
        if let Some(token) = self.map.lock().unwrap().remove(&id) {
            token.cancel();
        }
    }
}

fn send_error(channel: &Channel<InvokeResponseBody>, message: String) {
    let body = serde_json::json!({ "type": "error", "message": message }).to_string();
    let _ = channel.send(InvokeResponseBody::Json(body));
}

/// Open an MJPEG stream, demux frames, and push each as raw bytes down `on_frame`.
/// Returns a stream id for `mjpeg_stop`. Returns Err for immediate failures
/// (bad URL, TLS handshake, connect refused, non-2xx status).
#[tauri::command]
pub async fn mjpeg_start(
    state: tauri::State<'_, MjpegState>,
    url: String,
    accept_invalid_certs: bool,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(accept_invalid_certs)
        .danger_accept_invalid_hostnames(accept_invalid_certs)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let id = state.next_id();
    let token = CancellationToken::new();
    state.insert(id, token.clone());

    let registry = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(message) = pump(response, &on_frame, &token).await {
            // Suppress the cancellation-induced error; a normal stop is not an error.
            if !token.is_cancelled() {
                send_error(&on_frame, message);
            }
        }
        registry.remove(id);
    });

    Ok(id)
}

/// Cancel a running stream. The task's reqwest response is dropped, closing the
/// socket in hyper. No-op if the id is unknown.
#[tauri::command]
pub async fn mjpeg_stop(state: tauri::State<'_, MjpegState>, stream_id: u64) -> Result<(), String> {
    state.cancel(stream_id);
    Ok(())
}

async fn pump(
    mut response: reqwest::Response,
    channel: &Channel<InvokeResponseBody>,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut parser = MjpegParser::new();
    loop {
        tokio::select! {
            _ = token.cancelled() => return Ok(()),
            chunk = response.chunk() => {
                match chunk.map_err(|e| e.to_string())? {
                    Some(bytes) => {
                        for frame in parser.push(&bytes) {
                            channel
                                .send(InvokeResponseBody::Raw(frame))
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    None => return Err("stream ended".to_string()),
                }
            }
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/src-tauri && cargo test mjpeg::tests 2>&1 | tail -20`
Expected: `test result: ok. 5 passed`

- [ ] **Step 6: Register state and commands**

In `app/src-tauri/src/lib.rs`, add `.manage(...)` before `.invoke_handler(...)` (the builder starts at line 15) and add the commands to the handler list (currently lines 33-36):

```rust
    tauri::Builder::default()
        .manage(mjpeg::MjpegState::default())
        .plugin(tauri_plugin_http::init())
```

and:

```rust
        .invoke_handler(tauri::generate_handler![
            biometric::check_biometric_available,
            biometric::authenticate_biometric,
            mjpeg::mjpeg_start,
            mjpeg::mjpeg_stop,
        ])
```

- [ ] **Step 7: Verify the crate builds**

Run: `cd app/src-tauri && cargo build 2>&1 | tail -20`
Expected: `Finished` with no errors.

- [ ] **Step 8: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src/mjpeg.rs app/src-tauri/src/lib.rs
git commit -m "feat(tauri): mjpeg_start/mjpeg_stop commands with cancellation registry

refs #155"
```

---

## Task 3: JS wrapper `tauri-mjpeg.ts`

**Files:**
- Create: `app/src/lib/tauri-mjpeg.ts`
- Create: `app/src/lib/__tests__/tauri-mjpeg.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/__tests__/tauri-mjpeg.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
// A fake Channel that lets the test push messages to whatever onmessage handler
// the wrapper installs, mirroring @tauri-apps/api/core's Channel.
class FakeChannel<T> {
  onmessage: ((msg: T) => void) | null = null;
  emit(msg: T) {
    this.onmessage?.(msg);
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: FakeChannel,
}));

vi.mock('../ssl-trust', () => ({
  isTauriSslTrustEnabled: vi.fn(() => true),
}));

import { startMjpegStream, stopMjpegStream } from '../tauri-mjpeg';

describe('tauri-mjpeg wrapper', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes mjpeg_start with the url, ssl-trust flag, and a channel, returning the id', async () => {
    invoke.mockResolvedValue(7);
    const onFrame = vi.fn();
    const onError = vi.fn();

    const id = await startMjpegStream('https://zm/nph-zms?mode=jpeg', onFrame, onError);

    expect(id).toBe(7);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe('mjpeg_start');
    expect(args).toMatchObject({
      url: 'https://zm/nph-zms?mode=jpeg',
      acceptInvalidCerts: true,
    });
    expect(args.onFrame).toBeInstanceOf(FakeChannel);
  });

  it('routes ArrayBuffer messages to onFrame and JSON error messages to onError', async () => {
    let captured: FakeChannel<unknown> | undefined;
    invoke.mockImplementation(async (_cmd: string, args: { onFrame: FakeChannel<unknown> }) => {
      captured = args.onFrame;
      return 1;
    });
    const onFrame = vi.fn();
    const onError = vi.fn();

    await startMjpegStream('https://zm/x', onFrame, onError);

    const frame = new ArrayBuffer(8);
    captured!.emit(frame);
    captured!.emit({ type: 'error', message: 'boom' });

    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('stops a stream by id', async () => {
    invoke.mockResolvedValue(undefined);
    await stopMjpegStream(42);
    expect(invoke).toHaveBeenCalledWith('mjpeg_stop', { streamId: 42 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test -- tauri-mjpeg 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../tauri-mjpeg'`.

- [ ] **Step 3: Implement the wrapper**

Create `app/src/lib/tauri-mjpeg.ts`:

```typescript
/**
 * Tauri MJPEG streaming wrapper.
 *
 * Bridges the Rust mjpeg_start/mjpeg_stop commands to the webview. Frames arrive
 * on a Channel as raw bytes (ArrayBuffer); errors arrive as a JSON object. The
 * Rust side owns the nph-zms socket so WebKitGTK never opens one (refs #155, #150).
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import { isTauriSslTrustEnabled } from './ssl-trust';

interface MjpegErrorMessage {
  type: 'error';
  message: string;
}

type MjpegMessage = ArrayBuffer | MjpegErrorMessage;

/**
 * Start a Rust-owned MJPEG stream. Resolves with a stream id to pass to
 * stopMjpegStream. onFrame receives raw JPEG bytes per frame; onError receives a
 * message string when the stream fails or ends.
 */
export async function startMjpegStream(
  url: string,
  onFrame: (bytes: ArrayBuffer) => void,
  onError: (message: string) => void,
): Promise<number> {
  const channel = new Channel<MjpegMessage>();
  channel.onmessage = (message) => {
    if (message instanceof ArrayBuffer) {
      onFrame(message);
    } else if (message && typeof message === 'object' && message.type === 'error') {
      onError(message.message);
    }
  };

  return invoke<number>('mjpeg_start', {
    url,
    acceptInvalidCerts: isTauriSslTrustEnabled(),
    onFrame: channel,
  });
}

/** Cancel a running stream. Safe to call with an already-finished id. */
export async function stopMjpegStream(streamId: number): Promise<void> {
  await invoke('mjpeg_stop', { streamId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- tauri-mjpeg 2>&1 | tail -20`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tauri-mjpeg.ts app/src/lib/__tests__/tauri-mjpeg.test.ts
git commit -m "feat(stream): tauri-mjpeg wrapper for Rust-owned MJPEG streaming

refs #155"
```

---

## Task 4: Reconnect constants

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts:18-31` (the `ZM_INTEGRATION` object)

- [ ] **Step 1: Add the constants**

In `app/src/lib/zmninja-ng-constants.ts`, inside the `ZM_INTEGRATION` object, after the `snapshotFrameFetchTimeoutMs` line (line 31), add:

```typescript
  // Reconnect backoff for the Tauri Rust MJPEG stream when the connection drops
  // or ends (server restart, network blip). Exponential from base, capped, with
  // a bounded attempt count before surfacing the stream-error state. Refs #155.
  mjpegReconnectBaseDelayMs: 1000, // 1 second
  mjpegReconnectMaxDelayMs: 15000, // 15 seconds
  mjpegReconnectMaxAttempts: 6,
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/zmninja-ng-constants.ts
git commit -m "feat(stream): MJPEG reconnect backoff constants

refs #155"
```

---

## Task 5: Wire Rust streaming into `useMonitorStream`

**Files:**
- Modify: `app/src/hooks/useMonitorStream.ts`
- Create: `app/src/hooks/__tests__/useMonitorStream.rust-streaming.test.ts`
- Modify: `app/src/hooks/__tests__/useMonitorStream.blob-snapshot.test.ts`

- [ ] **Step 1: Write the failing hook tests**

Create `app/src/hooks/__tests__/useMonitorStream.rust-streaming.test.ts`:

```typescript
/**
 * useMonitorStream: Tauri Rust MJPEG streaming path (#155)
 *
 * On Tauri desktop in streaming mode, frames are pulled by the Rust reader and
 * pushed over a Channel, then shown as blob: URLs, so the webview never opens an
 * nph-zms socket (WebKitGTK CLOSE_WAIT leak). These tests verify the start call,
 * the per-frame blob lifecycle, teardown on unmount, and error-driven reconnect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonitorStream } from '../useMonitorStream';
import { useMonitorStore } from '../../stores/monitors';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { startMjpegStream, stopMjpegStream } from '../../lib/tauri-mjpeg';
import type { Profile } from '../../api/types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

vi.mock('../../lib/tauri-mjpeg', () => ({
  startMjpegStream: vi.fn(),
  stopMjpegStream: vi.fn(),
}));

vi.mock('../../lib/http', () => ({ httpGet: vi.fn() }));

vi.mock('../../lib/logger', () => ({
  log: {
    monitor: vi.fn(),
    dedupe: (_k: string, _w: number, emit: (s: string) => void) => emit(''),
  },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../api/monitors', () => ({
  getStreamUrl: (cgiUrl: string, monitorId: string, options: any) => {
    const params = new URLSearchParams();
    params.set('monitor', monitorId);
    if (options.mode) params.set('mode', options.mode);
    if (options.connkey) params.set('connkey', options.connkey.toString());
    return `${cgiUrl}/nph-zms?${params.toString()}`;
  },
}));

vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string) =>
    `${portalUrl}/api/host/daemonControl.json?command=${command}&connkey=${connkey}`,
}));

vi.mock('../../lib/zm-constants', () => ({ ZMS_COMMANDS: { cmdQuit: 'quit' } }));

const mockStart = vi.mocked(startMjpegStream);
const mockStop = vi.mocked(stopMjpegStream);

describe('useMonitorStream: Tauri Rust MJPEG streaming path', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  let objectUrlCounter = 0;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  // Captured frame/error callbacks from the most recent startMjpegStream call.
  let lastOnFrame: ((bytes: ArrayBuffer) => void) | undefined;
  let lastOnError: ((message: string) => void) | undefined;

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [mockProfile],
      currentProfileId: 'profile-1',
      isInitialized: true,
      isBootstrapping: false,
      bootstrapStep: null,
    });
    useAuthStore.setState({
      accessToken: 'test-token',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      refreshToken: null,
      isAuthenticated: false,
    });
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming', streamMaxFps: 5 },
      },
    });

    let nextKey = 1000;
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn(() => ++nextKey),
    });

    objectUrlCounter = 0;
    createObjectURL = vi.fn(() => `blob:mock-${++objectUrlCounter}`);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    let nextId = 100;
    mockStart.mockReset();
    mockStop.mockReset();
    mockStart.mockImplementation(async (_url, onFrame, onError) => {
      lastOnFrame = onFrame;
      lastOnError = onError;
      return ++nextId;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a Rust MJPEG stream for the streamUrl instead of binding <img src> to it', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalled();
    });
    const [calledUrl] = mockStart.mock.calls[0];
    expect(calledUrl).toContain('/nph-zms?');
    expect(calledUrl).toContain('mode=jpeg');
    // imageSrc must NOT be the raw stream URL; the webview must not load nph-zms.
    expect(result.current.imageSrc).not.toBe(result.current.streamUrl);
  });

  it('renders each frame as a blob URL and revokes the previous one', async () => {
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    act(() => lastOnFrame!(new ArrayBuffer(4)));
    await waitFor(() => expect(result.current.imageSrc).toBe('blob:mock-1'));
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => lastOnFrame!(new ArrayBuffer(4)));
    await waitFor(() => expect(result.current.imageSrc).toBe('blob:mock-2'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:mock-2');
  });

  it('stops the stream and revokes the last blob URL on unmount', async () => {
    const { result, unmount } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    act(() => lastOnFrame!(new ArrayBuffer(4)));
    await waitFor(() => expect(result.current.imageSrc).toBe('blob:mock-1'));

    unmount();

    expect(mockStop).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('reconnects with backoff after an error by regenerating the connkey', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    const firstUrl = result.current.streamUrl;

    act(() => lastOnError!('stream ended'));
    // Backoff base is 1000ms; advance past it to fire the reconnect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
    // Reconnect minted a fresh connkey, so the new stream URL differs.
    expect(result.current.streamUrl).not.toBe(firstUrl);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test -- useMonitorStream.rust-streaming 2>&1 | tail -30`
Expected: FAIL — streaming on Tauri currently sets `imageSrc = streamUrl` and never calls `startMjpegStream`.

- [ ] **Step 3: Add the import and gate**

In `app/src/hooks/useMonitorStream.ts`, add the import after the `httpGet` import (line 25):

```typescript
import { httpGet } from '../lib/http';
import { startMjpegStream, stopMjpegStream } from '../lib/tauri-mjpeg';
```

After the `useBlobSnapshots` declaration (line 93), add:

```typescript
  // On Tauri desktop in streaming mode, the persistent MJPEG connection is owned
  // by the Rust reader (mjpeg_start). Frames arrive over a Channel and are shown
  // as blob: URLs, so the webview never opens the nph-zms socket that WebKitGTK
  // leaks in CLOSE_WAIT. Refs #155, #150.
  const useRustStreaming = Platform.isTauri && effectiveViewMode === 'streaming';
```

Add the import for the constants object — it is already imported as `ZM_INTEGRATION` (line 26), so no new import is needed.

- [ ] **Step 4: Skip the default `<img src>` path when Rust-streaming**

In `app/src/hooks/useMonitorStream.ts`, change the default-path effect (line 159-162) from:

```typescript
  useEffect(() => {
    if (useBlobSnapshots) return;
    setImageSrc(streamUrl);
  }, [useBlobSnapshots, streamUrl]);
```

to:

```typescript
  useEffect(() => {
    if (useBlobSnapshots || useRustStreaming) return;
    setImageSrc(streamUrl);
  }, [useBlobSnapshots, useRustStreaming, streamUrl]);
```

- [ ] **Step 5: Add the Rust streaming effect**

In `app/src/hooks/useMonitorStream.ts`, add the refs after `blobUrlRef` (line 97):

```typescript
  const blobUrlRef = useRef<string>('');
  const streamIdRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Then add this effect immediately after the Tauri blob-snapshot effect (after line 214, before the unmount-revoke effect at line 218):

```typescript
  // Tauri desktop + streaming mode: the Rust reader owns the nph-zms socket and
  // pushes JPEG frames over a Channel. Each frame becomes a blob: URL; the
  // previous one is revoked. On error/EOF we reconnect with exponential backoff
  // by minting a fresh connkey (forceRegenerate), which re-runs this effect.
  useEffect(() => {
    if (!enabled || !useRustStreaming) return;
    if (!streamUrl) {
      setImageSrc('');
      return;
    }

    let cancelled = false;
    let localId: number | null = null;

    const onFrame = (bytes: ArrayBuffer) => {
      if (cancelled) return;
      reconnectAttemptRef.current = 0;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const previousUrl = blobUrlRef.current;
      blobUrlRef.current = url;
      setImageSrc(url);
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    };

    const scheduleReconnect = () => {
      const attempt = reconnectAttemptRef.current;
      if (attempt >= ZM_INTEGRATION.mjpegReconnectMaxAttempts) {
        log.monitor(
          `MJPEG stream gave up after ${attempt} reconnect attempts for monitor ${monitorId}`,
          LogLevel.ERROR,
          { monitorId },
        );
        return;
      }
      reconnectAttemptRef.current = attempt + 1;
      const delay = Math.min(
        ZM_INTEGRATION.mjpegReconnectBaseDelayMs * 2 ** attempt,
        ZM_INTEGRATION.mjpegReconnectMaxDelayMs,
      );
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) forceRegenerate();
      }, delay);
    };

    const onError = (message: string) => {
      if (cancelled) return;
      log.monitor(`MJPEG stream error for monitor ${monitorId}`, LogLevel.WARN, {
        monitorId,
        message,
      });
      scheduleReconnect();
    };

    startMjpegStream(streamUrl, onFrame, onError)
      .then((id) => {
        if (cancelled) {
          stopMjpegStream(id);
        } else {
          localId = id;
          streamIdRef.current = id;
        }
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const id = localId ?? streamIdRef.current;
      if (id != null) {
        stopMjpegStream(id);
        streamIdRef.current = null;
      }
    };
    // forceRegenerate is a stable-enough callback from useStreamLifecycle; adding
    // it would re-run the effect every render. Mirror the connkey effect's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, useRustStreaming, streamUrl, monitorId]);
```

- [ ] **Step 6: Update transport logging**

In `app/src/hooks/useMonitorStream.ts`, change the transport effect (line 233-243) to report the Rust streaming path:

```typescript
  useEffect(() => {
    if (!enabled) return;
    const transport = useBlobSnapshots
      ? 'native-http'
      : useRustStreaming
        ? 'rust-mjpeg'
        : 'webkit';
    if (transport === lastLoggedImageTransport) return;
    lastLoggedImageTransport = transport;
    const label =
      transport === 'native-http'
        ? 'native HTTP (Tauri Rust client)'
        : transport === 'rust-mjpeg'
          ? 'Rust MJPEG reader (Tauri Channel)'
          : 'WebKit (webview <img>)';
    log.monitor(`Image transport: ${label}`, LogLevel.INFO, {
      transport,
      viewMode: effectiveViewMode,
    });
  }, [enabled, useBlobSnapshots, useRustStreaming, effectiveViewMode]);
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `cd app && npm test -- useMonitorStream.rust-streaming 2>&1 | tail -30`
Expected: PASS — 4 passed.

- [ ] **Step 8: Fix the inverted assertion in the blob-snapshot test**

The existing test `streaming mode on Tauri does not fetch frames and imageSrc equals streamUrl` (`app/src/hooks/__tests__/useMonitorStream.blob-snapshot.test.ts:233-254`) is now wrong: streaming on Tauri uses the Rust path. That file mocks `@tauri-apps/api/core` as `{ isTauri: () => true }` only, so the hook would call the real `startMjpegStream` (which needs `invoke`/`Channel`). Add a mock for the wrapper and rewrite the assertion.

Add this mock alongside the other `vi.mock` calls near the top of the file (after the `../../lib/http` mock at line 31-33):

```typescript
vi.mock('../../lib/tauri-mjpeg', () => ({
  startMjpegStream: vi.fn().mockResolvedValue(1),
  stopMjpegStream: vi.fn(),
}));
```

Replace the test body (lines 233-254) with:

```typescript
  it('streaming mode on Tauri uses the Rust reader, not the snapshot httpGet path', async () => {
    const { startMjpegStream } = await import('../../lib/tauri-mjpeg');
    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamMaxFps: 5,
        },
      },
    });

    const { result } = renderHook(() => useMonitorStream({ monitorId: '1' }));

    await waitFor(() => {
      expect(result.current.streamUrl).toContain('mode=jpeg');
    });

    // The Rust reader owns the socket; the snapshot blob fetch must not run, and
    // the webview must not bind <img src> to the raw nph-zms URL.
    await waitFor(() => {
      expect(startMjpegStream).toHaveBeenCalled();
    });
    expect(mockHttpGet).not.toHaveBeenCalled();
    expect(result.current.imageSrc).not.toBe(result.current.streamUrl);
  });
```

- [ ] **Step 9: Run the full unit suite + type-check + build**

Run: `cd app && npm test 2>&1 | tail -25`
Expected: all pass (including `useMonitorStream.blob-snapshot`, `useMonitorStream.rust-streaming`, `tauri-mjpeg`).

Run: `cd app && npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors.

Run: `cd app && npm run build 2>&1 | tail -20`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add app/src/hooks/useMonitorStream.ts app/src/hooks/__tests__/useMonitorStream.rust-streaming.test.ts app/src/hooks/__tests__/useMonitorStream.blob-snapshot.test.ts
git commit -m "feat(stream): route Tauri streaming-mode frames through the Rust MJPEG reader

Fixes the WebKitGTK CLOSE_WAIT socket leak that stopped individual monitor
views displaying after ~8 opens. Streaming mode on Tauri now pulls frames in
Rust and renders them as blob URLs; the webview never opens an nph-zms socket.

refs #155 refs #150"
```

---

## Task 6: Developer-guide documentation

**Files:**
- Modify: `docs/developer-guide/07-api-and-data-fetching.rst`

- [ ] **Step 1: Find the insertion point**

Run: `grep -n "150\|blob\|snapshot\|WebKitGTK\|Tauri" docs/developer-guide/07-api-and-data-fetching.rst | head`
Expected: locate the existing #150 / Tauri HTTP discussion (the snapshot blob section) to place the streaming section next to it. If no such section exists, append a new section at the end of the file.

- [ ] **Step 2: Add the section**

Add this section adjacent to the existing Tauri HTTP / snapshot discussion (match the file's existing heading underline style; this uses the chapter's sub-section level):

```rst
Tauri MJPEG streaming (Rust reader)
-----------------------------------

On Tauri desktop, live monitor views in streaming mode do not point an
``<img>`` at ``nph-zms``. WebKitGTK/libsoup does not release the socket of an
aborted ``multipart/x-mixed-replace`` response, so each opened monitor leaks a
CLOSE_WAIT socket and the per-host pool is exhausted after about eight monitors
(refs #155). The snapshot blob fix from #150 does not transfer, because a
streaming response never completes and a single blob fetch never resolves.

Instead, Rust owns the connection. ``mjpeg_start`` opens the stream with reqwest,
demuxes JPEG frames by scanning SOI/EOI markers, and pushes each frame to the
webview over a Tauri ``Channel`` as raw bytes. ``mjpeg_stop`` cancels the task;
dropping the reqwest response closes the socket in hyper. The webview never opens
a socket to ZoneMinder.

The JS wrapper ``lib/tauri-mjpeg.ts`` exposes ``startMjpegStream(url, onFrame,
onError)`` and ``stopMjpegStream(id)``. It passes the self-signed-cert flag from
``isTauriSslTrustEnabled()`` to Rust, builds the ``Channel``, and routes raw
ArrayBuffer messages to ``onFrame`` and JSON error messages to ``onError``.

``useMonitorStream`` selects this path with ``useRustStreaming = Platform.isTauri
&& effectiveViewMode === 'streaming'``. Each frame becomes a ``blob:`` URL bound
to ``imageSrc`` (the previous URL is revoked, reusing the #150 ``blobUrlRef``
lifecycle). On error or EOF the hook reconnects with exponential backoff
(``ZM_INTEGRATION.mjpegReconnect*``) by minting a fresh connkey via
``forceRegenerate``. On unmount and on connkey regeneration it calls
``stopMjpegStream``.
```

- [ ] **Step 3: Verify no banned words or em-dashes**

Run: `grep -niE "\b(comprehensive|robust|powerful|extensively|thoroughly|excellent|amazing|seamless|cutting.edge|state.of.the.art|user.friendly|ground.up rewrite)\b" docs/developer-guide/07-api-and-data-fetching.rst; grep -n "—" docs/developer-guide/07-api-and-data-fetching.rst`
Expected: zero hits for both.

- [ ] **Step 4: Commit**

```bash
git add docs/developer-guide/07-api-and-data-fetching.rst
git commit -m "docs(api): document Tauri MJPEG Rust streaming path

refs #155"
```

---

## Task 7: Manual `@tauri` e2e regression scenario

**Files:**
- Create: `app/tests/features/monitor-streaming-tauri.feature`
- Modify or create: `app/tests/steps/monitor.steps.ts` (only if the steps below are not already defined)

This scenario is `@tauri` and `@native`, so it is manual-invoke only per the device-e2e policy (`npm run test:e2e:tauri`). It does not run in the automated web workflow.

- [ ] **Step 1: Write the feature file**

Create `app/tests/features/monitor-streaming-tauri.feature`:

```gherkin
@tauri @native
Feature: Tauri streaming-mode monitors do not exhaust the socket pool

  Opening many individual monitors in streaming mode used to leak WebKitGTK
  sockets and stop displaying after about the eighth monitor (refs #155). The
  Rust MJPEG reader owns the socket, so monitors keep displaying.

  Background:
    Given I am logged into zmNinjaNg

  Scenario: Open ten monitors in sequence and each still displays live frames
    When I navigate to the "Montage" page
    Then I should see at least one monitor tile
    When I open and close each available monitor 10 times in sequence
    Then each opened monitor should display live video frames
    And the most recently opened monitor should still display live video frames
```

- [ ] **Step 2: Add any missing step definitions**

Run: `grep -rn "open and close each available monitor\|display live video frames" app/tests/steps/`
Expected: if these steps do not exist, implement them in `app/tests/steps/monitor.steps.ts` using the shared `TestActions` abstraction (driver-agnostic). The "display live video frames" check must verify the monitor image element has a non-blank `src` and updates over time (compare `naturalWidth`/`src` across a short interval), not merely that an element is visible.

- [ ] **Step 3: Verify the feature parses (dry run on web is expected to skip @tauri)**

Run: `cd app && npm run test:e2e -- monitor-streaming-tauri.feature 2>&1 | tail -20`
Expected: the `@tauri` scenario is filtered out of the web run (0 web scenarios executed), confirming the tag wiring. Full execution is manual via `npm run test:e2e:tauri` on a Tauri build.

- [ ] **Step 4: Commit**

```bash
git add app/tests/features/monitor-streaming-tauri.feature app/tests/steps/monitor.steps.ts
git commit -m "test(e2e): manual @tauri regression for streaming-mode socket pool

refs #155"
```

---

## Task 8: Unify desktop snapshot onto a custom Rust command

Replace the desktop snapshot transport (`@tauri-apps/plugin-http` via `httpGet`)
with a custom Rust `mjpeg_snapshot` command so all desktop ZM image transport
lives in the `mjpeg` module. Snapshot stays discrete/low-bandwidth; only the
mechanism changes. Tauri-only; web/iOS/Android snapshot paths unchanged.

**Files:**
- Modify: `app/src-tauri/src/mjpeg.rs` (add `mjpeg_snapshot` command)
- Modify: `app/src-tauri/src/lib.rs` (register command)
- Modify: `app/src/lib/tauri-mjpeg.ts` (add `fetchMjpegSnapshot`)
- Modify: `app/src/lib/__tests__/tauri-mjpeg.test.ts` (test the wrapper)
- Modify: `app/src/hooks/useMonitorStream.ts` (rewire `useBlobSnapshots` effect)
- Modify: `app/src/hooks/__tests__/useMonitorStream.blob-snapshot.test.ts` (mock `fetchMjpegSnapshot` instead of `httpGet`)

- [ ] **Step 1: Rust command (returns one JPEG frame's bytes)**

Add to `app/src-tauri/src/mjpeg.rs` (reuses the same reqwest client construction as `mjpeg_start`):

```rust
/// Fetch a single frame (mode=single) and return its bytes. Used by the desktop
/// snapshot path so all ZM image transport runs through this module. Unlike
/// mjpeg_start there is no persistent connection: one GET, response dropped.
#[tauri::command]
pub async fn mjpeg_snapshot(
    url: String,
    accept_invalid_certs: bool,
) -> Result<tauri::ipc::Response, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(accept_invalid_certs)
        .danger_accept_invalid_hostnames(accept_invalid_certs)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}
```

Register in `lib.rs` `generate_handler!`: add `mjpeg::mjpeg_snapshot,`.

Verify the `tauri::ipc::Response::new(Vec<u8>)` API against the installed Tauri 2.10.x; if it differs, return raw bytes by whatever API delivers an `ArrayBuffer` to JS. Build: `cd app/src-tauri && cargo build 2>&1 | tail -15` (Finished).

- [ ] **Step 2: JS wrapper test (TDD)**

Add to `app/src/lib/__tests__/tauri-mjpeg.test.ts`:

```typescript
  it('fetches a single snapshot frame as an ArrayBuffer with the ssl-trust flag', async () => {
    const buf = new Uint8Array([9, 9, 9]).buffer;
    invoke.mockResolvedValue(buf);
    const out = await fetchMjpegSnapshot('https://zm/nph-zms?mode=single');
    expect(out).toBe(buf);
    expect(invoke).toHaveBeenCalledWith('mjpeg_snapshot', {
      url: 'https://zm/nph-zms?mode=single',
      acceptInvalidCerts: true,
    });
  });
```

Add `fetchMjpegSnapshot` to the import under test. Run `cd app && npm test -- tauri-mjpeg 2>&1 | tail -20` (fails: not exported).

- [ ] **Step 3: Implement the wrapper**

Add to `app/src/lib/tauri-mjpeg.ts`:

```typescript
/** Fetch a single snapshot frame's bytes through the Rust HTTP path (desktop). */
export async function fetchMjpegSnapshot(url: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('mjpeg_snapshot', {
    url,
    acceptInvalidCerts: isTauriSslTrustEnabled(),
  });
}
```

Run the wrapper test again (passes).

- [ ] **Step 4: Rewire the snapshot effect in useMonitorStream.ts**

In the `useBlobSnapshots` effect, replace the `httpGet<Blob>(streamUrl, {responseType:'blob', signal, ...})` call with `fetchMjpegSnapshot(streamUrl)`, building the blob from the returned bytes: `const blob = new Blob([bytes], { type: 'image/jpeg' });`. Drop the `AbortController`/`signal` (Tauri `invoke` is not abortable); keep the `cancelled` flag to discard stale results, and keep the blob-URL create/revoke and error logging. Remove the now-unused `httpGet` import if nothing else in the file uses it (check first; the file may still use it elsewhere).

- [ ] **Step 5: Update the blob-snapshot test file**

In `app/src/hooks/__tests__/useMonitorStream.blob-snapshot.test.ts`, replace the `vi.mock('../../lib/http', ...)` usage for the snapshot path with a mock of `fetchMjpegSnapshot` from `../../lib/tauri-mjpeg` (the file already mocks `tauri-mjpeg` for the streaming test from Task 5; extend it to include `fetchMjpegSnapshot: vi.fn().mockResolvedValue(new ArrayBuffer(4))`). Update the snapshot assertions: they should assert `fetchMjpegSnapshot` is called with a `mode=single` URL and that the blob-URL lifecycle (create on success, revoke previous, revoke on unmount) still holds. Keep the error-path test (reject `fetchMjpegSnapshot`, assert no crash, `imageSrc` stays `''`, error logged).

- [ ] **Step 6: Full gate + commit**

`cd app && npm test 2>&1 | tail -25` (all pass), `npx tsc --noEmit` (clean), `npm run build` (succeeds); `cd app/src-tauri && cargo test mjpeg::tests 2>&1 | tail -15` (pass), `cargo build` (Finished). Commit the six files (plus Cargo.lock if changed):

```bash
git commit -m "feat(stream): unify desktop snapshot onto the mjpeg Rust command

refs #155"
```

---

## Task 9: Streaming as the default view mode on desktop

**Files:**
- Modify: `app/src/stores/settings.ts:188-189` (`DEFAULT_SETTINGS.viewMode`)
- Test: `app/src/stores/__tests__/settings.test.ts` (or the existing settings test file)

- [ ] **Step 1: Write the failing test**

Add a test that asserts the default `viewMode` is `'streaming'` when `Platform.isTauri` is true and `'snapshot'` otherwise, and that an explicitly stored `viewMode` is preserved by `getProfileSettings`/the merge. Mock `@tauri-apps/api/core` `isTauri` to true in one case. (Match the existing settings test file's structure; if none tests defaults, create `app/src/stores/__tests__/settings.test.ts`.)

- [ ] **Step 2: Implement**

In `app/src/stores/settings.ts`, import `Platform` and change the default:

```typescript
import { Platform } from '../lib/platform';
// ...
export const DEFAULT_SETTINGS: ProfileSettings = {
  viewMode: Platform.isTauri ? 'streaming' : 'snapshot',
  // ...
};
```

Confirm the `{...DEFAULT_SETTINGS, ...stored}` merge (settings.ts:280, :288) still preserves an explicit stored `viewMode` (it does, since stored wins). If `DEFAULT_SETTINGS` is evaluated at module load before the Tauri runtime is ready, verify `Platform.isTauri` returns correctly at that point; if not, compute the default in the getter/merge path instead of the const.

- [ ] **Step 3: Gate + commit**

`cd app && npm test 2>&1 | tail -20`, `npx tsc --noEmit`, `npm run build`. Commit:

```bash
git commit -m "feat(settings): default to streaming view mode on desktop

refs #155"
```

---

## Final verification

- [ ] **Step 1: Full gate**

Run from `app/`:
```bash
npm test 2>&1 | tail -25
npx tsc --noEmit 2>&1 | tail -20
npm run build 2>&1 | tail -20
```
Expected: all pass.

Run from `app/src-tauri/`:
```bash
cargo test mjpeg 2>&1 | tail -20
cargo build 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 2: Manual Tauri smoke (developer machine)**

Build and run the Tauri app, open 10 monitors in streaming mode in sequence, confirm the 9th and 10th still display. On Linux, confirm sockets do not accumulate:
```bash
ss -tan | grep CLOSE-WAIT | wc -l   # before and after; should not grow per monitor
```

State which tests were run in the final summary, per AGENTS.md: "Tests verified: npm test, tsc --noEmit, build, cargo test, cargo build."

---

## Self-Review Notes

- **Spec coverage:** Scope (hook-level, all streaming consumers) → Task 5. Transport (Channel binary + JSON error) → Tasks 2, 3. Platforms (all Tauri) → `useRustStreaming = Platform.isTauri && ...` in Task 5. Reconnect (Rust signals, JS backoff via forceRegenerate) → Tasks 4, 5. Constants → Task 4. Rust parser + cancellation tests → Tasks 1, 2. JS unit tests → Tasks 3, 5. E2E manual @tauri → Task 7. Docs → Task 6. i18n → no new strings (reconnect reuses existing UI), so no locale task; if a string is added during implementation, update all five locales before committing.
- **Type consistency:** `startMjpegStream(url, onFrame, onError) => Promise<number>` and `stopMjpegStream(id)` used identically in Tasks 3 and 5. Rust `mjpeg_start(url, accept_invalid_certs, on_frame) -> Result<u64>` / `mjpeg_stop(stream_id)` match the JS invoke args (`acceptInvalidCerts`, `streamId`, `onFrame`) via Tauri's camelCase↔snake_case mapping. `MjpegParser::new()` / `push()` consistent across Tasks 1-2. `ZM_INTEGRATION.mjpegReconnectBaseDelayMs|MaxDelayMs|MaxAttempts` defined in Task 4, consumed in Task 5.
- **Open verification during implementation:** the exact `tauri::ipc::Channel<InvokeResponseBody>` send API and JS delivery type (ArrayBuffer for `Raw`) should be confirmed against Tauri 2.10.2 when `cargo build` (Task 2 Step 7) and the wrapper test (Task 3) run; adjust the discrimination in `tauri-mjpeg.ts` if a version delivers raw bytes as a typed array rather than `ArrayBuffer`.
