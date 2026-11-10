package com.zoneminder.zmNinjaNG.stream;

import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.zoneminder.zmNinjaNG.SSLTrustPlugin;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Serves one JPEG per request at {@code zmframe://frames/<streamId>/<n>}, and carries
 * the app's SSL error handling.
 *
 * A webview will not render {@code multipart/x-mixed-replace} in an {@code <img>},
 * which is why the native reader parses the stream and the webview asks for single
 * frames, chaining to {@code n+1} on each load event. {@code n} only makes each URL
 * unique; the frame served is whichever one the store has next.
 *
 * Both jobs live in one class because a WebView has one client: SSLTrustPlugin swaps
 * the client whenever self-signed trust is toggled, and a separate SSL client would
 * throw the zmframe interception away on the first toggle, killing every tile.
 */
public final class ZmFrameWebViewClient extends BridgeWebViewClient {
    /** zmframe://frames/7/3 is host "frames", path "/7/3". */
    public static final String SCHEME = "zmframe";
    private static final String FRAME_HOST = "frames";

    private final boolean trustSelfSigned;

    public ZmFrameWebViewClient(Bridge bridge, boolean trustSelfSigned) {
        super(bridge);
        this.trustSelfSigned = trustSelfSigned;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (url == null || !SCHEME.equals(url.getScheme())) {
            return super.shouldInterceptRequest(view, request);
        }
        return frameResponse(url);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // The flag says whether the user has self-signed trust on; the plugin owns
        // the fingerprint decision, so a cert it does not vouch for is cancelled
        // here rather than proceeded with.
        if (trustSelfSigned && SSLTrustPlugin.isWebViewCertTrusted(error)) {
            handler.proceed();
        } else {
            handler.cancel();
        }
    }

    /**
     * Returns at once, always. The wait for the next frame happens inside
     * FrameInputStream.read(), because Chromium calls this on a pool of IO threads
     * and a callback that blocked would starve the pool.
     */
    private WebResourceResponse frameResponse(Uri url) {
        List<String> parts = url.getPathSegments();
        MjpegReader reader = (FRAME_HOST.equals(url.getHost()) && parts.size() == 2)
            ? ZmStreamRegistry.shared().reader(parts.get(0))
            : null;
        if (reader == null) {
            // Unknown, closed or malformed: a 404 now, so the <img> fires error and
            // the JS backoff decides when to ask again. Parking would hang the tile.
            return response("text/plain", 404, "Not Found", new ByteArrayInputStream(new byte[0]));
        }
        return response(
            "image/jpeg",
            200,
            "OK",
            new FrameInputStream(FrameStore.shared(), parts.get(0), reader.stallTimeoutMs())
        );
    }

    private static WebResourceResponse response(String mimeType, int status, String reason, InputStream body) {
        Map<String, String> headers = new HashMap<>();
        // No Content-Length: the frame is not in hand yet, and this response has to
        // be built before the first read blocks for it. The body's EOF ends the frame.
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mimeType, null, status, reason, headers, body);
    }
}
