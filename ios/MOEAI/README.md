# MOE-AI Native iOS App

This directory contains the native SwiftUI iPhone client for MOE-AI. It communicates directly with the Cloudflare Worker through `URLSession`; it does not embed Safari, `WKWebView`, or browser authentication.

## Open the project

Open:

```text
ios/MOEAI/MOEAI.xcodeproj
```

The committed Xcode project is the source of truth. `project.yml` mirrors the project for optional regeneration with XcodeGen.

## Local build

1. Install Xcode 16 or newer.
2. Open `MOEAI.xcodeproj`.
3. Select the `MOEAI` target and choose your Apple Developer Team under **Signing & Capabilities**.
4. Keep **Automatically manage signing** enabled.
5. Select an iPhone simulator and run the app.

Command-line simulator validation:

```bash
xcodebuild \
  -project ios/MOEAI/MOEAI.xcodeproj \
  -scheme MOEAI \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  clean test
```

Static project validation:

```bash
ios/MOEAI/scripts/validate-project.sh
```

## Configuration

The default Worker URL is:

```text
https://moerand-alerts-sandbox.mosaprajb.workers.dev
```

It can be changed from the login screen or Settings. The app stores only the URL in `UserDefaults`; a remembered control PIN is stored in Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.

The native client currently calls these Worker routes:

- `POST /api/tradingview/session`
- `GET /api/tradingview/status`
- `GET /api/mobile/market-screener`
- `POST /api/tradingview/refresh`
- `POST /api/tradingview/repair`
- `POST /api/tradingview/position/close`
- `POST /api/tradingview/reception`
- `POST /api/tradingview/kill-switch`

## Push notifications

The iOS target includes the Push Notifications capability, handles APNs device tokens, and attempts to register them at:

```text
POST /api/mobile/push/register
```

The registration path is configurable through `UserDefaults` key `moe.push.registrationPath`. The Worker must implement APNs token persistence and APNs delivery before remote notifications can complete end-to-end. Local notification permission and local test notifications work independently.

Never commit Apple private keys, APNs `.p8` files, provisioning profiles, certificates, control PINs, or Worker secrets.

## Distribution

Physical-device and TestFlight distribution still require:

- an active Apple Developer membership,
- a unique App ID matching `com.moerand.moeai`,
- signing certificates and provisioning profiles,
- APNs configuration,
- an App Store Connect application record.
