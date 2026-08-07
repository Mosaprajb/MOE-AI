import Charts
import SwiftUI

struct PnLView: View {
  @EnvironmentObject private var model: AppModel

  private var points: [PnLPoint] {
    var cumulative = 0.0
    return model.status.safeArchive
      .compactMap { trade -> (ArchivedTrade, Date)? in
        guard let date = parseISO8601Date(trade.closedAt) else { return nil }
        return (trade, date)
      }
      .sorted { $0.1 < $1.1 }
      .map { trade, date in
        cumulative += trade.profitLoss ?? 0
        return PnLPoint(date: date, value: cumulative)
      }
  }

  private var winRate: Double? {
    let trades = model.status.safeArchive.filter { $0.profitLoss != nil }
    guard !trades.isEmpty else { return nil }
    let wins = trades.filter { ($0.profitLoss ?? 0) > 0 }.count
    return Double(wins) / Double(trades.count) * 100
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        GlassCard {
          VStack(alignment: .leading, spacing: 7) {
            Text("P&L اليوم")
              .foregroundStyle(MOETheme.muted)
            Text(formatCurrency(model.activeAccount.dayPnl))
              .font(.system(size: 40, weight: .black, design: .rounded))
              .foregroundStyle(MOETheme.tone(for: model.activeAccount.dayPnl))
            Text(formatPercent(model.activeAccount.dayPnlPercent))
              .font(.subheadline.bold())
              .foregroundStyle(MOETheme.tone(for: model.activeAccount.dayPnlPercent))
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "الأداء التراكمي", subtitle: "\(points.count) صفقة")

            if points.isEmpty {
              EmptyStateView(
                icon: "chart.xyaxis.line",
                title: "لا توجد بيانات كافية",
                message: "سيظهر المخطط بعد إغلاق أول صفقة."
              )
              .frame(height: 230)
            } else {
              Chart(points) { point in
                AreaMark(
                  x: .value("Date", point.date),
                  y: .value("P&L", point.value)
                )
                .foregroundStyle(
                  LinearGradient(
                    colors: [MOETheme.accent.opacity(0.38), MOETheme.violet.opacity(0.08)],
                    startPoint: .top,
                    endPoint: .bottom
                  )
                )

                LineMark(
                  x: .value("Date", point.date),
                  y: .value("P&L", point.value)
                )
                .foregroundStyle(MOETheme.accent)
                .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
              }
              .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                  AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                  AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    .foregroundStyle(MOETheme.muted)
                }
              }
              .chartYAxis {
                AxisMarks { value in
                  AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                  AxisValueLabel {
                    if let amount = value.as(Double.self) {
                      Text(formatCurrency(amount))
                    }
                  }
                  .foregroundStyle(MOETheme.muted)
                }
              }
              .frame(height: 250)
            }
          }
        }

        HStack {
          MetricTile(
            title: "محقق",
            value: formatCurrency(model.activeAccount.realizedPnl),
            icon: "checkmark.circle",
            tint: MOETheme.tone(for: model.activeAccount.realizedPnl)
          )
          MetricTile(
            title: "مفتوح",
            value: formatCurrency(model.activeAccount.unrealizedPnl),
            icon: "clock",
            tint: MOETheme.tone(for: model.activeAccount.unrealizedPnl)
          )
        }

        HStack {
          MetricTile(
            title: "نسبة النجاح",
            value: winRate.map { String(format: "%.1f%%", $0) } ?? "—",
            icon: "target",
            tint: MOETheme.violet
          )
          MetricTile(
            title: "عدد الصفقات",
            value: "\(model.status.safeArchive.count)",
            icon: "number.circle",
            tint: MOETheme.accent
          )
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("P&L")
    .refreshable { await model.refreshStatus() }
  }
}

private struct PnLPoint: Identifiable {
  let date: Date
  let value: Double

  var id: Date { date }
}
