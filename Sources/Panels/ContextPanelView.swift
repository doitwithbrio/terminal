import AppKit
import SwiftUI
import MarkdownUI

struct ContextPanelView: View {
    @ObservedObject var panel: ContextPanel
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let onRequestPanelFocus: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var focusFlashOpacity: Double = 0
    @State private var focusFlashAnimationGeneration: Int = 0

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundColor)
        .overlay {
            RoundedRectangle(cornerRadius: FocusFlashPattern.ringCornerRadius)
                .stroke(cmuxAccentColor().opacity(focusFlashOpacity), lineWidth: 3)
                .shadow(color: cmuxAccentColor().opacity(focusFlashOpacity * 0.35), radius: 10)
                .padding(FocusFlashPattern.ringInset)
                .allowsHitTesting(false)
        }
        .overlay {
            if isVisibleInUI {
                ContextPointerObserver(onPointerDown: onRequestPanelFocus)
            }
        }
        .onChange(of: panel.focusFlashToken) { _ in
            triggerFocusFlashAnimation()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(String(localized: "contextPanel.header.title", defaultValue: "Context"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.secondary)

            Spacer(minLength: 0)

            Menu {
                ForEach(ContextPageKind.allCases, id: \.self) { kind in
                    Button(kind.title) {
                        panel.onSelectPageKind?(kind)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(panel.pageState.kind.title)
                        .font(.system(size: 12, weight: .medium))
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(DesignSystem.Color.quietControlHoverFill.dsColor)
                )
            }
            .menuStyle(.borderlessButton)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var content: some View {
        switch panel.pageState.kind {
        case .blank:
            blankState
        case .agentMd, .plan:
            if panel.isFileUnavailable {
                missingFileState
            } else {
                markdownContent
            }
        }
    }

    private var blankState: some View {
        VStack(spacing: 16) {
            Image(systemName: "sidebar.right")
                .font(.system(size: 28, weight: .semibold))
                .foregroundColor(.secondary)
            Text(String(localized: "contextPanel.blank.title", defaultValue: "No context page selected"))
                .font(.headline)
            Text(String(localized: "contextPanel.blank.message", defaultValue: "Use Shift-Command-N here or the selector above to open AGENT.md or the bound plan page."))
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            HStack(spacing: 10) {
                Button("AGENT.md") {
                    panel.onSelectPageKind?(.agentMd)
                }
                Button(String(localized: "contextPanel.blank.openPlan", defaultValue: "Open Plan")) {
                    panel.onSelectPageKind?(.plan)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    private var missingFileState: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.questionmark")
                .font(.system(size: 36))
                .foregroundColor(.secondary)
            Text(String(localized: "contextPanel.fileUnavailable.title", defaultValue: "File unavailable"))
                .font(.headline)
            if let path = panel.pageState.resolvedFilePath, !path.isEmpty {
                Text(path)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .padding(.horizontal, 24)
            }
            Text(panel.pageState.missingReason ?? String(localized: "contextPanel.fileUnavailable.message", defaultValue: "The selected markdown file is missing or unreadable."))
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var markdownContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let path = panel.pageState.resolvedFilePath, !path.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.richtext")
                            .foregroundColor(.secondary)
                            .font(.system(size: 12))
                        Text(path)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                    Divider()
                        .padding(.horizontal, 16)
                }

                Markdown(panel.content)
                    .markdownTheme(markdownTheme)
                    .textSelection(.enabled)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
            }
        }
    }

    private var backgroundColor: Color {
        colorScheme == .dark
            ? Color(nsColor: NSColor(white: 0.12, alpha: 1.0))
            : Color(nsColor: NSColor(white: 0.98, alpha: 1.0))
    }

    private var markdownTheme: Theme {
        let isDark = colorScheme == .dark
        return Theme()
            .text {
                ForegroundColor(isDark ? .white.opacity(0.9) : .primary)
                FontSize(14)
            }
            .heading1 { configuration in
                VStack(alignment: .leading, spacing: 8) {
                    configuration.label
                        .markdownTextStyle {
                            FontWeight(.bold)
                            FontSize(28)
                            ForegroundColor(isDark ? .white : .primary)
                        }
                    Divider()
                }
                .markdownMargin(top: 24, bottom: 16)
            }
            .heading2 { configuration in
                VStack(alignment: .leading, spacing: 6) {
                    configuration.label
                        .markdownTextStyle {
                            FontWeight(.bold)
                            FontSize(22)
                            ForegroundColor(isDark ? .white : .primary)
                        }
                    Divider()
                }
                .markdownMargin(top: 20, bottom: 12)
            }
            .heading3 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(18)
                        ForegroundColor(isDark ? .white : .primary)
                    }
                    .markdownMargin(top: 16, bottom: 8)
            }
            .codeBlock { configuration in
                ScrollView(.horizontal, showsIndicators: true) {
                    configuration.label
                        .markdownTextStyle {
                            FontFamilyVariant(.monospaced)
                            FontSize(13)
                            ForegroundColor(isDark ? Color(red: 0.9, green: 0.9, blue: 0.9) : Color(red: 0.2, green: 0.2, blue: 0.2))
                        }
                        .padding(12)
                }
                .background(isDark
                    ? Color(nsColor: NSColor(white: 0.08, alpha: 1.0))
                    : Color(nsColor: NSColor(white: 0.93, alpha: 1.0)))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .markdownMargin(top: 8, bottom: 8)
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(13)
                ForegroundColor(isDark ? Color(red: 0.85, green: 0.6, blue: 0.95) : Color(red: 0.6, green: 0.2, blue: 0.7))
                BackgroundColor(isDark
                    ? Color(nsColor: NSColor(white: 0.18, alpha: 1.0))
                    : Color(nsColor: NSColor(white: 0.92, alpha: 1.0)))
            }
            .blockquote { configuration in
                HStack(spacing: 0) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(isDark ? Color.white.opacity(0.2) : Color.gray.opacity(0.4))
                        .frame(width: 3)
                    configuration.label
                        .markdownTextStyle {
                            ForegroundColor(isDark ? .white.opacity(0.6) : .secondary)
                            FontSize(14)
                        }
                        .padding(.leading, 12)
                }
                .markdownMargin(top: 8, bottom: 8)
            }
            .link {
                ForegroundColor(Color.accentColor)
            }
            .strong {
                FontWeight(.semibold)
            }
            .paragraph { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(14)
                        ForegroundColor(isDark ? .white.opacity(0.9) : .primary)
                    }
                    .markdownMargin(top: 0, bottom: 12)
            }
    }

    private func triggerFocusFlashAnimation() {
        focusFlashAnimationGeneration &+= 1
        let generation = focusFlashAnimationGeneration
        focusFlashOpacity = 0
        for segment in FocusFlashPattern.segments {
            DispatchQueue.main.asyncAfter(deadline: .now() + segment.delay) {
                guard generation == focusFlashAnimationGeneration else { return }
                withAnimation(animation(for: segment.curve, duration: segment.duration)) {
                    focusFlashOpacity = segment.targetOpacity
                }
            }
        }
    }

    private func animation(for curve: FocusFlashCurve, duration: TimeInterval) -> Animation {
        switch curve {
        case .easeIn:
            return .easeIn(duration: duration)
        case .easeOut:
            return .easeOut(duration: duration)
        }
    }
}

private struct ContextPointerObserver: NSViewRepresentable {
    let onPointerDown: () -> Void

    func makeNSView(context: Context) -> ContextPanelPointerObserverView {
        let view = ContextPanelPointerObserverView()
        view.onPointerDown = onPointerDown
        return view
    }

    func updateNSView(_ nsView: ContextPanelPointerObserverView, context: Context) {
        nsView.onPointerDown = onPointerDown
    }
}

final class ContextPanelPointerObserverView: NSView {
    var onPointerDown: (() -> Void)?
    private var eventMonitor: Any?
    private weak var forwardedMouseTarget: NSView?

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
        forwardedMouseTarget = forwardedTarget(for: event)
        forwardedMouseTarget?.mouseDown(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        forwardedMouseTarget?.mouseDragged(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        forwardedMouseTarget?.mouseUp(with: event)
        forwardedMouseTarget = nil
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
        guard let window,
              let contentView = window.contentView else {
            return nil
        }
        isHidden = true
        defer { isHidden = false }
        let point = contentView.convert(event.locationInWindow, from: nil)
        let target = contentView.hitTest(point)
        return target === self ? nil : target
    }
}
