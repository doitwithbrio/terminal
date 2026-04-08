import AppKit
import Foundation
import WebKit

/// Name used to register the message handler with WKUserContentController.
let t3CodeBridgeMessageHandlerName = "t3bridge"

/// Handles JavaScript → Swift messages from the T3 Code frontend,
/// replacing Electron's preload bridge for native operations like
/// file pickers, dialogs, and external URL opening.
///
/// Pattern follows `ReactGrabMessageHandler` in ReactGrab.swift.
class T3CodeBridgeHandler: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        Task { @MainActor in
            switch type {
            case "pickFolder":
                handlePickFolder(callbackId: body["callbackId"] as? String)
            case "confirm":
                handleConfirm(
                    message: body["message"] as? String ?? "",
                    callbackId: body["callbackId"] as? String
                )
            case "openExternal":
                handleOpenExternal(urlString: body["url"] as? String)
            case "openInEditor":
                handleOpenInEditor(
                    cwd: body["cwd"] as? String,
                    editorId: body["editorId"] as? String
                )
            case "setTheme":
                handleSetTheme(theme: body["theme"] as? String)
            default:
                #if DEBUG
                NSLog("[T3CodeBridge] Unhandled message type: \(type)")
                #endif
            }
        }
    }

    // MARK: - Message handlers

    @MainActor
    private func handlePickFolder(callbackId: String?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = String(localized: "t3code.pickFolder.prompt", defaultValue: "Select Folder")

        let result = panel.runModal()
        let selectedPath = result == .OK ? panel.url?.path : nil
        resolveCallback(callbackId: callbackId, value: selectedPath.map { "\"\($0)\"" } ?? "null")
    }

    @MainActor
    private func handleConfirm(message: String, callbackId: String?) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: String(localized: "t3code.confirm.ok", defaultValue: "OK"))
        alert.addButton(withTitle: String(localized: "t3code.confirm.cancel", defaultValue: "Cancel"))

        let response = alert.runModal()
        let confirmed = response == .alertFirstButtonReturn
        resolveCallback(callbackId: callbackId, value: confirmed ? "true" : "false")
    }

    @MainActor
    private func handleOpenExternal(urlString: String?) {
        guard let urlString, let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }

    @MainActor
    private func handleOpenInEditor(cwd: String?, editorId: String?) {
        guard let cwd else { return }
        let url = URL(fileURLWithPath: cwd)
        NSWorkspace.shared.open(url)
    }

    @MainActor
    private func handleSetTheme(theme: String?) {
        guard let webView else { return }
        switch theme {
        case "dark":
            webView.appearance = NSAppearance(named: .darkAqua)
        case "light":
            webView.appearance = NSAppearance(named: .aqua)
        default:
            webView.appearance = nil // Follow system
        }
    }

    // MARK: - Callback resolution

    /// Resolves a pending JavaScript Promise by evaluating a callback script.
    @MainActor
    private func resolveCallback(callbackId: String?, value: String) {
        guard let callbackId, let webView else { return }
        let script = """
        (function() {
            var cb = window.__t3_callbacks && window.__t3_callbacks['\(callbackId)'];
            if (cb) {
                cb(\(value));
                delete window.__t3_callbacks['\(callbackId)'];
            }
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}

// MARK: - Bridge injection script

enum T3CodeBridgeScript {
    /// JavaScript source to inject at document start that provides `window.nativeApi`
    /// and the WebSocket URL for the T3 Code frontend.
    static func bridgeScript(wsURL: String) -> String {
        return """
        // T3 Code Native Bridge — injected by cmux
        (function() {
            'use strict';

            // Expose WebSocket URL for the frontend to discover
            window.__T3CODE_WS_URL__ = '\(wsURL)';

            // Callback registry for async native operations
            window.__t3_callbacks = window.__t3_callbacks || {};
            var callbackCounter = 0;

            function nativeCall(type, params) {
                return new Promise(function(resolve) {
                    var id = 'cb_' + (++callbackCounter);
                    window.__t3_callbacks[id] = resolve;
                    var msg = Object.assign({ type: type, callbackId: id }, params || {});
                    window.webkit.messageHandlers.\(t3CodeBridgeMessageHandlerName).postMessage(msg);
                });
            }

            function nativeFire(type, params) {
                var msg = Object.assign({ type: type }, params || {});
                window.webkit.messageHandlers.\(t3CodeBridgeMessageHandlerName).postMessage(msg);
            }

            // Provide the nativeApi surface expected by the T3 Code frontend
            window.nativeApi = {
                dialogs: {
                    pickFolder: function() { return nativeCall('pickFolder'); },
                    confirm: function(message) { return nativeCall('confirm', { message: message }); }
                },
                shell: {
                    openExternal: function(url) { nativeFire('openExternal', { url: url }); },
                    openInEditor: function(cwd, editorId) { nativeFire('openInEditor', { cwd: cwd, editorId: editorId }); }
                },
                appearance: {
                    setTheme: function(theme) { nativeFire('setTheme', { theme: theme }); }
                },
                getWsUrl: function() { return window.__T3CODE_WS_URL__; }
            };

            // Signal that the native bridge is ready
            window.dispatchEvent(new CustomEvent('t3-native-bridge-ready'));
        })();
        """
    }
}
