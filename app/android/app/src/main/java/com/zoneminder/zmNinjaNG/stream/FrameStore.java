package com.zoneminder.zmNinjaNG.stream;

import java.util.HashMap;
import java.util.Map;

/**
 * Holds the latest JPEG frame of each native MJPEG stream and hands it to the one
 * request waiting for it. Mirrors the iOS FrameStore.
 *
 * The webview's img asks for zmframe://frames/id/n and chains to n+1 on load, so
 * there is at most one request outstanding per stream. A request that arrives
 * before the next frame blocks in awaitNext until the frame lands, the stream dies
 * or is removed, a newer request replaces it, or its deadline passes. Frames are
 * not queued: a slot holds one frame and a later frame overwrites an undelivered
 * one, because a live tile wants the newest picture, not a backlog.
 *
 * One monitor guards everything. Waiters block in Object.wait, which releases it,
 * so no thread holds the lock while waiting. Cancelling a waiter is interrupting
 * its thread.
 */
public final class FrameStore {
    private static final FrameStore SHARED = new FrameStore();

    private static final class Slot {
        byte[] frame;
        boolean dead;
        /** Ticket of the newest waiter; an older waiter that sees a different value was replaced. */
        long waiterTicket;
    }

    private final Map<String, Slot> slots = new HashMap<>();

    FrameStore() {}

    public static FrameStore shared() {
        return SHARED;
    }

    public synchronized void register(String id) {
        slots.put(id, new Slot());
        notifyAll(); // a waiter on the slot this replaced must wake and see it's gone
    }

    public synchronized void publish(String id, byte[] frame) {
        Slot slot = slots.get(id);
        if (slot == null || slot.dead) return;
        slot.frame = frame;
        notifyAll();
    }

    /**
     * The stream's connection is gone. Every later request is answered with null
     * until remove, so the img gets a 404 and fires error instead of hanging on a
     * socket that will never produce another frame.
     */
    public synchronized void markDead(String id) {
        Slot slot = slots.get(id);
        if (slot == null) return;
        slot.dead = true;
        slot.frame = null;
        notifyAll();
    }

    public synchronized void remove(String id) {
        if (slots.remove(id) != null) notifyAll();
    }

    /** Reclaims every stream: the webview that was reading them is gone and nothing will ask again. */
    public synchronized void removeAll() {
        slots.clear();
        notifyAll();
    }

    /**
     * Blocks up to deadlineMs for the next undelivered frame; null for a dead,
     * unknown, removed or timed-out stream. A newer waiter on the same id makes
     * this one return null. Throws InterruptedException if the thread is
     * interrupted, leaving any later frame for the next waiter.
     */
    public synchronized byte[] awaitNext(String id, long deadlineMs) throws InterruptedException {
        Slot slot = slots.get(id);
        if (slot == null || slot.dead) return null;

        // Bump before the fast path: a parked waiter whose frame this call takes
        // must wake and see it was replaced, not keep waiting on an empty slot.
        long ticket = ++slot.waiterTicket;
        notifyAll();
        if (slot.frame != null) return take(slot);
        long end = System.nanoTime() + deadlineMs * 1_000_000L;
        while (true) {
            // Order matters: a replaced or removed waiter must never take a frame
            // meant for its successor.
            if (slots.get(id) != slot || slot.dead || slot.waiterTicket != ticket) return null;
            if (slot.frame != null) return take(slot);
            long leftNanos = end - System.nanoTime();
            if (leftNanos <= 0) return null;
            wait(leftNanos / 1_000_000L, (int) (leftNanos % 1_000_000L));
        }
    }

    private static byte[] take(Slot slot) {
        byte[] frame = slot.frame;
        slot.frame = null;
        return frame;
    }
}
