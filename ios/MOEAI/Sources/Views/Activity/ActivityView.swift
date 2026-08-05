import SwiftUI

struct ActivityView: View {
  @EnvironmentObject private var model: AppModel
  @State private var filter: ActivityFilter = .all

  private var events: [AuditEvent] {
    switch filter {
    case .all:
      return model.status.safeAudit
    case .errors:
      return model.status.safeAudit.filter { $0.error != nil || ($0.type ?? "").contains("FAILED") }
    case .trades:
      return model.status.safeAudit.filter {
        let type = ($0.type ?? "").uppercased()
        return type.contains("TRADE") || type.contains("POSITION") || type.contains("ALERT")
      }
    }
  }

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 12) {
        Picker("الفلتر", selection: $filter) {
          ForEach(ActivityFilter.allCases) { item in
            Text(item.title).tag(item)
          }
        }
        .pickerStyle(.segmented)

        if events.isEmpty {
          EmptyStateView(
            icon: "clock.arrow.circlepath",
            title: "لا يوجد نشاط",
            message: "ستظهر أحداث الجلسة والإشارات والأوامر هنا."
          )
        } else {
          ForEach(events) { event in
            ActivityEventCard(event: event)
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("النشاط")
    .refreshable { await model.refreshStatus() }
  }
}

private enum ActivityFilter: String, CaseIterable, Identifiable {
  case all
  case trades
  case errors

  var id: String { rawValue }

  var title: String {
    switch self {
    case .all: return "الكل"
    case .trades: return "التداول"
    case .errors: return "الأخطاء"
    }
  }
}

private struct ActivityEventCard: View {
  let event: AuditEvent

  private var hasError: Bool {
    event.error != nil || (event.type ?? "").uppercased().contains("FAILED")
  }

  var body: some View {
    GlassCard {
      HStack(alignment: .top, spacing: 12) {
        Circle()
          .fill(hasError ? MOETheme.negative : MOETheme.accent)
          .frame(width: 10, height: 10)
          .padding(.top, 6)

        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .firstTextBaseline) {
            Text((event.type ?? "EVENT").replacingOccurrences(of: "_", with: " "))
              .font(.subheadline.bold())
            Spacer()
            Text(formatDate(event.createdAt))
              .font(.caption2)
              .foregroundStyle(MOETheme.muted)
          }

          HStack(spacing: 8) {
            if let symbol = event.symbol {
              Text(symbol)
                .font(.caption.bold())
                .foregroundStyle(MOETheme.accent)
            }
            if let account = event.accountType {
              Text(account)
                .font(.caption2.bold())
                .foregroundStyle(MOETheme.muted)
            }
          }

          if let message = event.error ?? event.reason {
            Text(message)
              .font(.caption)
              .foregroundStyle(hasError ? MOETheme.negative : MOETheme.muted)
          }
        }
      }
    }
  }
}
