import XCTest
@testable import MjpegKit

final class MjpegParserTests: XCTestCase {
    private let boundary = "ZoneMinderFrame"

    /// Same formula as make-fixtures.py.
    private func frame(_ n: Int, size: Int? = nil) -> Data {
        let sizes = [300, 1000, 5000]
        return Data((0..<(size ?? sizes[n])).map { UInt8((n * 31 + $0 * 7) % 256) })
    }

    private func fixture(_ name: String) throws -> Data {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        return try Data(contentsOf: dir.appendingPathComponent("Fixtures/\(name)"))
    }

    private func parse(_ data: Data, chunk: Int? = nil) -> [Data] {
        let parser = MjpegParser(boundary: boundary)
        var frames: [Data] = []
        parser.onFrame = { frames.append($0) }
        let step = chunk ?? max(data.count, 1)
        var i = 0
        while i < data.count {
            parser.feed(data.subdata(in: i..<min(i + step, data.count)))
            i += step
        }
        return frames
    }

    func testCleanStreamEmitsThreeFrames() throws {
        XCTAssertEqual(parse(try fixture("clean-three.bin")), [frame(0), frame(1), frame(2)])
    }

    func testArbitrarySplitsEmitSameFrames() throws {
        let data = try fixture("clean-three.bin")
        for chunk in [1, 7, 64] {
            XCTAssertEqual(parse(data, chunk: chunk), [frame(0), frame(1), frame(2)], "chunk \(chunk)")
        }
    }

    func testNoContentLengthScansToNextBoundary() throws {
        let data = try fixture("no-content-length.bin")
        XCTAssertEqual(parse(data), [frame(0), frame(1)])
        XCTAssertEqual(parse(data, chunk: 7), [frame(0), frame(1)])
    }

    func testTruncatedFinalFrameIsNotEmitted() throws {
        XCTAssertEqual(parse(try fixture("truncated.bin")), [frame(0), frame(1)])
    }

    func testResyncsAfterShortContentLength() {
        let head = "--\(boundary)\r\nContent-Type: image/jpeg\r\nContent-Length: "
        var data = Data("\(head)10\r\n\r\n".utf8)
        data.append(frame(0, size: 100))
        data.append(Data("\r\n\(head)\(frame(1).count)\r\n\r\n".utf8))
        data.append(frame(1))
        data.append(Data("\r\n".utf8))
        let frames = parse(data)
        XCTAssertEqual(frames, [frame(0, size: 100).prefix(10), frame(1)].map { Data($0) })
    }
}
