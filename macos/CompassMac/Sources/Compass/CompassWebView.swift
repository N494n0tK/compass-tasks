import AppKit
import SwiftUI
import WebKit

/// The only AppKit bridge: SwiftUI owns presentation state while WKWebView
/// owns web navigation, cookies, and the persistent Firebase session.
struct CompassWebView: NSViewRepresentable {
    @ObservedObject var model: CompassBrowserModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true

        context.coordinator.observe(webView)
        model.attach(to: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if model.webView !== webView {
            model.attach(to: webView)
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.stopObserving()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let model: CompassBrowserModel
        private var progressObservation: NSKeyValueObservation?

        init(model: CompassBrowserModel) {
            self.model = model
        }

        func observe(_ webView: WKWebView) {
            progressObservation = webView.observe(\WKWebView.estimatedProgress, options: [.initial, .new]) { [weak self] webView, _ in
                DispatchQueue.main.async {
                    self?.model.didUpdateProgress(webView.estimatedProgress)
                }
            }
        }

        func stopObserving() {
            progressObservation?.invalidate()
            progressObservation = nil
        }

        @MainActor
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = navigationAction.request.url
            let destination = url.map(CompassURLPolicy.destination(for:)) ?? .blocked

            switch destination {
            case .inApp:
                decisionHandler(.allow)
            case .external:
                if let url {
                    NSWorkspace.shared.open(url)
                }
                decisionHandler(.cancel)
            case .blocked:
                model.errorMessage = "安全でないリンクは開けません。"
                decisionHandler(.cancel)
            }
        }

        /// Firebase Auth and Google OAuth often call window.open / target=_blank.
        /// Load those identity URLs in this same persistent web view so the redirect
        /// returns to Compass with the existing session intact.
        @MainActor
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }

            switch CompassURLPolicy.destination(for: url) {
            case .inApp:
                webView.load(URLRequest(url: url))
            case .external:
                NSWorkspace.shared.open(url)
            case .blocked:
                model.errorMessage = "安全でないリンクは開けません。"
            }

            return nil
        }

        @MainActor
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model.didStartLoading()
        }

        @MainActor
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.didFinishLoading()
        }

        @MainActor
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
            model.showLoadError(error)
        }

        @MainActor
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            model.showLoadError(error)
        }
    }
}
