import SwiftUI

struct ArchiveView: View {
  @EnvironmentObject private var model: AppModel
  @State private var search = ""

  private var trades: [ArchivedTrade] {
    let normalized = search.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return model.status.safeArchive }
    return model.status.safeArchive.filter {
      ($0.symbol ?? "").localizedCaseInsensitiveContains(normalized)
        || ($0.exitReason ?? "").localizedCaseInsensitiveContains(normalized)
    }
  }

  private var totalPnl: Double {
    trades.reduce(0) { $0 + ($1.profitLoss ?? 0) }
  }

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 12) {
        GlassCard {
          VStack(spacing: 12) {
            HStack(spacing: 10) {
              Image(systemName: "magnifyingglass")
                .foregroundStyle(MOETheme.muted)
              TextField("بحث بالرمز أو سبب الإغلاق", text: $search)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            }
            .padding(12)
            .background(MOETheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 13))

            HStack {
              VStack(alignment: .leading, spacing: 3) {
                Text("الصفقات")
                  .font(.caption)
                  .foregroundStyle(MOETheme.muted)
                Text("\(trades.count)")
                  .font(.title3.bold())
              }
              Spacer()
              VStack(alignment: .trailing, spacing: 3) {
                Text("الإجمالي")
                  .font(.caption)
                  .foregroundStyle(MOETheme.muted)
                Text(formatCurrency(totalPnl))
                  .font(.title3.bold())
                  .foregroundStyle(MOETheme.tone(for: totalPnl))
              }
            }
          }
        }

        if trades.isEmpty {
          EmptyStateView(
            icon: "archivebox",
            title: "الأرشيف فارغ",
            message: "ستظهر الصفقات المغلقة ونتائجها هنا."
          )
        } else {
          ForEach(trades) { trade in
            ArchivedTradeCard(trade: trade)
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الأرشيف")
    .refreshable { await model.refreshStatus() }
  }
}

private struct ArchivedTradeCard: View {
  let trade: ArchivedTrade

  var body: some View {
    GlassCard {
      VStack(spacing: 10) {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text(trade.symbol ?? "—")
              .font(.headline)
            Text(trade.accountType ?? trade.indicator ?? "—")
              .font(.caption2)
              .foregroundStyle(MOETheme.muted)
          }
          Spacer()
          Text(formatCurrency(trade.profitLoss))
            .font(.headline)
            .foregroundStyle(MOETheme.tone(for: trade.profitLoss))
        }

        Divider().overlay(Color.white.opacity(0.08))

        HStack {
          Text("دخول \(formatCurrency(trade.entryPrice))")
          Spacer()
          Text("خروج \(formatCurrency(trade.exitPrice))")
        }
        .font(.caption)
        .foregroundStyle(MOETheme.muted)

        HStack {
          Text((trade.exitReason ?? "—").replacingOccurrences(of: "_", with: " "))
          Spacer()
          Text(formatDate(trade.closedAt))
        }
        .font(.caption2)
        .foregroundStyle(MOETheme.muted)
      }
    }
  }
}
