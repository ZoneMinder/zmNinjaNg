import Foundation

/// Splits a `multipart/x-mixed-replace` MJPEG byte stream into JPEG frames.
/// Feed it chunks of any size; `onFrame` fires once per complete frame.
public final class MjpegParser {
    private enum State {
        case scanToBoundary          // drop bytes until "--boundary"
        case headers                 // after the boundary, waiting for the blank line
        case body(remaining: Int)    // Content-Length known
        case bodyUntilBoundary       // no Content-Length: body ends at "\r\n--boundary"
    }

    /// Larger Content-Length values are treated as missing, so one bad header can't stall the stream.
    private static let maxFrameBytes = 16 * 1024 * 1024

    private let marker: [UInt8]
    private var buffer: [UInt8] = []
    private var state = State.scanToBoundary

    public var onFrame: ((Data) -> Void)?

    public init(boundary: String) {
        marker = Array("--\(boundary)".utf8)
    }

    public func feed(_ data: Data) {
        buffer.append(contentsOf: data)
        while step() {}
    }

    /// Advances one state transition. Returns false when it needs more bytes.
    private func step() -> Bool {
        switch state {
        case .scanToBoundary:
            // After a Content-Length body this is also the resync: anything that
            // isn't the boundary (a lying length) is dropped until it shows up.
            // ponytail: rescans from the start per feed, a rolling search if chunks get tiny and frames huge
            guard let at = find(marker) else {
                // keep a tail that could be the start of a split marker
                buffer.removeFirst(max(0, buffer.count - (marker.count - 1)))
                return false
            }
            buffer.removeFirst(at + marker.count)
            state = .headers
            return true

        case .headers:
            guard let end = find([13, 10, 13, 10]) else { return false }
            let head = String(decoding: buffer[..<end], as: UTF8.self)
            buffer.removeFirst(end + 4)
            if let length = Self.contentLength(in: head), length <= Self.maxFrameBytes {
                state = .body(remaining: length)
            } else {
                state = .bodyUntilBoundary
            }
            return true

        case .body(let remaining):
            guard buffer.count >= remaining else { return false }
            onFrame?(Data(buffer[..<remaining]))
            buffer.removeFirst(remaining)
            state = .scanToBoundary
            return true

        case .bodyUntilBoundary:
            guard let at = find([13, 10] + marker) else { return false }
            onFrame?(Data(buffer[..<at]))
            buffer.removeFirst(at + 2)
            state = .scanToBoundary
            return true
        }
    }

    private static func contentLength(in head: String) -> Int? {
        for line in head.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                return Int(parts[1].trimmingCharacters(in: .whitespaces))
            }
        }
        return nil
    }

    private func find(_ pattern: [UInt8]) -> Int? {
        guard buffer.count >= pattern.count else { return nil }
        for i in 0...(buffer.count - pattern.count) where buffer[i] == pattern[0] {
            if buffer[i..<(i + pattern.count)].elementsEqual(pattern) { return i }
        }
        return nil
    }
}
