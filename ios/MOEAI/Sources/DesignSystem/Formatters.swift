import Foundation

private let usdFormatter: NumberFormatter = {
  let formatter = NumberFormatter()
  formatter.numberStyle = .currency
  formatter.currencyCode = "USD"
  formatter.maximumFractionDigits = 2
  formatter.minimumFractionDigits = 2
  return formatter
}()

private let compactFormatter: NumberFormatter = {
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.maximumFractionDigits = 2
  formatter.usesGroupingSeparator = true
  return formatter
}()

func formatCurrency(_ value: Double?) -> String {
  guard let value else { return "—" }
  return usdFormatter.string(from: NSNumber(value: value)) ?? String(format: "$%.2f", value)
}

func formatPercent(_ value: Double?) -> String {
  guard let value else { return "—" }
  return String(format: "%+.2f%%", value)
}

func formatNumber(_ value: Double?, maximumFractionDigits: Int = 4) -> String {
  guard let value else { return "—" }
  compactFormatter.maximumFractionDigits = maximumFractionDigits
  return compactFormatter.string(from: NSNumber(value: value)) ?? String(value)
}

func formatVolume(_ value: Double?) -> String {
  guard let value else { return "—" }
  let absolute = abs(value)
  if absolute >= 1_000_000_000 {
    return String(format: "%.2fB", value / 1_000_000_000)
  }
  if absolute >= 1_000_000 {
    return String(format: "%.2fM", value / 1_000_000)
  }
  if absolute >= 1_000 {
    return String(format: "%.1fK", value / 1_000)
  }
  return formatNumber(value, maximumFractionDigits: 0)
}

func parseISO8601Date(_ value: String?) -> Date? {
  guard let value else { return nil }
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractional.date(from: value) { return date }
  return ISO8601DateFormatter().date(from: value)
}

func formatDate(_ value: String?) -> String {
  guard let date = parseISO8601Date(value) else { return value ?? "—" }
  return date.formatted(date: .abbreviated, time: .shortened)
}

var appVersionDescription: String {
  let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    ?? "0.1.0"
  let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
  return "\(version) (\(build))"
}
