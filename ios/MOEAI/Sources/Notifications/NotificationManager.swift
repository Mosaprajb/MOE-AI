import Combine
import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
  static let shared = NotificationManager()

  @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
  @Published private(set) var deviceToken: String?
  @Published private(set) var isRegistering = false
  @Published private(set) var registrationSucceeded = false
  @Published var errorMessage: String?

  private var tokenObserver: NSObjectProtocol?

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
  }

  deinit {
    if let tokenObserver {
      NotificationCenter.default.removeObserver(tokenObserver)
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
    content.body = "تم تفعيل الإشعارات المحلية بنجاح."
    content.sound = .default

    let request = UNNotificationRequest(
      identifier: "moe-local-test-\(UUID().uuidString)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request)
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
