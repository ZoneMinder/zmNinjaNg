package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Test;

public class FrameInputStreamTest {
    private static final byte[] A = {1, 2, 3, 4, 5};
    private static final byte[] B = {7, 7};
    /** Long enough that a prompt result can only come from the store answering, not the deadline. */
    private static final long LONG = 5000;

    private final ExecutorService pool = Executors.newCachedThreadPool();

    @After
    public void shutdown() {
        pool.shutdownNow();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[3]; // smaller than a frame, so the loop has to span reads
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }

    @Test
    public void servesThePublishedFrameAndThenEof() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        store.publish("1", A);
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        assertArrayEquals(A, readAll(in));
        assertEquals(-1, in.read());
    }

    @Test
    public void servesTheFrameOneByteAtATime() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        store.publish("1", B);
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        assertEquals(7, in.read());
        assertEquals(7, in.read());
        assertEquals(-1, in.read());
    }

    @Test
    public void unknownStreamFailsOnTheFirstRead() {
        FrameInputStream in = new FrameInputStream(new FrameStore(), "99", LONG);
        assertThrows(IOException.class, in::read);
    }

    @Test
    public void deadStreamFailsOnTheFirstRead() {
        FrameStore store = new FrameStore();
        store.register("1");
        store.markDead("1");
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        assertThrows(IOException.class, in::read);
    }

    @Test
    public void aFailedReadKeepsFailingRatherThanReportingAnEmptyBody() throws Exception {
        FrameInputStream in = new FrameInputStream(new FrameStore(), "99", LONG);
        assertThrows(IOException.class, in::read);
        // -1 here would be an empty 200 body, which the <img> treats as a decode
        // problem rather than a load error.
        assertThrows(IOException.class, in::read);
        assertThrows(IOException.class, () -> in.read(new byte[4], 0, 4));
    }

    @Test
    public void stalledStreamFailsWhenTheDeadlinePasses() {
        FrameStore store = new FrameStore();
        store.register("1"); // alive, so the failure can only be the deadline
        FrameInputStream in = new FrameInputStream(store, "1", 50);
        long start = System.nanoTime();
        assertThrows(IOException.class, in::read);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertTrue("failed after " + elapsedMs + " ms", elapsedMs >= 40 && elapsedMs < 2000);
    }

    @Test
    public void aParkedReadGetsTheFrameWhenItLands() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        Future<byte[]> read = parkedRead(in);
        store.publish("1", A);
        assertArrayEquals(A, read.get(1, TimeUnit.SECONDS));
    }

    @Test
    public void closeWakesAParkedReadAndLeavesNoInterruptOnTheThread() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        AtomicBoolean stillInterrupted = new AtomicBoolean(true);
        AtomicReference<Thread> worker = new AtomicReference<>();
        Future<?> read = pool.submit(() -> {
            worker.set(Thread.currentThread());
            try {
                in.read();
                return "read returned";
            } catch (IOException e) {
                // The thread goes back to Chromium's IO pool, so a leftover
                // interrupt flag would break whatever it serves next.
                stillInterrupted.set(Thread.currentThread().isInterrupted());
                return "failed";
            }
        });
        awaitParked(worker);
        in.close();
        assertEquals("failed", read.get(1, TimeUnit.SECONDS));
        assertFalse(stillInterrupted.get());
    }

    @Test
    public void readAfterCloseFails() {
        FrameStore store = new FrameStore();
        store.register("1");
        store.publish("1", A);
        FrameInputStream in = new FrameInputStream(store, "1", LONG);
        in.close();
        assertThrows(IOException.class, in::read);
    }

    /** Runs readAll on a pool thread and returns once that thread is parked in the store. */
    private Future<byte[]> parkedRead(FrameInputStream in) throws Exception {
        AtomicReference<Thread> worker = new AtomicReference<>();
        Future<byte[]> f = pool.submit(() -> {
            worker.set(Thread.currentThread());
            return readAll(in);
        });
        awaitParked(worker);
        return f;
    }

    /**
     * Waits until the reading thread is inside the store's timed wait, so a caller
     * can rely on the read being parked rather than sleeping and hoping. Nothing in
     * the read path sleeps, so TIMED_WAITING can only be that wait. Fails after 2 s.
     */
    private static void awaitParked(AtomicReference<Thread> worker) throws Exception {
        long giveUp = System.nanoTime() + 2_000_000_000L;
        while (true) {
            Thread t = worker.get();
            if (t != null && t.getState() == Thread.State.TIMED_WAITING) return;
            assertTrue("read never parked", System.nanoTime() < giveUp);
            Thread.sleep(1);
        }
    }
}
