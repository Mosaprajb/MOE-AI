import SwiftUI

struct DashboardView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var network: NetworkMonitor
  @EnvironmentObject private var preferences: AppPreferences

  @State private var pulse = false
  @State private var selectedSessions: Set<TradingSessionOption> = [.regular]
  @State private var timeInForce: TradingTimeInForceOption = .day
  @State private var shareQuantityText = ""
  @State private var maxTradeAmountText = ""
  @State private var previewSymbol = ""
  @State private var previewPriceText = ""
  @State private var showLiveArmConfirmation = false
  @State private var liveConfirmation = ""

  private var account: BrokerAccount { model.activeAccount }
  private var runtime: RuntimeState? { model.status.runtime }
  private var control: TradingControlStatus? { model.selectedTradingControl }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        header
        connectionCard
        accountPicker
        accountCard
        buyingPowerCard
        tradingControlCard
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
    .task(id: model.selectedAccount) {
      await model.loadTradingControl(for: model.selectedAccount, silently: true)
      syncControlFields()
    }
    .onAppear {
      syncControlFields()
      withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
        pulse = true
      }
    }
    .alert("تفعيل استقبال Live", isPresented: $showLiveArmConfirmation) {
      TextField("اكتب CONFIRM", text: $liveConfirmation)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
      Button("تفعيل Live", role: .destructive) {
        let confirmation = liveConfirmation
          .trimmingCharacters(in: .whitespacesAndNewlines)
          .uppercased()
        liveConfirmation = ""
        Task { await armTradingView(confirmation: confirmation) }
      }
      Button("إلغاء", role: .cancel) { liveConfirmation = "" }
    } message: {
      Text("سيتم السماح بإشارات TradingView للحساب الحقيقي فقط إذا كانت جميع بوابات Live في Worker مفتوحة. اكتب CONFIRM للمتابعة.")
    }
  }

  private var header: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text("MOE-AI")
          .font(.largeTitle.weight(.black))
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
          .fill(model.receptionEnabledForSelectedAccount ? MOETheme.positive : MOETheme.warning)
          .frame(width: 13, height: 13)
          .scaleEffect(pulse ? 1.22 : 0.9)

        VStack(alignment: .leading, spacing: 4) {
          Text(model.receptionEnabledForSelectedAccount ? "TradingView مسلّح" : "TradingView متوقف")
            .fontWeight(.bold)
          Text(model.isLiveSelected ? "LIVE ACCOUNT" : "PAPER TRADING")
            .font(.caption.weight(.bold))
            .foregroundStyle(model.isLiveSelected ? MOETheme.warning : MOETheme.accent)
        }

        Spacer()

        VStack(alignment: .trailing, spacing: 5) {
          Text(control?.market.label ?? model.status.marketClock?.phase ?? "—")
            .font(.caption.bold())
            .multilineTextAlignment(.trailing)
          Text(control?.market.allowedNow == true ? "الجلسة مسموحة" : "خارج الجلسة المختارة")
            .font(.caption2)
            .foregroundStyle(control?.market.allowedNow == true ? MOETheme.positive : MOETheme.muted)
        }
      }
    }
  }

  private var accountPicker: some View {
    Picker("الحساب", selection: $model.selectedAccount) {
      Text("Paper Trading").tag("DEMO")
      Text("Live").tag("LIVE")
    }
    .pickerStyle(.segmented)
  }

  private var accountCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 13) {
        HStack {
          VStack(alignment: .leading, spacing: 4) {
            Text(model.isLiveSelected ? "قيمة حساب Live" : "قيمة حساب Paper")
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
            title: "Cash",
            value: formatCurrency(account.cash),
            icon: "banknote.fill",
            tint: MOETheme.positive
          )
          MetricTile(
            title: "Buying Power",
            value: formatCurrency(account.buyingPower),
            icon: "creditcard.fill",
            tint: MOETheme.accent
          )
        }
      }
    }
  }

  private var buyingPowerCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 12) {
        SectionTitle(title: "Buying Power حسب الجلسة")
        HStack(spacing: 10) {
          MetricTile(
            title: "Intraday BP",
            value: formatCurrency(control?.broker.intradayBuyingPower),
            icon: "sun.max.fill",
            tint: MOETheme.accent
          )
          MetricTile(
            title: "Overnight BP",
            value: formatCurrency(control?.broker.overnightBuyingPower),
            icon: "moon.fill",
            tint: MOETheme.violet
          )
        }
        HStack {
          Text("Night Trading BP")
            .foregroundStyle(MOETheme.muted)
          Spacer()
          Text(formatCurrency(control?.broker.nightTradingBuyingPower))
            .font(.headline.monospacedDigit())
        }
        Divider().overlay(Color.white.opacity(0.08))
        HStack {
          Text("المتاح للجلسة الحالية")
            .fontWeight(.semibold)
          Spacer()
          Text(formatCurrency(control?.broker.currentSessionBuyingPower))
            .font(.headline.monospacedDigit())
            .foregroundStyle(MOETheme.positive)
        }
      }
    }
  }

  private var tradingControlCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 16) {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            SectionTitle(title: "TradingView Order Control")
            Text("إعدادات مستقلة للحساب المحدد")
              .font(.caption)
              .foregroundStyle(MOETheme.muted)
          }
          Spacer()
          StatusPill(
            title: model.receptionEnabledForSelectedAccount ? "ARMED" : "OFF",
            isPositive: model.receptionEnabledForSelectedAccount
          )
        }

        VStack(alignment: .leading, spacing: 9) {
          Text("Trading Hours")
            .font(.subheadline.weight(.bold))
          ForEach(TradingSessionOption.allCases) { option in
            sessionButton(option)
          }
          Text("يمكن تفعيل جلسة واحدة أو جلستين أو الثلاث معًا.")
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }

        Divider().overlay(Color.white.opacity(0.08))

        HStack(spacing: 12) {
          tradingInput(
            title: "Quantity",
            placeholder: "عدد الأسهم",
            text: $shareQuantityText,
            keyboard: .numberPad
          )
          tradingInput(
            title: "Max Trade $",
            placeholder: "المبلغ الأقصى",
            text: $maxTradeAmountText,
            keyboard: .decimalPad
          )
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("Time in Force")
            .font(.subheadline.weight(.bold))
          Picker("Time in Force", selection: $timeInForce) {
            ForEach(TradingTimeInForceOption.allCases) { option in
              Text(option.title).tag(option)
            }
          }
          .pickerStyle(.segmented)
          Text(timeInForce.detail)
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }

        Button {
          Task { await saveTradingControls() }
        } label: {
          LoadingButtonLabel(
            title: model.pendingAction == "trading-control-save" ? "جارٍ الحفظ…" : "حفظ إعدادات الحساب",
            icon: "checkmark.shield.fill",
            loading: model.pendingAction == "trading-control-save"
          )
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .tint(MOETheme.accent)
        .disabled(!controlFormIsValid || model.pendingAction != nil || !network.snapshot.isConnected)

        Divider().overlay(Color.white.opacity(0.08))

        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text("Order Preview")
              .font(.subheadline.weight(.bold))
            Spacer()
            Text("Webull Estimate")
              .font(.caption2.weight(.bold))
              .foregroundStyle(MOETheme.muted)
          }
          HStack(spacing: 12) {
            tradingInput(
              title: "Symbol",
              placeholder: "AAPL",
              text: $previewSymbol,
              keyboard: .default
            )
            tradingInput(
              title: "Price",
              placeholder: "180.00",
              text: $previewPriceText,
              keyboard: .decimalPad
            )
          }
          Button {
            Task { await runPreview() }
          } label: {
            Label("حساب Estimated Total والرسوم", systemImage: "function")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
          .disabled(!previewFormIsValid || model.pendingAction != nil || !network.snapshot.isConnected)
        }

        previewMetrics

        if let error = model.tradingControlErrorMessage {
          InlineErrorView(message: error)
        }

        if let blockers = control?.blockers, !blockers.isEmpty {
          VStack(alignment: .leading, spacing: 5) {
            ForEach(blockers, id: \.self) { blocker in
              Label(blocker, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(MOETheme.warning)
            }
          }
        }

        Button {
          if model.receptionEnabledForSelectedAccount {
            Task { await model.setTradingControlReception(enabled: false) }
          } else if model.isLiveSelected {
            showLiveArmConfirmation = true
          } else {
            Task { await armTradingView() }
          }
        } label: {
          HStack {
            Image(systemName: model.receptionEnabledForSelectedAccount ? "pause.fill" : "bolt.shield.fill")
            Text(model.receptionEnabledForSelectedAccount
              ? "إيقاف استقبال أوامر TradingView"
              : "تفعيل استقبال أوامر TradingView")
              .fontWeight(.bold)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(model.receptionEnabledForSelectedAccount ? MOETheme.negative : MOETheme.positive)
        .disabled(
          model.pendingAction != nil
            || !network.snapshot.isConnected
            || (!model.receptionEnabledForSelectedAccount && control?.configured != true)
        )

        Text(model.isLiveSelected
          ? "Live مستقل تمامًا عن Paper. لن تُستخدم إعدادات Paper أو استقبالها للحساب الحقيقي."
          : "Paper مستقل تمامًا عن Live، ومخصص لاختبار نفس إشارات TradingView قبل نقلها للحساب الحقيقي.")
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
      }
    }
  }

  private func sessionButton(_ option: TradingSessionOption) -> some View {
    let selected = selectedSessions.contains(option)
    return Button {
      if selected {
        selectedSessions.remove(option)
      } else {
        selectedSessions.insert(option)
      }
    } label: {
      HStack(spacing: 12) {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
          .font(.title3)
          .foregroundStyle(selected ? MOETheme.positive : MOETheme.muted)
        VStack(alignment: .leading, spacing: 2) {
          Text(option.title)
            .font(.subheadline.weight(.semibold))
          Text(option.subtitle)
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }
        Spacer()
        Text(option.rawValue)
          .font(.caption2.monospaced().bold())
          .foregroundStyle(selected ? MOETheme.accent : MOETheme.muted)
      }
      .padding(12)
      .background(
        selected ? MOETheme.accent.opacity(0.14) : Color.white.opacity(0.035),
        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(selected ? MOETheme.accent.opacity(0.35) : Color.white.opacity(0.06))
      }
    }
    .buttonStyle(.plain)
  }

  private func tradingInput(
    title: String,
    placeholder: String,
    text: Binding<String>,
    keyboard: UIKeyboardType
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.caption.weight(.bold))
        .foregroundStyle(MOETheme.muted)
      TextField(placeholder, text: text)
        .keyboardType(keyboard)
        .textInputAutocapitalization(title == "Symbol" ? .characters : .never)
        .autocorrectionDisabled()
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
          RoundedRectangle(cornerRadius: 12)
            .stroke(Color.white.opacity(0.08))
        }
    }
    .frame(maxWidth: .infinity)
  }

  private var previewMetrics: some View {
    VStack(spacing: 9) {
      previewRow("Estimated Total", formatCurrency(model.tradingPreview?.estimatedTotal))
      previewRow("Estimated Transaction Fee", formatCurrency(model.tradingPreview?.estimatedTransactionFee))
      previewRow("Max Quantity to Buy", model.tradingPreview?.maximumQuantityToBuy.map(String.init) ?? "—")
      previewRow("Intraday BP", formatCurrency(model.tradingPreview?.intradayBuyingPower ?? control?.broker.intradayBuyingPower))
      previewRow("Overnight BP", formatCurrency(model.tradingPreview?.overnightBuyingPower ?? control?.broker.overnightBuyingPower))
      previewRow("Night Trading BP", formatCurrency(model.tradingPreview?.nightTradingBuyingPower ?? control?.broker.nightTradingBuyingPower))
    }
    .padding(12)
    .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 14))
  }

  private func previewRow(_ title: String, _ value: String) -> some View {
    HStack {
      Text(title)
        .font(.caption)
        .foregroundStyle(MOETheme.muted)
      Spacer()
      Text(value)
        .font(.subheadline.monospacedDigit().weight(.semibold))
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
          detail: model.receptionEnabledForSelectedAccount ? "ON" : "OFF",
          healthy: model.receptionEnabledForSelectedAccount
        )
        DashboardSecurityRow(
          title: "اتصال الوسيط",
          detail: control?.broker.connected == true ? "متصل" : "غير متصل",
          healthy: control?.broker.connected == true
        )
        DashboardSecurityRow(
          title: "إعدادات الحساب",
          detail: control?.configured == true ? "جاهزة" : "غير مكتملة",
          healthy: control?.configured == true
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

  private var controlFormIsValid: Bool {
    !selectedSessions.isEmpty
      && (Int(shareQuantityText) ?? 0) > 0
      && parsedDouble(maxTradeAmountText) > 0
  }

  private var previewFormIsValid: Bool {
    !previewSymbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && parsedDouble(previewPriceText) > 0
      && control?.configured == true
  }

  private func parsedDouble(_ value: String) -> Double {
    Double(value.replacingOccurrences(of: ",", with: ".")) ?? 0
  }

  private func syncControlFields() {
    guard let settings = control?.settings else { return }
    selectedSessions = Set(settings.allowedSessions)
    timeInForce = settings.timeInForce
    shareQuantityText = settings.shareQuantity > 0 ? String(settings.shareQuantity) : ""
    maxTradeAmountText = settings.maxTradeAmountUsd > 0
      ? String(format: "%.2f", settings.maxTradeAmountUsd)
      : ""
  }

  private func saveTradingControls() async {
    let authorized = await session.authorizeSensitiveAction(
      reason: "حفظ حدود كمية الأسهم والمبلغ وجلسات استقبال TradingView",
      required: preferences.requiresAuthenticationForSensitiveActions
    )
    guard authorized else { return }
    await model.saveTradingControl(
      sessions: TradingSessionOption.allCases.filter(selectedSessions.contains),
      timeInForce: timeInForce,
      shareQuantity: Int(shareQuantityText) ?? 0,
      maxTradeAmountUsd: parsedDouble(maxTradeAmountText)
    )
    syncControlFields()
  }

  private func runPreview() async {
    await model.previewTradingOrder(
      symbol: previewSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
      price: parsedDouble(previewPriceText)
    )
  }

  private func armTradingView(confirmation: String? = nil) async {
    let authorized = await session.authorizeSensitiveAction(
      reason: model.isLiveSelected
        ? "تفعيل استقبال وتنفيذ إشارات TradingView على الحساب الحقيقي"
        : "تفعيل استقبال وتنفيذ إشارات TradingView على حساب Paper",
      required: preferences.requiresAuthenticationForSensitiveActions
    )
    guard authorized else { return }
    await model.setTradingControlReception(
      enabled: true,
      liveConfirmation: confirmation
    )
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
