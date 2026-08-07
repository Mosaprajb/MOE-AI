import Combine
import Foundation

@MainActor
final class AppModel: ObservableObject {
  @Published private(set) var status = APIStatus.empty
  @Published private(set) var scannerRows: [ScreenerRow] = []
  @Published private(set) var paperTradingControl: TradingControlStatus?
  @Published private(set) var liveTradingControl: TradingControlStatus?
  @Published private(set) var tradingPreview: TradingControlPreview?
  @Published private(set) var tradingControlErrorMessage: String?
  @Published private(set) var isLoading = false
  @Published private(set) var isRefreshingStatus = false
  @Published private(set) var isLoadingScanner = false
  @Published private(set) var isLoadingTradingControl = false
  @Published private(set) var pendingAction: String?
  @Published private(set) var lastErrorMessage: String?
  @Published private(set) var lastErrorAt: Date?
  @Published private(set) var consecutiveRequestFailures = 0
  @Published private(set) var statusRefreshErrorMessage: String?
  @Published var errorMessage: String?
  @Published var lastRefresh: Date?
  @Published var selectedAccount: String {
    didSet {
      UserDefaults.standard.set(
        selectedAccount,
        forKey: AppConfiguration.selectedAccountDefaultsKey
      )
      tradingPreview = nil
      Task { await loadTradingControl(for: selectedAccount, silently: true) }
    }
  }

  init() {
    selectedAccount = UserDefaults.standard.string(
      forKey: AppConfiguration.selectedAccountDefaultsKey
    ) ?? "DEMO"
  }

  var activeAccount: BrokerAccount {
    isLiveSelected
      ? status.accounts?.live ?? .empty
      : status.accounts?.demo ?? .empty
  }

  var isLiveSelected: Bool { selectedAccount.uppercased() == "LIVE" }

  var selectedTradingControl: TradingControlStatus? {
    isLiveSelected ? liveTradingControl : paperTradingControl
  }

  var receptionEnabledForSelectedAccount: Bool {
    selectedTradingControl?.reception.enabled == true
  }

  var activePositions: [TradingPosition] {
    let accountType = isLiveSelected ? "LIVE" : "DEMO"
    return (activeAccount.positions ?? []).map { position in
      TradingPosition(
        symbol: position.symbol,
        status: "OPEN",
        positionOpen: true,
        accountType: accountType,
        quantity: position.quantity,
        entryPrice: position.averagePrice,
        plannedEntryPrice: position.averagePrice,
        lastPrice: position.currentPrice,
        takeProfitPrice: nil,
        currentStopPrice: nil,
        initialStopPrice: nil,
        highWaterPrice: nil,
        openedAt: nil,
        updatedAt: activeAccount.fetchedAt,
        indicator: "WEBULL_OPENAPI",
        signalId: nil,
        orderIds: nil,
        error: nil
      )
    }
  }

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
      statusRefreshErrorMessage = nil
      markSuccess()
      await loadTradingControls(silently: true)
    } catch {
      guard !Self.isCancellation(error) else { return }
      handle(error)
    }
  }

  func refreshStatus(
    silently: Bool = false,
    showInlineError: Bool = false
  ) async {
    guard !isRefreshingStatus else { return }
    isRefreshingStatus = true
    if showInlineError { statusRefreshErrorMessage = nil }
    if !silently { errorMessage = nil }
    defer { isRefreshingStatus = false }

    do {
      status = try await APIClient.shared.status()
      lastRefresh = Date()
      statusRefreshErrorMessage = nil
      markSuccess()
      await loadTradingControl(for: selectedAccount, silently: true)
    } catch {
      guard !Self.isCancellation(error) else { return }
      handle(error, presentToUser: !silently)
      if showInlineError {
        statusRefreshErrorMessage = error.localizedDescription
      }
    }
  }

  func refreshStatusFromPullToRefresh() async {
    await refreshStatus(silently: true, showInlineError: true)
  }

  func loadTradingControls(silently: Bool = false) async {
    await loadTradingControl(for: "DEMO", silently: silently)
    await loadTradingControl(for: "LIVE", silently: silently)
  }

  func loadTradingControl(for account: String, silently: Bool = false) async {
    let mode = account.uppercased() == "LIVE" ? "LIVE" : "SANDBOX"
    isLoadingTradingControl = true
    if !silently { tradingControlErrorMessage = nil }
    defer { isLoadingTradingControl = false }

    do {
      let control = try await APIClient.shared.tradingControl(mode: mode)
      if mode == "LIVE" {
        liveTradingControl = control
      } else {
        paperTradingControl = control
      }
      if !silently { tradingControlErrorMessage = nil }
    } catch {
      guard !Self.isCancellation(error) else { return }
      if !silently { tradingControlErrorMessage = error.localizedDescription }
    }
  }

  // Compatibility entry point used by the main dashboard. Updating quantity,
  // sessions, or max trade amount must preserve the account's existing exit
  // protection values instead of silently resetting them.
  func saveTradingControl(
    sessions: [TradingSessionOption],
    timeInForce: TradingTimeInForceOption,
    shareQuantity: Int,
    maxTradeAmountUsd: Double
  ) async {
    let existing = selectedTradingControl?.settings
      ?? AccountTradingSettings.empty(mode: isLiveSelected ? "LIVE" : "SANDBOX")
    await saveTradingControl(
      sessions: sessions,
      timeInForce: timeInForce,
      shareQuantity: shareQuantity,
      maxTradeAmountUsd: maxTradeAmountUsd,
      stopLossPct: existing.stopLossPct,
      takeProfitPct: existing.takeProfitPct,
      trailingEnabled: existing.trailingEnabled,
      trailActivationUsd: existing.trailActivationUsd,
      trailInitialStopOffsetUsd: existing.trailInitialStopOffsetUsd,
      trailTriggerStepUsd: existing.trailTriggerStepUsd,
      trailStopMoveUsd: existing.trailStopMoveUsd
    )
  }

  func saveTradingControl(
    sessions: [TradingSessionOption],
    timeInForce: TradingTimeInForceOption,
    shareQuantity: Int,
    maxTradeAmountUsd: Double,
    stopLossPct: Double,
    takeProfitPct: Double,
    trailingEnabled: Bool,
    trailActivationUsd: Double,
    trailInitialStopOffsetUsd: Double,
    trailTriggerStepUsd: Double,
    trailStopMoveUsd: Double
  ) async {
    let mode = isLiveSelected ? "LIVE" : "SANDBOX"
    await performAction("trading-control-save") {
      let response = try await APIClient.shared.saveTradingControl(
        mode: mode,
        payload: TradingControlSettingsPayload(
          allowedSessions: sessions,
          timeInForce: timeInForce,
          shareQuantity: shareQuantity,
          maxTradeAmountUsd: maxTradeAmountUsd,
          stopLossPct: stopLossPct,
          takeProfitPct: takeProfitPct,
          trailingEnabled: trailingEnabled,
          trailActivationUsd: trailActivationUsd,
          trailInitialStopOffsetUsd: trailInitialStopOffsetUsd,
          trailTriggerStepUsd: trailTriggerStepUsd,
          trailStopMoveUsd: trailStopMoveUsd
        )
      )
      self.tradingPreview = nil
      await self.loadTradingControl(for: mode, silently: true)
      if !response.configured {
        self.tradingControlErrorMessage = "أكمل الجلسة والكمية والمبلغ وحدود إيقاف الخسارة وأخذ الربح وإعدادات التريلنغ قبل التفعيل."
      }
    }
  }

  func previewTradingOrder(symbol: String, price: Double) async {
    let mode = isLiveSelected ? "LIVE" : "SANDBOX"
    await performAction("trading-control-preview") {
      self.tradingPreview = try await APIClient.shared.previewTradingControl(
        mode: mode,
        symbol: symbol,
        price: price
      )
      self.tradingControlErrorMessage = nil
    }
  }

  func setTradingControlReception(
    enabled: Bool,
    liveConfirmation: String? = nil
  ) async {
    let mode = isLiveSelected ? "LIVE" : "SANDBOX"
    await performAction("reception") {
      _ = try await APIClient.shared.setTradingControlReception(
        mode: mode,
        enabled: enabled,
        confirmation: mode == "LIVE" ? liveConfirmation : nil
      )
      await self.loadTradingControl(for: mode, silently: true)
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
      markSuccess()
    } catch {
      guard !Self.isCancellation(error) else { return }
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
    await setTradingControlReception(
      enabled: enabled,
      liveConfirmation: liveConfirmation
    )
  }

  func activateKillSwitch() async {
    await performAction("kill-switch") {
      let response = try await APIClient.shared.activateKillSwitch()
      if let runtime = response.runtime {
        self.status.runtime = runtime
      }
      await self.refreshStatus(silently: true)
      await self.loadTradingControls(silently: true)
    }
  }

  func clearKillSwitch() async {
    await performAction("clear-kill-switch") {
      let response = try await APIClient.shared.clearKillSwitch()
      if let runtime = response.runtime {
        self.status.runtime = runtime
      }
      await self.refreshStatus(silently: true)
      await self.loadTradingControls(silently: true)
    }
  }

  func reset() {
    status = .empty
    scannerRows = []
    paperTradingControl = nil
    liveTradingControl = nil
    tradingPreview = nil
    tradingControlErrorMessage = nil
    errorMessage = nil
    statusRefreshErrorMessage = nil
    lastRefresh = nil
    lastErrorMessage = nil
    lastErrorAt = nil
    consecutiveRequestFailures = 0
    pendingAction = nil
  }

  private func performAction(
    _ identifier: String,
    operation: @escaping () async throws -> Void
  ) async {
    guard pendingAction == nil else { return }
    pendingAction = identifier
    errorMessage = nil
    tradingControlErrorMessage = nil
    defer { pendingAction = nil }

    do {
      try await operation()
      markSuccess()
    } catch {
      guard !Self.isCancellation(error) else { return }
      handle(error)
      tradingControlErrorMessage = error.localizedDescription
    }
  }

  private func markSuccess() {
    consecutiveRequestFailures = 0
  }

  private func handle(_ error: Error, presentToUser: Bool = true) {
    let message = error.localizedDescription
    lastErrorMessage = message
    lastErrorAt = Date()
    consecutiveRequestFailures += 1
    if presentToUser {
      errorMessage = message
    }
  }

  private static func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError {
      return true
    }

    if let urlError = error as? URLError, urlError.code == .cancelled {
      return true
    }

    if let apiError = error as? APIError,
      case let .transport(message) = apiError
    {
      return message == URLError(.cancelled).localizedDescription
    }

    return false
  }
}
