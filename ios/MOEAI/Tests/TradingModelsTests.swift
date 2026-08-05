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
}
