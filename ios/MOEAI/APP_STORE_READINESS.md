# MOE-AI App Store and TestFlight Readiness

This document separates work that is safe to complete before Apple Developer Program activation from work that requires an active membership and private Apple credentials.

## Ready before membership activation

- Native SwiftUI application and committed Xcode project.
- Debug build, unit tests, static analysis, and Release simulator build in GitHub Actions.
- PIN authentication, Face ID unlock, Keychain storage, native URLSession cookies, and privacy shielding.
- Dashboard, Scanner, Positions, Orders, Activity, Archive, P&L, and Settings screens.
- App Icon, Launch Screen, privacy manifest, Debug/Release entitlements, and app version settings.
- APNs device-token collection and Worker registration client contract.
- Release checklist, Worker API contract, and no-secret CI configuration.

## Required after membership becomes active

1. Confirm the final Apple Team ID.
2. Confirm or register the final bundle identifier (`com.moerand.moeai` unless changed).
3. Create the App ID and enable Push Notifications.
4. Create an App Store Connect application record.
5. Create distribution signing assets or configure an App Store Connect API-key based signing service.
6. Create the APNs authentication key and store it only in the server secret store.
7. Add signing and App Store Connect credentials to GitHub Environments/Secrets.
8. Produce a signed archive, validate it, and upload it to TestFlight.
9. Install the TestFlight build on a physical iPhone and complete the device test matrix.

## Secrets that may be needed later

Names are placeholders; values must never be committed or pasted into issue/PR comments.

- `ASC_KEY_ID`
- `ASC_ISSUER_ID`
- `ASC_PRIVATE_KEY_P8`
- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `TEMP_KEYCHAIN_PASSWORD`

The exact signing approach will be selected after membership activation. Do not create unnecessary certificates before that decision.

## App Store metadata to confirm

- App name: `MOE-AI`.
- Primary category: Finance.
- Subtitle and promotional text.
- Full description in Arabic and English.
- Support URL.
- Privacy Policy URL.
- Marketing URL, if used.
- Copyright holder.
- Age rating questionnaire.
- Export-compliance answers.
- App privacy disclosures based on actual production data collection.
- Review notes explaining the PIN, Demo/Live controls, and any test account requirements.

## Required iPhone device tests

- First launch and Launch Screen.
- Login with a correct and incorrect PIN.
- Save PIN to Keychain and unlock with Face ID.
- App-switcher privacy shield.
- Automatic local lock after background timeout.
- Session expiration and reauthentication.
- Sandbox Worker connectivity on Wi-Fi and cellular data.
- Scanner refresh and empty/error states.
- Positions, Orders, Activity, Archive, and P&L rendering.
- Reception controls, Kill Switch, and Live confirmation safeguards.
- APNs permission, device-token registration, foreground notification, and background notification.
- Sign out and Forget Device.
- Dark-mode layout, Dynamic Type, Arabic text, and VoiceOver labels.

## TestFlight release gate

A build may be uploaded only when all items below are true:

- GitHub Actions `iOS Build` is green for the release commit.
- The physical-device smoke test is complete.
- Live trading remains locked unless the Worker independently reports readiness.
- No secret, PIN, API token, certificate, or provisioning profile exists in Git history.
- App privacy answers match production behavior.
- The build number is higher than every previously uploaded build.
- Release notes document known limitations.
