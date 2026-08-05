import Combine
import Foundation
import LocalAuthentication

@MainActor
final class SessionStore: ObservableObject {
  @Published private(set) var isAuthenticated = false
  @Published private(set) var isBusy = false
  @Published private(set) var isRestoring = true
  @Published private(set) var faceIDAvailable = false
  @Published var errorMessage: String?
  @Published var baseURLText: String

  private let pinAccount = "control-pin"
  private var sessionExpiredObserver: NSObjectProtocol?

  var hasSavedPIN: Bool {
    (try? KeychainStore.read(account: pinAccount)) != nil
  }

  init() {
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
    guard hasSavedPIN else { return }
    await unlockWithFaceID()
  }

  func refreshBiometricAvailability() {
    let context = LAContext()
    var error: NSError?
    faceIDAvailable = context.canEvaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics,
      error: &error
    )
  }

  func login(pin: String, remember: Bool = true) async {
    let normalizedPIN = pin.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedPIN.isEmpty else {
      errorMessage = "أدخل الرمز السري."
      return
    }

    guard let baseURL = AppConfiguration.normalizedURL(from: baseURLText) else {
      errorMessage = APIError.invalidBaseURL.localizedDescription
      return
    }

    isBusy = true
    errorMessage = nil
    defer { isBusy = false }

    do {
      await APIClient.shared.updateBaseURL(baseURL)
      let response = try await APIClient.shared.login(pin: normalizedPIN)
      guard response.ok != false else {
        throw APIError.server(statusCode: 401, message: response.error ?? "تعذر تسجيل الدخول.")
      }

      UserDefaults.standard.set(baseURL.absoluteString, forKey: AppConfiguration.workerURLDefaultsKey)
      baseURLText = baseURL.absoluteString

      if remember {
        try KeychainStore.save(normalizedPIN, account: pinAccount)
      } else {
        try? KeychainStore.delete(account: pinAccount)
      }

      isAuthenticated = true
    } catch {
      isAuthenticated = false
      errorMessage = error.localizedDescription
    }
  }

  func unlockWithFaceID() async {
    let savedPIN: String
    do {
      guard let pin = try KeychainStore.read(account: pinAccount) else {
        errorMessage = "أدخل الرمز السري أولًا لتفعيل Face ID."
        return
      }
      savedPIN = pin
    } catch {
      errorMessage = error.localizedDescription
      return
    }

    let context = LAContext()
    context.localizedCancelTitle = "استخدام الرمز"
    context.localizedFallbackTitle = "إدخال الرمز"

    var policyError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &policyError) else {
      faceIDAvailable = false
      errorMessage = policyError?.localizedDescription ?? "Face ID غير متاح على هذا الجهاز."
      return
    }

    do {
      let allowed = try await context.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: "فتح لوحة MOE-AI الآمنة"
      )
      if allowed {
        await login(pin: savedPIN, remember: true)
      }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func saveServerURL() async -> Bool {
    guard let baseURL = AppConfiguration.normalizedURL(from: baseURLText) else {
      errorMessage = APIError.invalidBaseURL.localizedDescription
      return false
    }

    baseURLText = baseURL.absoluteString
    UserDefaults.standard.set(baseURL.absoluteString, forKey: AppConfiguration.workerURLDefaultsKey)
    await APIClient.shared.updateBaseURL(baseURL)
    errorMessage = nil
    return true
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
}
