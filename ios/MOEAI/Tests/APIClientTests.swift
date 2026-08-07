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
    XCTAssertEqual(
      URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value,
      "VOLUME"
    )
  }

  func testNormalizedWorkerURLRequiresHTTPSForRemoteHosts() throws {
    XCTAssertNil(AppConfiguration.normalizedURL(from: "http://example.com"))

    let secureURL = try XCTUnwrap(
      AppConfiguration.normalizedURL(from: "https://example.com/control/")
    )
    XCTAssertEqual(secureURL.absoluteString, "https://example.com/control")
  }

  func testNormalizedWorkerURLRejectsEmbeddedCredentialsAndRemovesQuery() throws {
    XCTAssertNil(
      AppConfiguration.normalizedURL(from: "https://user:password@example.com")
    )

    let normalized = try XCTUnwrap(
      AppConfiguration.normalizedURL(
        from: "https://example.com/control/?token=secret#fragment"
      )
    )
    XCTAssertNil(URLComponents(url: normalized, resolvingAgainstBaseURL: false)?.query)
    XCTAssertNil(URLComponents(url: normalized, resolvingAgainstBaseURL: false)?.fragment)
    XCTAssertEqual(normalized.path, "/control")
  }

  func testNormalizedWorkerURLAllowsLocalHTTPOnlyForDebugTesting() throws {
    #if DEBUG
    let localURL = try XCTUnwrap(
      AppConfiguration.normalizedURL(from: "http://127.0.0.1:8787")
    )
    XCTAssertEqual(localURL.host, "127.0.0.1")
    XCTAssertEqual(localURL.port, 8787)
    #else
    XCTAssertNil(AppConfiguration.normalizedURL(from: "http://127.0.0.1:8787"))
    #endif
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
    let diagnostics = await client.diagnosticsSnapshot()

    XCTAssertEqual(status.mode, "TRADINGVIEW_ONLY")
    XCTAssertEqual(diagnostics.method, "GET")
    XCTAssertEqual(diagnostics.path, "/api/tradingview/status")
    XCTAssertEqual(diagnostics.statusCode, 200)
    XCTAssertEqual(diagnostics.attempts, 1)
    XCTAssertEqual(diagnostics.outcome, "success")
    XCTAssertFalse((diagnostics.requestID ?? "").isEmpty)
    XCTAssertNotNil(diagnostics.completedAt)
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

    let diagnostics = await client.diagnosticsSnapshot()
    XCTAssertEqual(diagnostics.statusCode, 401)
    XCTAssertEqual(diagnostics.outcome, "unauthorized")
    XCTAssertEqual(diagnostics.attempts, 1)
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
    let diagnostics = await client.diagnosticsSnapshot()

    XCTAssertEqual(status.mode, "TRADINGVIEW_ONLY")
    XCTAssertEqual(attempts, 2)
    XCTAssertEqual(diagnostics.statusCode, 200)
    XCTAssertEqual(diagnostics.attempts, 2)
    XCTAssertEqual(diagnostics.outcome, "success")
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

    let diagnostics = await client.diagnosticsSnapshot()
    XCTAssertEqual(attempts, 1)
    XCTAssertEqual(diagnostics.method, "POST")
    XCTAssertEqual(diagnostics.statusCode, 503)
    XCTAssertEqual(diagnostics.attempts, 1)
    XCTAssertEqual(diagnostics.outcome, "server-error")
  }
}

final class SecurityPreferencesTests: XCTestCase {
  @MainActor
  func testPreferencesUseSecureDefaultsAndPersistChanges() throws {
    let suiteName = "MOEAI.SecurityPreferencesTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let preferences = AppPreferences(defaults: defaults)
    XCTAssertEqual(preferences.autoLockInterval, .thirtySeconds)
    XCTAssertEqual(preferences.autoRefreshInterval, .fifteenSeconds)
    XCTAssertTrue(preferences.requiresAuthenticationForSensitiveActions)

    preferences.autoLockInterval = .fiveMinutes
    preferences.autoRefreshInterval = .off
    preferences.requiresAuthenticationForSensitiveActions = false

    let reloaded = AppPreferences(defaults: defaults)
    XCTAssertEqual(reloaded.autoLockInterval, .fiveMinutes)
    XCTAssertEqual(reloaded.autoRefreshInterval, .off)
    XCTAssertFalse(reloaded.requiresAuthenticationForSensitiveActions)

    reloaded.reset()
    XCTAssertEqual(reloaded.autoLockInterval, .thirtySeconds)
    XCTAssertEqual(reloaded.autoRefreshInterval, .fifteenSeconds)
    XCTAssertTrue(reloaded.requiresAuthenticationForSensitiveActions)
  }

  @MainActor
  func testSensitiveActionGateCanBeDisabledWithoutPrompting() async {
    let authenticator = DeviceAuthenticatorStub(ownerAuthenticationResult: false)
    let session = SessionStore(deviceAuthenticator: authenticator)

    let allowed = await session.authorizeSensitiveAction(
      reason: "test",
      required: false
    )

    XCTAssertTrue(allowed)
    XCTAssertEqual(authenticator.ownerAuthenticationCalls, 0)
  }

  @MainActor
  func testSensitiveActionGateUsesDeviceOwnerAuthenticationWhenRequired() async {
    let authenticator = DeviceAuthenticatorStub(ownerAuthenticationResult: true)
    let session = SessionStore(deviceAuthenticator: authenticator)

    let allowed = await session.authorizeSensitiveAction(
      reason: "close position",
      required: true
    )

    XCTAssertTrue(allowed)
    XCTAssertEqual(authenticator.ownerAuthenticationCalls, 1)
    XCTAssertEqual(authenticator.lastReason, "close position")
  }
}

private final class DeviceAuthenticatorStub: DeviceAuthenticating {
  let ownerAuthenticationResult: Bool
  var ownerAuthenticationCalls = 0
  var lastReason: String?

  init(ownerAuthenticationResult: Bool) {
    self.ownerAuthenticationResult = ownerAuthenticationResult
  }

  func biometricsAvailable() -> Bool { true }

  func authenticateWithBiometrics(reason: String) async throws -> Bool {
    true
  }

  func authenticateDeviceOwner(reason: String) async throws -> Bool {
    ownerAuthenticationCalls += 1
    lastReason = reason
    return ownerAuthenticationResult
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
