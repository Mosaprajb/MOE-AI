import SwiftUI

struct OrdersView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    ScrollView {
      VStack(spacing: 13) {
        if model.status.safePositions.isEmpty {
          EmptyStateView(
            icon: "list.bullet.rectangle",
            title: "لا توجد أوامر نشطة",
            message: "تظهر أوامر الدخول والحماية والإغلاق المرتبطة بالمراكز هنا."
          )
        } else {
          ForEach(model.status.safePositions) { position in
            GlassCard {
              VStack(alignment: .leading, spacing: 12) {
                HStack {
                  Text(position.symbol ?? "—")
                    .font(.title3.weight(.black))
                  Spacer()
                  Text(position.accountType ?? "—")
                    .font(.caption.bold())
                    .foregroundStyle(MOETheme.muted)
                }

                OrderIdentifierRow(title: "Entry", identifier: position.orderIds?.entry)
                OrderIdentifierRow(title: "Take Profit", identifier: position.orderIds?.takeProfit)
                OrderIdentifierRow(
                  title: "Stop Loss",
                  identifier: position.orderIds?.currentStop ?? position.orderIds?.stopLoss
                )
                OrderIdentifierRow(title: "Combo", identifier: position.orderIds?.combo)
                OrderIdentifierRow(title: "Emergency Close", identifier: position.orderIds?.close)
              }
            }
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الأوامر")
    .refreshable { await model.refreshStatus() }
  }
}

private struct OrderIdentifierRow: View {
  let title: String
  let identifier: String?

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: identifier == nil ? "circle.dashed" : "checkmark.circle.fill")
        .foregroundStyle(identifier == nil ? MOETheme.muted : MOETheme.positive)
      Text(title)
        .font(.subheadline)
      Spacer()
      Text(identifier ?? "—")
        .font(.caption.monospaced())
        .foregroundStyle(MOETheme.muted)
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(maxWidth: 180, alignment: .trailing)
    }
  }
}
