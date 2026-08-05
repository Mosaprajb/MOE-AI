import SwiftUI

enum MOETheme {
  static let background = Color(red: 0.025, green: 0.03, blue: 0.09)
  static let surface = Color(red: 0.07, green: 0.085, blue: 0.17)
  static let surfaceElevated = Color(red: 0.105, green: 0.125, blue: 0.24)
  static let accent = Color(red: 0.40, green: 0.48, blue: 1.0)
  static let violet = Color(red: 0.70, green: 0.38, blue: 1.0)
  static let positive = Color(red: 0.25, green: 0.90, blue: 0.65)
  static let negative = Color(red: 1.0, green: 0.40, blue: 0.55)
  static let warning = Color(red: 1.0, green: 0.78, blue: 0.35)
  static let muted = Color(red: 0.66, green: 0.71, blue: 0.84)

  static let gradient = LinearGradient(
    colors: [accent, violet],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )

  static func tone(for value: Double?) -> Color {
    (value ?? 0) >= 0 ? positive : negative
  }
}

struct AppBackground: View {
  var body: some View {
    ZStack {
      MOETheme.background.ignoresSafeArea()
      RadialGradient(
        colors: [MOETheme.accent.opacity(0.22), .clear],
        center: .topLeading,
        startRadius: 10,
        endRadius: 430
      )
      .ignoresSafeArea()
      RadialGradient(
        colors: [MOETheme.violet.opacity(0.17), .clear],
        center: .topTrailing,
        startRadius: 20,
        endRadius: 390
      )
      .ignoresSafeArea()
    }
  }
}
