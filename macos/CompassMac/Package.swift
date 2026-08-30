// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CompassMac",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "Compass", targets: ["Compass"]),
    ],
    targets: [
        .executableTarget(name: "Compass"),
        .testTarget(name: "CompassTests", dependencies: ["Compass"]),
    ]
)
