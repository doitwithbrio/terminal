import SwiftUI

struct DesignPanelBackground: View {
    let cornerRadius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(DesignSystem.Color.panelSurface.dsColor)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(DesignSystem.Color.panelBorder.dsColor, lineWidth: DesignSystem.Primitive.Border.hairline)
            }
            .shadow(
                color: DesignSystem.Color.panelShadow.dsColor,
                radius: DesignSystem.Primitive.Shadow.panelRadius,
                x: DesignSystem.Primitive.Shadow.panelX,
                y: DesignSystem.Primitive.Shadow.panelY
            )
    }
}

private struct DesignPanelModifier: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .background {
                DesignPanelBackground(cornerRadius: cornerRadius)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

extension View {
    func designPanel(cornerRadius: CGFloat = DesignSystem.Primitive.Radius.panel) -> some View {
        modifier(DesignPanelModifier(cornerRadius: cornerRadius))
    }
}
