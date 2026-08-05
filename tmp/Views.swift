import Charts
import Foundation
import SwiftUI

// MARK: - Theme

enum MOETheme {
  static let background = Color(red: 0.025, green: 0.03, blue: 0.09)
  static let surface = Color(red: 0.07, green: 0.085, blue: 0.17)
  static let surface2 = Color(red: 0.105, green: 0.125, blue: 0.24)
  static let accent = Color(red: 0.40, green: 0.48, blue: 1.0)
  static let violet = Color(red: 0.70, green: 0.38, blue: 1.0)
  static let green = Color(red: 0.25, green: 0.90, blue: 0.65)
  static let red = Color(red: 1.0, green: 0.40, blue: 0.55)
  static let amber = Color(red: 1.0, green: 0.78, blue: 0.35)
  static let muted = Color(red: 0.66, green: 0.71, blue: 0.84)

  static let gradient = LinearGradient(
    colors: [accent, violet],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )
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
      .overlay(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .stroke(Color.white.opacity(0.08))
      )
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
        .minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(MOETheme.surface2, in: RoundedRectangle(cornerRadius: 17))
  }
}

struct SecurityRow: View {
  let title: String
  let active: Bool
  let goodWhenActive: Bool

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      Circle()
        .fill(active == goodWhenActive ? MOETheme.green : MOETheme.red)
        .frame(width: 10, height: 10)
      Text(active ? "ON" : "OFF")
        .font(.caption.bold())
        .foregroundStyle(MOETheme.muted)
    }
  }
}

struct ShortcutCard: View {
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

struct EmptyState: View {
  let icon: String
  let title: String
  let copy: String

  var body: some View {
    VStack(spacing: 13) {
      Image(systemName: icon)
        .font(.system(size: 44))
        .foregroundStyle(MOETheme.accent)
      Text(title)
        .font(.headline)
      Text(copy)
        .font(.subheadline)
        .foregroundStyle(MOETheme.muted)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(35)
  }
}

// MARK: - Root and Authentication

struct RootView: View {
  @EnvironmentObject private var session: SessionStore

  var body: some View {
    ZStack {
      AppBackground()
      if session.isAuthenticated {
        MainTabView()
      } else {
        AuthenticationView()
      }
    }
  }
}

struct AuthenticationView: View {
  @EnvironmentObject private var session: SessionStore
  @State private var pin = ""
  @State private var showServerSettings = false

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        Spacer(minLength: 60)

        ZStack {
          Circle()
            .fill(MOETheme.gradient)
            .frame(width: 92, height: 92)
            .blur(radius: 20)
            .opacity(0.55)
          Image(systemName: "waveform.path.ecg.rectangle.fill")
            .font(.system(size: 48))
            .foregroundStyle(.white)
        }

        VStack(spacing: 7) {
          Text("MOE-AI")
            .font(.system(size: 36, weight: .black, design: .rounded))
          Text("Native Trading Control")
            .foregroundStyle(MOETheme.muted)
        }

        GlassCard {
          VStack(spacing: 15) {
            SecureField("الرمز السري", text: $pin)
              .keyboardType(.numberPad)
              .textContentType(.password)
              .font(.title3.bold())
              .multilineTextAlignment(.center)
              .padding()
              .background(MOETheme.surface2, in: RoundedRectangle(cornerRadius: 15))

            Button {
              Task { await session.login(pin: pin) }
            } label: {
              Label(
                session.isBusy ? "جارٍ التحقق…" : "فتح التطبيق",
                systemImage: "lock.open.fill"
              )
              .frame(maxWidth: .infinity)
              .padding(.vertical, 15)
              .fontWeight(.bold)
            }
            .buttonStyle(.plain)
            .background(MOETheme.gradient, in: RoundedRectangle(cornerRadius: 15))
            .disabled(pin.isEmpty || session.isBusy)

            if session.faceIDAvailable && session.hasSavedPIN {
              Button {
                Task { await session.unlockWithFaceID() }
              } label: {
                Label("فتح باستخدام Face ID", systemImage: "faceid")
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 13)
              }
              .buttonStyle(.plain)
              .foregroundStyle(MOETheme.accent)
            }

            DisclosureGroup("إعدادات الخادم", isExpanded: $showServerSettings) {
              TextField("Cloudflare Worker URL", text: $session.baseURLText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(.top, 10)
            }
            .font(.subheadline)
            .foregroundStyle(MOETheme.muted)

            if let error = session.errorMessage {
              Text(error)
                .font(.footnote)
                .foregroundStyle(MOETheme.red)
                .multilineTextAlignment(.center)
            }
          }
        }
        .padding(.horizontal, 22)

        Text("اتصال أصلي مباشر بخادم MOE-AI — لا يستخدم Safari أو WebView")
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
          .multilineTextAlignment(.center)
          .padding(.horizontal)

        Spacer(minLength: 30)
      }
      .foregroundStyle(.white)
    }
  }
}

// MARK: - Tabs

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

// MARK: - Dashboard

struct DashboardView: View {
  @EnvironmentObject private var model: AppModel
  @State private var pulse = false

  private var account: BrokerAccount { model.activeAccount }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
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
            if model.loading {
              ProgressView()
                .tint(.white)
                .padding(12)
            } else {
              Image(systemName: "arrow.clockwise")
                .font(.title3.bold())
                .padding(12)
            }
          }
          .background(MOETheme.surface2, in: Circle())
        }

        GlassCard {
          HStack {
            Circle()
              .fill(model.status.tradingViewConnected == true ? MOETheme.green : MOETheme.red)
              .frame(width: 13, height: 13)
              .scaleEffect(pulse ? 1.25 : 0.9)
            VStack(alignment: .leading) {
              Text(
                model.status.tradingViewConnected == true
                  ? "TradingView متصل"
                  : "بانتظار إشارة TradingView"
              )
              .fontWeight(.bold)
              Text(
                model.status.runtime?.receptionEnabled == true
                  ? "استقبال الإشارات مفعل"
                  : "استقبال الإشارات متوقف"
              )
              .font(.caption)
              .foregroundStyle(MOETheme.muted)
            }
            Spacer()
            Text(model.status.marketClock?.phase ?? "—")
              .font(.caption.bold())
              .padding(.horizontal, 10)
              .padding(.vertical, 7)
              .background(MOETheme.accent.opacity(0.18), in: Capsule())
          }
        }

        Picker("الحساب", selection: $model.selectedAccount) {
          Text("Demo / Paper").tag("DEMO")
          Text("Live").tag("LIVE")
        }
        .pickerStyle(.segmented)

        GlassCard {
          VStack(alignment: .leading, spacing: 13) {
            Text("قيمة الحساب")
              .foregroundStyle(MOETheme.muted)
            Text(currency(account.balance))
              .font(.system(size: 38, weight: .black, design: .rounded))
            HStack {
              MetricTile(
                title: "القوة الشرائية",
                value: currency(account.buyingPower),
                icon: "creditcard.fill",
                tint: MOETheme.accent
              )
              MetricTile(
                title: "المراكز",
                value: "\(account.openPositions ?? 0)",
                icon: "briefcase.fill",
                tint: MOETheme.violet
              )
            }
          }
        }

        HStack(spacing: 12) {
          MetricTile(
            title: "ربح اليوم",
            value: currency(account.dayPnl),
            icon: "dollarsign.circle.fill",
            tint: tone(account.dayPnl)
          )
          MetricTile(
            title: "غير محقق",
            value: currency(account.unrealizedPnl),
            icon: "chart.xyaxis.line",
            tint: tone(account.unrealizedPnl)
          )
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 12) {
            Text("حالة الأمان")
              .font(.headline)
            SecurityRow(
              title: "Kill Switch",
              active: model.status.runtime?.killSwitchActive == true,
              goodWhenActive: false
            )
            SecurityRow(
              title: "الاستقبال",
              active: model.status.runtime?.receptionEnabled == true,
              goodWhenActive: true
            )
            SecurityRow(
              title: "اتصال الوسيط",
              active: account.connected == true,
              goodWhenActive: true
            )
          }
        }

        LazyVGrid(
          columns: [GridItem(.flexible()), GridItem(.flexible())],
          spacing: 12
        ) {
          NavigationLink {
            PnLView()
          } label: {
            ShortcutCard(title: "P&L", subtitle: "الربح والخسارة", icon: "chart.area.fill")
          }
          NavigationLink {
            OrdersView()
          } label: {
            ShortcutCard(
              title: "Orders", subtitle: "الأوامر الحالية", icon: "list.bullet.rectangle")
          }
          NavigationLink {
            ArchiveView()
          } label: {
            ShortcutCard(title: "Archive", subtitle: "الصفقات المغلقة", icon: "archivebox.fill")
          }
          NavigationLink {
            ActivityView()
          } label: {
            ShortcutCard(title: "Activity", subtitle: "سجل النظام", icon: "clock.arrow.circlepath")
          }
        }
        .buttonStyle(.plain)
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationBarHidden(true)
    .onAppear {
      withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
        pulse = true
      }
    }
    .refreshable { await model.loadAll() }
  }
}

// MARK: - Scanner

struct ScannerView: View {
  @EnvironmentObject private var model: AppModel
  @State private var search = ""
  @State private var sort = "VOLUME"

  private var filtered: [ScreenerRow] {
    guard !search.isEmpty else { return model.screenerRows }
    return model.screenerRows.filter {
      $0.symbol.localizedCaseInsensitiveContains(search)
        || ($0.name ?? "").localizedCaseInsensitiveContains(search)
    }
  }

  var body: some View {
    List {
      Section {
        TextField("ابحث عن سهم", text: $search)
          .textInputAutocapitalization(.characters)
        Picker("الترتيب", selection: $sort) {
          Text("الحجم").tag("VOLUME")
          Text("التغير").tag("CHANGE")
          Text("السعر").tag("PRICE_DESC")
        }
        .pickerStyle(.segmented)
      }

      Section("السوق") {
        if filtered.isEmpty {
          EmptyState(
            icon: "magnifyingglass",
            title: "لا توجد نتائج",
            copy: "غيّر البحث أو اسحب للتحديث."
          )
        } else {
          ForEach(filtered) { row in
            HStack(spacing: 12) {
              Text(row.symbol)
                .font(.headline)
                .frame(width: 60, alignment: .leading)
              VStack(alignment: .leading) {
                Text(row.name ?? row.symbol)
                  .lineLimit(1)
                Text(row.sector ?? "")
                  .font(.caption)
                  .foregroundStyle(MOETheme.muted)
              }
              Spacer()
              VStack(alignment: .trailing) {
                Text(currency(row.price))
                Text(percent(row.changePercent))
                  .font(.caption.bold())
                  .foregroundStyle(tone(row.changePercent))
              }
            }
            .padding(.vertical, 6)
          }
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("ماسح الأسهم")
    .onChange(of: sort) { _, newValue in
      Task { await model.reloadScanner(search: search, sort: newValue) }
    }
    .refreshable {
      await model.reloadScanner(search: search, sort: sort)
    }
  }
}

// MARK: - Positions and Orders

struct PositionsView: View {
  @EnvironmentObject private var model: AppModel
  @State private var closingSymbol: String?

  var body: some View {
    ScrollView {
      VStack(spacing: 13) {
        HStack {
          Button("تحديx� الوسيط") {
            Task { await model.refreshPositions() }
          }
          .buttonStyle(.borderedProminent)

          Button("إصلاح الحماية") {
            Task { await model.refreshPositions(repair: true) }
          }
          .buttonStyle(.bordered)
        }

        if (model.status.positions ?? []).isEmpty {
          EmptyState(
            icon: "briefcase",
            title: "لا توجد مراكز مفتوحة",
            copy: "ستظهر مراكز TradingView النشطة هنا مباشرة."
          )
        }

        ForEach(model.status.positions ?? []) { position in
          GlassCard {
            VStack(spacing: 13) {
              HStack {
                Text(position.symbol ?? "—")
                  .font(.title2.black())
                Spacer()
                Text(position.status ?? "—")
                  .font(.caption.bold())
                  .padding(8)
                  .background(MOETheme.accent.opacity(0.18), in: Capsule())
              }

              HStack {
                MetricTile(
                  title: "الكمية",
                  value: number(position.quantity),
                  icon: "number",
                  tint: MOETheme.accent
                )
                MetricTile(
                  title: "آخر سعر",
                  value: currency(position.lastPrice),
                  icon: "dollarsign",
                  tint: MOETheme.green
                )
              }

              HStack {
                MetricTile(
                  title: "الدخول",
                  value: currency(position.entryPrice),
                  icon: "arrow.down.circle",
                  tint: MOETheme.accent
                )
                MetricTile(
                  title: "Stop",
                  value: currency(position.currentStopPrice),
                  icon: "shield.fill",
                  tint: MOETheme.red
                )
              }

              Button(role: .destructive) {
                closingSymbol = position.symbol
              } label: {
                Label("إغلاق المركز فورًا", systemImage: "xmark.octagon.fill")
                  .frame(maxWidth: .infinity)
                  .padding(12)
              }
              .buttonStyle(.borderedProminent)
              .tint(MOETheme.red)
            }
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("المراكز")
    .confirmationDialog(
      "تأكيد إغلاق المركز",
      isPresented: Binding(
        get: { closingSymbol != nil },
        set: { if !$0 { closingSymbol = nil } }
      )
    ) {
      Button("إغلاق \(closingSymbol ?? "")", role: .destructive) {
        if let symbol = closingSymbol {
          Task { await model.close(symbol: symbol) }
        }
        closingSymbol = nil
      }
      Button("إلغاء", role: .cancel) { closingSymbol = nil }
    }
  }
}

struct OrdersView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    List {
      ForEach(model.status.positions ?? []) { position in
        Section(position.symbol ?? "—") {
          OrderRow(name: "Entry", id: position.orderIds?.entry)
          OrderRow(name: "Take Profit", id: position.orderIds?.takeProfit)
          OrderRow(
            name: "Stop Loss",
            id: position.orderIds?.currentStop ?? position.orderIds?.stopLoss
          )
          OrderRow(name: "Emergency Close", id: position.orderIds?.close)
        }
      }

      if (model.status.positions ?? []).isEmpty {
        EmptyState(
          icon: "list.bullet.rectangle",
          title: "لا توجد أوامر نشطة",
          copy: "تظهر أوامر الدخول والحماية هنا."
        )
      }
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الأوامر")
  }
}

struct OrderRow: View {
  let name: String
  let id: String?

  var body: some View {
    HStack {
      Text(name)
      Spacer()
      Text(id ?? "—")
        .font(.caption.monospaced())
        .foregroundStyle(MOETheme.muted)
        .lineLimit(1)
    }
  }
}

// MARK: - Activity, Archive, P&L

struct ActivityView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    List(model.status.audit ?? [], id: \.stableID) { event in
      HStack(alignment: .top, spacing: 12) {
        Circle()
          .fill(event.error == nil ? MOETheme.accent : MOETheme.red)
          .frame(width: 10, height: 10)
          .padding(.top, 6)
        VStack(alignment: .leading, spacing: 5) {
          Text((event.type ?? "EVENT").replacingOccurrences(of: "_", with: " "))
            .font(.subheadline.bold())
          if let symbol = event.symbol {
            Text(symbol)
              .foregroundStyle(MOETheme.accent)
          }
          if let message = event.error ?? event.reason {
            Text(message)
              .font(.caption)
              .foregroundStyle(MOETheme.red)
          }
          Text(formatDate(event.createdAt))
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }
      }
      .padding(.vertical, 5)
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("النشاط")
    .refreshable { await model.refreshStatus() }
  }
}

struct ArchiveView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    List(model.status.archive ?? [], id: \.stableID) { trade in
      VStack(spacing: 9) {
        HStack {
          Text(trade.symbol ?? "—")
            .font(.headline)
          Spacer()
          Text(currency(trade.profitLoss))
            .font(.headline)
            .foregroundStyle(tone(trade.profitLoss))
        }
        HStack {
          Text("دخول \(currency(trade.entryPrice))")
          Spacer()
          Text("خروج \(currency(trade.exitPrice))")
        }
        .font(.caption)
        .foregroundStyle(MOETheme.muted)
        HStack {
          Text(trade.exitReason ?? "—")
          Spacer()
          Text(formatDate(trade.closedAt))
        }
        .font(.caption2)
        .foregroundStyle(MOETheme.muted)
      }
      .padding(.vertical, 6)
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الأرشيف")
  }
}

struct PnLPoint: Identifiable {
  let id = UUID()
  let date: Date
  let value: Double
}

struct PnLView: View {
  @EnvironmentObject private var model: AppModel

  private var points: [PnLPoint] {
    let formatter = ISO8601DateFormatter()
    var total = 0.0
    return (model.status.archive ?? [])
      .sorted { ($0.closedAt ?? "") < ($1.closedAt ?? "") }
      .compactMap { trade in
        guard let raw = trade.closedAt,
          let date = formatter.date(from: raw)
        else {
          return nil
        }
        total += trade.profitLoss ?? 0
        return PnLPoint(date: date, value: total)
      }
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        GlassCard {
          VStack(alignment: .leading) {
            Text("P&L اليوم")
              .foregroundStyle(MOETheme.muted)
            Text(currency(model.activeAccount.dayPnl))
              .font(.system(size: 40, weight: .black))
              .foregroundStyle(tone(model.activeAccount.dayPnl))
            Text(percent(model.activeAccount.dayPnlPercent))
              .foregroundStyle(MOETheme.muted)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }

        GlassCard {
          if points.isEmpty {
            EmptyState(
              icon: "chart.xyaxis.line",
              title: "لا توجد بيانات P&L بعد",
              copy: "سيظهر منحنى الأداء بعد إغلاق أول صفقة."
            )
          } else {
            Chart(points) { point in
              AreaMark(
                x: .value("Date", point.date),
                y: .value("P&L", point.value)
              )
              .foregroundStyle(MOETheme.accent.opacity(0.25))

              LineMark(
                x: .value("Date", point.date),
                y: .value("P&L", point.value)
              )
              .foregroundStyle(MOETheme.accent)
              .lineStyle(.init(lineWidth: 3))
            }
            .frame(height: 250)
          }
        }

        HStack {
          MetricTile(
            title: "محقق",
            value: currency(model.activeAccount.realizedPnl),
            icon: "checkmark.circle",
            tint: tone(model.activeAccount.realizedPnl)
          )
          MetricTile(
            title: "مفتوح",
            value: currency(model.activeAccount.unrealizedPnl),
            icon: "clock",
            tint: tone(model.activeAccount.unrealizedPnl)
          )
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("P&L")
  }
}

// MARK: - Settings

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var notifications: NotificationManager
  @AppStorage("moe.baseURL") private var baseURL =
    "https://moerand-alerts-sandbox.mosaprajb.workers.dev"
  @State private var showLiveConfirmation = false

  private var receptionBinding: Binding<Bool> {
    Binding(
      get: { model.status.runtime?.receptionEnabled == true },
      set: { enabled in
        if enabled && model.selectedAccount == "LIVE" {
          showLiveConfirmation = true
        } else {
          Task { await model.setReception(enabled: enabled) }
        }
      }
    )
  }

  var body: some View {
    Form {
      Section("الاتصال") {
        TextField("Cloudflare Worker URL", text: $baseURL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)

        Button("حفظ الرابط وإعادة الاتصال") {
          session.baseURLText = baseURL
          UserDefaults.standard.set(baseURL, forKey: "moe.baseURL")
          Task { await model.loadAll() }
        }

        LabeledContent("الوضع", value: model.status.mode ?? "—")
        LabeledContent("المصدر", value: model.status.executionSource ?? "—")
      }

      Section("الحساب والتحكم") {
        Picker("الحساب المعروض", selection: $model.selectedAccount) {
          Text("Demo / Paper").tag("DEMO")
          Text("Live").tag("LIVE")
        }

        Toggle("استقبال إشارات TradingView", isOn: receptionBinding)

        LabeledContent("نوع التشغيل", value: model.status.settings?.tradingMode ?? "—")
        LabeledContent(
          "الحد الأقصى للمراكز",
          value: "\(model.status.settings?.maxOpenPositions ?? 0)"
        )
        LabeledContent(
          "حجم الصفقة",
          value: currency(model.status.settings?.positionSizeDollars)
        )
      }

      Section("الإشعارات") {
        Button(notifications.authorized ? "إعادة تسجيل إشعارات الجهاز" : "تفعيل الإشعارات") {
          Task { await notifications.requestPermission() }
        }

        if let token = notifications.deviceToken {
          LabeledContent("APNs Token") {
            Text(String(token.prefix(16)) + "…")
              .font(.caption.monospaced())
          }
        }

        if let message = notifications.registrationMessage {
          Text(message)
            .font(.caption)
            .foregroundStyle(MOETheme.muted)
        }
      }

      Section("الأمان") {
        Button("قفل التطبيق") { session.signOut() }
        Button("نسيان هذا الجهاز", role: .destructive) { session.forgetDevice() }
      }

      Section("التطبيق") {
        LabeledContent("الواجهة", value: "SwiftUI Native")
        LabeledContent("Safari / WebView", value: "غير مستخدم")
        LabeledContent("الإصدار", value: appVersion)
      }
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الإعدادات")
    .confirmationDialog(
      "تفعيل الحساب الحقيقي",
      isPresented: $showLiveConfirmation,
      titleVisibility: .visible
    ) {
      Button("تأكيد تفعيل Live", role: .destructive) {
        Task { await model.setReception(enabled: true, confirmation: "CONFIRM") }
      }
      Button("إلغاء", role: .cancel) {}
    } message: {
      Text("سيطلب الخادم جاهزية الحساب الحقيقي وكل بوابات الأمان قبل التفعيل.")
    }
  }
}

// MARK: - Formatting

func currency(_ value: Double?) -> String {
  guard let value else { return "—" }
  return value.formatted(.currency(code: "USD").precision(.fractionLength(2)))
}

func percent(_ value: Double?) -> String {
  guard let value else { return "—" }
  return String(format: "%+.2f%%", value)
}

func number(_ value: Double?) -> String {
  guard let value else { return "—" }
  return value.formatted(.number.precision(.fractionLength(0...4)))
}

func tone(_ value: Double?) -> Color {
  (value ?? 0) >= 0 ? MOETheme.green : MOETheme.red
}

func formatDate(_ value: String?) -> String {
  guard let value,
    let date = ISO8601DateFormatter().date(from: value)
  else {
    return value ?? "—"
  }
  return date.formatted(date: .abbreviated, time: .shortened)
}

var appVersion: String {
  let version =
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.2.0"
  let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "2"
  return "\(version) (\(build))"
}
