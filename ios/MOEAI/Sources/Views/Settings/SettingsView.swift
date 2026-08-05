import SwiftUI
import UserNotifications

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var notifications: NotificationManager

  @State private var serverURL = ""
  @State private var liveConfirmation = ""
  @State private var showLiveConfirmation = false
  @State private var showActivateKillSwitch = false
  @State private var showClearKillSwitch = false

  private var receptionEnabled: Bool {
    model.status.runtime?.receptionEnabled == true
  }

  private var killSwitchActive: Bool {
    model.status.runtime?.killSwitchActive == true
  }

  var body: some View {
    Form {
      connectionSection
      accountSection
      safetySection
      notificationsSection
      securitySection
      applicationSection
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الإعدادات")
    .onAppear { serverURL = session.baseURLText }
    .alert("تفعيل الحساب الحقيقي", isPresented: $showLiveConfirmation) {
      TextField("اكتب CONFIRM", text: $liveConfirmation)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
      Button("تفعيل", role: .destructive) {
        let confirmation = liveConfirmation.trimmingCharacters(in: .whitespacesAndNewlines)
        liveConfirmation = ""
        Task { await model.setReception(enabled: true, liveConfirmation: confirmation) }
      }
      Button("إلغاء", role: .cancel) { liveConfirmation = "" }
    } message: {
      Text("لن يطلب التطبيق التفعيل إلا إذا سمح Worker بالحساب الحقيقي واجتازت جميع بوابات الأمان. اكتب CONFIRM للمتابعة.")
    }
    .confirmationDialog(
      "تفعيل مفتاح الإيقاف الطارئ؟",
      isPresented: $showActivateKillSwitch,
      titleVisibility: .visible
    ) {
      Button("تفعيل Kill Switch", role: .destructive) {
        Task { await model.activateKillSwitch() }
      }
      Button("إلغاء", role: .cancel) {}
    } message: {
      Text("سيوقف استقبال الإشارات ويحاول إغلاق المراكز وفق سياسة الخادم.")
    }
    .confirmationDialog(
      "مسح مفتاح الإيقاف؟",
      isPresented: $showClearKillSwitch,
      titleVisibility: .visible
    ) {
      Button("مسح Kill Switch") {
        Task { await model.clearKillSwitch() }
      }
      Button("إلغاء", role: .cancel) {}
    } message: {
      Text("سيبقى استقبال الإشارات متوقفًا بعد المسح إلى أن تفعّله يدويًا.")
    }
  }

  private var connectionSection: some View {
    Section("الاتصال") {
      TextField("Cloudflare Worker URL", text: $serverURL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(.URL)

      Button("حفظ واختبار الرابط") {
        session.baseURLText = serverURL
        Task {
          if await session.saveServerURL() {
            await model.loadAll()
          }
        }
      }

      LabeledContent("الوضع", value: model.status.mode ?? "—")
      LabeledContent("المصدر", value: model.status.executionSource ?? "—")
      LabeledContent("آخر تحديث", value: model.lastRefresh?.formatted(date: .omitted, time: .shortened) ?? "—")

      if let error = session.errorMessage {
        Text(error)
          .font(.footnote)
          .foregroundStyle(MOETheme.negative)
      }
    }
  }

  private var accountSection: some View {
    Section("الحساب") {
      Picker("الحساب المعروض", selection: $model.selectedAccount) {
        Text("Demo / Paper").tag("DEMO")
        Text("Live").tag("LIVE")
      }

      LabeledContent("نوع التشغيل", value: model.status.settings?.tradingMode ?? "—")
      LabeledContent("الحد الأقصى للمراكز", value: "\(model.status.settings?.maxOpenPositions ?? 0)")
      LabeledContent("حجم الصفقة", value: formatCurrency(model.status.settings?.positionSizeDollars))
      LabeledContent("حالة الحساب", value: model.activeAccount.connected == true ? "متصل" : (model.activeAccount.locked == true ? "مقفل" : "غير متصل"))
    }
  }

  private var safetySection: some View {
    Section("التحكم والأمان") {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text("استقبال إشارات TradingView")
          Text(receptionEnabled ? "مفعّل" : "متوقف")
            .font(.caption)
            .foregroundStyle(receptionEnabled ? MOETheme.positive : MOETheme.muted)
        }
        Spacer()
        Button(receptionEnabled ? "إيقاف" : "تفعيل") {
          if receptionEnabled {
            Task { await model.setReception(enabled: false) }
          } else if model.isLiveSelected {
            showLiveConfirmation = true
          } else {
            Task { await model.setReception(enabled: true) }
          }
        }
        .buttonStyle(.borderedProminent)
        .tint(receptionEnabled ? MOETheme.negative : MOETheme.accent)
        .disabled(model.pendingAction != nil)
      }

      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text("Kill Switch")
          Text(killSwitchActive ? "مفعّل" : "غير مفعّل")
            .font(.caption)
            .foregroundStyle(killSwitchActive ? MOETheme.negative : MOETheme.positive)
        }
        Spacer()
        Button(killSwitchActive ? "مسح" : "تفعيل") {
          if killSwitchActive {
            showClearKillSwitch = true
          } else {
            showActivateKillSwitch = true
          }
        }
        .buttonStyle(.bordered)
        .tint(killSwitchActive ? MOETheme.warning : MOETheme.negative)
        .disabled(model.pendingAction != nil)
      }
    }
  }

  private var notificationsSection: some View {
    Section("الإشعارات") {
      LabeledContent("إذن النظام", value: notificationStatusText)

      Button(notifications.authorizationStatus == .authorized ? "إعادة تسجيل الجهاز" : "تفعيل الإشعارات") {
        Task {
          if notifications.authorizationStatus == .authorized {
            await notifications.retryRegistration()
          } else {
            await notifications.requestPermission()
          }
        }
      }
      .disabled(notifications.isRegistering)

      Button("اختبار إشعار محلي") {
        notifications.scheduleLocalTest()
      }
      .disabled(notifications.authorizationStatus != .authorized)

      if notifications.registrationSucceeded {
        Label("تم تسجيل APNs Token في Worker", systemImage: "checkmark.circle.fill")
          .font(.footnote)
          .foregroundStyle(MOETheme.positive)
      }

      if let token = notifications.deviceToken {
        LabeledContent("APNs Token") {
          Text(token)
            .font(.caption2.monospaced())
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }

      if let error = notifications.errorMessage {
        Text(error)
          .font(.footnote)
          .foregroundStyle(MOETheme.warning)
      }
    }
  }

  private var securitySection: some View {
    Section("الجهاز") {
      Button("قفل التطبيق") {
        session.signOut()
      }

      Button("نسيان هذا الجهاز", role: .destructive) {
        session.forgetDevice()
      }
    }
  }

  private var applicationSection: some View {
    Section("التطبيق") {
      LabeledContent("الواجهة", value: "SwiftUI Native")
      LabeledContent("Safari / WebView", value: "غير مستخدم")
      LabeledContent("الإصدار", value: appVersionDescription)
      LabeledContent("Bundle ID", value: Bundle.main.bundleIdentifier ?? "—")
    }
  }

  private var notificationStatusText: String {
    switch notifications.authorizationStatus {
    case .notDetermined: return "لم يُطلب"
    case .denied: return "مرفوض"
    case .authorized: return "مفعّل"
    case .provisional: return "مؤقت"
    case .ephemeral: return "مؤقت للتطبيق"
    @unknown default: return "غير معروف"
    }
  }
}
