import Foundation
import WebKit

/// Shared support for the live T3 BrowserPanel path and the legacy T3CodePanel.
///
/// The bundled frontend source of truth is `Resources/t3code-server/client`.
/// Host theming must stay additive and must fail open: vendor T3 rendering is a
/// valid fallback if the host theme cannot be applied safely.
enum T3CodeWebSupport {
    static let bundledClientRelativePath = "t3code-server/client"
    static let bundledThemeFilename = "cmux-ernest-theme.css"
    static let hostThemeEnabledDefaultsKey = "t3.hostThemeEnabled"
    // Give the SPA enough time to mount its real shell before we consider a fail-open disable.
    static let maxReadinessAttempts = 10

    private static let panelDisableSessionStorageKey = "cmux.t3.themeDisabled"
    private static let panelDisableReasonSessionStorageKey = "cmux.t3.themeDisabledReason"

    private static let criticalThemeCSS = """
    html[data-cmux-t3-theme="ernest"] {
      color-scheme: light !important;
      --background: #ffffff !important;
      --foreground: #09090b !important;
      --card: #ffffff !important;
      --card-foreground: #09090b !important;
      --popover: #ffffff !important;
      --popover-foreground: #09090b !important;
      --border: #e4e4e7 !important;
      --primary: #1a4731 !important;
      --primary-foreground: #fafaf9 !important;
      --secondary: #dce8df !important;
      --secondary-foreground: #09090b !important;
      --muted: #dce8df !important;
      --muted-foreground: rgba(63, 63, 70, 0.82) !important;
      --accent: #dce8df !important;
      --accent-foreground: #09090b !important;
      --input: #e4e4e7 !important;
      --ring: #1a4731 !important;
      --radius: 0.75rem !important;
    }

    html[data-cmux-t3-theme="ernest"] body,
    html[data-cmux-t3-theme="ernest"] #root,
    html[data-cmux-t3-theme="ernest"] #root > div {
      background: #ffffff !important;
      color: #09090b !important;
    }

    html[data-cmux-t3-theme="ernest"] header {
      background: rgba(255, 255, 255, 0.96) !important;
      border-bottom: 0 !important;
      backdrop-filter: none !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] header :is([data-slot="button"], button) {
      min-height: 30px !important;
      height: 30px !important;
      padding-inline: 10px !important;
      border: 0 !important;
      border-radius: 10px !important;
      background: #dce8df !important;
      color: rgba(9, 9, 11, 0.72) !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] form[data-chat-composer-form="true"] > div {
      padding: 0 !important;
      border-radius: 14px !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] form[data-chat-composer-form="true"] > div > div {
      border: 1px solid #e4e4e7 !important;
      border-radius: 14px !important;
      background: #dce8df !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] form[data-chat-composer-form="true"] > div > div:focus-within {
      border-color: rgba(26, 71, 49, 0.45) !important;
      box-shadow: 0 0 0 3px rgba(26, 71, 49, 0.12) !important;
    }

    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] {
      border-top: 0 !important;
      gap: 8px !important;
    }

    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [data-slot="separator"] {
      display: none !important;
    }

    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [data-slot="button"],
    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] button[type="button"] {
      display: inline-flex !important;
      align-items: center !important;
      min-height: 32px !important;
      height: 32px !important;
      padding-inline: 12px !important;
      border: 0 !important;
      border-radius: 12px !important;
      background: #dce8df !important;
      color: rgba(9, 9, 11, 0.72) !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [aria-pressed="true"],
    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [data-state="open"],
    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [data-state="checked"],
    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [data-state="on"],
    html[data-cmux-t3-theme="ernest"] [data-chat-composer-footer="true"] [aria-selected="true"] {
      background: #1a4731 !important;
      color: #fafaf9 !important;
    }

    html[data-cmux-t3-theme="ernest"] form[data-chat-composer-form="true"] button[type="submit"] {
      width: 34px !important;
      height: 34px !important;
      border: 0 !important;
      border-radius: 12px !important;
      background: #1a4731 !important;
      color: #fafaf9 !important;
      box-shadow: none !important;
    }

    html[data-cmux-t3-theme="ernest"] ::selection {
      background: #dce8df !important;
      color: #09090b !important;
    }
    """

    struct ThemeProbePayload: Codable, Equatable {
        let theme: String?
        let critical: Bool
        let full: Bool
        let installed: Bool
        let autoDisabled: Bool
        let disableReason: String?
        let headerPresent: Bool
        let composerPresent: Bool
        let mainPresent: Bool
        let interactiveElementCount: Int
        let bodyTextLength: Int
        let composerShellTagged: Bool
        let composerEditorTagged: Bool
        let headerBadgeTaggedCount: Int
        let toolbarClusterTaggedCount: Int
        let toolbarButtonTaggedCount: Int
        let userShellTaggedCount: Int
        let timestampTaggedCount: Int
        let scrollButtonTaggedCount: Int
        let consoleLogCount: Int
        let errorLogCount: Int
        let recentConsoleLog: [String]
        let recentErrorLog: [String]
    }

    enum ThemeReadinessDisposition: String, Equatable {
        case themeDisabled
        case themeNotInstalledYet
        case themeInstalledAndReady
        case themeInstalledButMissingShell
        case jsErrorDetectedBeforeReady
    }

    static var debugProbeScript: String {
        """
        (function() {
            const asText = function(entry) {
                if (!entry) return "";
                if (typeof entry === "string") return entry;
                if (entry.text) return String(entry.text);
                if (entry.message) return String(entry.message);
                try {
                    return JSON.stringify(entry);
                } catch (_error) {
                    return String(entry);
                }
            };

            const root = document.documentElement;
            const headerPresent = !!document.querySelector("header");
            const composerPresent = !!document.querySelector("form[data-chat-composer-form='true']");
            const mainPresent = !!document.querySelector("main, [role='main']");
            const interactiveElementCount = document.querySelectorAll(
                "button, input, textarea, [contenteditable='true'], [role='textbox']"
            ).length;
            const bodyText = (document.body && document.body.innerText) ? document.body.innerText.trim() : "";
            const composerShellTagged = !!document.querySelector("[data-cmux-t3-surface='composer-shell']");
            const composerEditorTagged = !!document.querySelector("[data-cmux-t3-surface='composer-editor']");
            const headerBadgeTaggedCount = document.querySelectorAll("[data-cmux-t3-chip='header-badge']").length;
            const toolbarClusterTaggedCount = document.querySelectorAll("[data-cmux-t3-toolbar='thread-actions']").length;
            const toolbarButtonTaggedCount = document.querySelectorAll("[data-cmux-t3-toolbar-button='thread-action']").length;
            const userShellTaggedCount = document.querySelectorAll("[data-cmux-t3-message='user-shell']").length;
            const timestampTaggedCount = document.querySelectorAll("[data-cmux-t3-message-meta='timestamp']").length;
            const scrollButtonTaggedCount = document.querySelectorAll("[data-cmux-t3-button='scroll-bottom']").length;
            const consoleLog = Array.isArray(window.__cmuxConsoleLog) ? window.__cmuxConsoleLog.slice(-6) : [];
            const errorLog = Array.isArray(window.__cmuxErrorLog) ? window.__cmuxErrorLog.slice(-6) : [];
            const autoDisabled = window.__cmuxT3ThemeAutoDisabled === true || (function() {
                try {
                    return window.sessionStorage.getItem("\(panelDisableSessionStorageKey)") === "1";
                } catch (_error) {
                    return false;
                }
            })();
            const disableReason = window.__cmuxT3ThemeDisableReason || (function() {
                try {
                    return window.sessionStorage.getItem("\(panelDisableReasonSessionStorageKey)");
                } catch (_error) {
                    return null;
                }
            })();

            return JSON.stringify({
                theme: root && root.dataset ? root.dataset.cmuxT3Theme || null : null,
                critical: !!document.getElementById("cmux-t3-ernest-critical"),
                full: !!document.getElementById("cmux-t3-ernest-theme"),
                installed: window.__cmuxT3ThemeInstalled === true,
                autoDisabled,
                disableReason,
                headerPresent,
                composerPresent,
                mainPresent,
                interactiveElementCount,
                bodyTextLength: bodyText.length,
                composerShellTagged,
                composerEditorTagged,
                headerBadgeTaggedCount,
                toolbarClusterTaggedCount,
                toolbarButtonTaggedCount,
                userShellTaggedCount,
                timestampTaggedCount,
                scrollButtonTaggedCount,
                consoleLogCount: consoleLog.length,
                errorLogCount: errorLog.length,
                recentConsoleLog: consoleLog.map(asText),
                recentErrorLog: errorLog.map(asText)
            });
        })();
        """
    }

    static func bundledClientDirectory(bundleURL: URL) -> URL {
        bundleURL.appendingPathComponent(bundledClientRelativePath)
    }

    static func bundledThemeURL(bundleURL: URL) -> URL {
        bundledClientDirectory(bundleURL: bundleURL)
            .appendingPathComponent(bundledThemeFilename)
    }

    static func isHostThemeEnabled(userDefaults: UserDefaults = .standard) -> Bool {
        guard let explicitValue = userDefaults.object(forKey: hostThemeEnabledDefaultsKey) as? Bool else {
            return true
        }
        return explicitValue
    }

    static func makeInitialUserScripts(
        bundle: Bundle = .main,
        userDefaults: UserDefaults = .standard
    ) -> [WKUserScript] {
        guard let bundleURL = bundle.resourceURL else { return [] }
        return makeInitialUserScripts(bundleURL: bundleURL, userDefaults: userDefaults)
    }

    static func makeInitialUserScripts(
        bundleURL: URL,
        userDefaults: UserDefaults = .standard
    ) -> [WKUserScript] {
        guard isHostThemeEnabled(userDefaults: userDefaults) else { return [] }
        guard let payload = makeThemePayload(bundleURL: bundleURL) else { return [] }

        return [
            WKUserScript(
                source: makeCriticalThemeBootstrapScript(payload: payload),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ),
            WKUserScript(
                source: makeFullThemeInstallScript(payload: payload),
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            ),
        ]
    }

    static func decodeThemeProbePayload(from result: Any?) -> ThemeProbePayload? {
        guard let payloadString = result as? String, let data = payloadString.data(using: .utf8) else {
            return nil
        }

        return try? JSONDecoder().decode(ThemeProbePayload.self, from: data)
    }

    static func readinessDisposition(
        from payload: ThemeProbePayload?,
        themeEnabled: Bool
    ) -> ThemeReadinessDisposition {
        guard themeEnabled else { return .themeDisabled }
        guard let payload else { return .themeNotInstalledYet }

        if payload.autoDisabled {
            return .themeDisabled
        }

        let hasExpectedUI = hasExpectedShellMarkers(payload)

        if hasExpectedUI {
            return .themeInstalledAndReady
        }

        if payload.errorLogCount > 0 {
            return .jsErrorDetectedBeforeReady
        }

        let looksInstalled =
            payload.theme == "ernest" &&
            payload.critical &&
            payload.full &&
            payload.installed

        return looksInstalled ? .themeInstalledButMissingShell : .themeNotInstalledYet
    }

    static func autoDisableReason(for payload: ThemeProbePayload?) -> String {
        guard let payload else { return "themeInstalledButNoContent" }
        if payload.errorLogCount > 0 {
            return "jsErrorDetectedBeforeReady"
        }

        let hasShell = hasExpectedShellMarkers(payload)

        return hasShell ? "themeInstalledButNoContent" : "missingComposerAndShell"
    }

    // T3 must prove that its own shell mounted; generic body text or an incidental button is
    // not enough to keep the host theme active because those signals can come from an error shell.
    private static func hasExpectedShellMarkers(_ payload: ThemeProbePayload) -> Bool {
        payload.headerPresent || payload.composerPresent || payload.mainPresent
    }

    static func disableThemeScript(reason: String) -> String {
        let reasonLiteral = javaScriptStringLiteral(reason)

        return """
        (function() {
            const removeNode = function(id) {
                const node = document.getElementById(id);
                if (node && node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            };

            const disableTheme = function(reasonValue) {
                window.__cmuxT3ThemeAutoDisabled = true;
                window.__cmuxT3ThemeDisableReason = reasonValue;

                try {
                    window.sessionStorage.setItem("\(panelDisableSessionStorageKey)", "1");
                    window.sessionStorage.setItem("\(panelDisableReasonSessionStorageKey)", reasonValue);
                } catch (_error) {}

                const observer = window.__cmuxT3ThemeObserver;
                if (observer && typeof observer.disconnect === "function") {
                    observer.disconnect();
                }

                window.__cmuxT3ThemeObserver = null;
                window.__cmuxT3ThemeObserverInstalled = false;
                window.__cmuxT3ThemeInstalled = false;

                const root = document.documentElement;
                if (root) {
                    root.removeAttribute("data-cmux-t3-theme");
                }

                removeNode("cmux-t3-ernest-critical");
                removeNode("cmux-t3-ernest-theme");
            };

            if (typeof window.__cmuxDisableT3Theme === "function") {
                window.__cmuxDisableT3Theme(\(reasonLiteral));
            } else {
                disableTheme(\(reasonLiteral));
            }

            return JSON.stringify({
                autoDisabled: window.__cmuxT3ThemeAutoDisabled === true,
                disableReason: window.__cmuxT3ThemeDisableReason || null,
                theme: document.documentElement && document.documentElement.dataset
                    ? document.documentElement.dataset.cmuxT3Theme || null
                    : null,
                critical: !!document.getElementById("cmux-t3-ernest-critical"),
                full: !!document.getElementById("cmux-t3-ernest-theme")
            });
        })();
        """
    }

    private struct ThemePayload {
        let criticalCSSLiteral: String
        let fullCSSLiteral: String
    }

    private static func makeThemePayload(bundleURL: URL) -> ThemePayload? {
        let themeURL = bundledThemeURL(bundleURL: bundleURL)

        guard let fullCSS = try? String(contentsOf: themeURL, encoding: .utf8) else {
            return nil
        }

        return ThemePayload(
            criticalCSSLiteral: javaScriptStringLiteral(criticalThemeCSS),
            fullCSSLiteral: javaScriptStringLiteral(fullCSS)
        )
    }

    private static func makeCriticalThemeBootstrapScript(payload: ThemePayload) -> String {
        """
        (function() {
            const criticalCss = \(payload.criticalCSSLiteral);

            const stripLegacyPartialNativeApi = function() {
                const nativeApi = window.nativeApi;
                const hasModernOrchestration = !!(
                    nativeApi &&
                    nativeApi.orchestration &&
                    typeof nativeApi.orchestration.onDomainEvent === "function"
                );

                if (!nativeApi || hasModernOrchestration) return;

                try {
                    delete window.nativeApi;
                } catch (_error) {
                    try {
                        window.nativeApi = undefined;
                    } catch (_innerError) {}
                }

                window.__cmuxT3ClearedLegacyNativeApi = true;
            };

            const isPanelThemeDisabled = function() {
                if (window.__cmuxT3ThemeAutoDisabled === true) {
                    return true;
                }
                try {
                    return window.sessionStorage.getItem("\(panelDisableSessionStorageKey)") === "1";
                } catch (_error) {
                    return false;
                }
            };

            const installCriticalTheme = function() {
                if (isPanelThemeDisabled()) return;

                const root = document.documentElement;
                if (!root) return;

                root.setAttribute("data-cmux-t3-theme", "ernest");

                let style = document.getElementById("cmux-t3-ernest-critical");
                if (!style) {
                    style = document.createElement("style");
                    style.id = "cmux-t3-ernest-critical";
                    style.textContent = criticalCss;
                    (document.head || root).appendChild(style);
                } else if (style.textContent !== criticalCss) {
                    style.textContent = criticalCss;
                }
            };

            stripLegacyPartialNativeApi();
            installCriticalTheme();

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", installCriticalTheme, { once: true });
            }
        })();
        """
    }

    private static func makeFullThemeInstallScript(payload: ThemePayload) -> String {
        """
        (function() {
            const criticalCss = \(payload.criticalCSSLiteral);
            const fullCss = \(payload.fullCSSLiteral);

            const readDisableReason = function() {
                try {
                    return window.sessionStorage.getItem("\(panelDisableReasonSessionStorageKey)");
                } catch (_error) {
                    return null;
                }
            };

            const isPanelThemeDisabled = function() {
                if (window.__cmuxT3ThemeAutoDisabled === true) {
                    return true;
                }
                try {
                    return window.sessionStorage.getItem("\(panelDisableSessionStorageKey)") === "1";
                } catch (_error) {
                    return false;
                }
            };

            const removeNode = function(id) {
                const node = document.getElementById(id);
                if (node && node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            };

            const clearManagedTags = function() {
                document.querySelectorAll("[data-cmux-t3-surface]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-surface");
                });
                document.querySelectorAll("[data-cmux-t3-toolbar]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-toolbar");
                });
                document.querySelectorAll("[data-cmux-t3-toolbar-button]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-toolbar-button");
                });
                document.querySelectorAll("[data-cmux-t3-toolbar-segment]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-toolbar-segment");
                });
                document.querySelectorAll("[data-cmux-t3-chip]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-chip");
                });
                document.querySelectorAll("[data-cmux-t3-message]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-message");
                });
                document.querySelectorAll("[data-cmux-t3-message-meta]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-message-meta");
                });
                document.querySelectorAll("[data-cmux-t3-button]").forEach(function(node) {
                    node.removeAttribute("data-cmux-t3-button");
                });
            };

            const hasExpectedShell = function() {
                return !!document.querySelector("main, [role='main'], form[data-chat-composer-form='true'], header");
            };

            const normalizeText = function(value) {
                return (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
            };

            const classNameString = function(node) {
                return node && typeof node.className === "string" ? node.className : "";
            };

            const hasClassToken = function(node, token) {
                return classNameString(node).indexOf(token) !== -1;
            };

            const isVisibleElement = function(node) {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const firstElementChild = function(node) {
                return node && node.firstElementChild ? node.firstElementChild : null;
            };

            const firstVisibleChild = function(node) {
                if (!node) return null;
                return Array.from(node.children).find(function(child) {
                    return isVisibleElement(child);
                }) || null;
            };

            const isHeaderControlElement = function(node) {
                if (!(node instanceof Element)) return false;
                const tagName = node.tagName ? node.tagName.toUpperCase() : "";
                return (
                    tagName === "BUTTON" ||
                    node.getAttribute("data-slot") === "button" ||
                    node.getAttribute("role") === "button"
                );
            };

            const isHeaderBadgeCandidate = function(node) {
                if (!(node instanceof Element)) return false;
                if (!isVisibleElement(node)) return false;
                if (node !== null && node.querySelector("h1, h2")) return false;
                if (node !== null && node !== document.activeElement) {
                    const nestedControls = Array.from(node.querySelectorAll("button, [data-slot='button'], [role='button']")).filter(function(control) {
                        return control !== node;
                    });
                    if (nestedControls.length > 0) return false;
                }
                const text = normalizeText(node.textContent);
                if (!text || text.length > 48) return false;
                const rect = node.getBoundingClientRect();
                return rect.height >= 16 && rect.height <= 44 && rect.width >= 24 && rect.width <= 240;
            };

            const findHeaderBadge = function(header) {
                const title = header ? header.querySelector("h1, h2") : null;
                if (!title) return null;

                const directBadge = header.querySelector("h1 + [data-slot='badge'], h2 + [data-slot='badge']");
                if (directBadge && isVisibleElement(directBadge)) {
                    return directBadge;
                }

                let current = title;
                while (current && current !== header) {
                    let sibling = current.nextElementSibling;
                    while (sibling) {
                        const nestedDirectBadge = sibling.matches("[data-slot='badge']")
                            ? sibling
                            : sibling.querySelector("[data-slot='badge']");
                        if (nestedDirectBadge && isVisibleElement(nestedDirectBadge)) return nestedDirectBadge;
                        if (isHeaderBadgeCandidate(sibling)) return sibling;
                        sibling = sibling.nextElementSibling;
                    }

                    sibling = current.previousElementSibling;
                    while (sibling) {
                        const nestedDirectBadge = sibling.matches("[data-slot='badge']")
                            ? sibling
                            : sibling.querySelector("[data-slot='badge']");
                        if (nestedDirectBadge && isVisibleElement(nestedDirectBadge)) return nestedDirectBadge;
                        if (isHeaderBadgeCandidate(sibling)) return sibling;
                        sibling = sibling.previousElementSibling;
                    }

                    current = current.parentElement;
                }

                return Array.from(header.querySelectorAll("button, [data-slot='button'], [role='button'], div, span, a")).find(isHeaderBadgeCandidate) || null;
            };

            const findHeaderToolbar = function(header) {
                const title = header ? header.querySelector("h1, h2") : null;
                const titleRect = title && title.getBoundingClientRect ? title.getBoundingClientRect() : null;

                const headerButtons = Array.from(header.querySelectorAll("button, [data-slot='button'], [role='button']")).filter(function(button) {
                    if (!isHeaderControlElement(button)) return false;
                    if (!isVisibleElement(button)) return false;
                    if (!button.querySelector("svg")) return false;
                    const rect = button.getBoundingClientRect();
                    if (titleRect && rect.left <= titleRect.right) return false;
                    return true;
                }).sort(function(a, b) {
                    return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
                });

                let segmentedPair = null;
                let smallestGap = Number.POSITIVE_INFINITY;
                for (let index = 0; index < headerButtons.length - 1; index += 1) {
                    const currentRect = headerButtons[index].getBoundingClientRect();
                    const nextRect = headerButtons[index + 1].getBoundingClientRect();
                    const gap = nextRect.left - currentRect.right;
                    if (gap >= -2 && gap < smallestGap) {
                        smallestGap = gap;
                        segmentedPair = [headerButtons[index], headerButtons[index + 1]];
                    }
                }

                return {
                    toolbarButtons: headerButtons,
                    segmentedPair,
                };
            };

            const findUserShell = function(row) {
                if (!row) return null;

                const directShell = row.querySelector("div.flex.justify-end > div");
                if (directShell && isVisibleElement(directShell)) {
                    return directShell;
                }

                const alignCandidates = Array.from(row.querySelectorAll("div")).filter(function(node) {
                    return hasClassToken(node, "flex") && hasClassToken(node, "justify-end");
                });

                for (const alignCandidate of alignCandidates) {
                    const candidateShell = firstVisibleChild(alignCandidate);
                    if (candidateShell) return candidateShell;
                }

                return null;
            };

            const timeTextPattern = /\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\s?(?:am|pm)?\\b/i;
            const findUserTimestamp = function(userShell) {
                if (!userShell) return null;

                const metaRows = Array.from(userShell.querySelectorAll("div")).filter(function(node) {
                    return (
                        isVisibleElement(node) &&
                        hasClassToken(node, "items-center") &&
                        hasClassToken(node, "justify-end")
                    );
                });

                for (const metaRow of metaRows) {
                    const timestampNode = Array.from(metaRow.querySelectorAll("p, span, div")).find(function(node) {
                        return timeTextPattern.test(normalizeText(node.textContent));
                    });
                    if (timestampNode) return timestampNode;
                }

                return Array.from(userShell.querySelectorAll("p, span")).reverse().find(function(node) {
                    return timeTextPattern.test(normalizeText(node.textContent));
                }) || null;
            };

            // ── Lightweight markdown parser for user messages ──

            const processInline = function(text) {
                // Inline code (before bold/italic to avoid conflicts inside backticks)
                text = text.replace(/`([^`]+)`/g, '<code data-cmux-md="inline-code">$1</code>');
                // Bold
                text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
                text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
                // Italic (single * or _)
                text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
                text = text.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, '<em>$1</em>');
                // Links (only http/https/mailto)
                text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(match, label, url) {
                    if (/^(https?:|mailto:)/i.test(url)) {
                        return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
                    }
                    return match;
                });
                return text;
            };

            const cmuxParseMarkdown = function(text) {
                if (!text || !text.trim()) return text;

                // HTML-escape for XSS prevention
                var escaped = text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');

                // Extract fenced code blocks into placeholders
                var codeBlocks = [];
                escaped = escaped.replace(/```(\\w*)\\n([\\s\\S]*?)```/g, function(match, lang, code) {
                    var index = codeBlocks.length;
                    codeBlocks.push(
                        '<pre data-cmux-md-code="block"><code' +
                        (lang ? ' data-cmux-md-lang="' + lang + '"' : '') +
                        '>' + code.replace(/\\n$/, '') + '</code></pre>'
                    );
                    return '\\x00CODEBLOCK' + index + '\\x00';
                });

                // Process line-by-line for block elements
                var lines = escaped.split('\\n');
                var output = [];
                var inList = null;

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];

                    // Code block placeholder
                    var cbMatch = line.match(/^\\x00CODEBLOCK(\\d+)\\x00$/);
                    if (cbMatch) {
                        if (inList) { output.push('</' + inList + '>'); inList = null; }
                        output.push(codeBlocks[parseInt(cbMatch[1], 10)]);
                        continue;
                    }

                    // Table detection (look-ahead for header + separator pattern)
                    var pipeRowMatch = line.match(/^\\|(.+)\\|\\s*$/);
                    if (pipeRowMatch && i + 1 < lines.length) {
                        var nextLine = lines[i + 1];
                        var sepMatch = nextLine.match(/^\\|[\\s:\\-|]+\\|\\s*$/);
                        if (sepMatch) {
                            if (inList) { output.push('</' + inList + '>'); inList = null; }

                            var splitRow = function(row) {
                                return row.replace(/^\\|\\s*/, '').replace(/\\s*\\|\\s*$/, '').split(/\\s*\\|\\s*/);
                            };

                            var alignCells = splitRow(nextLine);
                            var aligns = alignCells.map(function(cell) {
                                var trimmed = cell.trim();
                                var left = trimmed.charAt(0) === ':';
                                var right = trimmed.charAt(trimmed.length - 1) === ':';
                                if (left && right) return 'center';
                                if (right) return 'right';
                                if (left) return 'left';
                                return null;
                            });

                            var headerCells = splitRow(line);
                            var thead = '<thead><tr>';
                            for (var h = 0; h < headerCells.length; h++) {
                                var alignAttr = aligns[h] ? ' style="text-align:' + aligns[h] + '"' : '';
                                thead += '<th' + alignAttr + '>' + processInline(headerCells[h].trim()) + '</th>';
                            }
                            thead += '</tr></thead>';

                            var tbody = '<tbody>';
                            var j = i + 2;
                            while (j < lines.length && /^\\|(.+)\\|\\s*$/.test(lines[j])) {
                                var bodyCells = splitRow(lines[j]);
                                tbody += '<tr>';
                                for (var c = 0; c < bodyCells.length; c++) {
                                    var alignAttr2 = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '';
                                    tbody += '<td' + alignAttr2 + '>' + processInline(bodyCells[c].trim()) + '</td>';
                                }
                                tbody += '</tr>';
                                j++;
                            }
                            tbody += '</tbody>';

                            output.push('<table data-cmux-md="table">' + thead + tbody + '</table>');
                            i = j - 1;
                            continue;
                        }
                    }

                    // Headings (h1-h3)
                    var headingMatch = line.match(/^(#{1,3})\\s+(.+)$/);
                    if (headingMatch) {
                        if (inList) { output.push('</' + inList + '>'); inList = null; }
                        var level = headingMatch[1].length;
                        output.push('<h' + level + ' data-cmux-md="heading">' + processInline(headingMatch[2]) + '</h' + level + '>');
                        continue;
                    }

                    // Blockquotes (> is &gt; after escape)
                    var quoteMatch = line.match(/^&gt;\\s?(.*)$/);
                    if (quoteMatch) {
                        if (inList) { output.push('</' + inList + '>'); inList = null; }
                        output.push('<blockquote data-cmux-md="blockquote">' + processInline(quoteMatch[1]) + '</blockquote>');
                        continue;
                    }

                    // Unordered list
                    var ulMatch = line.match(/^[\\-\\*]\\s+(.+)$/);
                    if (ulMatch) {
                        if (inList !== 'ul') {
                            if (inList) output.push('</' + inList + '>');
                            output.push('<ul data-cmux-md="list">');
                            inList = 'ul';
                        }
                        output.push('<li>' + processInline(ulMatch[1]) + '</li>');
                        continue;
                    }

                    // Ordered list
                    var olMatch = line.match(/^\\d+\\.\\s+(.+)$/);
                    if (olMatch) {
                        if (inList !== 'ol') {
                            if (inList) output.push('</' + inList + '>');
                            output.push('<ol data-cmux-md="list">');
                            inList = 'ol';
                        }
                        output.push('<li>' + processInline(olMatch[1]) + '</li>');
                        continue;
                    }

                    // Close any open list on non-list line
                    if (inList) { output.push('</' + inList + '>'); inList = null; }

                    // Blank line or paragraph
                    if (line.trim() === '') {
                        output.push('<br>');
                    } else {
                        output.push('<p data-cmux-md="paragraph">' + processInline(line) + '</p>');
                    }
                }

                if (inList) output.push('</' + inList + '>');
                return output.join('');
            };

            // ── User message markdown processing ──

            const cmuxMarkdownPattern = /[\\*_`#\\[\\]\\\\]|^\\d+\\.\\s|^[\\-\\*]\\s|^>|^\\|.+\\|/m;

            const processUserMessageMarkdown = function(userShell) {
                if (!userShell) return;
                if (userShell.getAttribute('data-cmux-md-processed') === '1') return;

                // Find content nodes (skip timestamp row)
                var children = Array.from(userShell.children);
                var contentNodes = children.filter(function(child) {
                    if (child.querySelector('[data-cmux-t3-message-meta="timestamp"]')) return false;
                    if (child.hasAttribute('data-cmux-md-content')) return false;
                    // Skip tiny nodes that are only timestamp-like text
                    var text = (child.textContent || '').trim();
                    if (text.length < 20 && timeTextPattern.test(normalizeText(text))) return false;
                    return true;
                });

                if (contentNodes.length === 0) {
                    userShell.setAttribute('data-cmux-md-processed', '1');
                    return;
                }

                // Get raw text preserving line breaks
                var rawText = contentNodes.map(function(node) {
                    return node.innerText || node.textContent || '';
                }).join('\\n');

                if (!rawText.trim()) {
                    userShell.setAttribute('data-cmux-md-processed', '1');
                    return;
                }

                // Only process if text contains markdown syntax
                if (!cmuxMarkdownPattern.test(rawText)) {
                    userShell.setAttribute('data-cmux-md-processed', '1');
                    return;
                }

                // Parse and replace
                var html = cmuxParseMarkdown(rawText);
                var mdWrapper = document.createElement('div');
                mdWrapper.setAttribute('data-cmux-md-content', 'user');
                mdWrapper.innerHTML = html;

                contentNodes.forEach(function(node, index) {
                    if (index === 0) {
                        node.parentNode.replaceChild(mdWrapper, node);
                    } else {
                        node.parentNode.removeChild(node);
                    }
                });

                userShell.setAttribute('data-cmux-md-processed', '1');
            };

            const tagSurfaces = function() {
                clearManagedTags();
                const counts = {
                    composerShellTagged: false,
                    composerEditorTagged: false,
                    headerBadgeTaggedCount: 0,
                    toolbarClusterTaggedCount: 0,
                    toolbarButtonTaggedCount: 0,
                    userShellTaggedCount: 0,
                    timestampTaggedCount: 0,
                    scrollButtonTaggedCount: 0
                };

                try {
                    const composerShell = document.querySelector("form[data-chat-composer-form='true'] > div > div");
                    if (composerShell) {
                        composerShell.setAttribute("data-cmux-t3-surface", "composer-shell");
                        counts.composerShellTagged = true;
                    }

                    const composerEditor = composerShell
                        ? composerShell.querySelector("[contenteditable='true'], textarea, [role='textbox']")
                        : null;
                    if (composerEditor) {
                        composerEditor.setAttribute("data-cmux-t3-surface", "composer-editor");
                        counts.composerEditorTagged = true;
                    }

                    const scrollButton = Array.from(document.querySelectorAll("button")).find(function(button) {
                        return normalizeText(button.textContent).indexOf("scroll to bottom") !== -1;
                    });
                    if (scrollButton) {
                        scrollButton.setAttribute("data-cmux-t3-button", "scroll-bottom");
                        counts.scrollButtonTaggedCount = 1;
                    }

                    const header = document.querySelector("header");
                    const headerBadge = header ? findHeaderBadge(header) : null;
                    if (headerBadge) {
                        headerBadge.setAttribute("data-cmux-t3-chip", "header-badge");
                        counts.headerBadgeTaggedCount = 1;
                    }

                    if (header) {
                        const { toolbarButtons, segmentedPair } = findHeaderToolbar(header);
                        if (toolbarButtons.length > 0) {
                            toolbarButtons.forEach(function(button) {
                                button.setAttribute("data-cmux-t3-toolbar-button", "thread-action");
                            });
                            counts.toolbarButtonTaggedCount = toolbarButtons.length;
                        }
                        if (segmentedPair && segmentedPair.length === 2) {
                            segmentedPair[0].setAttribute("data-cmux-t3-toolbar-segment", "left");
                            segmentedPair[1].setAttribute("data-cmux-t3-toolbar-segment", "right");
                            counts.toolbarClusterTaggedCount = 1;
                        }
                    }

                    const userRows = Array.from(document.querySelectorAll("[data-message-role='user']"));
                    userRows.forEach(function(row) {
                        const userShell = findUserShell(row);
                        if (!userShell) return;

                        userShell.setAttribute("data-cmux-t3-message", "user-shell");
                        counts.userShellTaggedCount += 1;

                        const timestamp = findUserTimestamp(userShell);
                        if (timestamp) {
                            timestamp.setAttribute("data-cmux-t3-message-meta", "timestamp");
                            counts.timestampTaggedCount += 1;
                        }

                        // Render markdown in user messages (idempotent — skips already-processed)
                        processUserMessageMarkdown(userShell);
                    });
                } catch (error) {
                    window.__cmuxT3TaggerError = String(error && error.message ? error.message : error);
                }

                window.__cmuxT3TagCounts = counts;
                return counts;
            };

            const installThemeNodes = function() {
                if (isPanelThemeDisabled()) {
                    return false;
                }

                const root = document.documentElement;
                if (!root) return false;

                root.setAttribute("data-cmux-t3-theme", "ernest");

                const host = document.head || root;

                let criticalStyle = document.getElementById("cmux-t3-ernest-critical");
                if (!criticalStyle) {
                    criticalStyle = document.createElement("style");
                    criticalStyle.id = "cmux-t3-ernest-critical";
                    criticalStyle.textContent = criticalCss;
                    host.appendChild(criticalStyle);
                } else if (criticalStyle.textContent !== criticalCss) {
                    criticalStyle.textContent = criticalCss;
                }

                let fullStyle = document.getElementById("cmux-t3-ernest-theme");
                if (!fullStyle) {
                    fullStyle = document.createElement("style");
                    fullStyle.id = "cmux-t3-ernest-theme";
                    fullStyle.textContent = fullCss;
                    host.appendChild(fullStyle);
                } else if (fullStyle.textContent !== fullCss) {
                    fullStyle.textContent = fullCss;
                }

                window.__cmuxT3ThemeInstalled = true;
                window.__cmuxT3ThemeDisableReason = null;
                return true;
            };

            let retagPending = false;
            const scheduleRetag = function() {
                if (retagPending || isPanelThemeDisabled()) return;
                retagPending = true;
                const run = function() {
                    retagPending = false;
                    if (!hasExpectedShell()) return;
                    window.__cmuxTagT3Surfaces = tagSurfaces;
                    tagSurfaces();
                };
                if (window.requestAnimationFrame) {
                    window.requestAnimationFrame(run);
                } else {
                    window.setTimeout(run, 0);
                }
            };

            let boundedRetagScheduled = false;
            const runBoundedRetagPass = function() {
                if (boundedRetagScheduled || isPanelThemeDisabled()) return;
                boundedRetagScheduled = true;
                let attemptsRemaining = 8;

                const tick = function() {
                    if (isPanelThemeDisabled()) {
                        boundedRetagScheduled = false;
                        return;
                    }

                    scheduleRetag();
                    attemptsRemaining -= 1;

                    if (attemptsRemaining > 0) {
                        window.setTimeout(tick, 250);
                    } else {
                        boundedRetagScheduled = false;
                    }
                };

                tick();
            };

            const disableTheme = function(reason) {
                window.__cmuxT3ThemeAutoDisabled = true;
                window.__cmuxT3ThemeDisableReason = reason;

                try {
                    window.sessionStorage.setItem("\(panelDisableSessionStorageKey)", "1");
                    window.sessionStorage.setItem("\(panelDisableReasonSessionStorageKey)", reason);
                } catch (_error) {}

                const observer = window.__cmuxT3ThemeObserver;
                if (observer && typeof observer.disconnect === "function") {
                    observer.disconnect();
                }

                window.__cmuxT3ThemeObserver = null;
                window.__cmuxT3ThemeObserverInstalled = false;
                window.__cmuxT3ThemeInstalled = false;

                const tagObserver = window.__cmuxT3TagObserver;
                if (tagObserver && typeof tagObserver.disconnect === "function") {
                    tagObserver.disconnect();
                }

                window.__cmuxT3TagObserver = null;
                window.__cmuxT3TagObserverInstalled = false;

                const root = document.documentElement;
                if (root) {
                    root.removeAttribute("data-cmux-t3-theme");
                }

                clearManagedTags();
                window.__cmuxT3TagCounts = {
                    composerShellTagged: false,
                    composerEditorTagged: false,
                    headerBadgeTaggedCount: 0,
                    toolbarClusterTaggedCount: 0,
                    toolbarButtonTaggedCount: 0,
                    userShellTaggedCount: 0,
                    timestampTaggedCount: 0,
                    scrollButtonTaggedCount: 0
                };

                removeNode("cmux-t3-ernest-critical");
                removeNode("cmux-t3-ernest-theme");
            };

            const installTheme = function() {
                if (isPanelThemeDisabled()) {
                    window.__cmuxT3ThemeInstalled = false;
                    window.__cmuxT3ThemeDisableReason = readDisableReason();
                    return;
                }
                if (!installThemeNodes()) return;
                window.__cmuxTagT3Surfaces = tagSurfaces;
                scheduleRetag();
                runBoundedRetagPass();
            };

            window.__cmuxDisableT3Theme = disableTheme;
            window.__cmuxEnableT3Theme = function() {
                window.__cmuxT3ThemeAutoDisabled = false;
                window.__cmuxT3ThemeDisableReason = null;
                try {
                    window.sessionStorage.removeItem("\(panelDisableSessionStorageKey)");
                    window.sessionStorage.removeItem("\(panelDisableReasonSessionStorageKey)");
                } catch (_error) {}
                installTheme();
            };

            installTheme();

            if (!window.__cmuxT3TagObserverInstalled) {
                const installTagObserver = function() {
                    const target = document.body || document.documentElement;
                    if (!target || window.__cmuxT3TagObserverInstalled) return;

                    const observer = new MutationObserver(function() {
                        scheduleRetag();
                    });
                    observer.observe(target, {
                        childList: true,
                        subtree: true
                    });

                    window.__cmuxT3TagObserverInstalled = true;
                    window.__cmuxT3TagObserver = observer;
                };

                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", installTagObserver, { once: true });
                } else {
                    installTagObserver();
                }
            }

            if (!window.__cmuxT3ThemeObserverInstalled) {
                let installPending = false;
                const scheduleInstall = function() {
                    if (isPanelThemeDisabled() || installPending) return;
                    installPending = true;
                    const run = function() {
                        installPending = false;
                        installThemeNodes();
                    };
                    if (window.requestAnimationFrame) {
                        window.requestAnimationFrame(run);
                    } else {
                        window.setTimeout(run, 0);
                    }
                };

                const observer = new MutationObserver(function() {
                    scheduleInstall();
                });
                observer.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ["data-cmux-t3-theme"]
                });
                const head = document.head;
                if (head) {
                    observer.observe(head, {
                        childList: true
                    });
                }

                window.__cmuxT3ThemeObserverInstalled = true;
                window.__cmuxT3ThemeObserver = observer;
            }

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", runBoundedRetagPass, { once: true });
            } else {
                runBoundedRetagPass();
            }
            window.addEventListener("pageshow", runBoundedRetagPass);
            window.addEventListener("load", runBoundedRetagPass);
            window.addEventListener("popstate", runBoundedRetagPass);
            window.addEventListener("hashchange", runBoundedRetagPass);
        })();
        """
    }

    private static func javaScriptStringLiteral(_ string: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [string]),
            var jsonArray = String(data: data, encoding: .utf8),
            jsonArray.count >= 2
        else {
            return "\"\""
        }

        jsonArray.removeFirst()
        jsonArray.removeLast()
        return jsonArray
    }
}
