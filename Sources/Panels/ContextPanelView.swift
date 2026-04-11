import AppKit
import SwiftUI
import MarkdownUI

struct ContextPanelView: View {
    @ObservedObject var panel: ContextPanel
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let onRequestPanelFocus: () -> Void

    @State private var focusFlashOpacity: Double = 0
    @State private var focusFlashAnimationGeneration: Int = 0
    @State private var hoveredRowIdentifier: String?
    @State private var hoveredControlIdentifier: String?

    var body: some View {
        VStack(spacing: 0) {
            if panel.pageState.kind != .blank,
               !panel.isFileUnavailable,
               let path = panel.pageState.resolvedFilePath, !path.isEmpty {
                contextHeaderBar(kind: panel.pageState.kind, filePath: path)
            }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignSystem.Color.panelSurface.dsColor)
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
        .onChange(of: panel.focusFlashToken) {
            triggerFocusFlashAnimation()
        }
    }

    // The three fixed tabs are rendered by ContextPaneTabBar
    // in the Bonsplit tab bar position via BonsplitController.setCustomTabBar().

    // MARK: - T3-style action bar

    private func contextHeaderBar(kind: ContextPageKind, filePath: String) -> some View {
        HStack(spacing: DesignSystem.Primitive.Space.sm) {
            Image(systemName: kind.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(nsColor: NSColor(white: 0.04, alpha: 0.72)))
            Text(kind.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(nsColor: NSColor(red: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)))
                .tracking(-0.28)

            Spacer(minLength: 0)

            headerButton(
                id: "edit",
                icon: panel.isEditing ? "eye" : "pencil",
                tooltip: panel.isEditing
                    ? String(localized: "contextHeader.viewRendered", defaultValue: "View Rendered")
                    : String(localized: "contextHeader.edit", defaultValue: "Edit")
            ) {
                panel.toggleEditing()
            }
            headerButton(id: "reveal", icon: "folder", tooltip: String(localized: "contextHeader.reveal", defaultValue: "Reveal in Finder")) {
                NSWorkspace.shared.selectFile(filePath, inFileViewerRootedAtPath: "")
            }
        }
        .padding(.horizontal, DesignSystem.Primitive.Space.md)
        .frame(height: 44)
        .background(Color(nsColor: NSColor(white: 1.0, alpha: 0.96)))
    }

    private func headerButton(id: String, icon: String, tooltip: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(
                    hoveredControlIdentifier == id
                        ? Color(nsColor: NSColor(red: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1))
                        : Color(nsColor: NSColor(red: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 0.72))
                )
                .frame(width: 30, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(
                            hoveredControlIdentifier == id
                                ? Color(nsColor: NSColor(red: 200 / 255, green: 218 / 255, blue: 206 / 255, alpha: 1))
                                : Color(nsColor: NSColor(red: 220 / 255, green: 232 / 255, blue: 223 / 255, alpha: 1))
                        )
                )
        }
        .buttonStyle(.plain)
        .help(tooltip)
        .onHover { hovering in
            hoveredControlIdentifier = hovering ? id : nil
        }
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
        ScrollView {
            contentColumn {
                stateEyebrow(String(localized: "contextPanel.blank.eyebrow", defaultValue: "No page selected"))

                Text(String(localized: "contextPanel.blank.title", defaultValue: "Choose what this tab should remember"))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)

                Text(String(localized: "contextPanel.blank.message", defaultValue: "Pin instructions or a plan alongside the active tab."))
                    .font(.system(size: 13))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: DesignSystem.Primitive.Space.sm) {
                    pageChoiceRow(for: .agentMd, titleOverride: "AGENT.md")
                    pageChoiceRow(for: .plan)
                }
                .padding(.top, DesignSystem.Primitive.Space.xs)
            }
        }
    }

    private var missingFileState: some View {
        ScrollView {
            contentColumn {
                stateEyebrow(String(localized: "contextPanel.fileUnavailable.eyebrow", defaultValue: "Unavailable"))

                Text(String(localized: "contextPanel.fileUnavailable.title", defaultValue: "This context file can’t be shown"))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)

                Text(panel.pageState.missingReason ?? String(localized: "contextPanel.fileUnavailable.message", defaultValue: "The selected markdown file is missing or unreadable."))
                    .font(.system(size: 13))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)

                if let path = panel.pageState.resolvedFilePath, !path.isEmpty {
                    documentMetaCard(
                        icon: "doc.text",
                        title: String(localized: "contextPanel.fileUnavailable.pathTitle", defaultValue: "Expected file"),
                        subtitle: path
                    )
                }

                HStack(spacing: 10) {
                    quietActionButton(
                        id: "show-start-page",
                        title: String(localized: "contextPanel.fileUnavailable.showStartPage", defaultValue: "Show Start Page"),
                        icon: ContextPageKind.blank.systemImage
                    ) {
                        panel.onSelectPageKind?(.blank)
                    }

                    if panel.pageState.kind == .agentMd {
                        quietActionButton(
                            id: "open-plan",
                            title: String(localized: "contextPanel.fileUnavailable.openPlan", defaultValue: "Open Plan"),
                            icon: ContextPageKind.plan.systemImage
                        ) {
                            panel.onSelectPageKind?(.plan)
                        }
                    } else {
                        quietActionButton(
                            id: "retry-plan",
                            title: String(localized: "contextPanel.fileUnavailable.retryPlan", defaultValue: "Try Plan Again"),
                            icon: "arrow.clockwise"
                        ) {
                            panel.onSelectPageKind?(.plan)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var markdownContent: some View {
        if panel.isEditing {
            MilkdownEditorView(
                initialContent: panel.content,
                onContentChanged: { newContent in
                    panel.debouncedSave(newContent)
                }
            )
        } else {
            ScrollView {
                contentColumn(spacing: DesignSystem.Primitive.Space.lg) {
                    Markdown(panel.content)
                        .markdownTheme(contextMarkdownTheme)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private func contentColumn<Content: View>(
        spacing: CGFloat = DesignSystem.Primitive.Space.lg,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
        .frame(maxWidth: 620, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, DesignSystem.Primitive.Space.sm)
        .padding(.bottom, 24)
    }

    private func stateEyebrow(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
            .textCase(.uppercase)
            .tracking(0.5)
    }

    private func pageChoiceRow(
        for kind: ContextPageKind,
        titleOverride: String? = nil
    ) -> some View {
        Button {
            panel.onSelectPageKind?(kind)
        } label: {
            HStack(spacing: DesignSystem.Primitive.Space.md) {
                leadingIconTile(systemImage: kind.systemImage, isSelected: false, isHovered: hoveredRowIdentifier == kind.rawValue)

                VStack(alignment: .leading, spacing: 3) {
                    Text(titleOverride ?? kind.title)
                        .font(DesignSystem.Typography.rowTitle)
                        .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                    Text(kind.subtitle)
                        .font(DesignSystem.Typography.rowSubtitle)
                        .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                        .lineLimit(2)
                }

                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.control, style: .continuous)
                    .fill(rowFill(identifier: kind.rawValue))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.control, style: .continuous)
                    .stroke(DesignSystem.Color.panelBorder.dsColor, lineWidth: DesignSystem.Primitive.Border.hairline)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredRowIdentifier = hovering ? kind.rawValue : nil
        }
    }

    private func quietActionButton(
        id: String,
        title: String,
        icon: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: DesignSystem.Primitive.Space.sm) {
                Image(systemName: icon)
                    .font(DesignSystem.Typography.iconButton)
                Text(title)
                    .font(DesignSystem.Typography.primaryButton)
            }
            .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
            .padding(.horizontal, DesignSystem.Primitive.Space.md)
            .padding(.vertical, DesignSystem.Primitive.Space.sm)
            .background(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.control, style: .continuous)
                    .fill(controlFill(identifier: id))
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredControlIdentifier = hovering ? id : nil
        }
    }

    private func documentMetaCard(icon: String, title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: DesignSystem.Primitive.Space.md) {
            leadingIconTile(systemImage: icon, isSelected: false, isHovered: false)

            VStack(alignment: .leading, spacing: DesignSystem.Primitive.Space.xs) {
                Text(title)
                    .font(DesignSystem.Typography.primaryButton)
                    .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                Text(subtitle)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .padding(DesignSystem.Primitive.Space.md)
        .background(
            RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous)
                .fill(DesignSystem.Color.sidebarRowSelectedFill.dsColor)
        )
    }

    private func leadingIconTile(systemImage: String, isSelected: Bool, isHovered: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(iconTileFill(isSelected: isSelected, isHovered: isHovered))
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
        }
        .frame(width: 34, height: 34)
    }

    private func rowFill(identifier: String) -> Color {
        hoveredRowIdentifier == identifier
            ? Color(nsColor: DesignSystem.Primitive.Color.selectionTint.blended(withFraction: 0.08, of: .black) ?? DesignSystem.Primitive.Color.selectionTint)
            : DesignSystem.Color.sidebarRowSelectedFill.dsColor
    }

    private func controlFill(identifier: String) -> Color {
        hoveredControlIdentifier == identifier
            ? Color(nsColor: DesignSystem.Primitive.Color.selectionTint.blended(withFraction: 0.08, of: .black) ?? DesignSystem.Primitive.Color.selectionTint)
            : DesignSystem.Color.sidebarRowSelectedFill.dsColor
    }

    private func iconTileFill(isSelected: Bool, isHovered: Bool) -> Color {
        if isSelected || isHovered {
            return DesignSystem.Color.panelSurface.dsColor
        }
        return DesignSystem.Color.sidebarRowSelectedFill.dsColor
    }

    private var contextMarkdownTheme: Theme {
        Theme()
            .text {
                ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                FontSize(13)
            }
            .heading1 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(22)
                        ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                    }
                    .markdownMargin(top: 0, bottom: 12)
            }
            .heading2 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(18)
                        ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                    }
                    .markdownMargin(top: 18, bottom: 8)
            }
            .heading3 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(15)
                        ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                    }
                    .markdownMargin(top: 12, bottom: 8)
            }
            .heading4 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(13)
                        ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                    }
                    .markdownMargin(top: 12, bottom: 4)
            }
            .paragraph { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(13)
                        ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                    }
                    .markdownMargin(top: 0, bottom: 12)
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(13)
                ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                BackgroundColor(DesignSystem.Color.primaryActionFill.dsColor.opacity(0.07))
            }
            .codeBlock { configuration in
                ScrollView(.horizontal, showsIndicators: true) {
                    configuration.label
                        .markdownTextStyle {
                            FontFamilyVariant(.monospaced)
                            FontSize(13)
                            ForegroundColor(DesignSystem.Color.textPrimary.dsColor)
                        }
                        .padding(DesignSystem.Primitive.Space.md)
                }
                .background(DesignSystem.Color.primaryActionFill.dsColor.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous))
                .markdownMargin(top: 8, bottom: 12)
            }
            .blockquote { configuration in
                HStack(spacing: 0) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(DesignSystem.Color.primaryActionFill.dsColor.opacity(0.14))
                        .frame(width: 4)
                    configuration.label
                        .markdownTextStyle {
                            FontSize(13)
                            ForegroundColor(DesignSystem.Color.textSecondary.dsColor)
                        }
                        .padding(.leading, DesignSystem.Primitive.Space.md)
                }
                .markdownMargin(top: 8, bottom: 12)
            }
            .link {
                ForegroundColor(DesignSystem.Color.primaryActionFill.dsColor)
            }
            .strong {
                FontWeight(.semibold)
            }
            .listItem { configuration in
                configuration.label
                    .markdownMargin(top: 4, bottom: 4)
            }
            .thematicBreak {
                Divider()
                    .markdownMargin(top: 18, bottom: 18)
            }
            .table { configuration in
                configuration.label
                    .markdownTableBorderStyle(.init(color: DesignSystem.Color.panelBorder.dsColor))
                    .markdownTableBackgroundStyle(
                        .alternatingRows(
                            DesignSystem.Color.sidebarRowSelectedFill.dsColor,
                            DesignSystem.Color.panelSurface.dsColor
                        )
                    )
                    .markdownMargin(top: 10, bottom: 12)
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

// MARK: - Context Pane Tab Bar (replaces Bonsplit tab strip for context pane)

struct ContextPaneTabBar: View {
    @ObservedObject var panel: ContextPanel
    let onSelect: (ContextPageKind) -> Void

    @State private var hoveredKind: ContextPageKind?

    var body: some View {
        HStack(spacing: DesignSystem.Primitive.Space.xs) {
            ForEach(ContextPageKind.allCases, id: \.self) { kind in
                tabPill(for: kind)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DesignSystem.Primitive.Space.md)
        .padding(.top, DesignSystem.Primitive.Space.sm)
        .frame(height: 32 + DesignSystem.Primitive.Space.sm)
    }

    private func tabPill(for kind: ContextPageKind) -> some View {
        let isActive = panel.pageState.kind == kind
        let isHovered = hoveredKind == kind

        return Button {
            onSelect(kind)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: kind.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(kind.title)
                    .font(DesignSystem.Typography.primaryButton)
            }
            .foregroundStyle(
                isActive
                    ? DesignSystem.Color.topTabActiveForeground.dsColor
                    : DesignSystem.Color.topTabInactiveForeground.dsColor
            )
            .padding(.horizontal, DesignSystem.Metrics.topShelfTabHorizontalPadding)
            .frame(height: DesignSystem.Metrics.topShelfControlHeight)
            .background(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.control, style: .continuous)
                    .fill(
                        isActive
                            ? DesignSystem.Color.topTabActiveFill.dsColor
                            : isHovered
                                ? DesignSystem.Color.topTabHoverFill.dsColor
                                : DesignSystem.Color.topTabInactiveFill.dsColor
                    )
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredKind = hovering ? kind : nil
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
        guard let window, let contentView = window.contentView else { return nil }
        isHidden = true
        defer { isHidden = false }
        let point = contentView.convert(event.locationInWindow, from: nil)
        let target = contentView.hitTest(point)
        return target === self ? nil : target
    }
}
