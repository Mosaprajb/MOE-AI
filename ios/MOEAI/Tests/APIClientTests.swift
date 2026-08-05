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

  func testStatusRequestAddsNativeClientHeader() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-moe-mobile-client"), "1")
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
