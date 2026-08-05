import Foundation
import Security

enum KeychainStore {
  private static let service = "com.moerand.moeai"

  static func save(_ value: String, account: String) throws {
    guard let data = value.data(using: .utf8) else {
      throw KeychainError.invalidData
    }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]

    SecItemDelete(query as CFDictionary)

    var attributes = query
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw KeychainError.unhandledStatus(status)
    }
  }

  static func read(account: String) throws -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecItemNotFound {
      return nil
    }

    guard status == errSecSuccess else {
      throw KeychainError.unhandledStatus(status)
    }

    guard let data = result as? Data,
      let value = String(data: data, encoding: .utf8)
    else {
      throw KeychainError.invalidData
    }

    return value
  }

  static func delete(account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]

    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError.unhandledStatus(status)
    }
  }
}

enum KeychainError: LocalizedError, Equatable {
  case invalidData
  case unhandledStatus(OSStatus)

  var errorDescription: String? {
    switch self {
    case .invalidData:
      return "تعذر قراءة بيانات Keychain."
    case let .unhandledStatus(status):
      let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
      return "تعذر الوصول إلى Keychain: \(message)"
    }
  }
}
