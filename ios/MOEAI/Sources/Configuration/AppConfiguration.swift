import Combine
import Foundation
import Network

enum AutoLockInterval: Double, CaseIterable, Hashable, Identifiable, Sendable {
  case immediately = 0
  case thirtySeconds = 30
  case oneMinute = 60
  case fiveMinutes = 300

  var id: Double { rawValue }
  var seconds: TimeInterval { rawValue }

  var displayName: String {
    switch self {
    case .immediately: return "فورًا"
    case .thirtySeconds: return "بعد 30 ثانية"
    case .oneMinute: return "بعد دقيقة"
    case .fiveMinutes: return "بعد 5 دقائق"
    }
  }
}

enum AutoRefreshInterval: Double, CaseIterable, Hashable, Identifiable, Sendable {
  case off = 0
  case fifteenSeconds = 15
  case thirtySeconds = 30
  case oneMinute = 60

  var id: Double { rawValue }
  var seconds: TimeInterval { rawValue }

  var displayName: String {
    switch self {
    case .off: return "متوقف"
    case .fifteenSeconds: return "كل 15 ثانية"
    case .thirtySeconds: return "كل 30 ثانية"
    case .oneMinute: return "كل دقيقة"
    }
  }
}

@MainActor
final class AppPreferences: ObservableObject {
  private enum Key {
    static let autoLockInterval = "moe.preferences.autoLockInterval"
    static let autoRefreshInterval = "moe.preferences.autoRefreshInterval"
    static let requireSensitiveActionAuthentication =
      "moe.preferences.requireSensitiveActionAuthentication"
  }

  private let defaults: UserDefaults

  @Published var autoLockInterval: AutoLockInterval {
    didSet {
      defaults.set(autoLockInterval.rawValue, forKey: Key.autoLockInterval)
    }
  }

  @Published var autoRefreshInterval: AutoRefreshInterval {
    didSet {
      defaults.set(autoRefreshInterval.rawValue, forKey: Key.autoRefreshInterval)
    }
  }

  @Published var requiresAuthenticationForSensitiveActions: Bool {
    didSet {
      defaults.set(
        requiresAuthenticationForSensitiveActions,
        forKey: Key.requireSensitiveActionAuthentication
      )
    }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults

    if let value = defaults.object(forKey: Key.autoLockInterval) as? NSNumber,
      let interval = AutoLockInterval(rawValue: value.doubleValue)
    {
      autoLockInterval = interval
    } else {
      autoLockInterval = .thirtySeconds
    }

    if let value = defaults.object(forKey: Key.autoRefreshInterval) as? NSNumber,
      let interval = AutoRefreshInterval(rawValue: value.doubleValue)
    {
      autoRefreshInterval = interval
    } else {
      autoRefreshInterval = .fifteenSeconds
    }

    if defaults.object(forKey: Key.requireSensitiveActionAuthentication) == nil {
      requiresAuthenticationForSensitiveActions = true
    } else {
      requiresAuthenticationForSensitiveActions = defaults.bool(
        forKey: Key.requireSensitiveActionAuthentication
      )
    }
  }

  func reset() {
    autoLockInterval = .thirtySeconds
    autoRefreshInterval = .fifteenSeconds
    requiresAuthenticationForSensitiveActions = true
  }
}

enum AppConfiguration {
  static let defaultWorkerURL = "https://moerand-alerts-sandbox.mosaprajb.workers.dev"
  static let workerURLDefaultsKey = "moe.worker.baseURL"
  static let selectedAccountDefaultsKey = "moe.selectedAccount"
  static let pushRegistrationPathDefaultsKey = "moe.push.registrationPath"
  static let defaultPushRegistrationPath = "/api/mobile/push/register"

  static var allowsCustomWorkerURL: Bool {
    #if DEBUG
    true
    #else
    false
    #endif
  }

  static var storedWorkerURL: String {
    guard allowsCustomWorkerURL else { return defaultWorkerURL }
    return UserDefaults.standard.string(forKey: workerURLDefaultsKey) ?? defaultWorkerURL
  }

  static var pushRegistrationPath: String {
    UserDefaults.standard.string(forKey: pushRegistrationPathDefaultsKey)
      ?? defaultPushRegistrationPath
  }

  static func normalizedURL(from value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard var components = URLComponents(string: trimmed),
      let scheme = components.scheme?.lowercased(),
      let host = components.host?.lowercased(),
      !host.isEmpty,
      ["https", "http"].contains(scheme),
      components.user == nil,
      components.password == nil
    else {
      return nil
    }

    if scheme == "http" {
      #if DEBUG
      let localHosts = ["localhost", "127.0.0.1", "::1"]
      guard localHosts.contains(host) else { return nil }
      #else
      return nil
      #endif
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

  static func isDefaultWorkerURL(_ url: URL) -> Bool {
    guard let defaultURL = normalizedURL(from: defaultWorkerURL) else { return false }
    return url.absoluteString == defaultURL.absoluteString
  }
}

struct NetworkSnapshot: Equatable, Sendable {
  var isConnected: Bool
  var interfaceName: String
  var isExpensive: Bool
  var isConstrained: Bool
  var updatedAt: Date

  static let initial = NetworkSnapshot(
    isConnected: true,
    interfaceName: "جارٍ التحقق",
    isExpensive: false,
    isConstrained: false,
    updatedAt: Date()
  )

  var statusText: String {
    isConnected ? "متصل" : "غير متصل"
  }

  var detailsText: String {
    guard isConnected else { return "لا يوجد اتصال بالإنترنت" }
    var details = [interfaceName]
    if isConstrained { details.append("بيانات محدودة") }
    if isExpensive { details.append("اتصال خلوي/مكلف") }
    return details.joined(separator: " • ")
  }
}

@MainActor
final class NetworkMonitor: ObservableObject {
  @Published private(set) var snapshot = NetworkSnapshot.initial

  private let monitor: NWPathMonitor
  private let queue = DispatchQueue(
    label: "com.moerand.moeai.network-monitor",
    qos: .utility
  )

  init(monitor: NWPathMonitor = NWPathMonitor()) {
    self.monitor = monitor
    monitor.pathUpdateHandler = { [weak self] path in
      let updated = NetworkSnapshot(
        isConnected: path.status == .satisfied,
        interfaceName: Self.interfaceName(for: path),
        isExpensive: path.isExpensive,
        isConstrained: path.isConstrained,
        updatedAt: Date()
      )

      Task { @MainActor [weak self] in
        self?.snapshot = updated
      }
    }
    monitor.start(queue: queue)
  }

  deinit {
    monitor.cancel()
  }

  nonisolated private static func interfaceName(for path: NWPath) -> String {
    if path.usesInterfaceType(.wifi) { return "Wi-Fi" }
    if path.usesInterfaceType(.cellular) { return "شبكة خلوية" }
    if path.usesInterfaceType(.wiredEthernet) { return "Ethernet" }
    if path.usesInterfaceType(.loopback) { return "Loopback" }
    if path.usesInterfaceType(.other) { return "اتصال آخر" }
    return path.status == .satisfied ? "متصل" : "غير متصل"
  }
}
