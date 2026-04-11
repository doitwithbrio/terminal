import AppKit
import SwiftUI
import WebKit

/// A WYSIWYG markdown editor powered by Milkdown, embedded in a WKWebView.
/// Renders markdown as rich text and allows inline editing with auto-save.
struct MilkdownEditorView: NSViewRepresentable {
    let initialContent: String
    let onContentChanged: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onContentChanged: onContentChanged)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "milkdownBridge")

        // Allow loading from esm.sh CDN
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")

        // Store reference so coordinator can call JS
        context.coordinator.webView = webView
        context.coordinator.pendingContent = initialContent

        // Load the bundled editor HTML
        if let editorURL = Bundle.main.resourceURL?
            .appendingPathComponent("milkdown-editor")
            .appendingPathComponent("editor.html") {
            webView.loadFileURL(editorURL, allowingReadAccessTo: editorURL.deletingLastPathComponent())
        }

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // Content updates after initial load are handled via JS calls from the coordinator
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let onContentChanged: (String) -> Void
        weak var webView: WKWebView?
        var pendingContent: String?
        private var isReady = false

        init(onContentChanged: @escaping (String) -> Void) {
            self.onContentChanged = onContentChanged
        }

        // MARK: WKScriptMessageHandler

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }

            switch type {
            case "ready":
                isReady = true
                if let content = pendingContent {
                    setContent(content)
                    pendingContent = nil
                }
            case "contentChanged":
                if let content = body["content"] as? String {
                    DispatchQueue.main.async {
                        self.onContentChanged(content)
                    }
                }
            default:
                break
            }
        }

        // MARK: WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // After page loads, initialize with content if we have it
            if let content = pendingContent {
                let escaped = content
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "`", with: "\\`")
                    .replacingOccurrences(of: "$", with: "\\$")
                let js = "window.initEditor(`\(escaped)`);"
                webView.evaluateJavaScript(js) { _, error in
                    if let error {
                        NSLog("[MilkdownEditor] initEditor error: \(error)")
                    }
                }
            }
        }

        // MARK: - Swift → JS

        func setContent(_ markdown: String) {
            guard let webView, isReady else {
                pendingContent = markdown
                return
            }
            let escaped = markdown
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "`", with: "\\`")
                .replacingOccurrences(of: "$", with: "\\$")
            webView.evaluateJavaScript("window.editorSetContent(`\(escaped)`);", completionHandler: nil)
        }
    }
}
