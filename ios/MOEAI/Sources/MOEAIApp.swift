import SwiftUI

@main
struct MOEAIApp: App {
    @StateObject private var session = SessionStore()
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(appModel)
                .preferredColorScheme(.dark)
                .task {
                    await session.restore()
                }
        }
    }
}
