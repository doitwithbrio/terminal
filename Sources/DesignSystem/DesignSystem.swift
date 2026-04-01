import AppKit
import SwiftUI

enum DesignSystem {
    enum Primitive {
        enum Color {
            static let sageCanvas = NSColor(hex: "#E4ECE6") ?? NSColor(calibratedRed: 228.0 / 255.0, green: 236.0 / 255.0, blue: 230.0 / 255.0, alpha: 1.0)
            static let white = NSColor.white
            static let ink = NSColor(hex: "#09090B") ?? NSColor(calibratedWhite: 0.04, alpha: 1.0)
            static let forest = NSColor(hex: "#1A4731") ?? NSColor(calibratedRed: 26.0 / 255.0, green: 71.0 / 255.0, blue: 49.0 / 255.0, alpha: 1.0)
            static let neutralSecondary = NSColor(hex: "#F0F0F0") ?? NSColor(calibratedWhite: 0.94, alpha: 1.0)
            static let neutralMuted = NSColor(hex: "#F4F4F5") ?? NSColor(calibratedWhite: 0.96, alpha: 1.0)
            static let borderBase = NSColor(hex: "#E4E4E7") ?? NSColor(calibratedWhite: 0.89, alpha: 1.0)
            static let selectionTint = NSColor(hex: "#DCE8DF") ?? NSColor(calibratedRed: 220.0 / 255.0, green: 232.0 / 255.0, blue: 223.0 / 255.0, alpha: 1.0)
            static let neutralTint = NSColor.black.withAlphaComponent(0.035)
            static let panelBorder = (NSColor(hex: "#111315") ?? NSColor(calibratedWhite: 0.07, alpha: 1.0)).withAlphaComponent(0.08)
            static let panelShadow = (NSColor(hex: "#14221A") ?? NSColor(calibratedRed: 20.0 / 255.0, green: 34.0 / 255.0, blue: 26.0 / 255.0, alpha: 1.0)).withAlphaComponent(0.05)
        }

        enum Space {
            static let xs: CGFloat = 4
            static let sm: CGFloat = 8
            static let md: CGFloat = 12
            static let lg: CGFloat = 18
        }

        enum Radius {
            static let panel: CGFloat = 18
            static let control: CGFloat = 12
            static let row: CGFloat = 10
            static let iconButton: CGFloat = 8
        }

        enum Border {
            static let hairline: CGFloat = 1
        }

        enum Shadow {
            static let panelRadius: CGFloat = 10
            static let panelX: CGFloat = 0
            static let panelY: CGFloat = 3
        }
    }

    enum Color {
        static let windowCanvas = Primitive.Color.sageCanvas
        static let panelSurface = Primitive.Color.white
        static let panelBorder = Primitive.Color.panelBorder
        static let panelShadow = Primitive.Color.panelShadow
        static let textPrimary = Primitive.Color.ink
        static let textSecondary = Primitive.Color.ink.withAlphaComponent(0.62)
        static let primaryActionFill = Primitive.Color.forest
        static let primaryActionForeground = Primitive.Color.white
        static let quietControlFill = Primitive.Color.neutralMuted
        static let quietControlHoverFill = Primitive.Color.neutralSecondary
        static let sidebarWordmark = Primitive.Color.forest
        static let sidebarRowSelectedFill = Primitive.Color.selectionTint
        static let sidebarRowMultiSelectedFill = Primitive.Color.neutralTint
        static let sidebarUnreadBadgeFill = Primitive.Color.forest
        static let sidebarUnreadBadgeForeground = Primitive.Color.white
        static let sidebarActiveBorder = Primitive.Color.forest.withAlphaComponent(0.22)
        static let topTabActiveFill = Primitive.Color.forest
        static let topTabActiveForeground = Primitive.Color.white
        static let topTabInactiveFill = Primitive.Color.selectionTint
        static let topTabInactiveForeground = Primitive.Color.ink
        static let topTabHoverFill = Primitive.Color.selectionTint.withAlphaComponent(0.8)
    }

    enum Metrics {
        static let outerPadding: CGFloat = Primitive.Space.md
        static let panelGap: CGFloat = Primitive.Space.md
        static let sidebarHeaderTopInset: CGFloat = Primitive.Space.md
        static let sidebarHeaderToPrimaryGap: CGFloat = Primitive.Space.sm
        static let sidebarPrimaryToListGap: CGFloat = 14
        static let sidebarPrimaryActionHeight: CGFloat = 32
        static let sidebarInset: CGFloat = Primitive.Space.md
        static let sidebarTopSectionGap: CGFloat = Primitive.Space.sm
        static let sidebarRowSpacing: CGFloat = Primitive.Space.xs
        static let sidebarRowPaddingY: CGFloat = 7
        static let sidebarRailWidth: CGFloat = 56
        static let sidebarRailInset: CGFloat = Primitive.Space.md
        static let sidebarRailItemSize: CGFloat = 32
        static let topShelfControlHeight: CGFloat = 32
        static let topShelfTabHorizontalPadding: CGFloat = 12
        static let topShelfUtilitySpacing: CGFloat = Primitive.Space.xs
    }

    enum Typography {
        static let sidebarWordmark = Font.system(size: 24, weight: .light, design: .serif)
        static let primaryButton = Font.system(size: 12.5, weight: .semibold)
        static let iconButton = Font.system(size: 11, weight: .semibold)
        static let rowTitle = Font.system(size: 12.5, weight: .semibold)
        static let rowSubtitle = Font.system(size: 10)
    }

    enum Terminal {
        static let cornerRadius: CGFloat = Primitive.Radius.panel
        static let backgroundHex = Primitive.Color.white.hexString()
        static let foregroundHex = (NSColor(hex: "#111315") ?? Primitive.Color.ink).hexString()
        static let cursorHex = Primitive.Color.forest.hexString()
        static let cursorTextHex = Primitive.Color.white.hexString()
        static let selectionBackgroundHex = Primitive.Color.selectionTint.hexString()
        static let selectionForegroundHex = (NSColor(hex: "#111315") ?? Primitive.Color.ink).hexString()
        static let inlineConfig = """
        background = \(backgroundHex)
        background-opacity = 1.0
        foreground = \(foregroundHex)
        cursor-color = \(cursorHex)
        cursor-text = \(cursorTextHex)
        selection-background = \(selectionBackgroundHex)
        selection-foreground = \(selectionForegroundHex)
        palette = 0=#24292F
        palette = 1=#CF222E
        palette = 2=#1A7F37
        palette = 3=#9A6700
        palette = 4=#0969DA
        palette = 5=#8250DF
        palette = 6=#1B7C83
        palette = 7=#57606A
        palette = 8=#6E7781
        palette = 9=#A40E26
        palette = 10=#2DA44E
        palette = 11=#BF8700
        palette = 12=#218BFF
        palette = 13=#A475F9
        palette = 14=#3192AA
        palette = 15=#111315
        """
    }

    enum LegacyAccent {
        static func nsColor(for colorScheme: ColorScheme) -> NSColor {
            switch colorScheme {
            case .dark:
                return NSColor(srgbRed: 0, green: 145.0 / 255.0, blue: 1.0, alpha: 1.0)
            default:
                return NSColor(srgbRed: 0, green: 136.0 / 255.0, blue: 1.0, alpha: 1.0)
            }
        }

        static func nsColor(for appAppearance: NSAppearance?) -> NSColor {
            let bestMatch = appAppearance?.bestMatch(from: [.darkAqua, .aqua])
            let scheme: ColorScheme = (bestMatch == .darkAqua) ? .dark : .light
            return nsColor(for: scheme)
        }

        static func dynamicNSColor() -> NSColor {
            NSColor(name: nil) { appearance in
                nsColor(for: appearance)
            }
        }

        static func color() -> SwiftUI.Color {
            SwiftUI.Color(nsColor: dynamicNSColor())
        }
    }
}

extension NSColor {
    var dsColor: Color {
        Color(nsColor: self)
    }
}
