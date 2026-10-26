import Foundation
import WebKit
import MjpegKit

/// Serves one JPEG per request at `zmframe://frames/<streamId>/<n>`.
///
/// WKWebView will not render `multipart/x-mixed-replace` in an `<img>`, which is
/// why the native reader parses the stream and the webview asks for single frames,
/// chaining to `n+1` on each load event. `n` only makes each URL unique; the frame
/// served is whichever one the store has next.
final class ZmFrameSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "zmframe"
    private static let frameHost = "frames"

    /// The waiter of each request in flight, keyed by task identity. WebKit calls
    /// start and stop on the main thread, so this is only ever touched there.
    private var waiters: [ObjectIdentifier: FrameStore.WaiterToken] = [:]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        // `zmframe://frames/7/3` is host "frames", path "/7/3".
        let parts = (task.request.url?.pathComponents ?? []).filter { $0 != "/" }
        guard task.request.url?.host == Self.frameHost, parts.count == 2,
              let stallTimeout = ZmStreamRegistry.shared.stallTimeout(of: parts[0]) else {
            respond(task, status: 404, body: nil)
            return
        }

        let key = ObjectIdentifier(task)
        let token = FrameStore.shared.next(parts[0], deadline: stallTimeout) { [weak self] frame in
            DispatchQueue.main.async {
                // Removing the key is also the check that WebKit has not stopped
                // this task: stop(_:) takes it out, and a stopped task must never
                // be touched again - it throws an ObjC exception Swift cannot catch.
                guard let self = self, self.waiters.removeValue(forKey: key) != nil else { return }
                if let frame = frame {
                    self.respond(task, status: 200, body: frame)
                } else {
                    // Dead, unknown or stalled: the <img> fires error and the JS
                    // side's backoff decides when to ask again.
                    self.respond(task, status: 404, body: nil)
                }
            }
        }
        waiters[key] = token
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guard let token = waiters.removeValue(forKey: ObjectIdentifier(task)) else { return }
        FrameStore.shared.cancel(token)
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, body: Data?) {
        guard let url = task.request.url else { return }
        var headers = [
            "Content-Length": String(body?.count ?? 0),
            "Cache-Control": "no-store",
        ]
        if body != nil {
            headers["Content-Type"] = "image/jpeg"
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else { return }

        task.didReceive(response)
        if let body = body, !body.isEmpty {
            task.didReceive(body)
        }
        task.didFinish()
    }
}
