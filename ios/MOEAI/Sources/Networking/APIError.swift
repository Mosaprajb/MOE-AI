import Foundation

enum APIError: LocalizedError, Equatable {
  case invalidBaseURL
  case invalidResponse
  case unauthorized
  case server(statusCode: Int, message: String)
  case decoding(String)
  case transport(String)

  var errorDescription: String? {
    switch self {
    case .invalidBaseURL:
      return "رابط خادم Cloudflare Worker غير صالح."
    case .invalidResponse:
      return "وصلت استجابة غير صالحة من الخادم."
    case .unauthorized:
      return "انتهت الجلسة أو يلزم تسجيل الدخول من جديد."
    case let .server(_, message):
      return message
    case let .decoding(message):
      return "تعذر قراءة بيانات الخادم: \(message)"
    case let .transport(message):
      return "تعذر الاتصال بالخادم: \(message)"
    }
  }
}
