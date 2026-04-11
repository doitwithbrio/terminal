import Foundation
import Combine

enum ContextPageKind: String, CaseIterable, Codable, Sendable {
    case blank
    case agentMd
    case plan

    var title: String {
        switch self {
        case .blank:
            return String(localized: "contextPage.blank.title", defaultValue: "Start Here")
        case .agentMd:
            return "AGENT.md"
        case .plan:
            return String(localized: "contextPage.plan.title", defaultValue: "Plan")
        }
    }

    var subtitle: String {
        switch self {
        case .blank:
            return String(localized: "contextPage.blank.subtitle", defaultValue: "Choose what this tab should remember")
        case .agentMd:
            return String(localized: "contextPage.agentMd.subtitle", defaultValue: "Workspace instructions for humans and agents")
        case .plan:
            return String(localized: "contextPage.plan.subtitle", defaultValue: "The bound task plan for this tab")
        }
    }

    var systemImage: String {
        switch self {
        case .blank:
            return "square.text.square"
        case .agentMd:
            return "doc.text"
        case .plan:
            return "checklist"
        }
    }
}

struct ContextPageState: Equatable, Sendable {
    let kind: ContextPageKind
    let resolvedFilePath: String?
    let missingReason: String?

    static let blank = ContextPageState(kind: .blank, resolvedFilePath: nil, missingReason: nil)
}

struct AgentContextBindingState: Equatable, Codable, Sendable {
    var kind: ContextPageKind
    var planFilePath: String?

    static let blank = AgentContextBindingState(kind: .blank, planFilePath: nil)
}

@MainActor
final class ContextPanel: Panel, ObservableObject {
    let id: UUID
    let panelType: PanelType = .context

    private(set) var workspaceId: UUID

    @Published private(set) var displayTitle: String
    @Published private(set) var content: String = ""
    @Published private(set) var isFileUnavailable: Bool = false
    @Published private(set) var pageState: ContextPageState = .blank
    @Published private(set) var focusFlashToken: Int = 0
    @Published var isEditing: Bool = false

    var displayIcon: String? { "rectangle.split.2x1" }

    var onSelectPageKind: ((ContextPageKind) -> Void)?
    var onOpenFile: ((String) -> Void)?

    private let documentState = MarkdownDocumentState()
    private var cancellables = Set<AnyCancellable>()
    private var saveWorkItem: DispatchWorkItem?

    init(workspaceId: UUID) {
        self.id = UUID()
        self.workspaceId = workspaceId
        self.displayTitle = String(localized: "contextPanel.title", defaultValue: "Context")

        documentState.$content
            .receive(on: DispatchQueue.main)
            .sink { [weak self] content in
                self?.content = content
            }
            .store(in: &cancellables)

        documentState.$isFileUnavailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isUnavailable in
                self?.isFileUnavailable = isUnavailable
            }
            .store(in: &cancellables)
    }

    func updateWorkspaceId(_ newWorkspaceId: UUID) {
        workspaceId = newWorkspaceId
    }

    func setPageState(_ newState: ContextPageState) {
        pageState = newState
        if let filePath = newState.resolvedFilePath, !filePath.isEmpty {
            documentState.setFilePath(filePath)
        } else {
            documentState.setFilePath(nil)
            content = ""
            isFileUnavailable = false
        }
    }

    func toggleEditing() {
        isEditing.toggle()
    }

    func debouncedSave(_ text: String) {
        saveWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.saveToFile(text)
        }
        saveWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
    }

    private func saveToFile(_ text: String) {
        guard let path = pageState.resolvedFilePath, !path.isEmpty else { return }
        do {
            try text.write(toFile: path, atomically: true, encoding: .utf8)
        } catch {
            NSLog("[ContextPanel] Failed to save file: \(error)")
        }
    }

    func focus() {
        // The SwiftUI view owns focusable controls; no AppKit first responder handoff needed here.
    }

    func unfocus() {
        // No-op for the context surface.
    }

    func close() {
        documentState.close()
    }

    func triggerFlash(reason: WorkspaceAttentionFlashReason) {
        _ = reason
        guard NotificationPaneFlashSettings.isEnabled() else { return }
        focusFlashToken += 1
    }
}
