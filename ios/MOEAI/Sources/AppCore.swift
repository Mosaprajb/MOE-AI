import Foundation
import LocalAuthentication
import Security
import UserNotifications

struct TradingStatus: Codable {
    var ok: Bool
    var runtime: RuntimeState?
    var accounts: Accounts?
    var positions: [Position]
    var archive: [Trade]
    var audit: [AuditEvent]
    var marketClock: MarketClock?

    struct RuntimeState: Codable {
        var receptionEnabled: Bool?
        var killSwitchActive: Bool?
        var accountType: String?
        var lastValidAlertAt: String?
    }

    struct Accounts: Codable {
        var demo: Account?
        var live: Account?
    }

    struct Account: Codable {
        var connected: Bool?
        var balance: Double?
        var buyingPower: Double?
        var openPositions: Int?
        var dayPnl: Double?
        var realizedPnl: Double?
        var unrealizedPnl: Double?
        var dayPnlPercent: Double?
        var fetchedAt: String?
    }

    struct Position: Codable, Identifiable {
        var id: String { symbol ?? UUID().uuidString }
        var symbol: String?
        var status: String?
        var quantity: Double?
        var entryPrice: Double?
        var lastPrice: Double?
        var currentStopPrice: Double?
        var takeProfitPrice: Double?
        var positionOpen: Bool?
        var updatedAt: String?
    }

    struct Trade: Codable, Identifiable {
        var id: String { signalId ?? "\(symbol ?? "trade")-\(closedAt ?? UUID().uuidString)" }
        var symbol: String?
        var entryPrice: Double?
        var exitPrice: Double?
        var profitLoss: Double?
        var exitReason: String?
        var quantity: Double?
        var accountType: String?
        var closedAt: String?
        var signalId: String?
    }

    struct AuditEvent: Codable, Identifiable {
        var id: String
        var type: String?
        var symbol: String?
        var createdAt: String?
    }

    struct MarketClock: Codable {
        var label: String?
        var phase: String?
        var entryAllowed: Bool?
        var nextTransitionAt: String?
        var autoFlattenAt: String?
    }
}

struct ScannerResponse: Codable {
    var ok: Bool
    var rows: [ScannerRow]
    var updatedAt: String?

    struct ScannerRow: Codable, Identifiable {
        var id: String { symbol }
        var symbol: String
        var name: String?
        var sector: String?
        var price: Double?
        var changePercent: Double?
        var volume: Double?
        var available: Bool?
    }
}

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

actor APIClient {
    static let shared = APIClient()
    private let decoder = JSONDecoder()
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 20
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        session = URLSession(configuration: configuration)
    }

    func status(baseURL: URL) async throws -> TradingStatus {
        try await request(baseURL: baseURL, path: "/api/tradingview/status")
    }

    func scanner(baseURL: URL) async throws -> ScannerResponse {
        try await request(baseURL: baseURL, path: "/api/mobile/market-screener?sort=VOLUME")
    }

    func unlock(baseURL: URL, pin: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/api/tradingview/session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "x-moe-mobile-client")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["pin": pin])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(message: message ?? "تعذر تسجيل الدخول")
        }
    }

    func closePosition(baseURL: URL, symbol: String) async throws {
        try await post(baseURL: baseURL, path: "/api/tradingview/position/close", body: ["symbol": symbol, "confirmation": "CLOSE"])
    }

    func refresh(baseURL: URL) async throws {
        try await post(baseURL: baseURL, path: "/api/tradingview/refresh", body: [:])
    }

    private func request<T: Decodable>(baseURL: URL, path: String) async throws -> T {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("1", forHTTPHeaderField: "x-moe-mobile-client")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "استجابة غير صالحة") }
        if http.statusCode == 401 { throw APIError(message: "AUTH_REQUIRED") }
        guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)") }
        return try decoder.decode(T.self, from: data)
    }

    private func post(baseURL: URL, path: String, body: [String: String]) async throws {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "x-moe-mobile-client")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: "فشل تنفيذ الطلب")
        }
    }
}

enum KeychainStore {
    static func set(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrAccount: key] as CFDictionary)
        let status = SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ] as CFDictionary, nil)
        guard status == errSecSuccess else { throw APIError(message: "تعذر الحفظ الآمن") }
    }

    static func get(_ key: String) -> String? {
        var result: AnyObject?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ] as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrAccount: key] as CFDictionary)
    }
}

@MainActor
final class SessionStore: ObservableObject {
    @Published var isUnlocked = false
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var baseURLText = UserDefaults.standard.string(forKey: "moe.baseURL") ?? "https://moerand-alerts-sandbox.mosaprajb.workers.dev"

    private let pinKey = "moe.control.pin"

    var baseURL: URL? { URL(string: baseURLText.trimmingCharacters(in: .whitespacesAndNewlines)) }
    var hasSavedPIN: Bool { KeychainStore.get(pinKey) != nil }

    func restore() async {
        if hasSavedPIN { await unlockWithFaceID() }
    }

    func unlock(pin: String, remember: Bool = true) async {
        guard let baseURL else { errorMessage = "رابط الخادم غير صالح"; return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await APIClient.shared.unlock(baseURL: baseURL, pin: pin)
            if remember { try KeychainStore.set(pin, for: pinKey) }
            UserDefaults.standard.set(baseURLText, forKey: "moe.baseURL")
            isUnlocked = true
            errorMessage = nil
            await Notifications.requestAuthorization()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func unlockWithFaceID() async {
        guard let pin = KeychainStore.get(pinKey) else { return }
        let context = LAContext()
        var evaluationError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evaluationError) else {
            errorMessage = "Face ID غير متاح على هذا الجهاز"
            return
        }
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "فتح تطبيق MOE-AI")
            if ok { await unlock(pin: pin, remember: true) }
        } catch {
            errorMessage = "لم تنجح مصادقة Face ID"
        }
    }

    func lock() {
        isUnlocked = false
    }

    func forgetPIN() {
        KeychainStore.remove(pinKey)
        isUnlocked = false
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var status: TradingStatus?
    @Published var scannerRows: [ScannerResponse.ScannerRow] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var selectedAccount = "demo"

    func refresh(baseURL: URL) async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let statusTask = APIClient.shared.status(baseURL: baseURL)
            async let scannerTask = APIClient.shared.scanner(baseURL: baseURL)
            status = try await statusTask
            scannerRows = try await scannerTask.rows
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func close(symbol: String, baseURL: URL) async {
        do {
            try await APIClient.shared.closePosition(baseURL: baseURL, symbol: symbol)
            await refresh(baseURL: baseURL)
        } catch { errorMessage = error.localizedDescription }
    }
}

enum Notifications {
    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
    }
}
