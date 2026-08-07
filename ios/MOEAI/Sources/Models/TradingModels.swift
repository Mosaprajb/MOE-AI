import Foundation

struct APIStatus: Codable, Equatable {
  var ok: Bool?
  var mode: String?
  var executionSource: String?
  var tradingViewConnected: Bool?
  var generatedAt: String?
  var runtime: RuntimeState?
  var accounts: Accounts?
  var positions: [TradingPosition]?
  var archive: [ArchivedTrade]?
  var audit: [AuditEvent]?
  var dailyPnl: [String: Double]?
  var marketClock: MarketClock?
  var settings: TradingSettings?

  static let empty = APIStatus()

  var safePositions: [TradingPosition] { positions ?? [] }
  var safeArchive: [ArchivedTrade] { archive ?? [] }
  var safeAudit: [AuditEvent] { audit ?? [] }
}

struct RuntimeState: Codable, Equatable {
  var receptionEnabled: Bool?
  var killSwitchActive: Bool?
  var accountType: String?
  var liveActivated: Bool?
  var lastValidAlertAt: String?
  var updatedAt: String?
}

struct Accounts: Codable, Equatable {
  var demo: BrokerAccount?
  var live: BrokerAccount?
}

struct BrokerAccount: Codable, Equatable {
  var accountType: String?
  var connected: Bool?
  var locked: Bool?
  var balance: Double?
  var cash: Double?
  var buyingPower: Double?
  var openPositions: Int?
  var totalPnl: Double?
  var dayPnl: Double?
  var realizedPnl: Double?
  var unrealizedPnl: Double?
  var dayPnlPercent: Double?
  var pnlSource: String?
  var pnlReliable: Bool?
  var fetchedAt: String?
  var positions: [BrokerPosition]?

  static let empty = BrokerAccount()
}

struct BrokerPosition: Codable, Equatable, Identifiable {
  var symbol: String?
  var quantity: Double?
  var averagePrice: Double?
  var currentPrice: Double?
  var marketValue: Double?
  var unrealizedPnl: Double?

  var id: String { symbol ?? "unknown-broker-position" }
}

struct OrderIdentifiers: Codable, Equatable {
  var entry: String?
  var takeProfit: String?
  var stopLoss: String?
  var currentStop: String?
  var combo: String?
  var close: String?
}

struct TradingPosition: Codable, Equatable, Identifiable {
  var symbol: String?
  var status: String?
  var positionOpen: Bool?
  var accountType: String?
  var quantity: Double?
  var entryPrice: Double?
  var plannedEntryPrice: Double?
  var lastPrice: Double?
  var takeProfitPrice: Double?
  var currentStopPrice: Double?
  var initialStopPrice: Double?
  var highWaterPrice: Double?
  var openedAt: String?
  var updatedAt: String?
  var indicator: String?
  var signalId: String?
  var orderIds: OrderIdentifiers?
  var error: String?

  var id: String {
    [symbol, signalId, openedAt]
      .compactMap { $0 }
      .joined(separator: "-")
      .nonEmpty ?? "unknown-position"
  }

  var unrealizedPnl: Double? {
    guard let quantity, let entryPrice, let lastPrice else { return nil }
    return (lastPrice - entryPrice) * quantity
  }
}

struct ArchivedTrade: Codable, Equatable, Identifiable {
  var recordID: String?
  var symbol: String?
  var entryPrice: Double?
  var exitPrice: Double?
  var exitReason: String?
  var profitLoss: Double?
  var quantity: Double?
  var durationSeconds: Double?
  var accountType: String?
  var indicator: String?
  var signalId: String?
  var closedAt: String?

  enum CodingKeys: String, CodingKey {
    case recordID = "id"
    case symbol
    case entryPrice
    case exitPrice
    case exitReason
    case profitLoss
    case quantity
    case durationSeconds
    case accountType
    case indicator
    case signalId
    case closedAt
  }

  var id: String {
    recordID
      ?? [symbol, signalId, closedAt].compactMap { $0 }.joined(separator: "-").nonEmpty
      ?? "unknown-trade"
  }
}

struct AuditEvent: Codable, Equatable, Identifiable {
  var recordID: String?
  var type: String?
  var symbol: String?
  var createdAt: String?
  var error: String?
  var reason: String?
  var accountType: String?

  enum CodingKeys: String, CodingKey {
    case recordID = "id"
    case type
    case symbol
    case createdAt
    case error
    case reason
    case accountType
  }

  var id: String {
    recordID
      ?? [type, symbol, createdAt].compactMap { $0 }.joined(separator: "-").nonEmpty
      ?? "unknown-event"
  }
}

struct MarketClock: Codable, Equatable {
  var label: String?
  var phase: String?
  var entryAllowed: Bool?
  var entryBlockedReason: String?
  var selectedSession: String?
  var nextTransitionAt: String?
  var autoFlattenAt: String?
}

struct TradingSettings: Codable, Equatable {
  var configured: Bool?
  var accountType: String?
  var tradingMode: String?
  var maxBuyingPowerPercent: Double?
  var positionSizeDollars: Double?
  var takeProfitDollars: Double?
  var stopLossDollars: Double?
  var maxDailyLossDollars: Double?
  var maxOpenPositions: Int?
  var trailingEnabled: Bool?
  var session: String?
  var autoFlattenTimeLocal: String?
  var autoFlattenTimezone: String?
}

// MARK: - Per-account TradingView controls

enum TradingSessionOption: String, Codable, CaseIterable, Identifiable {
  case regular = "CORE"
  case extended = "EXTENDED"
  case overnight = "NIGHT"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .regular: return "الساعات العادية"
    case .extended: return "Extended Hours"
    case .overnight: return "Overnight"
    }
  }

  var subtitle: String {
    switch self {
    case .regular: return "9:30 AM – 4:00 PM ET"
    case .extended: return "4:00–9:30 AM + 4:00–8:00 PM ET"
    case .overnight: return "8:00 PM – 4:00 AM ET"
    }
  }
}

enum TradingTimeInForceOption: String, Codable, CaseIterable, Identifiable {
  case day = "DAY"
  case gtc = "GTC"

  var id: String { rawValue }
  var title: String { self == .day ? "Day" : "GTC" }
  var detail: String { self == .day ? "ينتهي بنهاية يوم التداول" : "يبقى حتى التنفيذ أو الإلغاء" }
}

struct AccountTradingSettings: Codable, Equatable {
  var mode: String
  var allowedSessions: [TradingSessionOption]
  var timeInForce: TradingTimeInForceOption
  var shareQuantity: Int
  var maxTradeAmountUsd: Double
  var sizingSource: String
  var maxCashPct: Double
  var marginPct: Double
  var maxPositionUsd: Double
  var stopLossEnabled: Bool
  var stopLossPct: Double
  var takeProfitEnabled: Bool
  var takeProfitPct: Double
  var trailingEnabled: Bool
  var trailActivationUsd: Double
  var trailInitialStopOffsetUsd: Double
  var trailTriggerStepUsd: Double
  var trailStopMoveUsd: Double
  var blockIfPosition: Bool
  var sessionOpenOnly: Bool
  var sessionTz: String
  var sessionStart: String
  var sessionEnd: String

  static func empty(mode: String) -> AccountTradingSettings {
    AccountTradingSettings(
      mode: mode,
      allowedSessions: [.regular],
      timeInForce: .day,
      shareQuantity: 0,
      maxTradeAmountUsd: 0,
      sizingSource: "cash_plus_margin",
      maxCashPct: 25,
      marginPct: 50,
      maxPositionUsd: 0,
      stopLossEnabled: true,
      stopLossPct: 2,
      takeProfitEnabled: true,
      takeProfitPct: 3,
      trailingEnabled: false,
      trailActivationUsd: 0.05,
      trailInitialStopOffsetUsd: 0.02,
      trailTriggerStepUsd: 0.05,
      trailStopMoveUsd: 0.01,
      blockIfPosition: true,
      sessionOpenOnly: true,
      sessionTz: "America/New_York",
      sessionStart: "09:30",
      sessionEnd: "16:00"
    )
  }
}

struct TradingControlReception: Codable, Equatable {
  var enabled: Bool
  var accountType: String
  var updatedAt: String
}

struct TradingControlMarket: Codable, Equatable {
  var window: String
  var webullSession: String?
  var label: String
  var weekday: String
  var minutesET: Int
  var allowedNow: Bool?
}

struct TradingControlBroker: Codable, Equatable {
  var connected: Bool?
  var accountValue: Double?
  var cash: Double?
  var buyingPower: Double?
  var intradayBuyingPower: Double?
  var overnightBuyingPower: Double?
  var nightTradingBuyingPower: Double?
  var currentSessionBuyingPower: Double?
  var marginDataAvailable: Bool?
  var maintenanceMargin: Double?
  var openMarginCalls: [String]?
  var usedMargin: Double?
  var usedMarginForOpenOrder: Double?
  var initialMargin: Double?
  var intradayMargin: Double?
  var marginExcess: Double?
  var marginRatio: Double?
  var updatedAt: String?
}

struct TradingControlStatus: Codable, Equatable {
  var ok: Bool
  var mode: String
  var accountType: String
  var settings: AccountTradingSettings
  var configured: Bool
  var reception: TradingControlReception
  var market: TradingControlMarket
  var broker: TradingControlBroker
  var blockers: [String]
}

struct TradingControlSettingsResponse: Codable, Equatable {
  var ok: Bool
  var mode: String
  var settings: AccountTradingSettings
  var configured: Bool
  var receptionEnabled: Bool
}

struct TradingControlPreview: Codable, Equatable {
  var ok: Bool
  var mode: String?
  var symbol: String?
  var side: String?
  var price: Double?
  var quantity: Int?
  var maximumQuantityToBuy: Int?
  var configuredShareQuantity: Int?
  var maxTradeAmountUsd: Double?
  var estimatedTotal: Double?
  var estimatedTransactionFee: Double?
  var orderType: String?
  var tradingSession: String?
  var timeInForce: String?
  var intradayBuyingPower: Double?
  var overnightBuyingPower: Double?
  var nightTradingBuyingPower: Double?
  var availableBuyingPower: Double?
  var market: TradingControlMarket?
  var error: String?
}

struct TradingControlReceptionResponse: Codable, Equatable {
  var ok: Bool
  var mode: String?
  var reception: TradingControlReception?
  var settings: AccountTradingSettings?
  var code: String?
  var error: String?
  var blockers: [String]?
}

struct TradingControlSettingsPayload: Codable, Equatable {
  var allowedSessions: [TradingSessionOption]
  var timeInForce: TradingTimeInForceOption
  var shareQuantity: Int
  var maxTradeAmountUsd: Double
  var stopLossPct: Double
  var takeProfitPct: Double
  var trailingEnabled: Bool
  var trailActivationUsd: Double
  var trailInitialStopOffsetUsd: Double
  var trailTriggerStepUsd: Double
  var trailStopMoveUsd: Double
}

struct TradingControlPreviewPayload: Codable, Equatable {
  var symbol: String
  var price: Double
  var side: String
}

struct TradingControlReceptionPayload: Codable, Equatable {
  var enabled: Bool
  var confirmation: String?
}

struct ScreenerResponse: Codable, Equatable {
  var ok: Bool?
  var degraded: Bool?
  var warning: String?
  var error: String?
  var rows: [ScreenerRow]?
  var updatedAt: String?

  var safeRows: [ScreenerRow] { rows ?? [] }
}

struct ScreenerRow: Codable, Equatable, Identifiable {
  var symbol: String
  var name: String?
  var sector: String?
  var price: Double?
  var change: Double?
  var changePercent: Double?
  var volume: Double?
  var bid: Double?
  var ask: Double?
  var session: String?
  var available: Bool?

  var id: String { symbol }
}

struct APIEnvelope: Codable, Equatable {
  var ok: Bool?
  var error: String?
  var message: String?
}

struct SessionResponse: Codable, Equatable {
  var ok: Bool?
  var expiresAt: String?
  var error: String?
}

struct RuntimeResponse: Codable, Equatable {
  var ok: Bool?
  var runtime: RuntimeState?
  var error: String?
}

struct PushRegistrationResponse: Codable, Equatable {
  var ok: Bool?
  var registered: Bool?
  var error: String?
}

struct PushRegistrationPayload: Codable, Equatable {
  var token: String
  var platform: String
  var bundleIdentifier: String
  var environment: String
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
