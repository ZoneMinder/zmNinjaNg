package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Test;

public class FrameStoreTest {
    private static final byte[] A = {1, 2, 3};
    private static final byte[] B = {9, 9};
    /** Long enough that a prompt result can only come from the store answering, not the deadline. */
    private static final long LONG = 5000;

    private final ExecutorService pool = Executors.newCachedThreadPool();

    @After
    public void shutdown() {
        pool.shutdownNow();
    }

    /**
     * Parks a waiter on a second thread and returns once that thread is inside
     * awaitNext's timed wait (Thread state TIMED_WAITING), so callers can rely on it
     * being parked. Fails after 2 s if the thread never gets there.
     */
    private Future<byte[]> park(FrameStore store, String id, long deadlineMs) throws Exception {
        AtomicReference<Thread> waiter = new AtomicReference<>();
        Future<byte[]> f = pool.submit(() -> {
            waiter.set(Thread.currentThread());
            return store.awaitNext(id, deadlineMs);
        });
        long giveUp = System.nanoTime() + 2_000_000_000L;
        while (true) {
            Thread t = waiter.get();
            if (t != null && t.getState() == Thread.State.TIMED_WAITING) return f;
            assertTrue("waiter never parked", System.nanoTime() < giveUp);
            Thread.sleep(1);
        }
    }

    @Test
    public void awaitNextReturnsPublishedFrameOnce() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        store.publish("1", A);
        assertArrayEquals(A, store.awaitNext("1", LONG));

        // The frame is spent, so this waiter parks and gets B, not A again and not null.
        Future<byte[]> second = park(store, "1", LONG);
        store.publish("1", B);
        assertArrayEquals(B, second.get(1, TimeUnit.SECONDS));
    }

    @Test
    public void unknownStreamReturnsNull() throws Exception {
        assertNull(new FrameStore().awaitNext("99", LONG));
    }

    @Test
    public void secondWaiterReplacesFirstWithNull() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        Future<byte[]> first = park(store, "1", LONG);
        Future<byte[]> second = park(store, "1", LONG);
        assertNull(first.get(1, TimeUnit.SECONDS));

        store.publish("1", A);
        assertArrayEquals(A, second.get(1, TimeUnit.SECONDS));
    }

    @Test
    public void removeWakesParkedWaiterWithNull() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        Future<byte[]> parked = park(store, "1", LONG);
        store.remove("1");
        assertNull(parked.get(1, TimeUnit.SECONDS));
    }

    @Test
    public void markDeadKeepsAnsweringNullUntilRemove() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        Future<byte[]> parked = park(store, "1", LONG);
        store.markDead("1");
        assertNull(parked.get(1, TimeUnit.SECONDS));

        // A frame published after death must not resurrect the stream.
        store.publish("1", A);
        for (int i = 0; i < 3; i++) assertNull(store.awaitNext("1", LONG));

        store.remove("1");
        assertNull(store.awaitNext("1", LONG));
    }

    @Test
    public void deadlineReturnsNull() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        long start = System.nanoTime();
        assertNull(store.awaitNext("1", 50)); // alive, so null can only be the deadline
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertTrue("returned after " + elapsedMs + " ms", elapsedMs >= 40 && elapsedMs < 2000);
    }

    @Test
    public void removeAllDropsEverySlotAndWakesTheirWaiters() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        store.register("2");
        Future<byte[]> first = park(store, "1", LONG);
        Future<byte[]> second = park(store, "2", LONG);

        store.removeAll();
        assertNull(first.get(1, TimeUnit.SECONDS));
        assertNull(second.get(1, TimeUnit.SECONDS));

        // Both slots are gone, so a later request is an unknown stream.
        store.publish("1", A);
        assertNull(store.awaitNext("1", LONG));
    }

    @Test
    public void interruptEndsTheWaitAndLeavesTheNextFrameForALaterWaiter() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        CountDownLatch interrupted = new CountDownLatch(1);
        Thread t = new Thread(() -> {
            try {
                store.awaitNext("1", LONG);
            } catch (InterruptedException e) {
                interrupted.countDown();
            }
        });
        t.start();
        Thread.sleep(100);
        t.interrupt();
        assertTrue(interrupted.await(1, TimeUnit.SECONDS));

        // The cancelled waiter must not swallow the next frame.
        store.publish("1", A);
        assertArrayEquals(A, store.awaitNext("1", LONG));
    }

    @Test
    public void reRegisteredIdDoesNotWakeOldWaiterWithNewFrame() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        Future<byte[]> old = park(store, "1", LONG);
        store.register("1"); // fresh slot under the same id
        assertNull(old.get(1, TimeUnit.SECONDS));
        store.publish("1", A);
        assertFalse(old.isCancelled());
        assertArrayEquals(A, store.awaitNext("1", LONG));
    }

    @Test
    public void waiterWhoseFrameIsTakenByANewerCallerReturnsNull() throws Exception {
        FrameStore store = new FrameStore();
        store.register("1");
        Future<byte[]> w1 = park(store, "1", LONG);

        // Holding the monitor keeps W1 from running between publish and the second call,
        // so the interleaving is forced: W1 is notified, then W2 takes the frame first.
        byte[] taken;
        synchronized (store) {
            store.publish("1", A);
            taken = store.awaitNext("1", LONG);
        }
        assertArrayEquals(A, taken);
        assertNull(w1.get(1, TimeUnit.SECONDS));
    }
}
