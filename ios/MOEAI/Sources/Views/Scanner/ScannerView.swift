import SwiftUI

struct ScannerView: View {
  @EnvironmentObject private var model: AppModel
  @State private var search = ""
  @State private var sort: ScannerSort = .volume

  private var filteredRows: [ScreenerRow] {
    let normalized = search.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return model.scannerRows }
    return model.scannerRows.filter { row in
      row.symbol.localizedCaseInsensitiveContains(normalized)
        || (row.name ?? "").localizedCaseInsensitiveContains(normalized)
    }
  }

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 12) {
        controls

        if model.isLoadingScanner && model.scannerRows.isEmpty {
          ProgressView("جارٍ تحميل بيانات السوق…")
            .tint(.white)
            .foregroundStyle(MOETheme.muted)
            .padding(.top, 50)
        } else if filteredRows.isEmpty {
          EmptyStateView(
            icon: "waveform.path.ecg",
            title: "لا توجد نتائج",
            message: search.isEmpty
              ? "لم يعرض الخادم أسهمًا في الوقت الحالي."
              : "لا يوجد سهم يطابق البحث الحالي."
          )
        } else {
          ForEach(filteredRows) { row in
            ScannerRowCard(row: row)
          }
        }
      }
      .padding()
    }
    .background(AppBackground())
    .foregroundStyle(.white)
    .navigationTitle("ماسح الأسهم")
    .refreshable { await model.loadScanner(search: search, sort: sort.rawValue) }
    .task {
      if model.scannerRows.isEmpty {
        await model.loadScanner(sort: sort.rawValue)
      }
    }
    .onChange(of: sort) { _, newValue in
      Task { await model.loadScanner(search: search, sort: newValue.rawValue) }
    }
  }

  private var controls: some View {
    GlassCard {
      VStack(spacing: 12) {
        HStack(spacing: 10) {
          Image(systemName: "magnifyingglass")
            .foregroundStyle(MOETheme.muted)
          TextField("ابحث عن سهم أو شركة", text: $search)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
          if !search.isEmpty {
            Button {
              search = ""
            } label: {
              Image(systemName: "xmark.circle.fill")
                .foregroundStyle(MOETheme.muted)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(12)
        .background(MOETheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 13))

        Picker("الترتيب", selection: $sort) {
          ForEach(ScannerSort.allCases) { option in
            Text(option.title).tag(option)
          }
        }
        .pickerStyle(.segmented)

        HStack {
          Text("\(filteredRows.count) نتيجة")
            .font(.caption)
            .foregroundStyle(MOETheme.muted)
          Spacer()
          Button {
            Task { await model.loadScanner(search: search, sort: sort.rawValue) }
          } label: {
            if model.isLoadingScanner {
              ProgressView()
                .tint(.white)
            } else {
              Label("تحديث", systemImage: "arrow.clockwise")
                .font(.caption.bold())
            }
          }
          .buttonStyle(.plain)
          .foregroundStyle(MOETheme.accent)
        }
      }
    }
  }
}

private enum ScannerSort: String, CaseIterable, Identifiable {
  case volume = "VOLUME"
  case change = "CHANGE"
  case price = "PRICE_DESC"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .volume: return "الحجم"
    case .change: return "التغير"
    case .price: return "السعر"
    }
  }
}

private struct ScannerRowCard: View {
  let row: ScreenerRow

  var body: some View {
    GlassCard {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(row.symbol)
            .font(.title3.black())
          Text(row.sector ?? row.session ?? "—")
            .font(.caption2)
            .foregroundStyle(MOETheme.muted)
        }
        .frame(width: 75, alignment: .leading)

        VStack(alignment: .leading, spacing: 5) {
          Text(row.name ?? row.symbol)
            .font(.subheadline.bold())
            .lineLimit(1)
          Text("الحجم \(formatVolume(row.volume))")
            .font(.caption)
            .foregroundStyle(MOETheme.muted)
        }

        Spacer(minLength: 8)

        VStack(alignment: .trailing, spacing: 5) {
          Text(formatCurrency(row.price))
            .font(.headline)
          Text(formatPercent(row.changePercent))
            .font(.caption.bold())
            .foregroundStyle(MOETheme.tone(for: row.changePercent))
        }
      }
    }
    .opacity(row.available == false ? 0.58 : 1)
  }
}
