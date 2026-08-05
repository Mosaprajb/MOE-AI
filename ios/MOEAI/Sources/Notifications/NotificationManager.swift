import Combine
import Foundation
import UIKit
import UserNotifications

enum MainTab: String, Hashable, Sendable {
  case dashboard
  case scanner
  case positions
  case activity
  case settings
}

struct PushNavigationDestination: Equatable, Sendable {
  var tab: MainTab
  var symbol: String?
  var notificationType: String?
  var deepLink: String?
}

enum PushNavigationParser {
  static func destination(
    from userInfo: [AnyHashable: Any]
  ) -> PushNavigationDestination? {
    let payload = payloadDictionary(from: userInfo)
    let deepLink = stringValue(for: "deepLink", in: payload)
    let notificationType = stringValue(for: "type", in: payload)?.uppercased()
    let payloadSymbol = normalizedSymbol(stringValue(for: "symbol", in: payload))

    guard deepLink != nil || notificationType != nil || payloadSymbol != nil else {
      return nil
    }

    if let deepLink,
      let parsed = destinationFromDeepLink(deepLink)
    {
      return PushNavigationDestination(
        tab: parsed.tab,
        symbol: parsed.symbol ?? payloadSymbol,
        notificationType: notificationType,
        deepLink: deepLink
      )
    }

    return PushNavigationDestination(
      tab: tab(for: notificationType),
      symbol: payloadSymbol,
      notificationType: notificationType,
      deepLink: deepLink
    )
  }

  private static func payloadDictionary(
    from userInfo: [AnyHashable: Any]
  ) -> [AnyHashable: Any] {
    if let nested = userInfo["moe"] as? [AnyHashable: Any] {
      return nested
    }
    if let nested = userInfo["moe"] as? [String: Any] {
      return Dictionary(
        uniqueKeysWithValues: nested.map { (AnyHashable($0.key), $0.value) }
      )
    }
    return userInfo
  }

  private static func stringValue(
    for key: String,
    in payload: [AnyHashable: Any]
  ) -> String? {
    guard let value = payload[AnyHashable(key)] else { return nil }
    let text = String(describing: value)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private static func destinationFromDeepLink(
    _ rawValue: String
  ) -> (tab: MainTab, symbol: String?)? {
    guard let url = URL(string: rawValue),
      url.scheme?.lowercased() == "moeai"
    else {
      return nil
    }

    let pathParts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
    let route: String
    let symbolCandidate: String?

    if let host = url.host, !host.isEmpty {
      route = host.lowercased()
      symbolCandidate = pathParts.first
    } else {
      route = pathParts.first?.lowercased() ?? ""
      symbolCandidate = pathParts.dropFirst().first
    }

    let tab: MainTab
    switch route {
    case "dashboard", "home": tab = .dashboard
    case "scanner", "screener": tab = .scanner
    case "positions", "position", "orders": tab = .positions
    case "activity", "archive", "pnl": tab = .activity
    case "settings", "security": tab = .settings
    default: return nil
    }

    return (tab, normalizedSymbol(symbolCandidate))
  }

  private static func tab(for notificationType: String?) -> MainTab {
    switch notificationType {
    case "POSITION_OPEN_SUBMITTED",
      "POSITION_CLOSE_SUBMITTED",
      "POSITION_OPENED",
      "POSITION_CLOSED",
      "STOP_LOSS",
      "TAKE_PROFIT",
      "TARGET_REACHED":
      return .positions

    case "SCANNER_CANDIDATE", "SCANNER_RUN", "SCANNER_ALERT":
      return .scanner

    case "KILL_SWITCH",
      "MOBILE_KILL_SWITCH_ACTIVATED",
      "MOBILE_KILL_SWITCH_CLEARED",
      "RECEPTION_DISABLED",
      "RECEPTION_ENABLED",
      "TEST":
      return .settings

    case "TRADINGVIEW_ORDER_REJECTED", "RISK", "SYSTEM", "WEBHOOK":
      return .activity

    default:
      return .activity
    }
  }

  private static func normalizedSymbol(_ value: String?) -> String? {
    guard let value else { return nil }
    let cleaned = value
      .uppercased()
      .filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }
    return cleaned.isEmpty ? nil : cleaned
  }
}

@MainActor
final class NotificationManager: ObservableObject {
  static let shared = NotificationManager()

  @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
  @Published private(set) var deviceToken: String?
  @Published private(set) var isRegistering = false
  @Published private(set) var registrationSucceeded = false
  @Published private(set) var lastOpenedDestination: PushNavigationDestination?
  @Published private(set) var lastOpenedNotificationAt: Date?
  @Published var selectedTab: MainTab = .dashboard
  @Published var errorMessage: String?

  private var tokenObserver: NSObjectProtocol?
  private var openedNotificationObserver: NSObjectProtocol?

  private init() {
    tokenObserver = NotificationCenter.default.addObserver(
      forName: .moeDidReceivePushToken,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      Task { @MainActor in
        if let error = notification.userInfo?["error"] as? String {
          self?.errorMessage = error
          return
        }
        guard let token = notification.userInfo?["token"] as? String else { return }
        self?.deviceToken = token
        await self?.registerTokenWithWorker(token)
      }
    }

    openedNotificationObserver = NotificationCenter.default.addObserver(
      forName: .moeDidOpenPushNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      Task { @MainActor in
        guard let payload = notification.userInfo?["payload"] as? [AnyHashable: Any] else {
          return
        }
        self?.handleOpenedNotification(payload)
      }
    }
  }

  deinit {
    if let tokenObserver {
      NotificationCenter.default.removeObserver(tokenObserver)
    }
    if let openedNotificationObserver {
      NotificationCenter.default.removeObserver(openedNotificationObserver)
    }
  }

  func refreshAuthorizationStatus() async {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    authorizationStatus = settings.authorizationStatus
  }

  func requestPermission() async {
    errorMessage = nil
    do {
      let granted = try await UNUserNotificationCenter.current().requestAuthorization(
        options: [.alert, .badge, .sound]
      )
      await refreshAuthorizationStatus()
      guard granted else {
        errorMessage = "لم يتم منح إذن الإشعارات."
        return
      }
      UIApplication.shared.registerForRemoteNotifications()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func retryRegistration() async {
    guard let deviceToken else {
      UIApplication.shared.registerForRemoteNotifications()
      return
    }
    await registerTokenWithWorker(deviceToken)
  }

  func scheduleLocalTest() {
    let content = UNMutableNotificationContent()
    content.title = "MOE-AI"
    content.body = "تم تفعيل الإشعارات المحلية بنجاح. اضغط لفتح الإعدادات."
    content.sound = .default
    content.userInfo = [
      "moe": [
        "type": "TEST",
        "deepLink": "moeai://settings",
      ],
    ]

    let request = UNNotificationRequest(
      identifier: "moe-local-test-\(UUID().uuidString)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request)
  }

  func handleOpenedNotification(_ userInfo: [AnyHashable: Any]) {
    guard let destination = PushNavigationParser.destination(from: userInfo) else {
      return
    }

    lastOpenedDestination = destination
    lastOpenedNotificationAt = Date()
    selectedTab = destination.tab

    Task {
      try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
  }

  private func registerTokenWithWorker(_ token: String) async {
    guard !isRegistering else { return }
    isRegistering = true
    registrationSucceeded = false
    errorMessage = nil
    defer { isRegistering = false }

    #if DEBUG
    let environment = "development"
    #else
    let environment = "production"
    #endif

    do {
      let response = try await APIClient.shared.registerPushToken(
        token,
        environment: environment
      )
      guard response.ok != false else {
        throw APIError.server(
          statusCode: 400,
          message: response.error ?? "رفض الخادم تسجيل جهاز الإشعارات."
        )
      }
      registrationSucceeded = response.registered ?? true
    } catch {
      registrationSucceeded = false
      errorMessage = "تم استلام APNs Token، لكن تسجيله في Worker لم يكتمل: \(error.localizedDescription)"
    }
  }
}

extension Notification.Name {
  static let moeDidOpenPushNotification = Notification.Name("moe.push.opened")
}
