package com.zoneminder.zmNinjaNG.stream;

import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * Holds one ZoneMinder {@code multipart/x-mixed-replace} connection open natively
 * and publishes every JPEG it parses into the frame store. Mirrors the iOS
 * MjpegReader.
 *
 * The point of doing this outside the webview is the connection itself: a webview
 * allows six per host, and a montage of tiles streaming through {@code <img>} spends
 * all six, which starves the API requests on the same host (refs #507). One reader
 * owns one socket here, and the webview only ever fetches finished frames over
 * zmframe://.
 *
 * HttpURLConnection rather than a client of our own: for an https URL it is an
 * HttpsURLConnection, which picks up the socket factory and hostname verifier
 * {@link com.zoneminder.zmNinjaNG.SSLTrustPlugin} installs while self-signed trust
 * is on. With that trust off, a self-signed server fails the handshake here exactly
 * as it does in the webview.
 */
public final class MjpegReader implements Runnable {
    private static final String TAG = "ZmStream";

    /** The boundary nph-zms uses. Taken from the response when it declares one. */
    private static final String DEFAULT_BOUNDARY = "ZoneMinderFrame";

    private static final int CHUNK_BYTES = 16 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 10_000;

    private final String streamId;
    private final String url;
    private final long stallTimeoutMs;
    private final FrameStore store;

    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    public MjpegReader(String streamId, String url, long stallTimeoutMs) {
        this(streamId, url, stallTimeoutMs, FrameStore.shared());
    }

    MjpegReader(String streamId, String url, long stallTimeoutMs, FrameStore store) {
        this.streamId = streamId;
        this.url = url;
        this.stallTimeoutMs = stallTimeoutMs;
        this.store = store;
    }

    /**
     * How long a zmframe request for this stream may park. The scheme handler reads
     * it from here, and it is also the socket read timeout: a connection that goes
     * that long without a byte has already stalled the tile, so there is nothing
     * left to wait for.
     */
    public long stallTimeoutMs() {
        return stallTimeoutMs;
    }

    public void start() {
        Thread thread = new Thread(this, TAG + "-" + streamId);
        // Daemon so a reader can never hold the process up; close() ends it anyway.
        thread.setDaemon(true);
        thread.start();
    }

    /**
     * Drops the connection. disconnect() closes the socket, which makes the blocking
     * read in {@link #run()} throw, so the thread exits rather than sitting on a
     * stream nobody reads.
     */
    public void cancel() {
        cancelled = true;
        HttpURLConnection open = connection;
        if (open != null) open.disconnect();
    }

    @Override
    public void run() {
        try {
            HttpURLConnection open = (HttpURLConnection) new URL(url).openConnection();
            connection = open;
            open.setUseCaches(false);
            open.setConnectTimeout(CONNECT_TIMEOUT_MS);
            open.setReadTimeout((int) Math.max(1, Math.min(stallTimeoutMs, Integer.MAX_VALUE)));
            // cancel() may have run while the connection was being built, in which
            // case its disconnect() landed before there was a socket to close.
            if (cancelled) return;

            int code = open.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                // log-safe: a status code only, never the stream URL or its auth token
                Log.w(TAG, "stream " + streamId + " refused, status " + code);
                return;
            }

            MjpegParser parser = new MjpegParser(
                boundary(open.getContentType()),
                frame -> store.publish(streamId, frame)
            );
            byte[] chunk = new byte[CHUNK_BYTES];
            try (InputStream in = open.getInputStream()) {
                int read;
                while (!cancelled && (read = in.read(chunk)) != -1) {
                    parser.feed(chunk, 0, read);
                }
            }
        } catch (IOException | RuntimeException e) {
            if (!cancelled) {
                // log-safe: the exception's class name only, no message and no URL -
                // a stream URL carries the access token in its query string
                Log.w(TAG, "stream " + streamId + " ended, " + e.getClass().getSimpleName());
            }
        } finally {
            // A clean end is just as dead as an error: nph-zms only stops sending
            // when the stream is over, and the store answers 404 from here on. After
            // a close the slot is already gone, so this is a no-op.
            store.markDead(streamId);
            HttpURLConnection open = connection;
            if (open != null) open.disconnect();
        }
    }

    /** {@code multipart/x-mixed-replace;boundary=ZoneMinderFrame} -> {@code ZoneMinderFrame}. */
    static String boundary(String contentType) {
        if (contentType == null) return DEFAULT_BOUNDARY;
        for (String parameter : contentType.split(";")) {
            int equals = parameter.indexOf('=');
            if (equals < 0) continue;
            String name = parameter.substring(0, equals).trim().toLowerCase(Locale.ROOT);
            if (!name.equals("boundary")) continue;
            String value = parameter.substring(equals + 1).trim().replaceAll("^[\"']+|[\"']+$", "");
            return value.isEmpty() ? DEFAULT_BOUNDARY : value;
        }
        return DEFAULT_BOUNDARY;
    }
}
