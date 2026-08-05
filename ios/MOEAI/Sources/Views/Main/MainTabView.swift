import SwiftUI

struct MainTabView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var network: NetworkMonitor
  @EnvironmentObject private var notifications: NotificationManager

  var body: some View {
    TabView(selection: $notifications.selectedTab) {
      NavigationStack { DashboardView() }
        .tabItem { Label("الرئيسية", systemImage: "square.grid.2x2.fill") }
        .tag(MainTab.dashboard)

      NavigationStack { ScannerView() }
        .tabItem { Label("الماسح", systemImage: "waveform.path.ecg") }
        .tag(MainTab.scanner)

      NavigationStack { PositionsView() }
        .tabItem { Label("المراكز", systemImage: "chart.line.uptrend.xyaxis") }
        .tag(MainTab.positions)

      NavigationStack { ActivityView() }
        .tabItem { Label("النشاط", systemImage: "bolt.horizontal.circle.fill") }
        .tag(MainTab.activity)

      NavigationStack { SettingsView() }
        .tabItem { Label("الإعدادات", systemImage: "gearshape.fill") }
        .tag(MainTab.settings)
    }
    .tint(MOETheme.accent)
    .safeAreaInset(edge: .top, spacing: 0) {
      if !network.snapshot.isConnected {
        OfflineBanner(snapshot: network.snapshot)
      }
    }
    .task {
      if model.lastRefresh == nil, network.snapshot.isConnected {
        await model.loadAll()
      }

      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(15))
        guard !Task.isCancelled else { break }
        guard network.snapshot.isConnected else { continue }
        await model.refreshStatus(silently: true)
      }
    }
    .onChange(of: network.snapshot.isConnected) { wasConnected, isConnected in
      guard isConnected, !wasConnected else { return }
      Task {
        if model.lastRefresh == nil {
          await model.loadAll()
        } else {
          await model.refreshStatus(silently: true)
        }
      }
    }
    .onChange(of: notifications.lastOpenedNotificationAt) { _, openedAt in
      guard openedAt != nil, network.snapshot.isConnected else { return }
      Task {
        await model.refreshStatus(silently: true)
      }
    }
    .alert(
      "MOE-AI",
      isPresented: Binding(
        get: { model.errorMessage != nil },
        set: { if !$0 { model.errorMessage = nil } }
      )
    ) {
      Button("حسنًا") { model.errorMessage = nil }
    } message: {
      Text(model.errorMessage ?? "")
    }
  }
}

private struct OfflineBanner: View {
  let snapshot: NetworkSnapshot

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "wifi.slash")
        .font(.headline)

      VStack(alignment: .leading, spacing: 2) {
        Text("لا يوجد اتصال بالإنترنت")
          .font(.subheadline.weight(.semibold))
        Text("تم إيقاف التحديث التلقائي وسيُستأنف عند عودة الاتصال")
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
      }

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(MOETheme.warning.opacity(0.18))
    .overlay(alignment: .bottom) {
      Divider().overlay(MOETheme.warning.opacity(0.5))
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("لا يوجد اتصال بالإنترنت. تم إيقاف التحديث التلقائي مؤقتًا.")
  }
}
