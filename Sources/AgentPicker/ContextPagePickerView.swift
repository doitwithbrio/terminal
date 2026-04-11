import SwiftUI

struct ContextPagePickerView: View {
    let selectedIndex: Int
    let items: [ContextPagePickerItem]
    let onActivateItem: (Int) -> Void
    let onDismiss: () -> Void
    @State private var hoveredIndex: Int?

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.black.opacity(0.14)
                    .allowsHitTesting(false)

                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onEnded { _ in onDismiss() }
                    )

                VStack(spacing: 0) {
                    header
                    itemList
                    footer
                }
                .frame(width: min(440, geometry.size.width - 48))
                .designPanel()
                .padding(.top, 56)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "contextPagePicker.eyebrow", defaultValue: "Context"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)

            VStack(alignment: .leading, spacing: 5) {
                Text(String(localized: "contextPagePicker.title", defaultValue: "Context Pages"))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                Text(String(localized: "contextPagePicker.subtitle", defaultValue: "Switch the paired context page for the active tab."))
                    .font(.system(size: 12.5))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 10)
    }

    private var itemList: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        Button {
                            onActivateItem(index)
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(iconTileFill(isSelected: index == selectedIndex, isHovered: hoveredIndex == index))
                                    Image(systemName: item.icon)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                                }
                                .frame(width: 34, height: 34)

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.title)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                                    if let subtitle = item.subtitle {
                                        Text(subtitle)
                                            .font(.system(size: 11))
                                            .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                                            .lineLimit(2)
                                    }
                                }

                                Spacer()

                                pickerKeycapLabel("\(index + 1)")
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)
                            .background(
                                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous)
                                    .fill(rowFill(isSelected: index == selectedIndex, isHovered: hoveredIndex == index))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous)
                                    .stroke(
                                        index == selectedIndex
                                            ? DesignSystem.Color.sidebarActiveBorder.dsColor
                                            : DesignSystem.Color.panelBorder.dsColor,
                                        lineWidth: DesignSystem.Primitive.Border.hairline
                                    )
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            hoveredIndex = hovering ? index : nil
                        }
                        .id(index)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .frame(maxHeight: 240)
            .onChange(of: selectedIndex) {
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo(selectedIndex, anchor: .center)
                }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: DesignSystem.Primitive.Space.md) {
            hintLabel("↑↓", String(localized: "contextPagePicker.hint.navigate", defaultValue: "Navigate"))
            hintLabel("1-9", String(localized: "contextPagePicker.hint.select", defaultValue: "Select"))
            hintLabel("↩", String(localized: "contextPagePicker.hint.open", defaultValue: "Open"))
            hintLabel("esc", String(localized: "contextPagePicker.hint.close", defaultValue: "Close"))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    private func hintLabel(_ key: String, _ label: String) -> some View {
        HStack(spacing: 3) {
            pickerKeycapLabel(key)
            Text(label)
                .font(.system(size: 10))
        }
        .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
    }

    private func pickerKeycapLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(DesignSystem.Color.quietControlFill.dsColor)
            )
    }

    private func rowFill(isSelected: Bool, isHovered: Bool) -> Color {
        if isSelected {
            return DesignSystem.Color.sidebarRowSelectedFill.dsColor
        }
        if isHovered {
            return DesignSystem.Color.quietControlHoverFill.dsColor
        }
        return Color.clear
    }

    private func iconTileFill(isSelected: Bool, isHovered: Bool) -> Color {
        if isSelected {
            return DesignSystem.Color.panelSurface.dsColor
        }
        if isHovered {
            return DesignSystem.Color.panelSurface.dsColor
        }
        return DesignSystem.Color.quietControlFill.dsColor
    }
}
