import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var session: SessionStore
  @EnvironmentObject private var notifications: NotificationManager
  @EnvironmentObject private var network: NetworkMonitor

  @State private var serverURL = ""
  @State private var liveConfirmation = ""
  @State private var showLiveConfirmation = false
  @State private var showActivateKillSwitch = false
  @State private var showClearKillSwitch = false
  @State private var showDiagnostics = false
  @State private var isPreparingDiagnostics = false
  @State private var diagnosticsReport = ""

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
      diagnosticsSection
      applicationSection
    }
    .scrollContentBackground(.hidden)
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("الإعدادات")
    .onAppear { serverURL = session.baseURLText }
    .sheet(isPresented: $showDiagnostics) {
      NavigationStack {
        ScrollView {
          Text(diagnosticsReport)
            .font(.caption.monospaced())
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .padding()
        }
        .background(AppBackground())
        .foregroundStyle(.white)
        .navigationTitle("تقرير التشخيص")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            Button("إغلاق") { showDiagnostics = false }
          }
          ToolbarItem(placement: .topBarTrailing) {
            ShareLink(item: diagnosticsReport) {
              Image(systemName: "square.and.arrow.up")
            }
            .accessibilityLabel("مشاركة تقرير التشخيص")
          }
        }
      }
      .preferredColorScheme(.dark)
    }
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

      LabeledContent("الشبكة", value: network.snapshot.statusText)
      LabeledContent("نوع الاتصال", value: network.snapshot.detailsText)
      LabeledContent("الوضع", value: model.status.mode ?? "—")
      LabeledContent("المصدر", value: model.status.executionSource ?? "—")
      LabeledContent("آخر تحديث", value: model.lastRefresh?.formatted(date: .omitted, time: .shortened) ?? "—")

      if model.consecutiveRequestFailures > 0 {
        LabeledContent(
          "إخفاقات متتالية",
          value: "\(model.consecutiveRequestFailures)"
        )
        .foregroundStyle(MOETheme.warning)
      }

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
        .disabled(model.pendingAction != nil || !network.snapshot.isConnected)
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
        .disabled(model.pendingAction != nil || !network.snapshot.isConnected)
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
      .disabled(notifications.isRegistering || !network.snapshot.isConnected)

      Button("اختبار إشعار محلي") {
        notifications.scheduleLocalTest()
      }
      .disabled(notifications.authorizationStatus != .authorized)

      if notifications.registrationSucceeded {
        Label("تم تسجيل الجهاز في Worker", systemImage: "checkmark.circle.fill")
          .font(.footnote)
          .foregroundStyle(MOETheme.positive)
      }

      if notifications.deviceToken != nil {
        LabeledContent("APNs Token", value: "متوفر ومحجوب للحماية")
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

  private var diagnosticsSection: some View {
    Section("التشخيص والدعم") {
      LabeledContent("حالة الشبكة", value: network.snapshot.statusText)
      LabeledContent("آخر طلب API", value: model.lastRefresh?.formatted(date: .omitted, time: .shortened) ?? "—")

      Button {
        Task { await prepareDiagnosticsReport() }
      } label: {
        HStack {
          Label("إنشاء تقرير تشخيص آمن", systemImage: "stethoscope")
          Spacer()
          if isPreparingDiagnostics {
            ProgressView()
          }
        }
      }
      .disabled(isPreparingDiagnostics)

      Text("لا يتضمن التقرير PIN أو Cookies أو APNs Token أو مفاتيح Apple أو Webull أو Cloudflare.")
        .font(.footnote)
        .foregroundStyle(MOETheme.muted)
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

  @MainActor
  private func prepareDiagnosticsReport() async {
    isPreparingDiagnostics = true
    let apiDiagnostics = await APIClient.shared.diagnosticsSnapshot()

    diagnosticsReport = SupportDiagnostics.makeReport(
      generatedAt: Date(),
      appVersion: appVersionDescription,
      bundleIdentifier: Bundle.main.bundleIdentifier ?? "unknown",
      systemVersion: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
      deviceModel: UIDevice.current.model,
      network: network.snapshot,
      workerURLText: session.baseURLText,
      authenticated: session.isAuthenticated,
      selectedAccount: model.selectedAccount,
      mode: model.status.mode,
      executionSource: model.status.executionSource,
      lastRefresh: model.lastRefresh,
      lastErrorAt: model.lastErrorAt,
      requestFailureCount: model.consecutiveRequestFailures,
      modelError: model.lastErrorMessage,
      sessionError: session.errorMessage,
      notificationStatus: notificationStatusText,
      pushRegistered: notifications.registrationSucceeded,
      pushTokenAvailable: notifications.deviceToken != nil,
      pushError: notifications.errorMessage,
      apiDiagnostics: apiDiagnostics
    )

    isPreparingDiagnostics = false
    showDiagnostics = true
  }
}

enum SupportDiagnostics {
  static func makeReport(
    generatedAt: Date,
    appVersion: String,
    bundleIdentifier: String,
    systemVersion: String,
    deviceModel: String,
    network: NetworkSnapshot,
    workerURLText: String,
    authenticated: Bool,
    selectedAccount: String,
    mode: String?,
    executionSource: String?,
    lastRefresh: Date?,
    lastErrorAt: Date?,
    requestFailureCount: Int,
    modelError: String?,
    sessionError: String?,
    notificationStatus: String,
    pushRegistered: Bool,
    pushTokenAvailable: Bool,
    pushError: String?,
    apiDiagnostics: APIRequestDiagnostics
  ) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    func dateText(_ date: Date?) -> String {
      guard let date else { return "none" }
      return formatter.string(from: date)
    }

    let lines = [
      "MOE-AI Support Diagnostics",
      "generated_at=\(dateText(generatedAt))",
      "app_version=\(sanitized(appVersion))",
      "bundle_id=\(sanitized(bundleIdentifier))",
      "system=\(sanitized(systemVersion))",
      "device_model=\(sanitized(deviceModel))",
      "network_status=\(network.statusText)",
      "network_interface=\(sanitized(network.interfaceName))",
      "network_expensive=\(network.isExpensive)",
      "network_constrained=\(network.isConstrained)",
      "network_updated_at=\(dateText(network.updatedAt))",
      "worker_endpoint=\(workerEndpointSummary(workerURLText))",
      "authenticated=\(authenticated)",
      "selected_account=\(sanitized(selectedAccount))",
      "worker_mode=\(sanitized(mode))",
      "execution_source=\(sanitized(executionSource))",
      "last_refresh=\(dateText(lastRefresh))",
      "last_error_at=\(dateText(lastErrorAt))",
      "consecutive_request_failures=\(requestFailureCount)",
      "last_model_error=\(sanitized(modelError))",
      "last_session_error=\(sanitized(sessionError))",
      "notification_authorization=\(sanitized(notificationStatus))",
      "push_registered=\(pushRegistered)",
      "push_token_available=\(pushTokenAvailable)",
      "last_push_error=\(sanitized(pushError))",
      "api_request_id=\(sanitized(apiDiagnostics.requestID))",
      "api_method=\(sanitized(apiDiagnostics.method))",
      "api_path=\(sanitized(apiDiagnostics.path))",
      "api_status_code=\(apiDiagnostics.statusCode.map(String.init) ?? "none")",
      "api_attempts=\(apiDiagnostics.attempts)",
      "api_outcome=\(sanitized(apiDiagnostics.outcome))",
      "api_completed_at=\(dateText(apiDiagnostics.completedAt))",
      "security_note=PIN, cookies, APNs device tokens, Apple keys, Webull keys, and Cloudflare secrets are excluded."
    ]

    return lines.joined(separator: "\n")
  }

  static func workerEndpointSummary(_ value: String) -> String {
    guard let url = AppConfiguration.normalizedURL(from: value),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let scheme = components.scheme,
      let host = components.host
    else {
      return "invalid"
    }

    let port = components.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(port)"
  }

  static func sanitized(_ value: String?) -> String {
    guard var output = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      !output.isEmpty
    else {
      return "none"
    }

    let replacements: [(pattern: String, template: String)] = [
      (#"(?i)\b(authorization|cookie|set-cookie|pin|secret|token|api[_-]?key)\b\s*[:=]\s*[^\n,;]+"#, "$1=<redacted>"),
      (#"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"#, "Bearer <redacted>"),
      (#"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"#, "<redacted-jwt>"),
      (#"\b[A-Fa-f0-9]{32,}\b"#, "<redacted-hex>")
    ]

    for replacement in replacements {
      guard let expression = try? NSRegularExpression(
        pattern: replacement.pattern,
        options: []
      ) else {
        continue
      }
      let range = NSRange(output.startIndex..<output.endIndex, in: output)
      output = expression.stringByReplacingMatches(
        in: output,
        options: [],
        range: range,
        withTemplate: replacement.template
      )
    }

    return output.replacingOccurrences(of: "\n", with: " ")
  }
}
