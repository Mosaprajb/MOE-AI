import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    Task {
      try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    NotificationCenter.default.post(
      name: .moeDidReceivePushToken,
      object: nil,
      userInfo: ["token": token]
    )
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    NotificationCenter.default.post(
      name: .moeDidReceivePushToken,
      object: nil,
      userInfo: ["error": error.localizedDescription]
    )
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound, .badge])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    NotificationCenter.default.post(
      name: .moeDidOpenPushNotification,
      object: nil,
      userInfo: ["payload": response.notification.request.content.userInfo]
    )
    completionHandler()

    Task {
      try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
  }
}
