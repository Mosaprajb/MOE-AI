import SwiftUI

struct DashboardView: View {
  @EnvironmentObject private var model: AppModel
  @State private var pulse = false

  private var account: BrokerAccount { model.activeAccount }
  private var runtime: RuntimeState? { model.status.runtime }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        header
        connectionCard
        accountPicker
        accountCard
        pnlMetrics
        safetyCard
        shortcuts

        if let lastRefresh = model.lastRefresh {
          Text("آخر تحديث: \(lastRefresh.formatted(date: .omitted, time: .standard))")
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
            .padding(.top, 4)
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationBarHidden(true)
    .refreshable { await model.loadAll() }
    .onAppear {
      withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
        pulse = true
      }
    }
  }

  private var header: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text("MOE-AI")
          .font(.largeTitle.black())
        Text("Trading Control Center")
          .foregroundStyle(MOETheme.muted)
      }
      Spacer()
      Button {
        Task { await model.loadAll() }
      } label: {
        Group {
          if model.isLoading || model.isRefreshingStatus {
            ProgressView()
              .tint(.white)
          } else {
            Image(systemName: "arrow.clockwise")
              .font(.title3.bold())
          }
        }
        .frame(width: 44, height: 44)
        .background(MOETheme.surfaceElevated, in: Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("تحديث البيانات")
    }
  }

  private var connectionCard: some View {
    GlassCard {
      HStack(spacing: 12) {
        Circle()
          .fill(model.status.tradingViewConnected == true ? MOETheme.positive : MOETheme.warning)
          .frame(width: 13, height: 13)
          .scaleEffect(pulse ? 1.22 : 0.9)

        VStack(alignment: .leading, spacing: 4) {
          Text(
            model.status.tradingViewConnected == true
              ? "TradingView متصل"
              : "بانتظار إشارة TradingView"
          )
          .fontWeight(.bold)
          Text(runtime?.receptionEnabled == true ? "استقبال الإشارات مفعل" : "استقبال الإشارات متوقف")
            .font(.caption)
            .foregroundStyle(MOETheme.muted)
        }

        Spacer()

        VStack(alignment: .trailing, spacing: 5) {
          Text(model.status.marketClock?.phase ?? model.status.mode ?? "—")
            .font(.caption.bold())
          Text(model.status.executionSource ?? "—")
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }
      }
    }
  }

  private var accountPicker: some View {
    Picker("الحساب", selection: $model.selectedAccount) {
      Text("Demo / Paper").tag("DEMO")
      Text("Live").tag("LIVE")
    }
    .pickerStyle(.segmented)
  }

  private var accountCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 13) {
        HStack {
          VStack(alignment: .leading, spacing: 4) {
            Text("قيمة الحساب")
              .foregroundStyle(MOETheme.muted)
            Text(formatCurrency(account.balance))
              .font(.system(size: 38, weight: .black, design: .rounded))
              .minimumScaleFactor(0.7)
          }
          Spacer()
          StatusPill(
            title: account.connected == true ? "متصل" : (account.locked == true ? "مقفل" : "غير متصل"),
            isPositive: account.connected == true
          )
        }

        HStack {
          MetricTile(
            title: "القوة الشرائية",
            value: formatCurrency(account.buyingPower),
            icon: "creditcard.fill",
            tint: MOETheme.accent
          )
          MetricTile(
            title: "المراكز",
            value: "\(account.openPositions ?? model.status.safePositions.count)",
            icon: "briefcase.fill",
            tint: MOETheme.violet
          )
        }
      }
    }
  }

  private var pnlMetrics: some View {
    HStack(spacing: 12) {
      MetricTile(
        title: "ربح اليوم",
        value: formatCurrency(account.dayPnl),
        icon: "dollarsign.circle.fill",
        tint: MOETheme.tone(for: account.dayPnl)
      )
      MetricTile(
        title: "غير محقق",
        value: formatCurrency(account.unrealizedPnl),
        icon: "chart.xyaxis.line",
        tint: MOETheme.tone(for: account.unrealizedPnl)
      )
    }
  }

  private var safetyCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 12) {
        SectionTitle(title: "حالة الأمان")
        DashboardSecurityRow(
          title: "Kill Switch",
          detail: runtime?.killSwitchActive == true ? "مفعّل" : "غير مفعّل",
          healthy: runtime?.killSwitchActive != true
        )
        DashboardSecurityRow(
          title: "استقبال الإشارات",
          detail: runtime?.receptionEnabled == true ? "ON" : "OFF",
          healthy: runtime?.receptionEnabled == true
        )
        DashboardSecurityRow(
          title: "اتصال الوسيط",
          detail: account.connected == true ? "متصل" : "غير متصل",
          healthy: account.connected == true
        )
        DashboardSecurityRow(
          title: "الحساب الحقيقي",
          detail: model.isLiveSelected ? "محدد" : "غير مستخدم",
          healthy: !model.isLiveSelected || account.connected == true
        )
      }
    }
  }

  private var shortcuts: some View {
    LazyVGrid(
      columns: [GridItem(.flexible()), GridItem(.flexible())],
      spacing: 12
    ) {
      NavigationLink { PnLView() } label: {
        DashboardShortcutCard(title: "P&L", subtitle: "الربح والخسارة", icon: "chart.area.fill")
      }
      NavigationLink { OrdersView() } label: {
        DashboardShortcutCard(title: "Orders", subtitle: "الأوامر الحالية", icon: "list.bullet.rectangle")
      }
      NavigationLink { ArchiveView() } label: {
        DashboardShortcutCard(title: "Archive", subtitle: "الصفقات المغلقة", icon: "archivebox.fill")
      }
      NavigationLink { ActivityView() } label: {
        DashboardShortcutCard(title: "Activity", subtitle: "سجل النظام", icon: "clock.arrow.circlepath")
      }
    }
    .buttonStyle(.plain)
  }
}

private struct DashboardSecurityRow: View {
  let title: String
  let detail: String
  let healthy: Bool

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      Circle()
        .fill(healthy ? MOETheme.positive : MOETheme.negative)
        .frame(width: 9, height: 9)
      Text(detail)
        .font(.caption.bold())
        .foregroundStyle(MOETheme.muted)
    }
  }
}

private struct DashboardShortcutCard: View {
  let title: String
  let subtitle: String
  let icon: String

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 12) {
        Image(systemName: icon)
          .font(.title2)
          .foregroundStyle(MOETheme.accent)
        Text(title)
          .font(.headline)
        Text(subtitle)
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
