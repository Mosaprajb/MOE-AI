import SwiftUI

struct MainTabView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    TabView {
      NavigationStack { DashboardView() }
        .tabItem { Label("الرئيسية", systemImage: "square.grid.2x2.fill") }

      NavigationStack { ScannerView() }
        .tabItem { Label("الماسح", systemImage: "waveform.path.ecg") }

      NavigationStack { PositionsView() }
        .tabItem { Label("المراكز", systemImage: "chart.line.uptrend.xyaxis") }

      NavigationStack { ActivityView() }
        .tabItem { Label("النشاط", systemImage: "bolt.horizontal.circle.fill") }

      NavigationStack { SettingsView() }
        .tabItem { Label("الإعدادات", systemImage: "gearshape.fill") }
    }
    .tint(MOETheme.accent)
    .task {
      if model.lastRefresh == nil {
        await model.loadAll()
      }

      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(15))
        guard !Task.isCancelled else { break }
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
