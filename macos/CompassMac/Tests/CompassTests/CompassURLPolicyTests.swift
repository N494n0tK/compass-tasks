import XCTest
@testable import Compass

final class CompassURLPolicyTests: XCTestCase {
    func testProductionURLIsHTTPSAndUsesTheProductionHost() {
        XCTAssertEqual(CompassURLPolicy.productionURL.scheme, "https")
        XCTAssertEqual(CompassURLPolicy.productionURL.host, "compass-tasks.vercel.app")
        XCTAssertEqual(CompassURLPolicy.destination(for: CompassURLPolicy.productionURL), .inApp)
    }

    func testGoogleAndFirebaseOAuthHostsStayInTheSameWebView() throws {
        let urls = [
            "https://accounts.google.com/o/oauth2/auth",
            "https://secure-token.firebaseapp.com/__/auth/handler",
            "https://review-schedule-splakilop.web.app/__/auth/handler",
        ]

        for value in urls {
            XCTAssertEqual(CompassURLPolicy.destination(for: try XCTUnwrap(URL(string: value))), .inApp)
        }
    }

    func testExternalHTTPSLinksUseTheSystemBrowser() throws {
        let url = try XCTUnwrap(URL(string: "https://example.org/guide"))
        XCTAssertEqual(CompassURLPolicy.destination(for: url), .external)
    }

    func testNonHTTPSURLsAreBlockedFromTheEmbeddedBrowser() throws {
        let urls = ["http://compass-tasks.vercel.app", "file:///tmp/page.html"]

        for value in urls {
            XCTAssertEqual(CompassURLPolicy.destination(for: try XCTUnwrap(URL(string: value))), .blocked)
        }
    }
}
