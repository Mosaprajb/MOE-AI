import SwiftUI

struct AuthenticationView: View {
  @EnvironmentObject private var session: SessionStore
  @State private var pin = ""
  @State private var rememberPIN = true
  @State private var showServerSettings = false
  @FocusState private var pinFocused: Bool

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        Spacer(minLength: 54)

        ZStack {
          Circle()
            .fill(MOETheme.gradient)
            .frame(width: 96, height: 96)
            .blur(radius: 22)
            .opacity(0.58)
          Image(systemName: "waveform.path.ecg.rectangle.fill")
            .font(.system(size: 50, weight: .semibold))
            .foregroundStyle(.white)
        }

        VStack(spacing: 7) {
          Text("MOE-AI")
            .font(.system(size: 38, weight: .black, design: .rounded))
          Text("Native Trading Control")
            .foregroundStyle(MOETheme.muted)
        }

        GlassCard {
          VStack(spacing: 15) {
            SecureField("الرمز السري", text: $pin)
              .keyboardType(.numberPad)
              .textContentType(.password)
              .font(.title3.bold())
              .multilineTextAlignment(.center)
              .focused($pinFocused)
              .submitLabel(.go)
              .onSubmit { authenticate() }
              .padding()
              .background(
                MOETheme.surfaceElevated,
                in: RoundedRectangle(cornerRadius: 15)
              )

            Toggle("حفظ الرمز بأمان على هذا الجهاز", isOn: $rememberPIN)
              .font(.subheadline)
              .tint(MOETheme.accent)

            if rememberPIN {
              Text("يتطلب الحفظ تفعيل رمز قفل الآيفون، ولا ينتقل الرمز إلى جهاز آخر أو iCloud Keychain.")
                .font(.caption)
                .foregroundStyle(MOETheme.muted)
                .multilineTextAlignment(.leading)
            }

            Button(action: authenticate) {
              LoadingButtonLabel(
                title: session.isBusy ? "جارٍ التحقق…" : "فتح التطبيق",
                icon: "lock.open.fill",
                loading: session.isBusy
              )
              .padding(.vertical, 15)
            }
            .buttonStyle(.plain)
            .background(MOETheme.gradient, in: RoundedRectangle(cornerRadius: 15))
            .disabled(pin.trimmingCharacters(in: .whitespaces).isEmpty || session.isBusy)

            if session.faceIDAvailable && session.hasSavedPIN {
              Button {
                Task { await session.unlockWithFaceID() }
              } label: {
                Label("فتح باستخدام Face ID", systemImage: "faceid")
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 13)
              }
              .buttonStyle(.plain)
              .foregroundStyle(MOETheme.accent)
              .disabled(session.isBusy)
            }

            if AppConfiguration.allowsCustomWorkerURL {
              DisclosureGroup("إعدادات خادم الاختبار", isExpanded: $showServerSettings) {
                VStack(alignment: .leading, spacing: 10) {
                  TextField("Cloudflare Worker URL", text: $session.baseURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)

                  Button("حفظ رابط الخادم") {
                    Task { _ = await session.saveServerURL() }
                  }
                  .font(.footnote.bold())

                  Text("يُسمح بـHTTPS فقط، أو localhost عبر HTTP أثناء Debug.")
                    .font(.caption)
                }
                .padding(.top, 10)
              }
              .font(.subheadline)
              .foregroundStyle(MOETheme.muted)
            } else {
              Label(
                "متصل بخادم MOE-AI المعتمد",
                systemImage: "lock.shield.fill"
              )
              .font(.footnote)
              .foregroundStyle(MOETheme.muted)
            }

            if let error = session.errorMessage {
              InlineErrorView(message: error)
            }
          }
        }
        .padding(.horizontal, 22)

        Text("اتصال أصلي مباشر بخادم MOE-AI — من دون Safari أو WebView")
          .font(.caption)
          .foregroundStyle(MOETheme.muted)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 24)

        Spacer(minLength: 24)
      }
      .foregroundStyle(.white)
    }
    .scrollDismissesKeyboard(.interactively)
    .onAppear {
      if !session.hasSavedPIN {
        pinFocused = true
      }
    }
  }

  private func authenticate() {
    let currentPIN = pin
    Task {
      await session.login(pin: currentPIN, remember: rememberPIN)
      if session.isAuthenticated {
        pin = ""
      }
    }
  }
}
