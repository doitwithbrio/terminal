import SwiftUI

/// The floating Agent Picker overlay — a white Ernest card with category tabs
/// and a list of sessions/threads to resume or create.
struct AgentPickerView: View {
    let category: AgentPickerCategory
    let selectedIndex: Int
    let items: [AgentPickerItem]
    let onSelectCategory: (AgentPickerCategory) -> Void
    let onActivateItem: (Int) -> Void
    let onDismiss: () -> Void
    @State private var hoveredIndex: Int?

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                // Visual scrim — dims terminal for contrast, not interactive
                Color.black.opacity(0.25)
                    .allowsHitTesting(false)

                // Dismiss layer — clicking outside the card dismisses the picker
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onEnded { _ in onDismiss() }
                    )

                // Card
                VStack(spacing: 0) {
                    categoryTabBar
                    itemList
                    footerHints
                }
                .frame(width: min(480, geometry.size.width - 48))
                .designPanel()
                .padding(.top, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    // MARK: - Category tab bar

    private var categoryTabBar: some View {
        HStack(spacing: DesignSystem.Primitive.Space.xs) {
            ForEach(AgentPickerCategory.allCases) { cat in
                categoryTab(cat, isActive: cat == category)
            }
        }
        .padding(.horizontal, DesignSystem.Primitive.Space.md)
        .padding(.top, DesignSystem.Primitive.Space.md)
        .padding(.bottom, DesignSystem.Primitive.Space.sm)
    }

    private func categoryTab(_ cat: AgentPickerCategory, isActive: Bool) -> some View {
        Button {
            onSelectCategory(cat)
        } label: {
            HStack(spacing: 4) {
                Text(cat.shortcutHint)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .opacity(0.6)
                Image(systemName: cat.icon)
                    .font(.system(size: 10, weight: .semibold))
                Text(cat.label)
                    .font(DesignSystem.Typography.primaryButton)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.control, style: .continuous)
                    .fill(isActive
                        ? DesignSystem.Color.topTabActiveFill.dsColor
                        : DesignSystem.Color.topTabInactiveFill.dsColor)
            )
            .foregroundStyle(isActive
                ? DesignSystem.Color.topTabActiveForeground.dsColor
                : DesignSystem.Color.topTabInactiveForeground.dsColor)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Item list

    private var itemList: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: DesignSystem.Primitive.Space.xs) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        itemRow(item, index: index, isSelected: index == selectedIndex, isHovered: hoveredIndex == index)
                            .id(index)
                    }
                }
                .padding(.horizontal, DesignSystem.Primitive.Space.md)
                .padding(.vertical, DesignSystem.Primitive.Space.xs)
            }
            .frame(maxHeight: 320)
            .onChange(of: selectedIndex) { newIndex in
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo(newIndex, anchor: .center)
                }
            }
        }
    }

    private func itemRow(_ item: AgentPickerItem, index: Int, isSelected: Bool, isHovered: Bool) -> some View {
        Button {
            onActivateItem(index)
        } label: {
            HStack(spacing: DesignSystem.Primitive.Space.sm) {
                // Number badge
                Text("\(index + 1)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                    .frame(width: 18, alignment: .center)

                // Title
                if item.isCreateNew {
                    HStack(spacing: 3) {
                        Image(systemName: "plus")
                            .font(.system(size: 10, weight: .semibold))
                        Text(item.title)
                            .font(DesignSystem.Typography.rowTitle)
                    }
                    .foregroundStyle(DesignSystem.Color.primaryActionFill.dsColor)
                } else {
                    Text(item.title)
                        .font(DesignSystem.Typography.rowTitle)
                        .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                        .lineLimit(1)
                }

                Spacer()

                // Subtitle (e.g. "2h ago" or directory)
                if let subtitle = item.subtitle {
                    Text(subtitle)
                        .font(DesignSystem.Typography.rowSubtitle)
                        .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, DesignSystem.Primitive.Space.sm)
            .padding(.vertical, DesignSystem.Metrics.sidebarRowPaddingY)
            .background(
                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous)
                    .fill(isSelected
                        ? DesignSystem.Color.sidebarRowSelectedFill.dsColor
                        : (isHovered
                            ? DesignSystem.Color.quietControlHoverFill.dsColor
                            : Color.clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredIndex = hovering ? index : nil
        }
    }

    // MARK: - Footer

    private var footerHints: some View {
        HStack(spacing: DesignSystem.Primitive.Space.md) {
            hintLabel("n", String(localized: "agentPicker.hint.new", defaultValue: "New"))
            hintLabel("\u{2191}\u{2193}", String(localized: "agentPicker.hint.navigate", defaultValue: "Navigate"))
            hintLabel("1-9", String(localized: "agentPicker.hint.select", defaultValue: "Select"))
            hintLabel("\u{23CE}", String(localized: "agentPicker.hint.open", defaultValue: "Open"))
            hintLabel("esc", String(localized: "agentPicker.hint.close", defaultValue: "Close"))
        }
        .padding(.horizontal, DesignSystem.Primitive.Space.md)
        .padding(.vertical, DesignSystem.Primitive.Space.sm)
    }

    private func hintLabel(_ key: String, _ label: String) -> some View {
        HStack(spacing: 3) {
            Text(key)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
            Text(label)
                .font(.system(size: 10))
        }
        .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
    }
}
