import Combine
import Foundation
import Network

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
