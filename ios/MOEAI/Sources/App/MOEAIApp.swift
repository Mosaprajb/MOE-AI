import SwiftUI

@main
struct MOEAIApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var session = SessionStore()
  @StateObject private var model = AppModel()
  @StateObject private var notifications = NotificationManager.shared
  @Environment(\.scenePhase) private var scenePhase
  @State private var backgroundedAt: Date?
  @State private var privacyShieldVisible = false

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(session)
        .environmentObject(model)
        .environmentObject(notifications)
        .preferredColorScheme(.dark)
        .overlay {
          if privacyShieldVisible {
            PrivacyShieldView()
              .transition(.opacity)
              .zIndex(100)
          }
        }
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
          handleScenePhase(phase)
        }
    }
  }

  private func handleScenePhase(_ phase: ScenePhase) {
    switch phase {
    case .active:
      let shouldLock = backgroundedAt.map {
        Date().timeIntervalSince($0) >= AppConfiguration.privacyLockTimeout
      } ?? false
      backgroundedAt = nil

      withAnimation(.easeOut(duration: 0.15)) {
        privacyShieldVisible = false
      }

      if shouldLock {
        session.lockForPrivacy()
        return
      }

      guard session.isAuthenticated else { return }
      Task {
        await model.refreshStatus(silently: true)
        await notifications.refreshAuthorizationStatus()
      }

    case .background:
      backgroundedAt = Date()
      privacyShieldVisible = true

    case .inactive:
      privacyShieldVisible = true

    @unknown default:
      privacyShieldVisible = true
    }
  }
}

private struct PrivacyShieldView: View {
  var body: some View {
    ZStack {
      AppBackground()

      VStack(spacing: 14) {
        Image(systemName: "lock.shield.fill")
          .font(.system(size: 44, weight: .semibold))
          .foregroundStyle(MOETheme.accent)

        Text("MOE-AI")
          .font(.title2.weight(.black))

        Text("تم إخفاء بيانات التداول لحماية خصوصيتك")
          .font(.subheadline)
          .foregroundStyle(MOETheme.muted)
          .multilineTextAlignment(.center)
      }
      .padding(28)
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}
