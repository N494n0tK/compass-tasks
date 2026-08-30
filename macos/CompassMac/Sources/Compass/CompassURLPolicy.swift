import Foundation

enum CompassURLDestination: Equatable {
    case inApp
    case external
    case blocked
}

/// Limits the embedded browser to the production Compass site and the small
/// set of identity hosts required to complete Firebase/Google sign-in.
enum CompassURLPolicy {
    static let productionURL = URL(string: "https://compass-tasks.vercel.app")!

    private static let inAppIdentityDomains = [
        "google.com",
        "googleusercontent.com",
        "firebaseapp.com",
        "web.app",
    ]

    static func destination(for url: URL) -> CompassURLDestination {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else {
            return .blocked
        }

        if host == productionURL.host {
            return .inApp
        }

        if inAppIdentityDomains.contains(where: { hostMatches(host, domain: $0) }) {
            return .inApp
        }

        return .external
    }

    private static func hostMatches(_ host: String, domain: String) -> Bool {
        host == domain || host.hasSuffix("." + domain)
    }
}
