import Combine
import Foundation
import LocalAuthentication

protocol DeviceAuthenticating {
  func biometricsAvailable() -> Bool
  func authenticateWithBiometrics(reason: String) async throws -> Bool
  func authenticateDeviceOwner(reason: String) async throws -> Bool
}

struct SystemDeviceAuthenticator: DeviceAuthenticating {
  func biometricsAvailable() -> Bool {
    let context = LAContext()
    var error: NSError?
    return context.canEvaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics,
      error: &error
    )
  }

  func authenticateWithBiometrics(reason: String) async throws -> Bool {
    let context = LAContext()
    context.localizedCancelTitle = "استخدام الرمز"
    context.localizedFallbackTitle = "إدخال الرمز"
    return try await context.evaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics,
      localizedReason: reason
    )
  }

  func authenticateDeviceOwner(reason: String) async throws -> Bool {
    let context = LAContext()
    context.localizedCancelTitle = "إلغاء"
    return try await context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: reason
    )
  }
}

@MainActor
final class SessionStore: ObservableObject {
  @Published private(set) var isAuthenticated = false
  @Published private(set) var isBusy = false
  @Published private(set) var isRestoring = true
  @Published private(set) var faceIDAvailable = false
  @Published private(set) var isAuthorizingSensitiveAction = false
  @Published var errorMessage: String?
  @Published var baseURLText: String

  private let pinAccount = "control-pin"
  private let deviceAuthenticator: any DeviceAuthenticating
  private var sessionExpiredObserver: NSObjectProtocol?

  var hasSavedPIN: Bool {
    (try? KeychainStore.contains(account: pinAccount)) == true
  }

  init(deviceAuthenticator: any DeviceAuthenticating = SystemDeviceAuthenticator()) {
    self.deviceAuthenticator = deviceAuthenticator
    baseURLText = AppConfiguration.storedWorkerURL
    sessionExpiredObserver = NotificationCenter.default.addObserver(
      forName: .moeSessionExpired,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor in
        self?.isAuthenticated = false
        self?.errorMessage = "انتهت الجلسة. سجّل الدخول مرة أخرى."
      }
    }
  }

  deinit {
    if let sessionExpiredObserver {
      NotificationCenter.default.removeObserver(sessionExpiredObserver)
    }
  }

  func restore() async {
    defer { isRestoring = false }
    refreshBiometricAvailability()
    guard hasSavedPIN, faceIDAvailable else { return }
    await unlockWithFaceID()
  }

  func refreshBiometricAvailability() {
    faceIDAvailable = deviceAuthenticator.biometricsAvailable()
  }

  func login(pin: String, remember: Bool = true) async {
    let normalizedPIN = pin.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedPIN.isEmpty else {
      errorMessage = "أدخل الرمز السري."
      return
    }

    guard !isBusy else { return }
    isBusy = true
    errorMessage = nil
    defer { isBusy = false }

    do {
      try await authenticateWithServer(pin: normalizedPIN, remember: remember)
    } catch {
      isAuthenticated = false
      errorMessage = error.localizedDescription
    }
  }

  func unlockWithFaceID() async {
    guard hasSavedPIN else {
      errorMessage = "أدخل الرمز السري أولًا لتفعيل Face ID."
      return
    }

    refreshBiometricAvailability()
    guard faceIDAvailable else {
      errorMessage = "Face ID غير متاح على هذا الجهاز."
      return
    }

    guard !isBusy else { return }
    isBusy = true
    errorMessage = nil
    defer { isBusy = false }

    do {
      let allowed = try await deviceAuthenticator.authenticateWithBiometrics(
        reason: "فتح لوحة MOE-AI الآمنة"
      )
      guard allowed else { return }

      guard let savedPIN = try KeychainStore.read(account: pinAccount) else {
        errorMessage = "تعذر العثور على الرمز المحفوظ. أدخله من جديد."
        return
      }

      try await authenticateWithServer(pin: savedPIN, remember: true)
    } catch {
      handleLocalAuthenticationError(error)
    }
  }

  func authorizeSensitiveAction(reason: String, required: Bool) async -> Bool {
    guard required else { return true }
    guard !isAuthorizingSensitiveAction else { return false }

    isAuthorizingSensitiveAction = true
    errorMessage = nil
    defer { isAuthorizingSensitiveAction = false }

    do {
      let allowed = try await deviceAuthenticator.authenticateDeviceOwner(reason: reason)
      if !allowed {
        errorMessage = "لم يتم اعتماد العملية الحساسة."
      }
      return allowed
    } catch {
      handleLocalAuthenticationError(error)
      return false
    }
  }

  func saveServerURL() async -> Bool {
    guard let baseURL = AppConfiguration.normalizedURL(from: baseURLText) else {
      errorMessage = APIError.invalidBaseURL.localizedDescription
      return false
    }

    guard AppConfiguration.allowsCustomWorkerURL || AppConfiguration.isDefaultWorkerURL(baseURL) else {
      errorMessage = "إصدار TestFlight يستخدم خادم MOE-AI المعتمد فقط."
      return false
    }

    let previousURL = AppConfiguration.normalizedURL(from: AppConfiguration.storedWorkerURL)
    let changed = previousURL?.absoluteString != baseURL.absoluteString
    let wasAuthenticated = isAuthenticated

    baseURLText = baseURL.absoluteString
    if AppConfiguration.allowsCustomWorkerURL {
      UserDefaults.standard.set(
        baseURL.absoluteString,
        forKey: AppConfiguration.workerURLDefaultsKey
      )
    }
    await APIClient.shared.updateBaseURL(baseURL)

    if changed && wasAuthenticated {
      HTTPCookieStorage.shared.removeCookies(since: .distantPast)
      isAuthenticated = false
      errorMessage = "تم تغيير خادم Worker. سجّل الدخول من جديد قبل عرض بيانات التداول."
    } else {
      errorMessage = nil
    }
    return true
  }

  /// Removes sensitive trading data from the screen without deleting the saved
  /// PIN or changing the configured Worker URL. Face ID/PIN is required again.
  func lockForPrivacy() {
    guard isAuthenticated else { return }
    isAuthenticated = false
    errorMessage = nil
  }

  func signOut() {
    HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    isAuthenticated = false
    errorMessage = nil
  }

  func forgetDevice() {
    do {
      try KeychainStore.delete(account: pinAccount)
    } catch {
      errorMessage = error.localizedDescription
    }
    signOut()
    refreshBiometricAvailability()
  }

  private func authenticateWithServer(pin: String, remember: Bool) async throws {
    guard let baseURL = AppConfiguration.normalizedURL(from: baseURLText) else {
      throw APIError.invalidBaseURL
    }

    await APIClient.shared.updateBaseURL(baseURL)
    let response = try await APIClient.shared.login(pin: pin)
    guard response.ok != false else {
      throw APIError.server(
        statusCode: 401,
        message: response.error ?? "تعذر تسجيل الدخول."
      )
    }

    if AppConfiguration.allowsCustomWorkerURL {
      UserDefaults.standard.set(
        baseURL.absoluteString,
        forKey: AppConfiguration.workerURLDefaultsKey
      )
    }
    baseURLText = baseURL.absoluteString

    var keychainWarning: String?
    if remember {
      do {
        try KeychainStore.save(pin, account: pinAccount)
      } catch {
        keychainWarning = error.localizedDescription
      }
    } else {
      try? KeychainStore.delete(account: pinAccount)
    }

    isAuthenticated = true
    if let keychainWarning {
      errorMessage = "تم تسجيل الدخول، لكن لم يُحفظ الرمز: \(keychainWarning)"
    }
  }

  private func handleLocalAuthenticationError(_ error: Error) {
    let nsError = error as NSError
    if nsError.domain == LAError.errorDomain,
      [
        LAError.Code.userCancel.rawValue,
        LAError.Code.appCancel.rawValue,
        LAError.Code.systemCancel.rawValue,
      ].contains(nsError.code)
    {
      errorMessage = nil
      return
    }
    errorMessage = error.localizedDescription
  }
}
