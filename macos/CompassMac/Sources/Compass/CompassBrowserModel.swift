import Combine
import Foundation
import Network
import WebKit

@MainActor
final class CompassBrowserModel: ObservableObject {
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = false
    @Published private(set) var progress = 0.0
    @Published private(set) var isOffline = false
    @Published var errorMessage: String?

    weak var webView: WKWebView?
    private let pathMonitor = NWPathMonitor()
    private let pathQueue = DispatchQueue(label: "com.n494n0.compass.network")

    init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let offline = path.status != .satisfied
            Task { @MainActor [weak self] in
                self?.isOffline = offline
            }
        }
        pathMonitor.start(queue: pathQueue)
    }

    deinit {
        pathMonitor.cancel()
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
        refreshNavigationState()

        if webView.url == nil {
            loadProductionSite()
        }
    }

    func loadProductionSite() {
        errorMessage = nil
        webView?.load(URLRequest(url: CompassURLPolicy.productionURL))
    }

    func goBack() {
        webView?.goBack()
    }

    func goForward() {
        webView?.goForward()
    }

    func reload() {
        errorMessage = nil
        if webView?.url == nil {
            loadProductionSite()
        } else {
            webView?.reload()
        }
    }

    func refreshNavigationState() {
        canGoBack = webView?.canGoBack ?? false
        canGoForward = webView?.canGoForward ?? false
    }

    func didStartLoading() {
        errorMessage = nil
        isLoading = true
        progress = 0.05
        refreshNavigationState()
    }

    func didFinishLoading() {
        isLoading = false
        progress = 1
        refreshNavigationState()
    }

    func didUpdateProgress(_ value: Double) {
        progress = value
        refreshNavigationState()
    }

    func showLoadError(_ error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }

        isLoading = false
        refreshNavigationState()
        errorMessage = isOffline
            ? "オフラインです。ネットワーク接続を確認してください。"
            : "Compass を読み込めませんでした。再読み込みしてください。"
    }
}
