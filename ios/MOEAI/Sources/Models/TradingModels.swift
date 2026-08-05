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
