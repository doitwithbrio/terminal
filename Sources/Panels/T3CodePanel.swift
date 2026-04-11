import AppKit
import Combine
import Foundation
import WebKit

/// Legacy/fallback panel that displays the T3 Code web client in a WKWebView.
///
/// T3 Code is an open-source GUI for AI coding agents (Claude Code, Codex, etc.).
/// The frontend is a React SPA loaded from the app bundle or served by the
/// bundled T3 Code backend server. Communication with the backend uses WebSocket RPC.
///
/// The normal user-visible T3 runtime uses a chromeless `BrowserPanel`.
/// This class remains as a fallback/legacy path and shares the same theme helper.
///
/// Lifecycle:
///   1. On init, registers with `T3ServerManager` to ensure the backend is running.
///   2. Creates a WKWebView and loads the T3 Code frontend.
///   3. A native bridge (`T3CodeBridgeHandler`) replaces Electron's preload for
///      dialogs, file pickers, and external URL opening.
///   4. On close, unregisters from `T3ServerManager`.
@MainActor
final class T3CodePanel: Panel, ObservableObject {
    let id: UUID
    let panelType: PanelType = .t3code

    /// The workspace this panel belongs to.
    private(set) var workspaceId: UUID

    /// Title shown in the tab bar.
    @Published private(set) var displayTitle: String = "T3 Code"

    /// SF Symbol icon for the tab bar.
    var displayIcon: String? { "cpu" }

    /// Whether the panel has unsaved changes.
    @Published var isDirty: Bool = false

    /// Token incremented to trigger focus flash animation.
    @Published private(set) var focusFlashToken: Int = 0

    /// The WKWebView displaying the T3 Code frontend.
    private(set) var webView: WKWebView!

    /// Bridge handler for JavaScript → Swift communication.
    private var bridgeHandler: T3CodeBridgeHandler?

    /// Whether the panel has been closed.
    private var isClosed: Bool = false

    // MARK: - Shared WKWebView configuration

    /// Shared process pool for all T3 Code panels (memory efficiency).
    private static let sharedProcessPool = WKProcessPool()

    // MARK: - Init

    init(workspaceId: UUID) {
        self.id = UUID()
        self.workspaceId = workspaceId

        // Create and configure the WKWebView
        self.webView = makeWebView()

        // Register with server manager (starts server if needed)
        T3ServerManager.shared.registerPanel()

        // Load the T3 Code frontend
        loadFrontend()
    }

    // MARK: - Panel protocol

    func focus() {
        guard !isClosed else { return }
        // Make the webView the first responder
        if let window = webView.window {
            window.makeFirstResponder(webView)
        }
    }

    func unfocus() {
        // No explicit action needed; responder chain handles this.
    }

    func close() {
        guard !isClosed else { return }
        isClosed = true

        // Remove message handler to break retain cycle
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: t3CodeBridgeMessageHandlerName
        )
        bridgeHandler = nil

        // Stop loading and clear
        webView.stopLoading()

        // Unregister from server manager
        T3ServerManager.shared.unregisterPanel()
    }

    func triggerFlash(reason: WorkspaceAttentionFlashReason) {
        _ = reason
        guard NotificationPaneFlashSettings.isEnabled() else { return }
        focusFlashToken += 1
    }

    // MARK: - Focus intent

    func captureFocusIntent(in window: NSWindow?) -> PanelFocusIntent {
        .t3code(.webView)
    }

    func preferredFocusIntentForActivation() -> PanelFocusIntent {
        .t3code(.webView)
    }

    func prepareFocusIntentForActivation(_ intent: PanelFocusIntent) {
        _ = intent
    }

    @discardableResult
    func restoreFocusIntent(_ intent: PanelFocusIntent) -> Bool {
        switch intent {
        case .t3code(.webView), .panel:
            focus()
            return true
        default:
            return false
        }
    }

    func ownedFocusIntent(for responder: NSResponder, in window: NSWindow) -> PanelFocusIntent? {
        // Check if the responder is inside the webView
        var current: NSResponder? = responder
        while let r = current {
            if r === webView {
                return .t3code(.webView)
            }
            current = r.nextResponder
        }
        return nil
    }

    @discardableResult
    func yieldFocusIntent(_ intent: PanelFocusIntent, in window: NSWindow) -> Bool {
        _ = intent
        _ = window
        return false
    }

    // MARK: - WebView setup

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.processPool = Self.sharedProcessPool
        configuration.websiteDataStore = .nonPersistent()

        // Enable JavaScript
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        // Enable developer tools
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // NOTE: Bridge script and theme script are injected dynamically in
        // loadFromServer() / loadFrontend() right before webView.load(), because
        // user scripts added here (before any navigation) don't reliably fire.

        // Create the webView
        let webView = WKWebView(frame: .zero, configuration: configuration)

        // Set up the bridge message handler
        let handler = T3CodeBridgeHandler(webView: webView)
        configuration.userContentController.add(handler, name: t3CodeBridgeMessageHandlerName)
        self.bridgeHandler = handler

        // Visual configuration
        webView.setValue(false, forKey: "drawsBackground")

        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        return webView
    }

    // MARK: - Frontend loading

    /// Retry counter for server connectivity.
    private var loadRetryCount: Int = 0
    private static let maxLoadRetries = 30
    private static let loadRetryInterval: TimeInterval = 0.5

    private func loadFrontend() {
        // Wait for the server to be ready before loading
        if T3ServerManager.shared.serverURL != nil {
            loadFromServer()
            return
        }

        // Server not ready yet — wait and retry
        if loadRetryCount < Self.maxLoadRetries {
            loadRetryCount += 1
            NSLog("[T3CodePanel] Waiting for server... attempt \(loadRetryCount)/\(Self.maxLoadRetries)")
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.loadRetryInterval) { [weak self] in
                guard let self, !self.isClosed else { return }
                self.loadFrontend()
            }
            return
        }

        NSLog("[T3CodePanel] Server did not start in time, falling back to static assets")

        // Fallback: Load bundled static assets directly
        if let bundleURL = Bundle.main.resourceURL {
            let clientDir = T3CodeWebSupport.bundledClientDirectory(bundleURL: bundleURL)
            let indexHTML = clientDir.appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: indexHTML.path) {
                configureUserScripts(wsURL: nil)
                webView.loadFileURL(indexHTML, allowingReadAccessTo: clientDir)
                return
            }
        }

        // Strategy 3: Show a placeholder indicating T3 Code assets are not bundled
        // Uses Ernest design-system colors: white surface, ink text, forest heading, muted code bg
        let placeholder = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: #FFFFFF;
                    color: #09090B;
                }
                .container {
                    text-align: center;
                    max-width: 400px;
                    padding: 20px;
                }
                h2 { color: #1A4731; margin-bottom: 12px; }
                p { line-height: 1.6; font-size: 14px; color: rgba(9,9,11,0.62); }
                code {
                    background: #F4F4F5;
                    padding: 2px 6px;
                    border-radius: 8px;
                    border: 1px solid #E4E4E7;
                    font-size: 13px;
                    color: #09090B;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>T3 Code Not Bundled</h2>
                <p>
                    T3 Code assets are not yet included in this build.
                    The server and bundled client need to be built and placed in
                    <code>Resources/t3code-server/</code>, including
                    <code>Resources/t3code-server/client/</code>.
                </p>
            </div>
        </body>
        </html>
        """
        webView.loadHTMLString(placeholder, baseURL: nil)
    }

    /// Loads the frontend from the running server and injects the native bridge.
    private func loadFromServer() {
        guard let serverURL = T3ServerManager.shared.serverURL else { return }
        let wsURL = T3ServerManager.shared.wsURL?.absoluteString ?? ""

        NSLog("[T3CodePanel] Loading frontend from \(serverURL) wsURL=\(wsURL)")

        configureUserScripts(wsURL: wsURL)

        // Load the server URL
        let request = URLRequest(url: serverURL)
        webView.load(request)

        // Monitor for load failures and retry (server may still be starting up)
        scheduleServerReadyCheck()
    }

    /// Periodically checks if the server page loaded and retries if needed.
    private func scheduleServerReadyCheck() {
        guard loadRetryCount < Self.maxLoadRetries, !isClosed else { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self, !self.isClosed else { return }
            guard let serverURL = T3ServerManager.shared.serverURL else { return }

            // Check if the page loaded successfully
            self.webView.evaluateJavaScript("document.readyState") { result, _ in
                Task { @MainActor in
                    guard !self.isClosed else { return }
                    let readyState = result as? String ?? ""
                    if readyState != "complete" && readyState != "interactive" {
                        self.loadRetryCount += 1
                        NSLog("[T3CodePanel] Page not ready (state=\(readyState)), retrying \(self.loadRetryCount)/\(Self.maxLoadRetries)")
                        let request = URLRequest(url: serverURL)
                        self.webView.load(request)
                        self.scheduleServerReadyCheck()
                    } else {
                        NSLog("[T3CodePanel] Page loaded successfully (state=\(readyState))")
                    }
                }
            }
        }
    }

    private func configureUserScripts(wsURL: String?) {
        let userContentController = webView.configuration.userContentController
        userContentController.removeAllUserScripts()

        if let wsURL {
            let bridgeSource = T3CodeBridgeScript.bridgeScript(wsURL: wsURL)
            let bridgeUserScript = WKUserScript(
                source: bridgeSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            userContentController.addUserScript(bridgeUserScript)
        }

        let themeScripts = T3CodeWebSupport.makeInitialUserScripts()
        guard !themeScripts.isEmpty else {
            NSLog("[T3CodePanel] Ernest theme stylesheet missing; continuing without host theme overrides")
            return
        }

        for script in themeScripts {
            userContentController.addUserScript(script)
        }
    }

    deinit {
        // Safety: ensure server manager is notified if close() wasn't called
        if !isClosed {
            // Note: deinit may not run on MainActor, but T3ServerManager handles this
            Task { @MainActor in
                T3ServerManager.shared.unregisterPanel()
            }
        }
    }
}
