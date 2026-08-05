import SwiftUI

struct RootView: View {
  @EnvironmentObject private var session: SessionStore

  var body: some View {
    ZStack {
      AppBackground()

      if session.isRestoring {
        VStack(spacing: 16) {
          ProgressView()
            .controlSize(.large)
            .tint(.white)
          Text("جارٍ تأمين الجلسة…")
            .foregroundStyle(MOETheme.muted)
        }
      } else if session.isAuthenticated {
        MainTabView()
      } else {
        AuthenticationView()
      }
    }
  }
}
