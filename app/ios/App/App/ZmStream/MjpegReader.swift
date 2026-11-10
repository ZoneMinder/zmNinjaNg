import Foundation
import Capacitor
import MjpegKit

/// Holds one ZoneMinder `multipart/x-mixed-replace` connection open natively and
/// publishes every JPEG it parses into the frame store.
///
/// The point of doing this outside the webview is the connection itself: WKWebView
/// allows six per host, and a montage of tiles streaming through `<img>` spends all
/// six, which starves the API requests on the same host (refs #507). One reader owns
/// one socket here, and the webview only ever fetches finished frames over zmframe://.
final class MjpegReader: NSObject, URLSessionDataDelegate {
    /// The boundary nph-zms uses. Taken from the response when it declares one.
    private static let defaultBoundary = "ZoneMinderFrame"

    private let streamId: String
    private let url: URL
    private let store: FrameStore
    private var session: URLSession?
    private var parser: MjpegParser?

    init(streamId: String, url: URL, store: FrameStore = .shared) {
        self.streamId = streamId
        self.url = url
        self.store = store
        super.init()
    }

    func start() {
        let config = URLSessionConfiguration.ephemeral
        // Defaults to 6, which is the limit this whole transport exists to escape.
        config.httpMaximumConnectionsPerHost = 64
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        session.dataTask(with: url).resume()
    }

    /// Drops the connection. Also releases the session's reference to this reader.
    func cancel() {
        session?.invalidateAndCancel()
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            // log-safe: a status code only, never the stream URL or its auth token
            CAPLog.print("ZmStream: stream \(streamId) refused, status \(status)")
            store.markDead(streamId)
            completionHandler(.cancel)
            return
        }
        let parser = MjpegParser(boundary: Self.boundary(in: response) ?? Self.defaultBoundary)
        // Captures the store and the id, not self: the parser is owned by this reader.
        parser.onFrame = { [store, streamId] frame in store.publish(streamId, frame: frame) }
        self.parser = parser
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        parser?.feed(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as NSError? {
            // log-safe: the error's domain and numeric code only, no message and no URL
            CAPLog.print("ZmStream: stream \(streamId) ended, \(error.domain) \(error.code)")
        }
        // A clean end is just as dead as an error: nph-zms only stops sending when
        // the stream is over, and the frame store answers 404 from here on.
        store.markDead(streamId)
        // Releases the session's reference to this reader. The registry keeps the
        // reader itself until close, so a later cancel() is a harmless no-op.
        session.finishTasksAndInvalidate()
    }

    /// `multipart/x-mixed-replace;boundary=ZoneMinderFrame` -> `ZoneMinderFrame`.
    private static func boundary(in response: URLResponse) -> String? {
        guard let contentType = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") else {
            return nil
        }
        for parameter in contentType.split(separator: ";") {
            let parts = parameter.split(separator: "=", maxSplits: 1)
            guard parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "boundary" else {
                continue
            }
            let value = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
            return value.isEmpty ? nil : value
        }
        return nil
    }

    // MARK: - URLSessionDelegate

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        let answer = { (accept: Bool) in
            if accept {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
            } else {
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
        }

        // The user's self-signed setting is read first, deliberately. With it off,
        // system validation alone decides. isCertTrustedForHTTP returns true for a
        // host that has no stored fingerprint yet (trust on first use), so asking it
        // unconditionally would accept any certificate with the setting switched off.
        guard SSLTrustPlugin.sslTrustEnabled else {
            answer(isServerTrustValid(serverTrust))
            return
        }
        let host = challenge.protectionSpace.host
        let leaf = (SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate])?.first
        let pinned = leaf.map { isCertTrustedForHTTP($0, host: host) } ?? false
        answer(isServerTrustValid(serverTrust) || pinned)
    }
}
