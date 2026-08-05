import Combine
import Foundation

@MainActor
final class AppModel: ObservableObject {
  @Published private(set) var status = APIStatus.empty
  @Published private(set) var scannerRows: [ScreenerRow] = []
  @Published private(set) var isLoading = false
  @Published private(set) var isRefreshingStatus = false
  @Published private(set) var isLoadingScanner = false
  @Published private(set) var pendingAction: String?
  @Published var errorMessage: String?
  @Published var lastRefresh: Date?
  @Published var selectedAccount: String {
    didSet {
      UserDefaults.standard.set(
        selectedAccount,
        forKey: AppConfiguration.selectedAccountDefaultsKey
      )
    }
  }

  init() {
    selectedAccount = UserDefaults.standard.string(
      forKey: AppConfiguration.selectedAccountDefaultsKey
    ) ?? "DEMO"
  }

  var activeAccount: BrokerAccount {
    selectedAccount.uppercased() == "LIVE"
      ? status.accounts?.live ?? .empty
      : status.accounts?.demo ?? .empty
  }

  var isLiveSelected: Bool { selectedAccount.uppercased() == "LIVE" }

  func loadAll() async {
    guard !isLoading else { return }
    isLoading = true
    errorMessage = nil
    defer { isLoading = false }

    do {
      async let statusRequest = APIClient.shared.status()
      async let scannerRequest = APIClient.shared.screener()

      let (newStatus, newScanner) = try await (statusRequest, scannerRequest)
      status = newStatus
      scannerRows = newScanner.safeRows
      lastRefresh = Date()
    } catch {
      handle(error)
    }
  }

  func refreshStatus(silently: Bool = false) async {
    guard !isRefreshingStatus else { return }
    isRefreshingStatus = true
    if !silently { errorMessage = nil }
    defer { isRefreshingStatus = false }

    do {
      status = try await APIClient.shared.status()
      lastRefresh = Date()
    } catch {
      if !silently { handle(error) }
    }
  }

  func loadScanner(search: String = "", sort: String = "VOLUME") async {
    guard !isLoadingScanner else { return }
    isLoadingScanner = true
    errorMessage = nil
    defer { isLoadingScanner = false }

    do {
      let response = try await APIClient.shared.screener(search: search, sort: sort)
      if response.ok == false {
        throw APIError.server(statusCode: 502, message: response.error ?? "تعذر تحميل الماسح.")
      }
      scannerRows = response.safeRows
    } catch {
      handle(error)
    }
  }

  func refreshPositions(repair: Bool = false) async {
    await performAction(repair ? "repair" : "refresh") {
      _ = try await APIClient.shared.refreshPositions(repair: repair)
      await self.refreshStatus(silently: true)
    }
  }

  func closePosition(symbol: String) async {
    await performAction("close-\(symbol)") {
      _ = try await APIClient.shared.closePosition(symbol: symbol)
      await self.refreshStatus(silently: true)
    }
  }

  func setReception(enabled: Bool, liveConfirmation: String? = nil) async {
    let accountType = selectedAccount.uppercased()
    await performAction("reception") {
      let response = try await APIClient.shared.setReception(
        enabled: enabled,
        accountType: accountType,
        confirmation: accountType == "LIVE" ? liveConfirmation : nil
      )
      if let runtime = response.runtime {
        self.status.runtime = runtime
      } else {
        await self.refreshStatus(silently: true)
      }
    }
  }

  func activateKillSwitch() async {
    await performAction("kill-switch") {
      let response = try await APIClient.shared.activateKillSwitch()
      if let runtime = response.runtime {
        self.status.runtime = runtime
      }
      await self.refreshStatus(silently: true)
    }
  }

  func clearKillSwitch() async {
    await performAction("clear-kill-switch") {
      let response = try await APIClient.shared.clearKillSwitch()
      if let runtime = response.runtime {
        self.status.runtime = runtime
      }
      await self.refreshStatus(silently: true)
    }
  }

  func reset() {
    status = .empty
    scannerRows = []
    errorMessage = nil
    lastRefresh = nil
    pendingAction = nil
  }

  private func performAction(
    _ identifier: String,
    operation: @escaping () async throws -> Void
  ) async {
    guard pendingAction == nil else { return }
    pendingAction = identifier
    errorMessage = nil
    defer { pendingAction = nil }

    do {
      try await operation()
    } catch {
      handle(error)
    }
  }

  private func handle(_ error: Error) {
    errorMessage = error.localizedDescription
  }
}
