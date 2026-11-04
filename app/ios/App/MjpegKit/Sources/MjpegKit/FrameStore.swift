import Foundation

/// Holds the latest JPEG frame of each native MJPEG stream and hands it to the
/// one request waiting for it.
///
/// The webview's `<img>` asks for `zmframe://frames/<id>/<n>` and chains to
/// `n+1` on load, so there is at most one request outstanding per stream. A
/// request that arrives before the next frame parks here until the frame lands,
/// the stream dies, or its deadline passes - whichever comes first. Frames are
/// not queued: a slot holds one frame and a later frame overwrites an
/// undelivered one, because a live tile wants the newest picture, not a backlog.
public final class FrameStore {
    public static let shared = FrameStore()

    /// Identifies one parked request, so `cancel` can only drop that request and
    /// never a newer one that replaced it.
    public struct WaiterToken {
        let id: String
        let key: UUID
    }

    private struct Waiter {
        let key: UUID
        let completion: (Data?) -> Void
        let timeout: DispatchWorkItem
    }

    private final class Slot {
        var frame: Data?
        var dead = false
        var waiter: Waiter?
    }

    private let queue = DispatchQueue(label: "zmninja.framestore")
    private var slots: [String: Slot] = [:]

    public func register(_ id: String) {
        queue.async { self.slots[id] = Slot() }
    }

    public func publish(_ id: String, frame: Data) {
        queue.async {
            guard let slot = self.slots[id], !slot.dead else { return }
            if let waiter = slot.waiter {
                slot.waiter = nil
                self.finish(waiter, with: frame)
            } else {
                slot.frame = frame
            }
        }
    }

    /// The stream's connection is gone. Every later request is answered with nil
    /// until `remove`, so the `<img>` gets a 404 and fires `error` instead of
    /// hanging on a socket that will never produce another frame.
    public func markDead(_ id: String) {
        queue.async {
            guard let slot = self.slots[id] else { return }
            slot.dead = true
            slot.frame = nil
            self.completeWaiter(of: slot, with: nil)
        }
    }

    public func remove(_ id: String) {
        queue.async {
            guard let slot = self.slots.removeValue(forKey: id) else { return }
            self.completeWaiter(of: slot, with: nil)
        }
    }

    /// Reclaims every stream. The webview that was reading these frames is gone -
    /// a reload, a remount, a crash - so nothing will ever ask for them again.
    public func removeAll() {
        queue.async {
            let slots = self.slots
            self.slots = [:]
            for slot in slots.values {
                self.completeWaiter(of: slot, with: nil)
            }
        }
    }

    /// Calls `completion` on the store's queue with the next undelivered frame,
    /// nil for a dead, unknown or timed-out stream. Replaces any earlier waiter
    /// for `id`, completing that one with nil.
    @discardableResult
    public func next(
        _ id: String,
        deadline: TimeInterval,
        completion: @escaping (Data?) -> Void
    ) -> WaiterToken {
        let token = WaiterToken(id: id, key: UUID())
        queue.async {
            guard let slot = self.slots[id], !slot.dead else {
                completion(nil)
                return
            }
            if let frame = slot.frame {
                slot.frame = nil
                completion(frame)
                return
            }
            self.completeWaiter(of: slot, with: nil)

            let timeout = DispatchWorkItem { [weak slot] in
                guard let slot = slot, slot.waiter?.key == token.key else { return }
                self.completeWaiter(of: slot, with: nil)
            }
            slot.waiter = Waiter(key: token.key, completion: completion, timeout: timeout)
            self.queue.asyncAfter(deadline: .now() + deadline, execute: timeout)
        }
        return token
    }

    /// WebKit called `stop` on the request's task. The waiter is dropped without
    /// being completed: touching a stopped `WKURLSchemeTask` throws an
    /// Objective-C exception Swift cannot catch.
    public func cancel(_ token: WaiterToken) {
        queue.async {
            guard let slot = self.slots[token.id], slot.waiter?.key == token.key else { return }
            slot.waiter?.timeout.cancel()
            slot.waiter = nil
        }
    }

    private func completeWaiter(of slot: Slot, with frame: Data?) {
        guard let waiter = slot.waiter else { return }
        slot.waiter = nil
        finish(waiter, with: frame)
    }

    private func finish(_ waiter: Waiter, with frame: Data?) {
        waiter.timeout.cancel()
        waiter.completion(frame)
    }
}
