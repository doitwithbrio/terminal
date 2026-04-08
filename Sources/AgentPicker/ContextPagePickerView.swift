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
                Color.black.opacity(0.25)
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
                .frame(width: min(420, geometry.size.width - 48))
                .designPanel()
                .padding(.top, 56)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "contextPagePicker.title", defaultValue: "Context Pages"))
                    .font(.system(size: 14, weight: .semibold))
                Text(String(localized: "contextPagePicker.subtitle", defaultValue: "Choose what the right context pane should show"))
                    .font(.system(size: 11))
                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
            }
            Spacer()
        }
        .padding(.horizontal, DesignSystem.Primitive.Space.md)
        .padding(.top, DesignSystem.Primitive.Space.md)
        .padding(.bottom, DesignSystem.Primitive.Space.sm)
    }

    private var itemList: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: DesignSystem.Primitive.Space.xs) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        Button {
                            onActivateItem(index)
                        } label: {
                            HStack(spacing: DesignSystem.Primitive.Space.sm) {
                                Text("\(index + 1)")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                                    .frame(width: 18, alignment: .center)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(DesignSystem.Typography.rowTitle)
                                        .foregroundStyle(DesignSystem.Color.textPrimary.dsColor)
                                    if let subtitle = item.subtitle {
                                        Text(subtitle)
                                            .font(DesignSystem.Typography.rowSubtitle)
                                            .foregroundStyle(DesignSystem.Color.textSecondary.dsColor)
                                            .lineLimit(2)
                                    }
                                }

                                Spacer()
                            }
                            .padding(.horizontal, DesignSystem.Primitive.Space.sm)
                            .padding(.vertical, DesignSystem.Metrics.sidebarRowPaddingY)
                            .background(
                                RoundedRectangle(cornerRadius: DesignSystem.Primitive.Radius.row, style: .continuous)
                                    .fill(index == selectedIndex
                                        ? DesignSystem.Color.sidebarRowSelectedFill.dsColor
                                        : (hoveredIndex == index
                                            ? DesignSystem.Color.quietControlHoverFill.dsColor
                                            : Color.clear))
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
                .padding(.horizontal, DesignSystem.Primitive.Space.md)
                .padding(.vertical, DesignSystem.Primitive.Space.xs)
            }
            .frame(maxHeight: 220)
            .onChange(of: selectedIndex) { newIndex in
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo(newIndex, anchor: .center)
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
