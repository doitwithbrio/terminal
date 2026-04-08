import Foundation

@MainActor
final class ContextPagePickerDataSource {
    func items(
        selectPage: @escaping @MainActor (_ kind: ContextPageKind) -> Void
    ) -> [ContextPagePickerItem] {
        [
            ContextPagePickerItem(
                id: ContextPageKind.agentMd.rawValue,
                title: "AGENT.md",
                subtitle: String(localized: "contextPagePicker.agentMd.subtitle", defaultValue: "Open the workspace-local AGENT.md file"),
                action: { selectPage(.agentMd) }
            ),
            ContextPagePickerItem(
                id: ContextPageKind.plan.rawValue,
                title: String(localized: "contextPage.plan.title", defaultValue: "Plan"),
                subtitle: String(localized: "contextPagePicker.plan.subtitle", defaultValue: "Open the bound plan markdown file"),
                action: { selectPage(.plan) }
            ),
        ]
    }
}
