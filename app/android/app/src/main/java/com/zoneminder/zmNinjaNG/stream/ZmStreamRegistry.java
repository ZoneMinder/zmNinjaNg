package com.zoneminder.zmNinjaNG.stream;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The streams held open natively, so close can find a reader and the scheme handler
 * can find a stream's stall timeout. Mirrors the iOS ZmStreamRegistry.
 *
 * The plugin writes it on Capacitor's call thread and the scheme handler reads it on
 * one of Chromium's IO threads, hence the synchronisation. Nothing here blocks, so
 * neither caller waits on the other.
 */
public final class ZmStreamRegistry {
    private static final ZmStreamRegistry SHARED = new ZmStreamRegistry();

    private final Map<String, MjpegReader> readers = new HashMap<>();
    private int counter;

    ZmStreamRegistry() {}

    public static ZmStreamRegistry shared() {
        return SHARED;
    }

    public synchronized String nextId() {
        return String.valueOf(++counter);
    }

    public synchronized void add(String id, MjpegReader reader) {
        readers.put(id, reader);
    }

    /**
     * null when the stream was never opened, or was closed. That is what makes a
     * zmframe request for it a 404 rather than a park.
     */
    public synchronized MjpegReader reader(String id) {
        return readers.get(id);
    }

    public synchronized MjpegReader remove(String id) {
        return readers.remove(id);
    }

    public synchronized List<MjpegReader> removeAll() {
        List<MjpegReader> removed = new ArrayList<>(readers.values());
        readers.clear();
        return removed;
    }
}
