import Foundation

struct APIRequestDiagnostics: Equatable, Sendable {
  var requestID: String?
  var method: String?
  var path: String?
  var statusCode: Int?
  var attempts: Int
  var outcome: String?
  var completedAt: Date?

  static let empty = APIRequestDiagnostics(
    requestID: nil,
    method: nil,
    path: nil,
    statusCode: nil,
    attempts: 0,
    outcome: nil,
    completedAt: nil
  )
}

actor APIClient {
  static let shared = APIClient()

  private var baseURL: URL
  private let session: URLSession
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder
  private let retryDelaysNanoseconds: [UInt64]
  private var diagnostics = APIRequestDiagnostics.empty

  init(
    baseURL: URL = AppConfiguration.normalizedURL(from: AppConfiguration.storedWorkerURL)
      ?? URL(string: AppConfiguration.defaultWorkerURL)!,
    session: URLSession? = nil,
    retryDelaysNanoseconds: [UInt64] = [250_000_000, 750_000_000]
  ) {
    self.baseURL = baseURL
    self.retryDelaysNanoseconds = retryDelaysNanoseconds

    let decoder = JSONDecoder()
    self.decoder = decoder

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    self.encoder = encoder

    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.default
      configuration.waitsForConnectivity = true
      configuration.timeoutIntervalForRequest = 25
      configuration.timeoutIntervalForResource = 45
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.httpCookieStorage = .shared
      configuration.httpShouldSetCookies = true
      self.session = URLSession(configuration: configuration)
    }
  }

  func updateBaseURL(_ url: URL) {
    baseURL = url
  }

  func diagnosticsSnapshot() -> APIRequestDiagnostics {
    diagnostics
  }

  func login(pin: String) async throws -> SessionResponse {
    struct Payload: Encodable { let pin: String }
    return try await send(
      path: "/api/tradingview/session",
      method: "POST",
      body: Payload(pin: pin)
    )
  }

  func status() async throws -> APIStatus {
    try await send(path: "/api/tradingview/status", method: "GET")
  }

  func screener(search: String = "", sort: String = "VOLUME") async throws -> ScreenerResponse {
    let query = [
      URLQueryItem(name: "search", value: search),
      URLQueryItem(name: "sort", value: sort),
    ]
    return try await send(
      path: "/api/mobile/market-screener",
      method: "GET",
      query: query
    )
  }

  func refreshPositions(repair: Bool = false) async throws -> APIEnvelope {
    struct EmptyPayload: Encodable {}
    return try await send(
      path: repair ? "/api/tradingview/repair" : "/api/tradingview/refresh",
      method: "POST",
      body: EmptyPayload()
    )
  }

  func closePosition(symbol: String) async throws -> APIEnvelope {
    struct Payload: Encodable {
      let symbol: String
      let confirmation: String
    }
    return try await send(
      path: "/api/tradingview/position/close",
      method: "POST",
      body: Payload(symbol: symbol, confirmation: "CLOSE")
    )
  }

  func setReception(
    enabled: Bool,
    accountType: String,
    confirmation: String? = nil
  ) async throws -> RuntimeResponse {
    struct Payload: Encodable {
      let enabled: Bool
      let accountType: String
      let confirmation: String?
    }
    return try await send(
      path: "/api/tradingview/reception",
      method: "POST",
      body: Payload(
        enabled: enabled,
        accountType: accountType,
        confirmation: confirmation
      )
    )
  }

  func activateKillSwitch() async throws -> RuntimeResponse {
    struct Payload: Encodable { let action: String }
    return try await send(
      path: "/api/tradingview/kill-switch",
      method: "POST",
      body: Payload(action: "ACTIVATE")
    )
  }

  func clearKillSwitch() async throws -> RuntimeResponse {
    struct Payload: Encodable {
      let action: String
      let confirmation: String
    }
    return try await send(
      path: "/api/tradingview/kill-switch",
      method: "POST",
      body: Payload(action: "CLEAR", confirmation: "CLEAR")
    )
  }

  func registerPushToken(
    _ token: String,
    path: String = AppConfiguration.pushRegistrationPath,
    environment: String
  ) async throws -> PushRegistrationResponse {
    let bundleIdentifier = Bundle.main.bundleIdentifier ?? "com.moerand.moeai"
    let payload = PushRegistrationPayload(
      token: token,
      platform: "ios",
      bundleIdentifier: bundleIdentifier,
      environment: environment
    )
    return try await send(path: path, method: "POST", body: payload)
  }

  func unregisterPushToken(
    _ token: String,
    path: String = AppConfiguration.pushRegistrationPath
  ) async throws -> APIEnvelope {
    struct Payload: Encodable {
      let token: String
      let platform: String
    }
    return try await send(
      path: path,
      method: "DELETE",
      body: Payload(token: token, platform: "ios")
    )
  }

  private func send<Response: Decodable>(
    path: String,
    method: String,
    query: [URLQueryItem] = []
  ) async throws -> Response {
    try await execute(
      request: makeRequest(path: path, method: method, query: query, body: nil),
      responseType: Response.self,
      allowsRetry: method == "GET"
    )
  }

  private func send<Payload: Encodable, Response: Decodable>(
    path: String,
    method: String,
    query: [URLQueryItem] = [],
    body: Payload
  ) async throws -> Response {
    let bodyData: Data
    do {
      bodyData = try encoder.encode(body)
    } catch {
      throw APIError.transport(error.localizedDescription)
    }

    return try await execute(
      request: makeRequest(path: path, method: method, query: query, body: bodyData),
      responseType: Response.self,
      allowsRetry: false
    )
  }

  private func makeRequest(
    path: String,
    method: String,
    query: [URLQueryItem],
    body: Data?
  ) throws -> URLRequest {
    let url = try Self.endpointURL(baseURL: baseURL, path: path, query: query)
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("1", forHTTPHeaderField: "x-moe-mobile-client")
    request.setValue(UUID().uuidString, forHTTPHeaderField: "x-moe-request-id")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    if body != nil {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return request
  }

  private func execute<Response: Decodable>(
    request: URLRequest,
    responseType: Response.Type,
    allowsRetry: Bool
  ) async throws -> Response {
    let retryCount = allowsRetry ? retryDelaysNanoseconds.count : 0
    let maximumAttempts = retryCount + 1
    let requestID = request.value(forHTTPHeaderField: "x-moe-request-id")
    let method = request.httpMethod
    let path = request.url?.path

    recordDiagnostics(
      requestID: requestID,
      method: method,
      path: path,
      statusCode: nil,
      attempts: 0,
      outcome: "started",
      completed: false
    )

    for attempt in 0..<maximumAttempts {
      let attemptCount = attempt + 1
      let data: Data
      let response: URLResponse

      do {
        (data, response) = try await session.data(for: request)
      } catch {
        if allowsRetry,
          attempt < retryCount,
          Self.isRetryableTransportError(error)
        {
          recordDiagnostics(
            requestID: requestID,
            method: method,
            path: path,
            statusCode: nil,
            attempts: attemptCount,
            outcome: "retrying-transport",
            completed: false
          )
          await waitBeforeRetry(attempt: attempt)
          continue
        }

        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: nil,
          attempts: attemptCount,
          outcome: "transport-error"
        )
        throw APIError.transport(error.localizedDescription)
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: nil,
          attempts: attemptCount,
          outcome: "invalid-response"
        )
        throw APIError.invalidResponse
      }

      if httpResponse.statusCode == 401 {
        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: 401,
          attempts: attemptCount,
          outcome: "unauthorized"
        )
        NotificationCenter.default.post(name: .moeSessionExpired, object: nil)
        throw APIError.unauthorized
      }

      guard (200...299).contains(httpResponse.statusCode) else {
        if allowsRetry,
          attempt < retryCount,
          Self.isRetryableStatusCode(httpResponse.statusCode)
        {
          recordDiagnostics(
            requestID: requestID,
            method: method,
            path: path,
            statusCode: httpResponse.statusCode,
            attempts: attemptCount,
            outcome: "retrying-server",
            completed: false
          )
          await waitBeforeRetry(attempt: attempt)
          continue
        }

        let envelope = try? decoder.decode(APIEnvelope.self, from: data)
        let message = envelope?.error
          ?? envelope?.message
          ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: httpResponse.statusCode,
          attempts: attemptCount,
          outcome: "server-error"
        )
        throw APIError.server(statusCode: httpResponse.statusCode, message: message)
      }

      do {
        let decoded = try decoder.decode(responseType, from: data)
        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: httpResponse.statusCode,
          attempts: attemptCount,
          outcome: "success"
        )
        return decoded
      } catch {
        recordDiagnostics(
          requestID: requestID,
          method: method,
          path: path,
          statusCode: httpResponse.statusCode,
          attempts: attemptCount,
          outcome: "decoding-error"
        )
        throw APIError.decoding(Self.describeDecodingError(error))
      }
    }

    recordDiagnostics(
      requestID: requestID,
      method: method,
      path: path,
      statusCode: nil,
      attempts: maximumAttempts,
      outcome: "attempts-exhausted"
    )
    throw APIError.invalidResponse
  }

  private func recordDiagnostics(
    requestID: String?,
    method: String?,
    path: String?,
    statusCode: Int?,
    attempts: Int,
    outcome: String,
    completed: Bool = true
  ) {
    diagnostics = APIRequestDiagnostics(
      requestID: requestID,
      method: method,
      path: path,
      statusCode: statusCode,
      attempts: attempts,
      outcome: outcome,
      completedAt: completed ? Date() : nil
    )
  }

  private func waitBeforeRetry(attempt: Int) async {
    guard retryDelaysNanoseconds.indices.contains(attempt) else { return }
    let delay = retryDelaysNanoseconds[attempt]
    guard delay > 0 else { return }
    try? await Task.sleep(nanoseconds: delay)
  }

  static func endpointURL(
    baseURL: URL,
    path: String,
    query: [URLQueryItem] = []
  ) throws -> URL {
    let cleanPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let endpoint = cleanPath.isEmpty ? baseURL : baseURL.appendingPathComponent(cleanPath)
    guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
      throw APIError.invalidBaseURL
    }
    if !query.isEmpty {
      components.queryItems = query
    }
    guard let url = components.url else { throw APIError.invalidBaseURL }
    return url
  }

  private static func isRetryableStatusCode(_ statusCode: Int) -> Bool {
    [408, 429, 500, 502, 503, 504].contains(statusCode)
  }

  private static func isRetryableTransportError(_ error: Error) -> Bool {
    guard let urlError = error as? URLError else { return false }
    switch urlError.code {
    case .timedOut,
      .networkConnectionLost,
      .cannotConnectToHost,
      .cannotFindHost,
      .dnsLookupFailed,
      .notConnectedToInternet:
      return true
    default:
      return false
    }
  }

  private static func describeDecodingError(_ error: Error) -> String {
    switch error {
    case let DecodingError.keyNotFound(key, context):
      return "الحقل \(key.stringValue) غير موجود (\(context.debugDescription))."
    case let DecodingError.typeMismatch(_, context):
      return "نوع بيانات غير متوقع عند \(context.codingPath.map(\.stringValue).joined(separator: "."))."
    case let DecodingError.valueNotFound(_, context):
      return "قيمة مفقودة عند \(context.codingPath.map(\.stringValue).joined(separator: "."))."
    case let DecodingError.dataCorrupted(context):
      return context.debugDescription
    default:
      return error.localizedDescription
    }
  }
}

extension Notification.Name {
  static let moeSessionExpired = Notification.Name("moe.session.expired")
  static let moeDidReceivePushToken = Notification.Name("moe.push.token")
}
