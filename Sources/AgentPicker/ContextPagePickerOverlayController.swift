import AppKit
import SwiftUI

private var contextPagePickerWindowOverlayKey: UInt8 = 0
private let contextPagePickerOverlayContainerIdentifier = NSUserInterfaceItemIdentifier("cmux.contextPagePicker.overlay.container")

@MainActor
final class ContextPagePickerOverlayContainerView: NSView {
    var capturesMouseEvents = false

    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard capturesMouseEvents else { return nil }
        return super.hitTest(point)
    }
}

@MainActor
final class ContextPagePickerOverlayController: NSObject {
    private weak var window: NSWindow?
    private let containerView = ContextPagePickerOverlayContainerView(frame: .zero)
    private let hostingView = NSHostingView(rootView: AnyView(EmptyView()))
    private var installConstraints: [NSLayoutConstraint] = []
    private weak var installedThemeFrame: NSView?
    private var isPickerVisible = false
    private var keyEventMonitor: Any?

    var onKeyEvent: ((_ event: NSEvent) -> Bool)?

    init(window: NSWindow) {
        self.window = window
        super.init()
        containerView.translatesAutoresizingMaskIntoConstraints = false
        containerView.wantsLayer = true
        containerView.layer?.backgroundColor = NSColor.clear.cgColor
        containerView.isHidden = true
        containerView.alphaValue = 0
        containerView.capturesMouseEvents = false
        containerView.identifier = contextPagePickerOverlayContainerIdentifier
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor
        containerView.addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.topAnchor.constraint(equalTo: containerView.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor),
            hostingView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
        ])
        _ = ensureInstalled()
    }

    @discardableResult
    private func ensureInstalled() -> Bool {
        guard let window,
              let contentView = window.contentView,
              let themeFrame = contentView.superview else { return false }

        if containerView.superview !== themeFrame {
            NSLayoutConstraint.deactivate(installConstraints)
            installConstraints.removeAll()
            containerView.removeFromSuperview()
            themeFrame.addSubview(containerView, positioned: .above, relativeTo: nil)
            installConstraints = [
                containerView.topAnchor.constraint(equalTo: contentView.topAnchor),
                containerView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
                containerView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
                containerView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            ]
            NSLayoutConstraint.activate(installConstraints)
            installedThemeFrame = themeFrame
        }

        return true
    }

    private func promoteOverlayAboveSiblingsIfNeeded() {
        guard let themeFrame = installedThemeFrame,
              containerView.superview === themeFrame else { return }
        themeFrame.addSubview(containerView, positioned: .above, relativeTo: nil)
    }

    func update(rootView: AnyView, isVisible: Bool) {
        guard ensureInstalled() else { return }
        let shouldPromote = isVisible && !isPickerVisible
        isPickerVisible = isVisible
        if isVisible {
            hostingView.rootView = rootView
            containerView.capturesMouseEvents = true
            containerView.isHidden = false
            containerView.alphaValue = 1
            if shouldPromote {
                promoteOverlayAboveSiblingsIfNeeded()
            }
            installKeyEventMonitor()
        } else {
            removeKeyEventMonitor()
            hostingView.rootView = AnyView(EmptyView())
            containerView.capturesMouseEvents = false
            containerView.alphaValue = 0
            containerView.isHidden = true
        }
    }

    private func installKeyEventMonitor() {
        guard keyEventMonitor == nil else { return }
        keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if let handler = self.onKeyEvent, handler(event) {
                return nil
            }
            return nil
        }
    }

    private func removeKeyEventMonitor() {
        if let monitor = keyEventMonitor {
            NSEvent.removeMonitor(monitor)
            keyEventMonitor = nil
        }
    }

    deinit {
        if let monitor = keyEventMonitor {
            NSEvent.removeMonitor(monitor)
        }
    }
}

@MainActor
func contextPagePickerWindowOverlayController(for window: NSWindow) -> ContextPagePickerOverlayController {
    if let existing = objc_getAssociatedObject(window, &contextPagePickerWindowOverlayKey) as? ContextPagePickerOverlayController {
        return existing
    }
    let controller = ContextPagePickerOverlayController(window: window)
    objc_setAssociatedObject(window, &contextPagePickerWindowOverlayKey, controller, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    return controller
}
