import SwiftUI
import Charts

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            if session.isUnlocked {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.isUnlocked)
    }
}

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var pin = ""

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.black, Color(red: 0.04, green: 0.08, blue: 0.16)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 70)

                    ZStack {
                        Circle().fill(.blue.opacity(0.18)).frame(width: 118, height: 118)
                        Image(systemName: "chart.xyaxis.line")
                            .font(.system(size: 50, weight: .bold))
                            .foregroundStyle(.cyan)
                    }

                    VStack(spacing: 8) {
                        Text("MOE-AI")
                            .font(.system(size: 38, weight: .black, design: .rounded))
                        Text("تطبيق التداول الآمن")
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 14) {
                        TextField("رابط Cloudflare Worker", text: $session.baseURLText)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .padding()
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))

                        SecureField("الرمز السري", text: $pin)
                            .keyboardType(.numberPad)
                            .textContentType(.password)
                            .multilineTextAlignment(.center)
                            .font(.title2.monospacedDigit())
                            .padding()
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))

                        Button {
                            Task { await session.unlock(pin: pin) }
                        } label: {
                            HStack {
                                if session.isBusy { ProgressView().tint(.white) }
                                Text(session.isBusy ? "جارٍ فتح التطبيق…" : "فتح التطبيق")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .fontWeight(.bold)
                            .background(.blue.gradient, in: RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(pin.isEmpty || session.isBusy)

                        if session.hasSavedPIN {
                            Button {
                                Task { await session.unlockWithFaceID() }
                            } label: {
                                Label("فتح بواسطة Face ID", systemImage: "faceid")
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }

                    if let error = session.errorMessage {
                        Text(error)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .padding()
                            .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    }

                    Text("الاتصال مباشر وآمن مع Cloudflare Worker. لا يتم استخدام Safari أو WebView.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
            }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            NavigationStack { DashboardView() }
                .tabItem { Label("الرئيسية", systemImage: "gauge.with.dots.needle.50percent") }

            NavigationStack { ScannerView() }
                .tabItem { Label("الماسح", systemImage: "waveform.path.ecg.rectangle") }

            NavigationStack { PositionsView() }
                .tabItem { Label("المراكز", systemImage: "briefcase.fill") }

            NavigationStack { ActivityView() }
                .tabItem { Label("النشاط", systemImage: "clock.arrow.circlepath") }

            NavigationStack { MoreView() }
                .tabItem { Label("المزيد", systemImage: "ellipsis.circle") }
        }
        .task {
            if let url = session.baseURL { await model.refresh(baseURL: url) }
        }
    }
}

struct DashboardView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var model: AppModel

    private var account: TradingStatus.Accounts.Account? {
        guard let accounts = model.status?.accounts else { return nil }
        return model.selectedAccount == "live" ? accounts.live : accounts.demo
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                header
                accountSwitcher
                heroCard
                metricGrid
                marketCard
                statusCard
                pnlChart
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("MOE-AI")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    guard let url = session.baseURL else { return }
                    Task { await model.refresh(baseURL: url) }
                } label: {
                    if model.isLoading { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
            }
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("لوحة التداول")
                    .font(.title2.bold())
                Text(model.status?.runtime?.receptionEnabled == true ? "استقبال الإشارات مفعل" : "استقبال الإشارات متوقف")
                    .font(.subheadline)
                    .foregroundStyle(model.status?.runtime?.receptionEnabled == true ? .green : .orange)
            }
            Spacer()
            Circle()
                .fill(model.status?.runtime?.killSwitchActive == true ? .red : .green)
                .frame(width: 12, height: 12)
        }
    }

    private var accountSwitcher: some View {
        Picker("الحساب", selection: $model.selectedAccount) {
            Text("تجريبي").tag("demo")
            Text("حقيقي").tag("live")
        }
        .pickerStyle(.segmented)
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("قيمة الحساب")
                .foregroundStyle(.secondary)
            Text(money(account?.balance))
                .font(.system(size: 36, weight: .black, design: .rounded))
            HStack {
                Label(money(account?.dayPnl), systemImage: "chart.line.uptrend.xyaxis")
                    .foregroundStyle((account?.dayPnl ?? 0) >= 0 ? .green : .red)
                Spacer()
                Text(percent(account?.dayPnlPercent))
                    .fontWeight(.bold)
                    .foregroundStyle((account?.dayPnlPercent ?? 0) >= 0 ? .green : .red)
            }
        }
        .padding(20)
        .background(
            LinearGradient(colors: [.blue.opacity(0.35), .purple.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 24)
        )
    }

    private var metricGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            MetricCard(title: "القوة الشرائية", value: money(account?.buyingPower), icon: "bolt.fill")
            MetricCard(title: "المراكز المفتوحة", value: "\(account?.openPositions ?? 0)", icon: "briefcase.fill")
            MetricCard(title: "المحقق", value: money(account?.realizedPnl), icon: "checkmark.seal.fill")
            MetricCard(title: "غير المحقق", value: money(account?.unrealizedPnl), icon: "hourglass")
        }
    }

    private var marketCard: some View {
        GroupBox {
            HStack {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.status?.marketClock?.label ?? "السوق")
                        .font(.headline)
                    Text(model.status?.marketClock?.phase ?? "غير متاح")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: model.status?.marketClock?.entryAllowed == true ? "lock.open.fill" : "lock.fill")
                    .font(.title2)
                    .foregroundStyle(model.status?.marketClock?.entryAllowed == true ? .green : .orange)
            }
        } label: {
            Label("جلسة السوق", systemImage: "clock.fill")
        }
    }

    private var statusCard: some View {
        GroupBox {
            VStack(spacing: 12) {
                StatusRow(label: "الاتصال", value: account?.connected == true ? "متصل" : "غير متصل", good: account?.connected == true)
                StatusRow(label: "استقبال TradingView", value: model.status?.runtime?.receptionEnabled == true ? "مفعل" : "متوقف", good: model.status?.runtime?.receptionEnabled == true)
                StatusRow(label: "Kill Switch", value: model.status?.runtime?.killSwitchActive == true ? "نشط" : "غير نشط", good: model.status?.runtime?.killSwitchActive != true)
            }
        } label: {
            Label("حالة النظام", systemImage: "shield.lefthalf.filled")
        }
    }

    private var pnlChart: some View {
        let trades = model.status?.archive.suffix(20) ?? []
        let points = cumulativePoints(from: Array(trades.reversed()))
        return GroupBox {
            Chart(points) { point in
                AreaMark(x: .value("Trade", point.index), y: .value("P&L", point.value))
                    .foregroundStyle(.blue.opacity(0.2))
                LineMark(x: .value("Trade", point.index), y: .value("P&L", point.value))
                    .interpolationMethod(.catmullRom)
            }
            .frame(height: 190)
        } label: {
            Label("منحنى الأداء", systemImage: "chart.xyaxis.line")
        }
    }
}

struct ScannerView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var model: AppModel
    @State private var search = ""

    private var filtered: [ScannerResponse.ScannerRow] {
        guard !search.isEmpty else { return model.scannerRows }
        return model.scannerRows.filter { $0.symbol.localizedCaseInsensitiveContains(search) || ($0.name ?? "").localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List(filtered) { row in
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 12)
                    .fill((row.changePercent ?? 0) >= 0 ? Color.green.opacity(0.15) : Color.red.opacity(0.15))
                    .frame(width: 48, height: 48)
                    .overlay(Text(String(row.symbol.prefix(2))).fontWeight(.black))
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.symbol).font(.headline)
                    Text(row.name ?? row.sector ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(money(row.price))
                        .fontWeight(.bold)
                    Text(percent(row.changePercent))
                        .foregroundStyle((row.changePercent ?? 0) >= 0 ? .green : .red)
                }
            }
            .padding(.vertical, 5)
        }
        .searchable(text: $search, prompt: "ابحث عن سهم")
        .navigationTitle("ماسح الأسهم")
        .refreshable {
            if let url = session.baseURL { await model.refresh(baseURL: url) }
        }
    }
}

struct PositionsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            if let positions = model.status?.positions, !positions.isEmpty {
                ForEach(positions) { position in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(position.symbol ?? "—").font(.title3.bold())
                            Spacer()
                            Text(position.status ?? "—")
                                .font(.caption.bold())
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(.blue.opacity(0.15), in: Capsule())
                        }
                        HStack {
                            PositionMetric(label: "الكمية", value: decimal(position.quantity))
                            Spacer()
                            PositionMetric(label: "الدخول", value: money(position.entryPrice))
                            Spacer()
                            PositionMetric(label: "السعر", value: money(position.lastPrice))
                        }
                        HStack {
                            PositionMetric(label: "وقف الخسارة", value: money(position.currentStopPrice))
                            Spacer()
                            PositionMetric(label: "الهدف", value: money(position.takeProfitPrice))
                        }
                        if let symbol = position.symbol {
                            Button(role: .destructive) {
                                guard let url = session.baseURL else { return }
                                Task { await model.close(symbol: symbol, baseURL: url) }
                            } label: {
                                Label("إغلاق المركز فورًا", systemImage: "xmark.octagon.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                        }
                    }
                    .padding(.vertical, 8)
                }
            } else {
                ContentUnavailableView("لا توجد مراكز مفتوحة", systemImage: "briefcase", description: Text("ستظهر مراكز التداول هنا فور فتحها."))
            }
        }
        .navigationTitle("المراكز")
    }
}

struct ActivityView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List(model.status?.audit ?? []) { event in
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon(for: event.type))
                    .foregroundStyle(color(for: event.type))
                    .frame(width: 34, height: 34)
                    .background(color(for: event.type).opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.type?.replacingOccurrences(of: "_", with: " ") ?? "حدث")
                        .font(.subheadline.bold())
                    if let symbol = event.symbol { Text(symbol).font(.caption).foregroundStyle(.secondary) }
                    if let date = event.createdAt { Text(date).font(.caption2).foregroundStyle(.tertiary) }
                }
            }
            .padding(.vertical, 5)
        }
        .navigationTitle("النشاط")
    }
}

struct MoreView: View {
    var body: some View {
        List {
            NavigationLink { OrdersView() } label: { Label("الأوامر", systemImage: "list.bullet.rectangle") }
            NavigationLink { ArchiveView() } label: { Label("الأرشيف", systemImage: "archivebox.fill") }
            NavigationLink { PnLView() } label: { Label("الأرباح والخسائر", systemImage: "chart.bar.xaxis") }
            NavigationLink { SettingsView() } label: { Label("الإعدادات", systemImage: "gearshape.fill") }
        }
        .navigationTitle("المزيد")
    }
}

struct OrdersView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        List {
            ForEach(model.status?.positions ?? []) { position in
                VStack(alignment: .leading, spacing: 8) {
                    Text(position.symbol ?? "—").font(.headline)
                    Label("Entry: \(money(position.entryPrice))", systemImage: "arrow.down.circle")
                    Label("Stop: \(money(position.currentStopPrice))", systemImage: "shield")
                    Label("Target: \(money(position.takeProfitPrice))", systemImage: "target")
                }
                .padding(.vertical, 6)
            }
        }
        .overlay {
            if model.status?.positions.isEmpty != false {
                ContentUnavailableView("لا توجد أوامر نشطة", systemImage: "list.bullet.rectangle")
            }
        }
        .navigationTitle("الأوامر")
    }
}

struct ArchiveView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        List(model.status?.archive ?? []) { trade in
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(trade.symbol ?? "—").font(.headline)
                    Text(trade.exitReason ?? "").font(.caption).foregroundStyle(.secondary)
                    Text(trade.closedAt ?? "").font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer()
                Text(money(trade.profitLoss))
                    .fontWeight(.bold)
                    .foregroundStyle((trade.profitLoss ?? 0) >= 0 ? .green : .red)
            }
        }
        .navigationTitle("الأرشيف")
    }
}

struct PnLView: View {
    @EnvironmentObject private var model: AppModel
    private var trades: [TradingStatus.Trade] { model.status?.archive ?? [] }
    private var total: Double { trades.reduce(0) { $0 + ($1.profitLoss ?? 0) } }
    private var wins: Int { trades.filter { ($0.profitLoss ?? 0) > 0 }.count }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 8) {
                    Text("إجمالي الأداء").foregroundStyle(.secondary)
                    Text(money(total)).font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundStyle(total >= 0 ? .green : .red)
                }
                .frame(maxWidth: .infinity)
                .padding(24)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24))

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
                    MetricCard(title: "عدد الصفقات", value: "\(trades.count)", icon: "number")
                    MetricCard(title: "نسبة النجاح", value: trades.isEmpty ? "0%" : String(format: "%.1f%%", Double(wins) / Double(trades.count) * 100), icon: "percent")
                }

                Chart(cumulativePoints(from: Array(trades.reversed()))) { point in
                    LineMark(x: .value("Trade", point.index), y: .value("P&L", point.value))
                        .interpolationMethod(.catmullRom)
                    AreaMark(x: .value("Trade", point.index), y: .value("P&L", point.value))
                        .foregroundStyle(.blue.opacity(0.18))
                }
                .frame(height: 250)
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
            }
            .padding()
        }
        .navigationTitle("P&L")
    }
}

struct SettingsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            Section("الخادم") {
                TextField("Cloudflare Worker URL", text: $session.baseURLText)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                Button("حفظ واختبار الاتصال") {
                    UserDefaults.standard.set(session.baseURLText, forKey: "moe.baseURL")
                    guard let url = session.baseURL else { return }
                    Task { await model.refresh(baseURL: url) }
                }
            }

            Section("الأمان") {
                Button { Task { await session.unlockWithFaceID() } } label: {
                    Label("اختبار Face ID", systemImage: "faceid")
                }
                Button("قفل التطبيق") { session.lock() }
                Button("حذف الرمز المحفوظ", role: .destructive) { session.forgetPIN() }
            }

            Section("الحالة") {
                LabeledContent("الحساب", value: model.status?.runtime?.accountType ?? "—")
                LabeledContent("الإشارات", value: model.status?.runtime?.receptionEnabled == true ? "مفعلة" : "متوقفة")
                LabeledContent("Kill Switch", value: model.status?.runtime?.killSwitchActive == true ? "نشط" : "غير نشط")
            }
        }
        .navigationTitle("الإعدادات")
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon).foregroundStyle(.cyan)
            Text(value).font(.title3.bold()).lineLimit(1).minimumScaleFactor(0.65)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct StatusRow: View {
    let label: String
    let value: String
    let good: Bool
    var body: some View {
        HStack {
            Circle().fill(good ? .green : .orange).frame(width: 9, height: 9)
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary)
        }
    }
}

struct PositionMetric: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.bold())
        }
    }
}

struct PnLPoint: Identifiable {
    let id = UUID()
    let index: Int
    let value: Double
}

func cumulativePoints(from trades: [TradingStatus.Trade]) -> [PnLPoint] {
    var total = 0.0
    return trades.enumerated().map { index, trade in
        total += trade.profitLoss ?? 0
        return PnLPoint(index: index + 1, value: total)
    }
}

func money(_ value: Double?) -> String {
    guard let value else { return "—" }
    return value.formatted(.currency(code: "USD"))
}

func percent(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "%+.2f%%", value)
}

func decimal(_ value: Double?) -> String {
    guard let value else { return "—" }
    return value.formatted(.number.precision(.fractionLength(0...4)))
}

func icon(for type: String?) -> String {
    let value = type ?? ""
    if value.contains("FAILED") || value.contains("REJECTED") { return "xmark.octagon.fill" }
    if value.contains("BUY") || value.contains("OPEN") { return "arrow.up.circle.fill" }
    if value.contains("SELL") || value.contains("EXIT") || value.contains("CLOSE") { return "arrow.down.circle.fill" }
    if value.contains("LOGIN") { return "person.badge.key.fill" }
    return "bolt.fill"
}

func color(for type: String?) -> Color {
    let value = type ?? ""
    if value.contains("FAILED") || value.contains("REJECTED") { return .red }
    if value.contains("BUY") || value.contains("OPEN") { return .green }
    if value.contains("SELL") || value.contains("EXIT") || value.contains("CLOSE") { return .orange }
    return .blue
}
