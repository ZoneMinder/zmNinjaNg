import XCTest
@testable import MjpegKit

final class FrameStoreTests: XCTestCase {
    private let frameA = Data([1, 2, 3])
    private let frameB = Data([9, 9])

    /// Records the first value a waiter is completed with. Completions arrive on
    /// the store's queue, so the flag and the value are read under a lock.
    private final class Capture {
        let arrived = XCTestExpectation(description: "waiter completed")
        private let lock = NSLock()
        private var value: Data?

        func complete(_ frame: Data?) {
            lock.lock()
            value = frame
            lock.unlock()
            arrived.fulfill()
        }

        var frame: Data? {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
    }

    /// Parks a waiter on `id` and returns the capture for it. `deadline` is 5s in
    /// every test but the deadline one, so a prompt nil can only come from the
    /// store answering, never from the timer.
    @discardableResult
    private func park(
        _ store: FrameStore,
        _ id: String,
        deadline: TimeInterval = 5
    ) -> (Capture, FrameStore.WaiterToken) {
        let capture = Capture()
        let token = store.next(id, deadline: deadline) { capture.complete($0) }
        return (capture, token)
    }

    /// The value the waiter was completed with. Fails the test if it never was.
    private func completed(_ capture: Capture, within timeout: TimeInterval = 1) -> Data? {
        if XCTWaiter().wait(for: [capture.arrived], timeout: timeout) != .completed {
            XCTFail("waiter never completed")
            return nil
        }
        return capture.frame
    }

    func testNextReturnsPublishedFrameOnce() {
        let store = FrameStore()
        store.register("1")
        store.publish("1", frame: frameA)

        let (first, _) = park(store, "1")
        XCTAssertEqual(completed(first), frameA)

        // The frame is spent, so this waiter parks. It is completed with frameB,
        // not a second copy of frameA and not nil.
        let (second, _) = park(store, "1")
        store.publish("1", frame: frameB)
        XCTAssertEqual(completed(second), frameB)
    }

    func testUnknownStreamCompletesNil() {
        let store = FrameStore()
        let (capture, _) = park(store, "99")
        XCTAssertNil(completed(capture))
    }

    func testSecondWaiterReplacesFirstWithNil() {
        let store = FrameStore()
        store.register("1")

        let (first, _) = park(store, "1")
        let (second, _) = park(store, "1")
        XCTAssertNil(completed(first))

        store.publish("1", frame: frameA)
        XCTAssertEqual(completed(second), frameA)
    }

    func testRemoveCompletesParkedWaiterWithNil() {
        let store = FrameStore()
        store.register("1")
        let (capture, _) = park(store, "1")

        store.remove("1")
        XCTAssertNil(completed(capture))
    }

    func testMarkDeadKeepsAnsweringNilUntilRemove() {
        let store = FrameStore()
        store.register("1")
        let (parked, _) = park(store, "1")

        store.markDead("1")
        XCTAssertNil(completed(parked))

        // The <img> keeps pointing at a dead stream through the JS backoff delay,
        // so every later request has to be answered at once rather than parked.
        for attempt in 1...3 {
            let (capture, _) = park(store, "1")
            XCTAssertNil(completed(capture), "attempt \(attempt)")
        }

        store.remove("1")
        let (afterRemove, _) = park(store, "1")
        XCTAssertNil(completed(afterRemove))
    }

    func testDeadlineCompletesNil() {
        let store = FrameStore()
        store.register("1")
        // Registered and alive, so nil can only come from the deadline.
        let (capture, _) = park(store, "1", deadline: 0.05)
        XCTAssertNil(completed(capture))
    }

    func testRemoveAllDropsEverySlotAndCompletesTheirWaiters() {
        let store = FrameStore()
        store.register("1")
        store.register("2")
        let (first, _) = park(store, "1")
        let (second, _) = park(store, "2")

        // The webview went away, so every stream is reclaimed at once.
        store.removeAll()
        XCTAssertNil(completed(first))
        XCTAssertNil(completed(second))

        // Both slots are gone, so a later request is an unknown stream.
        store.publish("1", frame: frameA)
        let (afterRemoveAll, _) = park(store, "1")
        XCTAssertNil(completed(afterRemoveAll))
    }

    func testCancelledWaiterIsNeverCompleted() {
        let store = FrameStore()
        store.register("1")
        let (capture, token) = park(store, "1")

        // WebKit called stop(task): the task must not be touched again, so the
        // waiter is dropped silently and a later frame goes to nobody.
        store.cancel(token)
        store.publish("1", frame: frameA)

        capture.arrived.isInverted = true
        XCTAssertEqual(XCTWaiter().wait(for: [capture.arrived], timeout: 0.2), .completed)
    }
}
