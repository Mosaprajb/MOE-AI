import Foundation
import Security

enum KeychainStore {
  private static let service = "com.moerand.moeai"

  static func save(_ value: String, account: String) throws {
    guard let data = value.data(using: .utf8) else {
      throw KeychainError.invalidData
    }

    let query = baseQuery(account: account)
    SecItemDelete(query as CFDictionary)

    var attributes = query
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly

    let status = SecItemAdd(attributes as CFDictionary, nil)
    try validate(status)
  }

  static func contains(account: String) throws -> Bool {
    var query = baseQuery(account: account)
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    let status = SecItemCopyMatching(query as CFDictionary, nil)
    switch status {
    case errSecSuccess:
      return true
    case errSecItemNotFound:
      return false
    default:
      try validate(status)
      return false
    }
  }

  static func read(account: String) throws -> String? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecItemNotFound {
      return nil
    }

    try validate(status)

    guard let data = result as? Data,
      let value = String(data: data, encoding: .utf8)
    else {
      throw KeychainError.invalidData
    }

    return value
  }

  static func delete(account: String) throws {
    let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      try validate(status)
      return
    }
  }

  private static func baseQuery(account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func validate(_ status: OSStatus) throws {
    guard status != errSecSuccess else { return }
    throw KeychainError.unhandledStatus(status)
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
