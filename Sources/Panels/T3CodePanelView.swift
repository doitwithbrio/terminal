import AppKit
import SwiftUI
import WebKit

/// SwiftUI view that renders a T3CodePanel's WKWebView.
///
/// Much simpler than BrowserPanelView since there is no address bar,
/// bookmarks, or navigation controls — just the web content.
struct T3CodePanelView: View {
    @ObservedObject var panel: T3CodePanel
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let onRequestPanelFocus: () -> Void

    @State private var focusFlashOpacity: Double = 0.0
    @State private var focusFlashAnimationGeneration: Int = 0
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        T3WebViewRepresentable(
            panel: panel,
            onRequestPanelFocus: onRequestPanelFocus
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
            RoundedRectangle(cornerRadius: FocusFlashPattern.ringCornerRadius)
                .stroke(cmuxAccentColor().opacity(focusFlashOpacity), lineWidth: 3)
                .shadow(color: cmuxAccentColor().opacity(focusFlashOpacity * 0.35), radius: 10)
                .padding(FocusFlashPattern.ringInset)
                .allowsHitTesting(false)
        }
        .overlay {
            if isVisibleInUI {
                T3CodePointerObserver(onPointerDown: onRequestPanelFocus)
            }
        }
        .onChange(of: panel.focusFlashToken) { _ in
            triggerFocusFlashAnimation()
        }
    }

    // MARK: - Focus Flash

    private func triggerFocusFlashAnimation() {
        focusFlashAnimationGeneration &+= 1
        let generation = focusFlashAnimationGeneration
        focusFlashOpacity = FocusFlashPattern.values.first ?? 0

        for segment in FocusFlashPattern.segments {
            DispatchQueue.main.asyncAfter(deadline: .now() + segment.delay) {
                guard focusFlashAnimationGeneration == generation else { return }
                withAnimation(focusFlashAnimation(for: segment.curve, duration: segment.duration)) {
                    focusFlashOpacity = segment.targetOpacity
                }
            }
        }
    }

    private func focusFlashAnimation(for curve: FocusFlashCurve, duration: TimeInterval) -> Animation {
        switch curve {
        case .easeIn:
            return .easeIn(duration: duration)
        case .easeOut:
            return .easeOut(duration: duration)
        }
    }
}

// MARK: - NSViewRepresentable wrapper

/// Wraps the T3CodePanel's WKWebView for display in SwiftUI.
struct T3WebViewRepresentable: NSViewRepresentable {
    let panel: T3CodePanel
    let onRequestPanelFocus: () -> Void

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        container.wantsLayer = true

        let webView = panel.webView!
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // Ensure the webView is in the container
        let webView = panel.webView!
        if webView.superview !== nsView {
            webView.removeFromSuperview()
            webView.translatesAutoresizingMaskIntoConstraints = false
            nsView.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.topAnchor.constraint(equalTo: nsView.topAnchor),
                webView.bottomAnchor.constraint(equalTo: nsView.bottomAnchor),
                webView.leadingAnchor.constraint(equalTo: nsView.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: nsView.trailingAnchor),
            ])
        }
    }
}

// MARK: - Pointer observer for focus-on-click

private struct T3CodePointerObserver: NSViewRepresentable {
    let onPointerDown: () -> Void

    func makeNSView(context: Context) -> T3CodePointerObserverView {
        let view = T3CodePointerObserverView()
        view.onPointerDown = onPointerDown
        return view
    }

    func updateNSView(_ nsView: T3CodePointerObserverView, context: Context) {
        nsView.onPointerDown = onPointerDown
    }
}

final class T3CodePointerObserverView: NSView {
    var onPointerDown: (() -> Void)?
    private var eventMonitor: Any?

    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        installEventMonitorIfNeeded()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
        }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard PaneFirstClickFocusSettings.isEnabled(),
              window?.isKeyWindow != true,
              bounds.contains(point) else { return nil }
        return self
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        PaneFirstClickFocusSettings.isEnabled()
    }

    override func mouseDown(with event: NSEvent) {
        onPointerDown?()
        // Forward to underlying webView
        if let target = forwardedTarget(for: event) {
            target.mouseDown(with: event)
        }
    }

    func shouldHandle(_ event: NSEvent) -> Bool {
        guard event.type == .leftMouseDown,
              let window,
              event.window === window,
              !isHiddenOrHasHiddenAncestor else { return false }
        if PaneFirstClickFocusSettings.isEnabled(), window.isKeyWindow != true {
            return false
        }
        let point = convert(event.locationInWindow, from: nil)
        return bounds.contains(point)
    }

    func handleEventIfNeeded(_ event: NSEvent) -> NSEvent {
        guard shouldHandle(event) else { return event }
        DispatchQueue.main.async { [weak self] in
            self?.onPointerDown?()
        }
        return event
    }

    private func installEventMonitorIfNeeded() {
        guard eventMonitor == nil else { return }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] event in
            self?.handleEventIfNeeded(event) ?? event
        }
    }

    private func forwardedTarget(for event: NSEvent) -> NSView? {
        guard let window, let contentView = window.contentView else { return nil }
        isHidden = true
        defer { isHidden = false }
        let point = contentView.convert(event.locationInWindow, from: nil)
        let target = contentView.hitTest(point)
        return target === self ? nil : target
    }
}
