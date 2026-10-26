package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Test;

/**
 * Drives the reader against a real socket on the loopback interface, so the
 * HttpURLConnection path, the response-code branch and the socket teardown are all
 * exercised rather than mocked.
 */
public class MjpegReaderTest {
    private static final String BOUNDARY = "ZoneMinderFrame";
    private static final long STALL = 5000;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final CountDownLatch clientGone = new CountDownLatch(1);
    private ServerSocket server;
    private volatile Socket accepted;
    private MjpegReader reader;

    @After
    public void tearDown() throws IOException {
        if (reader != null) reader.cancel();
        if (accepted != null) accepted.close();
        if (server != null) server.close();
        pool.shutdownNow();
    }

    /** Same formula as MjpegParserTest, so a frame's bytes are recognisable. */
    private static byte[] frame(int n, int size) {
        byte[] b = new byte[size];
        for (int i = 0; i < size; i++) b[i] = (byte) ((n * 31 + i * 7) % 256);
        return b;
    }

    private static byte[] multipart(String boundary, byte[]... frames) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] frame : frames) {
            write(out, "--" + boundary + "\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + frame.length + "\r\n\r\n");
            write(out, frame);
            write(out, "\r\n");
        }
        return out.toByteArray();
    }

    private static void write(ByteArrayOutputStream out, String s) {
        write(out, s.getBytes(StandardCharsets.UTF_8));
    }

    private static void write(ByteArrayOutputStream out, byte[] b) {
        out.write(b, 0, b.length);
    }

    private static byte[] response(String status, String contentType, byte[] body) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, "HTTP/1.1 " + status + "\r\n");
        if (contentType != null) write(out, "Content-Type: " + contentType + "\r\n");
        if (body == null) write(out, "Content-Length: 0\r\n");
        write(out, "\r\n");
        if (body != null) write(out, body);
        return out.toByteArray();
    }

    /**
     * Serves `response` to one connection. With closeAfter the server hangs up once
     * it has written; otherwise it holds the socket open and counts down clientGone
     * when the reader's end closes.
     */
    private String serve(byte[] response, boolean closeAfter) throws IOException {
        server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
        pool.submit(() -> {
            Socket socket = server.accept();
            accepted = socket;
            drainRequest(socket.getInputStream());
            OutputStream out = socket.getOutputStream();
            out.write(response);
            out.flush();
            if (closeAfter) {
                socket.close();
                return null;
            }
            try {
                while (socket.getInputStream().read() != -1) { /* wait for the reader to hang up */ }
            } catch (IOException expected) {
                // A disconnect shows up as a reset here just as often as an EOF.
            }
            clientGone.countDown();
            return null;
        });
        return "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort() + "/zm/cgi-bin/nph-zms";
    }

    private static void drainRequest(InputStream in) throws IOException {
        int match = 0;
        byte[] end = {13, 10, 13, 10};
        int b;
        while (match < 4 && (b = in.read()) != -1) {
            match = ((byte) b == end[match]) ? match + 1 : ((byte) b == end[0] ? 1 : 0);
        }
    }

    private MjpegReader readerFor(String url, FrameStore store) {
        reader = new MjpegReader("1", url, STALL, store);
        reader.start();
        return reader;
    }

    /** awaitNext, failing the test if the answer only arrives when the deadline expires. */
    private static byte[] promptly(FrameStore store, String id) throws Exception {
        long start = System.nanoTime();
        byte[] frame = store.awaitNext(id, STALL);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertTrue("answered only after " + elapsedMs + " ms", elapsedMs < 2000);
        return frame;
    }

    @Test
    public void everyFrameInTheBodyReachesTheStore() throws Exception {
        byte[] one = frame(0, 300);
        byte[] two = frame(1, 1000);
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("200 OK", "multipart/x-mixed-replace;boundary=" + BOUNDARY,
            multipart(BOUNDARY, one, two)), false);

        readerFor(url, store);
        assertArrayEquals(one, promptly(store, "1"));
        assertArrayEquals(two, promptly(store, "1"));
    }

    @Test
    public void aRefusedStreamIsMarkedDeadRatherThanLeftToStall() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("401 Unauthorized", null, null), true);

        readerFor(url, store);
        // Registered and never published to, so null here is markDead, not an
        // unknown stream, and promptly() rules out the deadline.
        assertNull(promptly(store, "1"));
    }

    @Test
    public void theServerHangingUpMarksTheStreamDead() throws Exception {
        byte[] one = frame(2, 500);
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("200 OK", "multipart/x-mixed-replace;boundary=" + BOUNDARY,
            multipart(BOUNDARY, one)), true);

        readerFor(url, store);
        assertArrayEquals(one, promptly(store, "1"));
        assertNull(promptly(store, "1"));
    }

    @Test
    public void cancelClosesTheConnectionAndEndsTheThread() throws Exception {
        byte[] one = frame(0, 300);
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("200 OK", "multipart/x-mixed-replace;boundary=" + BOUNDARY,
            multipart(BOUNDARY, one)), false);

        MjpegReader reader = readerFor(url, store);
        assertArrayEquals(one, promptly(store, "1"));
        reader.cancel();

        assertTrue("the socket stayed open after cancel", clientGone.await(5, TimeUnit.SECONDS));
        long giveUp = System.nanoTime() + 5_000_000_000L;
        while (threadNamed("ZmStream-1")) {
            assertTrue("the reader thread never exited", System.nanoTime() < giveUp);
            Thread.sleep(5);
        }
    }

    @Test
    public void aQuotedBoundaryInTheContentTypeIsUsed() throws Exception {
        byte[] one = frame(1, 400);
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("200 OK", "multipart/x-mixed-replace; boundary=\"myBoundary\"",
            multipart("myBoundary", one)), false);

        readerFor(url, store);
        assertArrayEquals(one, promptly(store, "1"));
    }

    @Test
    public void aContentTypeWithNoBoundaryFallsBackToZoneMinderFrame() throws Exception {
        byte[] one = frame(2, 600);
        FrameStore store = new FrameStore();
        store.register("1");
        String url = serve(response("200 OK", "multipart/x-mixed-replace",
            multipart(BOUNDARY, one)), false);

        readerFor(url, store);
        assertArrayEquals(one, promptly(store, "1"));
    }

    private static boolean threadNamed(String name) {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (name.equals(t.getName())) return true;
        }
        return false;
    }
}
