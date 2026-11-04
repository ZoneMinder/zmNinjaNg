package com.zoneminder.zmNinjaNG.stream;

import java.io.IOException;
import java.io.InputStream;

/**
 * The body of one zmframe response: a single JPEG taken from the frame store.
 *
 * All the waiting happens here, in read(), and never in shouldInterceptRequest.
 * Chromium calls that callback on a pool of IO threads and reads this stream later,
 * so a callback that blocked would starve the pool while a montage of tiles waits
 * for frames.
 *
 * A stream that is dead, unknown or stalled fails the read instead of returning no
 * bytes, so the webview reports the load as an error and the JS backoff decides when
 * to ask again. An empty 200 body would look like a broken image instead.
 *
 * One consumer: a response body is read on a single thread, so only the two fields
 * close() touches are volatile.
 */
final class FrameInputStream extends InputStream {
    private final FrameStore store;
    private final String streamId;
    private final long deadlineMs;

    private byte[] frame;
    private int position;
    private boolean awaited;
    private IOException failure;
    private volatile boolean closed;
    /** The thread parked in awaitNext, so close() can wake it. */
    private volatile Thread reader;

    FrameInputStream(FrameStore store, String streamId, long deadlineMs) {
        this.store = store;
        this.streamId = streamId;
        this.deadlineMs = deadlineMs;
    }

    @Override
    public int read() throws IOException {
        if (!hasBytes()) return -1;
        return frame[position++] & 0xff;
    }

    @Override
    public int read(byte[] into, int offset, int length) throws IOException {
        if (length == 0) return 0;
        if (!hasBytes()) return -1;
        int count = Math.min(length, frame.length - position);
        System.arraycopy(frame, position, into, offset, count);
        position += count;
        return count;
    }

    /**
     * Ends the response. Interrupting the parked reader is the frame store's
     * cancel: without it a request the webview has dropped would hold an IO thread
     * until the stall deadline, one per tile.
     */
    @Override
    public void close() {
        closed = true;
        Thread parked = reader;
        if (parked != null) parked.interrupt();
    }

    /** Blocks for the frame on the first call. False once it has all been read. */
    private boolean hasBytes() throws IOException {
        if (failure != null) throw failure;
        if (frame != null) return position < frame.length;
        if (awaited) return false;
        awaited = true;

        // Published before the closed check, and close() reads it after setting
        // closed, so one of the two always sees the other: a close that lands here
        // either interrupts this thread or is seen by the check below. Setting the
        // flag before the wait is enough, since wait() throws on entry.
        reader = Thread.currentThread();
        try {
            if (closed) throw fail("frame request closed");
            byte[] next = store.awaitNext(streamId, deadlineMs);
            if (next == null) throw fail("no frame for stream " + streamId);
            frame = next;
        } catch (InterruptedException e) {
            throw fail("frame request cancelled");
        } finally {
            reader = null;
            // close() is the only thing that interrupts this thread, and the thread
            // goes back to Chromium's IO pool, so the flag is cleared rather than
            // restored: leaving it set would break the next request this thread serves.
            Thread.interrupted();
        }
        return frame.length > 0;
    }

    /** Remembered so a second read fails the same way rather than reporting EOF. */
    private IOException fail(String message) {
        failure = new IOException(message);
        return failure;
    }
}
