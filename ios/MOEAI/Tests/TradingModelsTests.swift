import XCTest
@testable import MOEAI

final class TradingModelsTests: XCTestCase {
  func testStatusDecodesWorkerPayload() throws {
    let data = Data(
      """
      {
        "ok": true,
        "mode": "TRADINGVIEW_ONLY",
        "executionSource": "TRADINGVIEW_WEBHOOK",
        "tradingViewConnected": true,
        "runtime": {
          "receptionEnabled": true,
          "killSwitchActive": false,
          "accountType": "DEMO"
        },
        "accounts": {
          "demo": {
            "connected": true,
            "balance": 25000.50,
            "buyingPower": 50000,
            "openPositions": 1,
            "dayPnl": 123.45
          },
          "live": {
            "connected": false,
            "locked": true
          }
        },
        "positions": [
          {
            "symbol": "AAPL",
            "status": "OPEN",
            "quantity": 2,
            "entryPrice": 200,
            "lastPrice": 202,
            "orderIds": {
              "entry": "entry-1",
              "currentStop": "stop-1"
            }
          }
        ],
        "archive": [],
        "audit": []
      }
      """.utf8
    )

    let status = try JSONDecoder().decode(APIStatus.self, from: data)

    XCTAssertEqual(status.mode, "TRADINGVIEW_ONLY")
    XCTAssertEqual(status.accounts?.demo?.balance, 25_000.50)
    XCTAssertEqual(status.safePositions.first?.symbol, "AAPL")
    XCTAssertEqual(status.safePositions.first?.unrealizedPnl, 4)
    XCTAssertEqual(status.safePositions.first?.orderIds?.currentStop, "stop-1")
  }

  func testStatusAllowsMissingOptionalSections() throws {
    let data = Data(#"{"ok":true,"generatedAt":"2026-08-04T20:00:00Z"}"#.utf8)
    let status = try JSONDecoder().decode(APIStatus.self, from: data)

    XCTAssertTrue(status.safePositions.isEmpty)
    XCTAssertTrue(status.safeArchive.isEmpty)
    XCTAssertTrue(status.safeAudit.isEmpty)
  }

  func testScreenerDecodesRows() throws {
    let data = Data(
      """
      {
        "ok": true,
        "rows": [
          {
            "symbol": "NVDA",
            "name": "NVIDIA Corporation",
            "price": 145.22,
            "changePercent": 2.15,
            "volume": 1200000,
            "available": true
          }
        ]
      }
      """.utf8
    )

    let response = try JSONDecoder().decode(ScreenerResponse.self, from: data)
    XCTAssertEqual(response.safeRows.count, 1)
    XCTAssertEqual(response.safeRows.first?.symbol, "NVDA")
    XCTAssertEqual(response.safeRows.first?.price, 145.22)
  }

  func testSupportDiagnosticsRedactsSecretsAndWorkerPath() {
    let longToken = String(repeating: "a1", count: 32)
    let report = SupportDiagnostics.makeReport(
      generatedAt: Date(timeIntervalSince1970: 0),
      appVersion: "1.0 (1)",
      bundleIdentifier: "com.moerand.moeai",
      systemVersion: "iOS 17.0",
      deviceModel: "iPhone",
      network: NetworkSnapshot(
        isConnected: true,
        interfaceName: "Wi-Fi",
        isExpensive: false,
        isConstrained: false,
        updatedAt: Date(timeIntervalSince1970: 0)
      ),
      workerURLText: "https://user:password@example.com/private/path?token=super-secret",
      authenticated: true,
      selectedAccount: "DEMO",
      mode: "TRADINGVIEW_ONLY",
      executionSource: "TRADINGVIEW_WEBHOOK",
      lastRefresh: Date(timeIntervalSince1970: 0),
      lastErrorAt: Date(timeIntervalSince1970: 1),
      requestFailureCount: 2,
      modelError: "Authorization: Bearer secret-value",
      sessionError: "cookie=session-secret",
      notificationStatus: "مفعّل",
      pushRegistered: true,
      pushTokenAvailable: true,
      pushError: "APNs token: \(longToken)",
      apiDiagnostics: APIRequestDiagnostics(
        requestID: "request-123",
        method: "GET",
        path: "/api/tradingview/status",
        statusCode: 503,
        attempts: 2,
        outcome: "server-error",
        completedAt: Date(timeIntervalSince1970: 2)
      )
    )

    XCTAssertTrue(report.contains("worker_endpoint=https://example.com"))
    XCTAssertTrue(report.contains("api_request_id=request-123"))
    XCTAssertTrue(report.contains("<redacted>"))
    XCTAssertFalse(report.contains("/private/path"))
    XCTAssertFalse(report.contains("password"))
    XCTAssertFalse(report.contains("super-secret"))
    XCTAssertFalse(report.contains("secret-value"))
    XCTAssertFalse(report.contains("session-secret"))
    XCTAssertFalse(report.contains(longToken))
  }

  func testPushNavigationParserUsesTrustedDeepLinkAndNormalizesSymbol() throws {
    let userInfo: [AnyHashable: Any] = [
      "aps": ["alert": ["title": "MOE-AI"]],
      "moe": [
        "type": "POSITION_OPEN_SUBMITTED",
        "symbol": "aapl",
        "deepLink": "moeai://positions/aapl",
      ],
    ]

    let destination = try XCTUnwrap(
      PushNavigationParser.destination(from: userInfo)
    )

    XCTAssertEqual(destination.tab, .positions)
    XCTAssertEqual(destination.symbol, "AAPL")
    XCTAssertEqual(destination.notificationType, "POSITION_OPEN_SUBMITTED")
  }

  func testPushNavigationParserRoutesRejectedOrderToActivity() throws {
    let userInfo: [AnyHashable: Any] = [
      "moe": [
        "type": "TRADINGVIEW_ORDER_REJECTED",
        "symbol": "NVDA",
      ],
    ]

    let destination = try XCTUnwrap(
      PushNavigationParser.destination(from: userInfo)
    )

    XCTAssertEqual(destination.tab, .activity)
    XCTAssertEqual(destination.symbol, "NVDA")
  }

  func testPushNavigationParserNeverTreatsExternalURLAsAnAppRoute() throws {
    let userInfo: [AnyHashable: Any] = [
      "moe": [
        "type": "TEST",
        "deepLink": "https://example.com/phishing",
      ],
    ]

    let destination = try XCTUnwrap(
      PushNavigationParser.destination(from: userInfo)
    )

    XCTAssertEqual(destination.tab, .settings)
    XCTAssertEqual(destination.deepLink, "https://example.com/phishing")
  }

  func testPushNavigationParserIgnoresUnrelatedPayloads() {
    let userInfo: [AnyHashable: Any] = [
      "aps": ["alert": ["title": "System"]],
    ]

    XCTAssertNil(PushNavigationParser.destination(from: userInfo))
  }
}
