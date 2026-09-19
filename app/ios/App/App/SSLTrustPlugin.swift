import Foundation
import Capacitor
import WebKit
import CommonCrypto

@objc(SSLTrustPlugin)
public class SSLTrustPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SSLTrustPlugin"
    public let jsName = "SSLTrust"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTrustedFingerprints", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getServerCertFingerprint", returnType: CAPPluginReturnPromise),
    ]

    /// Global flag checked by URLProtocol and WKWebView delegate
    @objc static var sslTrustEnabled = false

    /// Trusted certificate SHA-256 fingerprints, keyed by host (colon-separated uppercase hex)
    @objc static var trustedFingerprints: [String: String] = [:]

    @objc func enable(_ call: CAPPluginCall) {
        SSLTrustPlugin.sslTrustEnabled = true
        // Register URLProtocol to intercept URLSession.shared HTTPS requests
        // This covers CapacitorHttp which uses URLSession.shared
        URLProtocol.registerClass(SSLTrustURLProtocol.self)
        // WebView delegate is installed via setTrustedFingerprints() only when
        // a fingerprint is available, so the delegate never accepts without validation
        call.resolve()
    }

    @objc func disable(_ call: CAPPluginCall) {
        SSLTrustPlugin.sslTrustEnabled = false
        SSLTrustPlugin.trustedFingerprints = [:]
        URLProtocol.unregisterClass(SSLTrustURLProtocol.self)
        call.resolve()
    }

    @objc func isEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": SSLTrustPlugin.sslTrustEnabled])
    }

    @objc func setTrustedFingerprints(_ call: CAPPluginCall) {
        let entries = call.getArray("entries", JSObject.self) ?? []
        var updated: [String: String] = [:]
        for entry in entries {
            guard let host = entry["host"] as? String,
                  let fingerprint = entry["fingerprint"] as? String else { continue }
            updated[normalizeHost(host)] = fingerprint
        }
        // Rebuild atomically: a single assignment swaps the whole map at once
        SSLTrustPlugin.trustedFingerprints = updated
        // Only install WebView delegate when we have fingerprints to validate against
        if SSLTrustPlugin.sslTrustEnabled && !SSLTrustPlugin.trustedFingerprints.isEmpty {
            installWebViewDelegate()
        }
        call.resolve()
    }

    @objc func getServerCertFingerprint(_ call: CAPPluginCall) {
        guard let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            call.reject("URL is required")
            return
        }

        let delegate = CertFetchDelegate { result in
            switch result {
            case .success(let info):
                call.resolve([
                    "fingerprint": info.fingerprint,
                    "subject": info.subject,
                    "issuer": info.issuer,
                    "expiry": info.expiry,
                ])
            case .failure(let error):
                call.reject("Failed to get server certificate: \(error.localizedDescription)")
            }
        }

        let config = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        let task = session.dataTask(with: url) { _, _, _ in
            session.invalidateAndCancel()
        }
        task.resume()
    }

    // MARK: - WebView Navigation Delegate
    //
    // WKWebView routes server-trust challenges here for main-frame navigation
    // only. A subresource load - the <img> carrying an MJPEG stream, a WSS
    // connection - fails its handshake in the network process with no callback
    // to answer, so a self-signed server that CapacitorHttp reaches through
    // SSLTrustURLProtocol can still leave every live tile blank. Android has no
    // such gap: onReceivedSslError fires for subresources too. Suspected cause
    // of issue #507; the same limitation is documented for rich-push images in
    // docs/developer-guide/12-shared-services-and-components.rst.

    private var sslDelegate: SSLTrustNavigationDelegate?

    private func installWebViewDelegate() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.bridge?.webView,
                  let original = webView.navigationDelegate else { return }
            if original is SSLTrustNavigationDelegate { return }
            self.sslDelegate = SSLTrustNavigationDelegate(originalDelegate: original)
            webView.navigationDelegate = self.sslDelegate
        }
    }
}

// MARK: - Certificate info struct

struct CertFetchInfo {
    let fingerprint: String
    let subject: String
    let issuer: String
    let expiry: String
}

// MARK: - One-time cert fetch delegate

class CertFetchDelegate: NSObject, URLSessionDelegate {
    private let completion: (Result<CertFetchInfo, Error>) -> Void
    private var completed = false

    init(completion: @escaping (Result<CertFetchInfo, Error>) -> Void) {
        self.completion = completion
    }

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

        // Extract the leaf certificate
        let certCount = SecTrustGetCertificateCount(serverTrust)
        guard certCount > 0 else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            if !completed {
                completed = true
                completion(.failure(NSError(domain: "SSLTrust", code: -1, userInfo: [NSLocalizedDescriptionKey: "No certificates"])))
            }
            return
        }

        // Use SecTrustCopyCertificateChain for iOS 15+, fall back to SecTrustGetCertificateAtIndex
        var cert: SecCertificate?
        if #available(iOS 15.0, *) {
            if let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate], !chain.isEmpty {
                cert = chain[0]
            }
        } else {
            cert = SecTrustGetCertificateAtIndex(serverTrust, 0)
        }

        guard let leafCert = cert else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            if !completed {
                completed = true
                completion(.failure(NSError(domain: "SSLTrust", code: -2, userInfo: [NSLocalizedDescriptionKey: "Cannot extract certificate"])))
            }
            return
        }

        let fingerprint = sha256Fingerprint(leafCert)
        let subject = SecCertificateCopySubjectSummary(leafCert) as String? ?? "Unknown"

        // Extract real issuer/expiry from the certificate. Each falls back to its
        // own placeholder independently if extraction fails, rather than forcing
        // both fields to a generic value.
        let (extractedIssuer, extractedExpiry) = certificateIssuerAndExpiry(leafCert)
        let issuerStr = extractedIssuer ?? subject
        let expiryStr = extractedExpiry ?? "See certificate details"

        let info = CertFetchInfo(fingerprint: fingerprint, subject: subject, issuer: issuerStr, expiry: expiryStr)

        if !completed {
            completed = true
            completion(.success(info))
        }

        // Accept the cert for this one-time fetch
        completionHandler(.useCredential, URLCredential(trust: serverTrust))
    }
}

// MARK: - SHA-256 fingerprint helper

/// Normalize a host string for use as a trust-map key: lowercase (native
/// challenge hosts may differ in case from the JS side's `new URL().hostname`),
/// and strip surrounding `[ ]` from IPv6 literals (JS stores them bracket-free).
func normalizeHost(_ host: String) -> String {
    var normalized = host.lowercased()
    if normalized.hasPrefix("[") && normalized.hasSuffix("]") {
        normalized = String(normalized.dropFirst().dropLast())
    }
    return normalized
}

func sha256Fingerprint(_ certificate: SecCertificate) -> String {
    let data = SecCertificateCopyData(certificate) as Data
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes { ptr in
        _ = CC_SHA256(ptr.baseAddress!, CC_LONG(data.count), &hash)
    }
    return hash.map { String(format: "%02X", $0) }.joined(separator: ":")
}

/// Check if a certificate's fingerprint matches the trusted one for a given host.
/// Used by URLProtocol (HTTP requests) — allows when no fingerprint is stored for
/// the host (TOFU cert-fetch).
func isCertTrustedForHTTP(_ certificate: SecCertificate, host: String) -> Bool {
    guard let trusted = SSLTrustPlugin.trustedFingerprints[normalizeHost(host)], !trusted.isEmpty else {
        // No fingerprint stored for this host yet — allow for TOFU cert-fetch flow
        return true
    }
    let actual = sha256Fingerprint(certificate)
    return actual == trusted
}

/// Check if a certificate's fingerprint matches the trusted one for a given host.
/// Used by WKNavigationDelegate (WebView) — allows when no fingerprint is stored for
/// the host (TOFU: a profile mid-onboarding has no pinned fingerprint yet).
func isCertTrustedForWebView(_ certificate: SecCertificate, host: String) -> Bool {
    guard let trusted = SSLTrustPlugin.trustedFingerprints[normalizeHost(host)], !trusted.isEmpty else {
        return true
    }
    let actual = sha256Fingerprint(certificate)
    return actual == trusted
}

/// True when the server trust passes normal system validation (a valid CA chain
/// for the requested host). The pinned challenge handlers accept a cert if it is
/// system-valid OR matches the pinned fingerprint, so a pinned self-signed
/// fingerprint does not reject valid-CA servers (other profiles, external hosts).
func isServerTrustValid(_ serverTrust: SecTrust) -> Bool {
    return SecTrustEvaluateWithError(serverTrust, nil)
}

// MARK: - URLProtocol for intercepting URLSession.shared HTTPS requests

/// Custom URLProtocol that intercepts HTTPS requests and validates certificates
/// against the trusted fingerprint. This is needed because CapacitorHttp uses
/// URLSession.shared which has no delegate.
class SSLTrustURLProtocol: URLProtocol, URLSessionDelegate, URLSessionDataDelegate {
    private var dataTask: URLSessionDataTask?
    private var session: URLSession?
    private let invalidationLock = NSLock()
    private var didInvalidate = false
    private static let handledKey = "SSLTrustURLProtocolHandled"

    override class func canInit(with request: URLRequest) -> Bool {
        // Only intercept when SSL trust is enabled
        guard SSLTrustPlugin.sslTrustEnabled else { return false }
        // Only intercept HTTPS
        guard request.url?.scheme == "https" else { return false }
        // Prevent infinite recursion — skip requests we've already handled
        guard URLProtocol.property(forKey: handledKey, in: request) == nil else { return false }
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        guard let mutableRequest = (request as NSURLRequest).mutableCopy() as? NSMutableURLRequest else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "SSLTrust", code: -1))
            return
        }
        // Mark request as handled to prevent recursion
        URLProtocol.setProperty(true, forKey: SSLTrustURLProtocol.handledKey, in: mutableRequest)

        let config = URLSessionConfiguration.default
        let newSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session = newSession
        dataTask = newSession.dataTask(with: mutableRequest as URLRequest)
        dataTask?.resume()
    }

    override func stopLoading() {
        dataTask?.cancel()
        invalidateSession()
    }

    /// Invalidate the per-request URLSession exactly once. URLSession retains its
    /// delegate until invalidated, so without this every intercepted HTTPS request
    /// leaks a session + protocol instance. Both stopLoading() (client cancel/teardown)
    /// and didCompleteWithError (natural completion) can each try to invalidate, so
    /// guard with a lock to avoid invalidating twice.
    private func invalidateSession() {
        invalidationLock.lock()
        defer { invalidationLock.unlock() }
        guard !didInvalidate else { return }
        didInvalidate = true
        session?.finishTasksAndInvalidate()
    }

    // MARK: URLSessionDelegate — validate certificate fingerprint

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust {

            var cert: SecCertificate?
            if #available(iOS 15.0, *) {
                if let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate], !chain.isEmpty {
                    cert = chain[0]
                }
            } else {
                cert = SecTrustGetCertificateAtIndex(serverTrust, 0)
            }

            // Accept if the cert passes normal system validation (valid CA, the
            // requested host) OR matches the pinned fingerprint, so a pinned
            // self-signed fingerprint does not reject valid-CA servers.
            let host = challenge.protectionSpace.host
            let fingerprintTrusted = cert.map { isCertTrustedForHTTP($0, host: host) } ?? false
            if isServerTrustValid(serverTrust) || fingerprintTrusted {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
                return
            }

            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        completionHandler(.performDefaultHandling, nil)
    }

    // MARK: URLSessionDataDelegate — forward response data to client

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        client?.urlProtocol(self, didLoad: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            client?.urlProtocol(self, didFailWithError: error)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
        invalidateSession()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Forward redirects to the URL loading system
        client?.urlProtocol(self, wasRedirectedTo: request, redirectResponse: response)
        completionHandler(nil)
    }
}

// MARK: - WKWebView Navigation Delegate Proxy

class SSLTrustNavigationDelegate: NSObject, WKNavigationDelegate {
    let originalDelegate: WKNavigationDelegate

    init(originalDelegate: WKNavigationDelegate) {
        self.originalDelegate = originalDelegate
        super.init()
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return originalDelegate
    }

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return originalDelegate.responds(to: aSelector)
    }

    func webView(
        _ webView: WKWebView,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if SSLTrustPlugin.sslTrustEnabled,
           challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust {

            var cert: SecCertificate?
            if #available(iOS 15.0, *) {
                if let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate], !chain.isEmpty {
                    cert = chain[0]
                }
            } else {
                cert = SecTrustGetCertificateAtIndex(serverTrust, 0)
            }

            // Accept if the cert passes normal system validation OR matches the
            // pinned fingerprint, so a pinned self-signed fingerprint does not
            // reject valid-CA servers (e.g. image loads from another profile's host).
            let host = challenge.protectionSpace.host
            let fingerprintTrusted = cert.map { isCertTrustedForWebView($0, host: host) } ?? false
            if isServerTrustValid(serverTrust) || fingerprintTrusted {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
                return
            }

            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        if originalDelegate.responds(to: #selector(webView(_:didReceive:completionHandler:))) {
            originalDelegate.webView?(webView, didReceive: challenge, completionHandler: completionHandler)
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
