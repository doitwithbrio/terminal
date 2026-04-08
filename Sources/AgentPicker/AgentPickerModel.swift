import Foundation

/// Global state for the Agent Picker, readable by AppDelegate to consume
/// keyboard shortcuts while the picker is visible.
enum AgentPickerState {
    @MainActor static var isVisible = false
}

/// Category of agent/tool shown in the Agent Picker.
enum AgentPickerCategory: Int, CaseIterable, Identifiable {
    case terminal = 1
    case t3code = 2
    case opencode = 3

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .terminal: return String(localized: "agentPicker.category.terminal", defaultValue: "Terminal")
        case .t3code: return String(localized: "agentPicker.category.t3code", defaultValue: "T3 Code")
        case .opencode: return String(localized: "agentPicker.category.opencode", defaultValue: "OpenCode")
        }
    }

    var icon: String {
        switch self {
        case .terminal: return "terminal"
        case .t3code: return "cpu"
        case .opencode: return "brain"
        }
    }

    var shortcutHint: String {
        switch self {
        case .terminal: return "\u{2318}1"
        case .t3code: return "\u{2318}2"
        case .opencode: return "\u{2318}3"
        }
    }
}

/// A single selectable item inside an Agent Picker category.
struct AgentPickerItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let isCreateNew: Bool
    let action: @MainActor () -> Void
}
