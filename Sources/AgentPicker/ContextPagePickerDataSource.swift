import Foundation

@MainActor
final class ContextPagePickerDataSource {
    func items(
        selectPage: @escaping @MainActor (_ kind: ContextPageKind) -> Void
    ) -> [ContextPagePickerItem] {
        [
            ContextPagePickerItem(
                id: ContextPageKind.agentMd.rawValue,
                icon: ContextPageKind.agentMd.systemImage,
                title: "AGENT.md",
                subtitle: String(localized: "contextPagePicker.agentMd.subtitle", defaultValue: "Workspace instructions for humans and agents"),
                action: { selectPage(.agentMd) }
            ),
            ContextPagePickerItem(
                id: ContextPageKind.plan.rawValue,
                icon: ContextPageKind.plan.systemImage,
                title: String(localized: "contextPage.plan.title", defaultValue: "Plan"),
                subtitle: String(localized: "contextPagePicker.plan.subtitle", defaultValue: "The bound task plan for this tab"),
                action: { selectPage(.plan) }
            ),
        ]
    }
}
