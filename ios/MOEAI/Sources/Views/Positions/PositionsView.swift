import SwiftUI

struct PositionsView: View {
  @EnvironmentObject private var model: AppModel
  @State private var closingPosition: TradingPosition?

  var body: some View {
    ScrollView {
      VStack(spacing: 13) {
        actionBar

        if model.status.safePositions.isEmpty {
          EmptyStateView(
            icon: "briefcase",
            title: "لا توجد مراكز مفتوحة",
            message: "ستظهر مراكز TradingView النشطة هنا بعد تأكيدها من الخادم."
          )
        } else {
          ForEach(model.status.safePositions) { position in
            PositionCard(
              position: position,
              isClosing: model.pendingAction == "close-\(position.symbol ?? "")"
            ) {
              closingPosition = position
            }
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("المراكز")
    .refreshable { await model.refreshStatus() }
    .confirmationDialog(
      "تأكيد إغلاق المركز",
      isPresented: Binding(
        get: { closingPosition != nil },
        set: { if !$0 { closingPosition = nil } }
      ),
      titleVisibility: .visible
    ) {
      if let symbol = closingPosition?.symbol {
        Button("إغلاق \(symbol) فورًا", role: .destructive) {
          closingPosition = nil
          Task { await model.closePosition(symbol: symbol) }
        }
      }
      Button("إلغاء", role: .cancel) { closingPosition = nil }
    } message: {
      Text("سيُرسل أمر إغلاق مؤكد إلى Cloudflare Worker. لا يمكن التراجع بعد قبول الوسيط.")
    }
  }

  private var actionBar: some View {
    GlassCard {
      HStack(spacing: 10) {
        Button {
          Task { await model.refreshPositions() }
        } label: {
          Label("تحديث الوسيط", systemImage: "arrow.clockwise")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(MOETheme.accent)
        .disabled(model.pendingAction != nil)

        Button {
          Task { await model.refreshPositions(repair: true) }
        } label: {
          Label("إصلاح الحماية", systemImage: "shield.lefthalf.filled")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(MOETheme.warning)
        .disabled(model.pendingAction != nil)
      }
      .font(.caption.bold())
    }
  }
}

private struct PositionCard: View {
  let position: TradingPosition
  let isClosing: Bool
  let onClose: () -> Void

  var body: some View {
    GlassCard {
      VStack(spacing: 13) {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text(position.symbol ?? "—")
              .font(.title2.weight(.black))
            Text(position.indicator ?? position.accountType ?? "—")
              .font(.caption)
              .foregroundStyle(MOETheme.muted)
          }
          Spacer()
          Text(position.status ?? (position.positionOpen == true ? "OPEN" : "—"))
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(MOETheme.accent.opacity(0.18), in: Capsule())
        }

        HStack {
          MetricTile(
            title: "الكمية",
            value: formatNumber(position.quantity),
            icon: "number",
            tint: MOETheme.accent
          )
          MetricTile(
            title: "آخر سعر",
            value: formatCurrency(position.lastPrice),
            icon: "dollarsign",
            tint: MOETheme.positive
          )
        }

        HStack {
          MetricTile(
            title: "الدخول",
            value: formatCurrency(position.entryPrice ?? position.plannedEntryPrice),
            icon: "arrow.down.circle",
            tint: MOETheme.accent
          )
          MetricTile(
            title: "Stop",
            value: formatCurrency(position.currentStopPrice ?? position.initialStopPrice),
            icon: "shield.fill",
            tint: MOETheme.negative
          )
        }

        HStack {
          Text("الهدف: \(formatCurrency(position.takeProfitPrice))")
            .font(.caption)
            .foregroundStyle(MOETheme.muted)
          Spacer()
          Text("P&L: \(formatCurrency(position.unrealizedPnl))")
            .font(.caption.bold())
            .foregroundStyle(MOETheme.tone(for: position.unrealizedPnl))
        }

        if let error = position.error {
          InlineErrorView(message: error)
        }

        Button(role: .destructive, action: onClose) {
          LoadingButtonLabel(
            title: isClosing ? "جارٍ الإغلاق…" : "إغلاق المركز فورًا",
            icon: "xmark.octagon.fill",
            loading: isClosing
          )
          .padding(.vertical, 11)
        }
        .buttonStyle(.borderedProminent)
        .tint(MOETheme.negative)
        .disabled(isClosing)
      }
    }
  }
}
