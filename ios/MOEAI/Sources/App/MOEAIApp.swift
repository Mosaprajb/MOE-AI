import SwiftUI

@main
struct MOEAIApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var session = SessionStore()
  @StateObject private var model = AppModel()
  @StateObject private var notifications = NotificationManager.shared
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(session)
        .environmentObject(model)
        .environmentObject(notifications)
        .preferredColorScheme(.dark)
        .task {
          await session.restore()
          await notifications.refreshAuthorizationStatus()
        }
        .onChange(of: session.isAuthenticated) { _, authenticated in
          if !authenticated {
            model.reset()
          }
        }
        .onChange(of: scenePhase) { _, phase in
          guard phase == .active, session.isAuthenticated else { return }
          Task {
            await model.refreshStatus(silently: true)
            await notifications.refreshAuthorizationStatus()
          }
        }
    }
  }
}
