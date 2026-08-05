import Foundation

enum AppConfiguration {
  static let defaultWorkerURL = "https://moerand-alerts-sandbox.mosaprajb.workers.dev"
  static let workerURLDefaultsKey = "moe.worker.baseURL"
  static let selectedAccountDefaultsKey = "moe.selectedAccount"
  static let pushRegistrationPathDefaultsKey = "moe.push.registrationPath"
  static let defaultPushRegistrationPath = "/api/mobile/push/register"

  /// The app switcher is covered immediately. After this amount of time in the
  /// background, returning to MOE-AI requires the saved PIN/Face ID again.
  static let privacyLockTimeout: TimeInterval = 30

  static var storedWorkerURL: String {
    UserDefaults.standard.string(forKey: workerURLDefaultsKey) ?? defaultWorkerURL
  }

  static var pushRegistrationPath: String {
    UserDefaults.standard.string(forKey: pushRegistrationPathDefaultsKey)
      ?? defaultPushRegistrationPath
  }

  static func normalizedURL(from value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard var components = URLComponents(string: trimmed),
      let scheme = components.scheme?.lowercased(),
      ["https", "http"].contains(scheme),
      components.host != nil
    else {
      return nil
    }

    var normalizedPath = components.path
    while normalizedPath.count > 1 && normalizedPath.hasSuffix("/") {
      normalizedPath.removeLast()
    }
    components.path = normalizedPath == "/" ? "" : normalizedPath
    components.query = nil
    components.fragment = nil
    return components.url
  }
}
