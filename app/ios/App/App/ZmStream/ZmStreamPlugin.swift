import Foundation
import Capacitor
import MjpegKit

/// The streams held open natively, so `close` can find a reader and the scheme
/// handler can find a stream's stall timeout. The plugin writes this on
/// Capacitor's call queue and the handler reads it on the main thread, hence
/// the lock.
final class ZmStreamRegistry {
    static let shared = ZmStreamRegistry()

    private struct Stream {
        let reader: MjpegReader
        let stallTimeout: TimeInterval
    }

    private let lock = NSLock()
    private var streams: [String: Stream] = [:]
    private var counter = 0

    func nextId() -> String {
        lock.lock()
        defer { lock.unlock() }
        counter += 1
        return String(counter)
    }

    func add(_ id: String, reader: MjpegReader, stallTimeout: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        streams[id] = Stream(reader: reader, stallTimeout: stallTimeout)
    }

    /// nil when the stream was never opened, or was closed.
    func stallTimeout(of id: String) -> TimeInterval? {
        lock.lock()
        defer { lock.unlock() }
        return streams[id]?.stallTimeout
    }

    func removeReader(_ id: String) -> MjpegReader? {
        lock.lock()
        defer { lock.unlock() }
        return streams.removeValue(forKey: id)?.reader
    }

    func removeAllReaders() -> [MjpegReader] {
        lock.lock()
        defer { lock.unlock() }
        let readers = streams.values.map { $0.reader }
        streams = [:]
        return readers
    }
}

@objc(ZmStreamPlugin)
public class ZmStreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ZmStreamPlugin"
    public let jsName = "ZmStream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeAll", returnType: CAPPluginReturnPromise),
    ]

    /// Only used if a caller omits stallTimeoutMs; the JS side always sends one.
    private static let defaultStallTimeoutMs = 10_000

    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("url is required")
            return
        }
        // The bridge is a trust boundary: without this the webview could point a
        // reader at file:// or any other scheme the URL parser accepts.
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            call.reject("url must be http or https")
            return
        }
        let stallTimeoutMs = call.getInt("stallTimeoutMs") ?? Self.defaultStallTimeoutMs
        let id = ZmStreamRegistry.shared.nextId()
        FrameStore.shared.register(id)
        let reader = MjpegReader(streamId: id, url: url)
        ZmStreamRegistry.shared.add(id, reader: reader, stallTimeout: Double(stallTimeoutMs) / 1000)
        reader.start()
        call.resolve(["streamId": id])
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("streamId") else {
            call.reject("streamId is required")
            return
        }
        // Registry first, so a request arriving now is answered 404 rather than
        // parked; then the store, which completes whatever is parked already.
        ZmStreamRegistry.shared.removeReader(id)?.cancel()
        FrameStore.shared.remove(id)
        call.resolve()
    }

    /// Reclaims every stream. The JS side calls this when its page goes away and
    /// again when the stream module initialises, which is the half that matters:
    /// a hard reload or a crash runs no teardown handler, so without a reclaim at
    /// startup the readers of the previous page would keep parsing frames into
    /// slots nobody reads, one per tile, per reload.
    @objc func closeAll(_ call: CAPPluginCall) {
        for reader in ZmStreamRegistry.shared.removeAllReaders() {
            reader.cancel()
        }
        FrameStore.shared.removeAll()
        call.resolve()
    }
}
