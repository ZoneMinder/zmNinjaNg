package com.zoneminder.zmNinjaNG.stream;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.Locale;

/**
 * The webview's handle on the native MJPEG readers: open returns a streamId whose
 * frames are then fetched one at a time over zmframe://. Mirrors the iOS
 * ZmStreamPlugin.
 */
@CapacitorPlugin(name = "ZmStream")
public class ZmStreamPlugin extends Plugin {
    /** Only used if a caller omits stallTimeoutMs; the JS side always sends one. */
    private static final int DEFAULT_STALL_TIMEOUT_MS = 10_000;

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (!isHttpUrl(url)) {
            // The bridge is a trust boundary: without this the webview could point a
            // reader at file:// or any other scheme the URL parser accepts.
            call.reject("url must be http or https");
            return;
        }
        Integer requested = call.getInt("stallTimeoutMs", DEFAULT_STALL_TIMEOUT_MS);
        // A null or nonsense value would otherwise become the socket read timeout.
        int stallTimeoutMs = (requested == null || requested <= 0) ? DEFAULT_STALL_TIMEOUT_MS : requested;
        String id = ZmStreamRegistry.shared().nextId();
        FrameStore.shared().register(id);
        MjpegReader reader = new MjpegReader(id, url, stallTimeoutMs);
        ZmStreamRegistry.shared().add(id, reader);
        reader.start();

        JSObject result = new JSObject();
        result.put("streamId", id);
        call.resolve(result);
    }

    @PluginMethod
    public void close(PluginCall call) {
        String id = call.getString("streamId");
        if (id == null) {
            call.reject("streamId is required");
            return;
        }
        // Registry first, so a request arriving now is answered 404 rather than
        // parked; then the store, which completes whatever is parked already.
        MjpegReader reader = ZmStreamRegistry.shared().remove(id);
        if (reader != null) reader.cancel();
        FrameStore.shared().remove(id);
        call.resolve();
    }

    /**
     * Reclaims every stream. The JS side calls this when its page goes away and
     * again when the stream module initialises, which is the half that matters: a
     * hard reload or a crash runs no teardown handler, so without a reclaim at
     * startup the readers of the previous page would keep parsing frames into slots
     * nobody reads, one per tile, per reload.
     */
    @PluginMethod
    public void closeAll(PluginCall call) {
        for (MjpegReader reader : ZmStreamRegistry.shared().removeAll()) {
            reader.cancel();
        }
        FrameStore.shared().removeAll();
        call.resolve();
    }

    static boolean isHttpUrl(String raw) {
        if (raw == null) return false;
        try {
            String scheme = new URL(raw).getProtocol().toLowerCase(Locale.ROOT);
            return scheme.equals("http") || scheme.equals("https");
        } catch (MalformedURLException e) {
            return false;
        }
    }
}
