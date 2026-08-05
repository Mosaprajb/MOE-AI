import Foundation
import XCTest
@testable import MOEAI

final class APIClientTests: XCTestCase {
  override func tearDown() {
    URLProtocolStub.handler = nil
    super.tearDown()
  }

  func testEndpointURLPreservesBasePathAndAddsQuery() throws {
    let baseURL = try XCTUnwrap(URL(string: "https://example.com/control"))
    let url = try APIClient.endpointURL(
      baseURL: baseURL,
      path: "/api/mobile/market-screener",
      query: [URLQueryItem(name: "sort", value: "VOLUME")]
    )

    XCTAssertEqual(url.scheme, "https")
    XCTAssertEqual(url.host, "example.com")
    XCTAssertEqual(url.path, "/control/api/mobile/market-screener")
    XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "VOLUME")
  }

  func testStatusRequestAddsNativeClientAndCorrelationHeaders() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-moe-mobile-client"), "1")
      XCTAssertFalse((request.value(forHTTPHeaderField: "x-moe-request-id") ?? "").isEmpty)
      XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/tradingview/status")

      let payload = Data(#"{"ok":true,"mode":"TRADINGVIEW_ONLY"}"#.utf8)
      let response = HTTPURLResponse(
        url: try XCTUnwrap(request.url),
        statusCode: 200,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, payload)
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [URLProtocolStub.self]
    let client = APIClient(
      baseURL: URL(string: "https://example.com")!,
      session: URLSession(configuration: configuration)
    )

    let status = try await client.status()
    XCTAssertEqual(status.mode, "TRADINGVIEW_ONLY")
  }

  func testUnauthorizedResponseMapsToUnauthorizedError() async throws {
    URLProtocolStub.handler = { request in
      let response = HTTPURLResponse(
        url: try XCTUnwrap(request.url),
        statusCode: 401,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, Data(#"{"ok":false,"error":"Authentication required"}"#.utf8))
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [URLProtocolStub.self]
    let client = APIClient(
      baseURL: URL(string: "https://example.com")!,
      session: URLSession(configuration: configuration)
    )

    do {
      _ = try await client.status()
      XCTFail("Expected unauthorized error")
    } catch let error as APIError {
      XCTAssertEqual(error, .unauthorized)
    }
  }

  func testIdempotentGetRetriesTransientServerFailure() async throws {
    var attempts = 0
    URLProtocolStub.handler = { request in
      attempts += 1
      let statusCode = attempts == 1 ? 503 : 200
      let payload = statusCode == 200
        ? Data(#"{"ok":true,"mode":"TRADINGVIEW_ONLY"}"#.utf8)
        : Data(#"{"ok":false,"error":"Temporary unavailable"}"#.utf8)
      let response = HTTPURLResponse(
        url: try XCTUnwrap(request.url),
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, payload)
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [URLProtocolStub.self]
    let client = APIClient(
      baseURL: URL(string: "https://example.com")!,
      session: URLSession(configuration: configuration),
      retryDelaysNanoseconds: [0]
    )

    let status = try await client.status()
    XCTAssertEqual(status.mode, "TRADINGVIEW_ONLY")
    XCTAssertEqual(attempts, 2)
  }

  func testMutationIsNotRetriedAfterServerFailure() async throws {
    var attempts = 0
    URLProtocolStub.handler = { request in
      attempts += 1
      let response = HTTPURLResponse(
        url: try XCTUnwrap(request.url),
        statusCode: 503,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, Data(#"{"ok":false,"error":"Temporary unavailable"}"#.utf8))
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [URLProtocolStub.self]
    let client = APIClient(
      baseURL: URL(string: "https://example.com")!,
      session: URLSession(configuration: configuration),
      retryDelaysNanoseconds: [0, 0]
    )

    do {
      _ = try await client.login(pin: "1234")
      XCTFail("Expected server error")
    } catch let error as APIError {
      XCTAssertEqual(error, .server(statusCode: 503, message: "Temporary unavailable"))
    }

    XCTAssertEqual(attempts, 1)
  }
}

private final class URLProtocolStub: URLProtocol {
  static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let handler = Self.handler else {
      client?.urlProtocol(self, didFailWithError: URLError(.unknown))
      return
    }

    do {
      let (response, data) = try handler(request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
