package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class ZmStreamRegistryTest {
    /** Never started, so it opens no connection. */
    private static MjpegReader reader() {
        return new MjpegReader("x", "http://127.0.0.1:1/", 1000, new FrameStore());
    }

    @Test
    public void nextIdCountsUpAndRendersAsAString() {
        ZmStreamRegistry registry = new ZmStreamRegistry();
        assertEquals("1", registry.nextId());
        assertEquals("2", registry.nextId());
        assertEquals("3", registry.nextId());
    }

    @Test
    public void unknownIdHasNoReader() {
        // This is what makes a zmframe request for a stream nobody opened a 404
        // instead of a park. Another stream is open, so a lookup that ignored the
        // id would hand back the wrong reader rather than null.
        ZmStreamRegistry registry = new ZmStreamRegistry();
        registry.add("1", reader());
        assertNull(registry.reader("7"));
        assertNull(new ZmStreamRegistry().reader("7"));
    }

    @Test
    public void addedReaderIsFoundByItsId() {
        ZmStreamRegistry registry = new ZmStreamRegistry();
        MjpegReader reader = reader();
        registry.add("7", reader);
        assertSame(reader, registry.reader("7"));
    }

    @Test
    public void removeHandsBackTheReaderAndForgetsIt() {
        ZmStreamRegistry registry = new ZmStreamRegistry();
        MjpegReader reader = reader();
        registry.add("7", reader);
        assertSame(reader, registry.remove("7"));
        assertNull(registry.reader("7"));
        assertNull(registry.remove("7"));
    }

    @Test
    public void removeAllHandsBackEveryReaderAndEmpties() {
        ZmStreamRegistry registry = new ZmStreamRegistry();
        MjpegReader first = reader();
        MjpegReader second = reader();
        registry.add("1", first);
        registry.add("2", second);

        List<MjpegReader> removed = registry.removeAll();
        assertEquals(2, removed.size());
        assertTrue(removed.contains(first));
        assertTrue(removed.contains(second));
        assertNull(registry.reader("1"));
        assertNull(registry.reader("2"));
        assertTrue(registry.removeAll().isEmpty());
    }

    @Test
    public void readerCarriesTheStallTimeoutTheSchemeHandlerWaitsFor() {
        ZmStreamRegistry registry = new ZmStreamRegistry();
        registry.add("7", new MjpegReader("7", "http://127.0.0.1:1/", 4321, new FrameStore()));
        assertEquals(4321, registry.reader("7").stallTimeoutMs());
    }
}
