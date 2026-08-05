import SwiftUI

struct GlassCard<Content: View>: View {
  private let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .padding(16)
      .background(
        MOETheme.surface.opacity(0.96),
        in: RoundedRectangle(cornerRadius: 22, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .stroke(Color.white.opacity(0.08))
      }
      .shadow(color: .black.opacity(0.22), radius: 18, y: 10)
  }
}

struct MetricTile: View {
  let title: String
  let value: String
  let icon: String
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      Image(systemName: icon)
        .foregroundStyle(tint)
      Text(title)
        .font(.caption)
        .foregroundStyle(MOETheme.muted)
      Text(value)
        .font(.headline.bold())
        .lineLimit(1)
        .minimumScaleFactor(0.65)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(MOETheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 17))
  }
}

struct StatusPill: View {
  let title: String
  let isPositive: Bool

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(isPositive ? MOETheme.positive : MOETheme.negative)
        .frame(width: 8, height: 8)
      Text(title)
        .font(.caption.bold())
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(
      (isPositive ? MOETheme.positive : MOETheme.negative).opacity(0.13),
      in: Capsule()
    )
  }
}

struct EmptyStateView: View {
  let icon: String
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 13) {
      Image(systemName: icon)
        .font(.system(size: 42))
        .foregroundStyle(MOETheme.accent)
      Text(title)
        .font(.headline)
      Text(message)
        .font(.subheadline)
        .foregroundStyle(MOETheme.muted)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(35)
  }
}

struct SectionTitle: View {
  let title: String
  var subtitle: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title)
        .font(.headline)
      Spacer()
      if let subtitle {
        Text(subtitle)
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
      }
    }
  }
}

struct InlineErrorView: View {
  let message: String

  var body: some View {
    Label(message, systemImage: "exclamationmark.triangle.fill")
      .font(.footnote)
      .foregroundStyle(MOETheme.negative)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(MOETheme.negative.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
  }
}

struct LoadingButtonLabel: View {
  let title: String
  let icon: String
  let loading: Bool

  var body: some View {
    HStack(spacing: 9) {
      if loading {
        ProgressView()
          .tint(.white)
      } else {
        Image(systemName: icon)
      }
      Text(title)
        .fontWeight(.bold)
    }
    .frame(maxWidth: .infinity)
  }
}
