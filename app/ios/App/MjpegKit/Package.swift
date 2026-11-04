// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MjpegKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "MjpegKit", targets: ["MjpegKit"])],
    targets: [
        .target(name: "MjpegKit"),
        .testTarget(name: "MjpegKitTests", dependencies: ["MjpegKit"], exclude: ["Fixtures"]),
    ]
)
