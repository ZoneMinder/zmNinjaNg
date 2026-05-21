//! MJPEG streaming for Tauri desktop.
//!
//! WebKitGTK/libsoup leaks the TCP socket of an aborted multipart/x-mixed-replace
//! response (CLOSE_WAIT), so an <img> pointed at nph-zms in streaming mode
//! exhausts the per-host connection pool after ~8 monitors (refs #155, #150).
//! Here Rust owns the socket: it reads the MJPEG stream, demuxes JPEG frames, and
//! pushes them to the webview over a Channel. Dropping the response closes the
//! socket cleanly, so the webview never opens one.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio_util::sync::CancellationToken;

/// Demuxes a multipart/x-mixed-replace MJPEG byte stream into individual JPEG
/// frames by scanning for SOI (0xFFD8) and EOI (0xFFD9) markers. Multipart part
/// headers between frames are ignored. Safe across arbitrary chunk boundaries:
/// push() buffers a partial frame until its EOI arrives.
#[derive(Default)]
pub struct MjpegParser {
    buf: Vec<u8>,
}

/// Hard cap on a single buffered JPEG frame. ZM frames are well under this; a
/// larger partial means a truncated/corrupt stream, so we drop the bad frame
/// rather than buffer unboundedly.
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

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
                // Have a start but no end yet. A partial that exceeds the cap is a
                // truncated/corrupt frame: skip past the bad SOI and rescan for
                // the next one rather than buffer unboundedly.
                if self.buf.len() > MAX_FRAME_BYTES {
                    self.buf.drain(0..start + 2);
                    continue;
                }
                // Otherwise drop junk before SOI and keep the partial.
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
    // `client` is dropped when this fn returns; that's fine — the reqwest
    // Response keeps its own connection alive independently of the Client.
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

/// Fetch a single frame (mode=single) and return its bytes. Used by the desktop
/// snapshot path so all ZM image transport runs through this module. Unlike
/// mjpeg_start there is no persistent connection: one GET, response dropped.
#[tauri::command]
pub async fn mjpeg_snapshot(
    url: String,
    accept_invalid_certs: bool,
    timeout_ms: u64,
) -> Result<tauri::ipc::Response, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(accept_invalid_certs)
        .danger_accept_invalid_hostnames(accept_invalid_certs)
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
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
                    // Clean server close (ZM restart, session end). Surfaced as an
                    // error so the JS hook treats it as a reconnect signal.
                    None => return Err("stream ended".to_string()),
                }
            }
        }
    }
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

    #[test]
    fn discards_junk_with_no_soi() {
        let mut p = MjpegParser::new();
        let frames = p.push(b"--boundary\r\nContent-Type: image/jpeg\r\n\r\n");
        assert!(frames.is_empty());
        let f = frame(b"x");
        let frames = p.push(&f);
        assert_eq!(frames, vec![f]);
    }

    #[test]
    fn drops_oversized_partial_frame() {
        let mut p = MjpegParser::new();
        assert!(p.push(&SOI).is_empty());
        // Oversized payload with no EOI (zero bytes never form 0xFF 0xD9).
        let frames = p.push(&vec![0u8; MAX_FRAME_BYTES + 16]);
        assert!(frames.is_empty());
        // Parser recovered: a following complete frame still parses.
        let f = frame(b"ok");
        let frames = p.push(&f);
        assert_eq!(frames, vec![f]);
    }

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
}
