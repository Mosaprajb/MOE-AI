import Foundation

actor APIClient {
  static let shared = APIClient()

  private var baseURL: URL
  private let session: URLSession
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder

  init(
    baseURL: URL = AppConfiguration.normalizedURL(from: AppConfiguration.storedWorkerURL)
      ?? URL(string: AppConfiguration.defaultWorkerURL)!,
    session: URLSession? = nil
  ) {
    self.baseURL = baseURL

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
      responseType: Response.self
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
      responseType: Response.self
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
    if body != nil {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return request
  }

  private func execute<Response: Decodable>(
    request: URLRequest,
    responseType: Response.Type
  ) async throws -> Response {
    let data: Data
    let response: URLResponse

    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw APIError.transport(error.localizedDescription)
    }

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    if httpResponse.statusCode == 401 {
      NotificationCenter.default.post(name: .moeSessionExpired, object: nil)
      throw APIError.unauthorized
    }

    guard (200...299).contains(httpResponse.statusCode) else {
      let envelope = try? decoder.decode(APIEnvelope.self, from: data)
      let message = envelope?.error
        ?? envelope?.message
        ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
      throw APIError.server(statusCode: httpResponse.statusCode, message: message)
    }

    do {
      return try decoder.decode(responseType, from: data)
    } catch {
      throw APIError.decoding(Self.describeDecodingError(error))
    }
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
