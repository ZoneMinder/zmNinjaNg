package com.zoneminder.zmNinjaNG.stream;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Only the URL guard. The plugin's methods need a live Bridge, so they are covered
 * by the device pass, but the guard is the IPC trust boundary (I1) and is plain
 * Java.
 */
public class ZmStreamPluginTest {
    @Test
    public void httpAndHttpsStreamsAreAllowed() {
        assertTrue(ZmStreamPlugin.isHttpUrl("http://192.168.1.10/zm/cgi-bin/nph-zms?mode=jpeg"));
        assertTrue(ZmStreamPlugin.isHttpUrl("https://zm.example.com:8443/zm/cgi-bin/nph-zms"));
        assertTrue(ZmStreamPlugin.isHttpUrl("HTTPS://zm.example.com/zm/cgi-bin/nph-zms"));
    }

    @Test
    public void everyOtherSchemeIsRefused() {
        assertFalse(ZmStreamPlugin.isHttpUrl("file:///data/data/com.zoneminder.zmNinjaNG/databases/x"));
        assertFalse(ZmStreamPlugin.isHttpUrl("content://media/external/images/1"));
        assertFalse(ZmStreamPlugin.isHttpUrl("ftp://example.com/x"));
        assertFalse(ZmStreamPlugin.isHttpUrl("javascript:alert(1)"));
        assertFalse(ZmStreamPlugin.isHttpUrl("zmframe://frames/1/2"));
    }

    @Test
    public void nonsenseIsRefusedRatherThanThrown() {
        assertFalse(ZmStreamPlugin.isHttpUrl(""));
        assertFalse(ZmStreamPlugin.isHttpUrl("not a url"));
        assertFalse(ZmStreamPlugin.isHttpUrl("/zm/cgi-bin/nph-zms"));
        assertFalse(ZmStreamPlugin.isHttpUrl(null));
    }
}
