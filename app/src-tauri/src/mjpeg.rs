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
}
