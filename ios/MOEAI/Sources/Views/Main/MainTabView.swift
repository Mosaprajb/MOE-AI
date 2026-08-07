import SwiftUI

struct MainTabView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var network: NetworkMonitor
  @EnvironmentObject private var notifications: NotificationManager
  @EnvironmentObject private var preferences: AppPreferences

  private var activeErrorMessage: String? {
    model.errorMessage ?? session.errorMessage
  }

  var body: some View {
    TabView(selection: $notifications.selectedTab) {
      NavigationStack { TradingDashboardContainerView() }
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
    .task(id: preferences.autoRefreshInterval) {
      if model.lastRefresh == nil, network.snapshot.isConnected {
        await model.loadAll()
      }

      let seconds = preferences.autoRefreshInterval.seconds
      guard seconds > 0 else { return }
      let delay = UInt64(seconds * 1_000_000_000)

      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: delay)
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
        get: { activeErrorMessage != nil },
        set: { isPresented in
          if !isPresented {
            model.errorMessage = nil
            session.errorMessage = nil
          }
        }
      )
    ) {
      Button("حسنًا") {
        model.errorMessage = nil
        session.errorMessage = nil
      }
    } message: {
      Text(activeErrorMessage ?? "")
    }
  }
}

private struct TradingDashboardContainerView: View {
  var body: some View {
    DashboardView()
      .safeAreaInset(edge: .bottom, spacing: 8) {
        NavigationLink {
          TradingProtectionSettingsView()
        } label: {
          HStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled.badge.checkmark")
            VStack(alignment: .leading, spacing: 2) {
              Text("إيقاف الخسارة · أخذ الأرباح · التريلنغ")
                .font(.subheadline.weight(.bold))
              Text("إعدادات مستقلة لـ Paper و Live")
                .font(.caption2)
                .foregroundStyle(MOETheme.muted)
            }
            Spacer()
            Image(systemName: "chevron.forward")
              .font(.caption.bold())
              .foregroundStyle(MOETheme.muted)
          }
          .foregroundStyle(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 11)
          .background(MOETheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .stroke(Color.white.opacity(0.08))
              .allowsHitTesting(false)
          }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
      }
  }
}

private struct TradingProtectionSettingsView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var network: NetworkMonitor
  @EnvironmentObject private var preferences: AppPreferences

  @State private var stopLossPctText = ""
  @State private var takeProfitPctText = ""
  @State private var trailingEnabled = false
  @State private var trailActivationCentsText = ""
  @State private var trailInitialStopCentsText = ""
  @State private var trailTriggerStepCentsText = ""
  @State private var trailStopMoveCentsText = ""

  private var control: TradingControlStatus? { model.selectedTradingControl }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        GlassCard {
          VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "حماية الصفقة")
            Text("هذه القيم تُحفظ بشكل مستقل لكل حساب وتُستخدم من Worker، ولا يمكن لتنبيه TradingView تجاوزها.")
              .font(.caption)
              .foregroundStyle(MOETheme.muted)

            Picker("الحساب", selection: $model.selectedAccount) {
              Text("Paper Trading").tag("DEMO")
              Text("Live").tag("LIVE")
            }
            .pickerStyle(.segmented)

            HStack {
              StatusPill(
                title: model.isLiveSelected ? "LIVE" : "PAPER",
                isPositive: !model.isLiveSelected
              )
              Spacer()
              StatusPill(
                title: model.receptionEnabledForSelectedAccount ? "ARMED" : "OFF",
                isPositive: model.receptionEnabledForSelectedAccount
              )
            }
          }
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Stop Loss / Take Profit")

            HStack(spacing: 12) {
              protectionInput(
                title: "Stop Loss %",
                placeholder: "2.0",
                text: $stopLossPctText
              )
              protectionInput(
                title: "Take Profit %",
                placeholder: "3.0",
                text: $takeProfitPctText
              )
            }

            Text("بعد تنفيذ BUY يتم إنشاء حماية SL وTP من إعدادات الحساب المحفوظة. يتم تصحيح الأسعار إلى متوسط سعر التنفيذ الفعلي عند توفره.")
              .font(.caption2)
              .foregroundStyle(MOETheme.muted)
          }
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 14) {
            Toggle(isOn: $trailingEnabled) {
              VStack(alignment: .leading, spacing: 3) {
                Text("Step Trailing Stop")
                  .font(.headline)
                Text("تحويل الحماية إلى ستوب متدرج بعد تحقيق ربح محدد")
                  .font(.caption2)
                  .foregroundStyle(MOETheme.muted)
              }
            }
            .tint(MOETheme.positive)

            if trailingEnabled {
              HStack(spacing: 12) {
                protectionInput(
                  title: "التفعيل +¢",
                  placeholder: "5",
                  text: $trailActivationCentsText
                )
                protectionInput(
                  title: "أول Stop +¢",
                  placeholder: "2",
                  text: $trailInitialStopCentsText
                )
              }

              HStack(spacing: 12) {
                protectionInput(
                  title: "كل ارتفاع ¢",
                  placeholder: "5",
                  text: $trailTriggerStepCentsText
                )
                protectionInput(
                  title: "حرّك Stop +¢",
                  placeholder: "1",
                  text: $trailStopMoveCentsText
                )
              }

              Text("مثال: تفعيل 5¢ + أول Stop عند سعر الدخول +2¢ + كل ارتفاع إضافي 5¢ حرّك الـStop للأعلى 1¢. أول Stop يُقاس من سعر الدخول ويظل أسفل سعر السوق الحالي.")
                .font(.caption2)
                .foregroundStyle(MOETheme.muted)

              if !trailingValuesAreValid {
                InlineErrorView(message: "يجب أن يكون أول Stop أقل من مسافة التفعيل، وأن تكون حركة Stop موجبة ولا تتجاوز خطوة الارتفاع.")
              }
            } else {
              Text("عند إيقاف التريلنغ تبقى حماية Stop Loss وTake Profit الثابتة فقط.")
                .font(.caption2)
                .foregroundStyle(MOETheme.muted)
            }
          }
        }

        if let blockers = control?.blockers, !blockers.isEmpty {
          GlassCard {
            VStack(alignment: .leading, spacing: 7) {
              SectionTitle(title: "حالة الحساب")
              ForEach(blockers, id: \.self) { blocker in
                Label(blocker, systemImage: "exclamationmark.triangle.fill")
                  .font(.caption)
                  .foregroundStyle(MOETheme.warning)
              }
            }
          }
        }

        if let error = model.tradingControlErrorMessage {
          InlineErrorView(message: error)
        }

        Button {
          Task { await saveProtectionSettings() }
        } label: {
          LoadingButtonLabel(
            title: model.pendingAction == "trading-control-save" ? "جارٍ الحفظ…" : "حفظ حماية الحساب",
            icon: "shield.checkered",
            loading: model.pendingAction == "trading-control-save"
          )
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .tint(MOETheme.accent)
        .disabled(!formIsValid || model.pendingAction != nil || !network.snapshot.isConnected)

        Text("حفظ أي تغيير في إعدادات الحماية يوقف استقبال TradingView لهذا الحساب تلقائيًا. راجع القيم ثم أعد ARM من الصفحة الرئيسية.")
          .font(.caption)
          .foregroundStyle(MOETheme.warning)
          .multilineTextAlignment(.leading)
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("حماية التداول")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: model.selectedAccount) {
      await model.loadTradingControl(for: model.selectedAccount, silently: true)
      syncFields()
    }
    .onAppear { syncFields() }
  }

  private func protectionInput(
    title: String,
    placeholder: String,
    text: Binding<String>
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.caption.weight(.bold))
        .foregroundStyle(MOETheme.muted)
      TextField(placeholder, text: text)
        .textFieldStyle(.plain)
        .foregroundStyle(.white)
        .tint(MOETheme.accent)
        .keyboardType(.decimalPad)
        .autocorrectionDisabled()
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
          RoundedRectangle(cornerRadius: 12)
            .stroke(Color.white.opacity(0.08))
            .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
    }
    .frame(maxWidth: .infinity)
  }

  private var formIsValid: Bool {
    parsedDouble(stopLossPctText) > 0
      && parsedDouble(takeProfitPctText) > 0
      && (!trailingEnabled || trailingValuesAreValid)
  }

  private var trailingValuesAreValid: Bool {
    let activation = parsedDouble(trailActivationCentsText)
    let firstStop = parsedDouble(trailInitialStopCentsText)
    let triggerStep = parsedDouble(trailTriggerStepCentsText)
    let stopMove = parsedDouble(trailStopMoveCentsText)
    return activation > 0
      && firstStop >= 0
      && firstStop < activation
      && triggerStep > 0
      && stopMove > 0
      && stopMove <= triggerStep
  }

  private func parsedDouble(_ value: String) -> Double {
    Double(value.replacingOccurrences(of: ",", with: ".")) ?? 0
  }

  private func centsString(_ usd: Double) -> String {
    let cents = usd * 100
    if abs(cents.rounded() - cents) < 0.0001 {
      return String(format: "%.0f", cents)
    }
    return String(format: "%.2f", cents)
  }

  private func syncFields() {
    guard let settings = control?.settings else { return }
    stopLossPctText = String(format: "%.2f", settings.stopLossPct)
    takeProfitPctText = String(format: "%.2f", settings.takeProfitPct)
    trailingEnabled = settings.trailingEnabled
    trailActivationCentsText = centsString(settings.trailActivationUsd)
    trailInitialStopCentsText = centsString(settings.trailInitialStopOffsetUsd)
    trailTriggerStepCentsText = centsString(settings.trailTriggerStepUsd)
    trailStopMoveCentsText = centsString(settings.trailStopMoveUsd)
  }

  private func saveProtectionSettings() async {
    guard let existing = control?.settings else { return }
    let authorized = await session.authorizeSensitiveAction(
      reason: "حفظ Stop Loss وTake Profit وStep Trailing للحساب المحدد",
      required: preferences.requiresAuthenticationForSensitiveActions
    )
    guard authorized else { return }

    await model.saveTradingControl(
      sessions: existing.allowedSessions,
      timeInForce: existing.timeInForce,
      shareQuantity: existing.shareQuantity,
      maxTradeAmountUsd: existing.maxTradeAmountUsd,
      stopLossPct: parsedDouble(stopLossPctText),
      takeProfitPct: parsedDouble(takeProfitPctText),
      trailingEnabled: trailingEnabled,
      trailActivationUsd: parsedDouble(trailActivationCentsText) / 100,
      trailInitialStopOffsetUsd: parsedDouble(trailInitialStopCentsText) / 100,
      trailTriggerStepUsd: parsedDouble(trailTriggerStepCentsText) / 100,
      trailStopMoveUsd: parsedDouble(trailStopMoveCentsText) / 100
    )
    syncFields()
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
