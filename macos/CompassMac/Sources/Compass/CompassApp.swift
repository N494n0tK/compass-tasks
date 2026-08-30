import SwiftUI

@main
struct CompassApp: App {
    var body: some Scene {
        WindowGroup("Compass") {
            CompassWindow()
        }
        .defaultSize(width: 1280, height: 800)
        .windowResizability(.contentMinSize)
    }
}

private struct CompassWindow: View {
    @StateObject private var browser = CompassBrowserModel()

    var body: some View {
        VStack(spacing: 0) {
            navigationBar

            if browser.isLoading {
                ProgressView(value: browser.progress)
                    .progressViewStyle(.linear)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 5)
            }

            ZStack {
                CompassWebView(model: browser)

                if let errorMessage = browser.errorMessage {
                    loadError(message: errorMessage)
                }
            }
        }
        .frame(minWidth: 920, minHeight: 620)
    }

    private var navigationBar: some View {
        HStack(spacing: 8) {
            Button {
                browser.goBack()
            } label: {
                Image(systemName: "chevron.left")
            }
            .help("戻る")
            .disabled(!browser.canGoBack)

            Button {
                browser.goForward()
            } label: {
                Image(systemName: "chevron.right")
            }
            .help("進む")
            .disabled(!browser.canGoForward)

            Button {
                browser.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .help("再読み込み")

            Text("Compass")
                .font(.headline)
                .padding(.leading, 4)

            Spacer()

            if browser.isOffline {
                Label("オフライン", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(.bar)
    }

    @ViewBuilder
    private func loadError(message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: browser.isOffline ? "wifi.slash" : "exclamationmark.triangle")
                .font(.title2)
            Text(message)
                .multilineTextAlignment(.center)
            Button("再読み込み") {
                browser.reload()
            }
        }
        .padding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 12)
        .accessibilityElement(children: .combine)
    }
}
