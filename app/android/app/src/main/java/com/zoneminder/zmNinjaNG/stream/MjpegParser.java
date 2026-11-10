package com.zoneminder.zmNinjaNG.stream;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Splits a multipart/x-mixed-replace MJPEG byte stream into JPEG frames. Feed it
 * chunks of any size; the listener fires once per complete frame. Mirrors the iOS
 * MjpegParser so both platforms treat the same bytes the same way. Not thread safe.
 */
public final class MjpegParser {
    public interface FrameListener { void onFrame(byte[] frame); }

    private static final int SCAN_TO_BOUNDARY = 0; // drop bytes until "--boundary"
    private static final int HEADERS = 1;          // after the boundary, waiting for the blank line
    private static final int BODY = 2;             // Content-Length known
    private static final int BODY_UNTIL_BOUNDARY = 3; // body ends at "\r\n--boundary"

    /** Larger Content-Length values are treated as missing, so one bad header can't stall the stream. */
    private static final int MAX_FRAME_BYTES = 16 * 1024 * 1024;

    /** A header block longer than this is junk (bare-LF endings, no blank line); resync on the next boundary. */
    private static final int MAX_HEADER_BYTES = 8 * 1024;

    private static final byte[] HEADER_END = {13, 10, 13, 10};

    private final byte[] marker;
    private final byte[] crlfMarker;
    private final FrameListener listener;
    private byte[] buf = new byte[8192];
    private int len = 0;
    private int state = SCAN_TO_BOUNDARY;
    private int remaining = 0;

    public MjpegParser(String boundary, FrameListener listener) {
        this.marker = ("--" + boundary).getBytes(StandardCharsets.UTF_8);
        this.crlfMarker = new byte[marker.length + 2];
        crlfMarker[0] = 13;
        crlfMarker[1] = 10;
        System.arraycopy(marker, 0, crlfMarker, 2, marker.length);
        this.listener = listener;
    }

    public void feed(byte[] chunk, int offset, int length) {
        if (len + length > buf.length) buf = Arrays.copyOf(buf, Math.max(buf.length * 2, len + length));
        System.arraycopy(chunk, offset, buf, len, length);
        len += length;
        while (step()) { /* until it needs more bytes */ }
    }

    /** Advances one state transition. Returns false when it needs more bytes. */
    private boolean step() {
        switch (state) {
            case SCAN_TO_BOUNDARY: {
                // After a Content-Length body this is also the resync: anything that
                // isn't the boundary (a lying length) is dropped until it shows up.
                int at = find(marker);
                if (at < 0) {
                    // keep a tail that could be the start of a split marker
                    consume(Math.max(0, len - (marker.length - 1)));
                    return false;
                }
                consume(at + marker.length);
                state = HEADERS;
                return true;
            }
            case HEADERS: {
                int end = find(HEADER_END);
                if (end < 0 || end > MAX_HEADER_BYTES) {
                    if (len > MAX_HEADER_BYTES) {
                        state = SCAN_TO_BOUNDARY;
                        return true;
                    }
                    return false;
                }
                String head = new String(buf, 0, end, StandardCharsets.UTF_8);
                consume(end + 4);
                long length = contentLength(head);
                if (length >= 0 && length <= MAX_FRAME_BYTES) {
                    remaining = (int) length;
                    state = BODY;
                } else {
                    state = BODY_UNTIL_BOUNDARY;
                }
                return true;
            }
            case BODY: {
                if (len < remaining) return false;
                emit(remaining);
                consume(remaining);
                state = SCAN_TO_BOUNDARY;
                return true;
            }
            default: { // BODY_UNTIL_BOUNDARY
                int at = find(crlfMarker);
                if (at < 0) {
                    if (len > MAX_FRAME_BYTES) {
                        state = SCAN_TO_BOUNDARY;
                        return true;
                    }
                    return false;
                }
                emit(at);
                consume(at + 2);
                state = SCAN_TO_BOUNDARY;
                return true;
            }
        }
    }

    private void emit(int n) {
        listener.onFrame(Arrays.copyOf(buf, n));
    }

    private void consume(int n) {
        System.arraycopy(buf, n, buf, 0, len - n);
        len -= n;
    }

    /** The Content-Length value, or -1 when absent or unparseable. A negative value is also returned as-is. */
    private static long contentLength(String head) {
        for (String line : head.split("\r\n|\n|\r")) {
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            if (line.substring(0, colon).trim().toLowerCase(Locale.ROOT).equals("content-length")) {
                try {
                    return Long.parseLong(line.substring(colon + 1).trim());
                } catch (NumberFormatException e) {
                    return -1;
                }
            }
        }
        return -1;
    }

    private int find(byte[] pattern) {
        outer:
        for (int i = 0; i + pattern.length <= len; i++) {
            if (buf[i] != pattern[0]) continue;
            for (int j = 1; j < pattern.length; j++) {
                if (buf[i + j] != pattern[j]) continue outer;
            }
            return i;
        }
        return -1;
    }
}
