import Foundation

enum ContextPagePickerState {
    @MainActor static var isVisible = false
}

struct ContextPagePickerItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let action: @MainActor () -> Void
}
