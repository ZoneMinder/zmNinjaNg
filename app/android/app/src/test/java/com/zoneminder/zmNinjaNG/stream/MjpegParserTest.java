package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class MjpegParserTest {
    private static final String BOUNDARY = "ZoneMinderFrame";

    /** Same formula as the iOS tests and make-fixtures.py. */
    private static byte[] frame(int n, int size) {
        byte[] b = new byte[size];
        for (int i = 0; i < size; i++) b[i] = (byte) ((n * 31 + i * 7) % 256);
        return b;
    }

    private static byte[] frame(int n) {
        return frame(n, new int[] {300, 1000, 5000}[n]);
    }

    private static byte[] fixture(String name) throws IOException {
        try (InputStream in = MjpegParserTest.class.getResourceAsStream("/mjpeg/" + name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) out.write(p, 0, p.length);
        return out.toByteArray();
    }

    private static List<byte[]> parse(byte[] data, int chunk) {
        List<byte[]> frames = new ArrayList<>();
        MjpegParser parser = new MjpegParser(BOUNDARY, frames::add);
        for (int i = 0; i < data.length; i += chunk) {
            parser.feed(data, i, Math.min(chunk, data.length - i));
        }
        return frames;
    }

    private static List<byte[]> parse(byte[] data) {
        return parse(data, Math.max(data.length, 1));
    }

    private static void assertFrames(List<byte[]> actual, byte[]... expected) {
        assertEquals(expected.length, actual.size());
        for (int i = 0; i < expected.length; i++) assertArrayEquals("frame " + i, expected[i], actual.get(i));
    }

    private static byte[] part(byte[] f, String headers) {
        return cat(bytes("--" + BOUNDARY + "\r\n" + headers + "\r\n\r\n"), f, bytes("\r\n"));
    }

    @Test
    public void cleanStreamEmitsThreeFrames() throws IOException {
        assertFrames(parse(fixture("clean-three.bin")), frame(0), frame(1), frame(2));
    }

    @Test
    public void arbitrarySplitsEmitSameFrames() throws IOException {
        byte[] data = fixture("clean-three.bin");
        for (int chunk : new int[] {1, 7, 64}) {
            assertFrames(parse(data, chunk), frame(0), frame(1), frame(2));
        }
    }

    @Test
    public void noContentLengthScansToNextBoundary() throws IOException {
        byte[] data = fixture("no-content-length.bin");
        assertFrames(parse(data), frame(0), frame(1));
        assertFrames(parse(data, 7), frame(0), frame(1));
    }

    @Test
    public void truncatedFinalFrameIsNotEmitted() throws IOException {
        assertFrames(parse(fixture("truncated.bin")), frame(0), frame(1));
    }

    @Test
    public void resyncsAfterShortContentLength() {
        String head = "--" + BOUNDARY + "\r\nContent-Type: image/jpeg\r\nContent-Length: ";
        byte[] data = cat(
                bytes(head + "10\r\n\r\n"),
                frame(0, 100),
                bytes("\r\n" + head + frame(1).length + "\r\n\r\n"),
                frame(1),
                bytes("\r\n"));
        assertFrames(parse(data), Arrays.copyOf(frame(0, 100), 10), frame(1));
    }

    @Test
    public void negativeContentLengthFallsBackToBoundaryScan() {
        byte[] data = cat(
                part(frame(0), "Content-Type: image/jpeg\r\nContent-Length: -5"),
                part(frame(1), "Content-Length: " + frame(1).length));
        assertFrames(parse(data), frame(0), frame(1));
        assertFrames(parse(data, 7), frame(0), frame(1));
    }

    @Test
    public void headerNamesMatchCaseInsensitivelyWithWhitespace() {
        byte[] data = part(frame(0), "content-length :  " + frame(0).length + " ");
        // A trailing boundary would hide a length that was ignored, so none is sent.
        assertFrames(parse(data), frame(0));
    }

    @Test
    public void overlongHeaderBlockResyncsOnNextBoundary() {
        // ~10 KB of bare-LF header lines, no blank line. The first line is a decoy length:
        // without the cap it would merge with the next part's headers and cut frame 1 to 5 bytes.
        StringBuilder junk = new StringBuilder("Content-Length: 5\n");
        for (int i = 0; i < 400; i++) junk.append("X-Junk: aaaaaaaaaaaaaaaa\n");
        byte[] data = cat(
                bytes("--" + BOUNDARY + "\r\n" + junk),
                part(frame(1), "Content-Type: image/jpeg"),
                bytes("--" + BOUNDARY + "\r\n")); // closes the length-less frame
        assertFrames(parse(data), frame(1));
        assertFrames(parse(data, 64), frame(1));
    }
}
