# Native iOS Worker integration

This stage adds the authenticated API used by the SwiftUI iPhone client and a fail-closed APNs provider implementation.

## Security defaults

- `MOE_MOBILE_LIVE_CONTROL_ENABLED=false`: the phone cannot enable Live reception or close Live positions.
- `APNS_ENABLED=false`: device tokens may be registered, but the Worker never contacts APNs.
- Mobile sessions use an HttpOnly, Secure, SameSite=Strict cookie signed with HMAC-SHA256.
- Five failed PIN attempts within 15 minutes lock the request fingerprint for 15 minutes.
- Mutating trade requests are never retried by the iOS client.
- TradingView webhook reception can be disabled by the authenticated mobile control API.

## Required Cloudflare secrets before mobile login

```text
MOE_MOBILE_CONTROL_PIN
MOE_MOBILE_SESSION_SECRET
```

Generate the session secret as a high-entropy random value of at least 32 characters. Do not commit either value.

## D1 migration

Run the migration before deploying the mobile API:

```sh
cd worker
pnpm exec wrangler d1 migrations apply moe-ai --remote
```

The migration creates login throttling, mobile audit, APNs device registry, and delivery-event tables.

## APNs activation after Apple membership becomes active

Keep `APNS_ENABLED=false` until all of these secrets are set:

```text
APNS_TEAM_ID
APNS_KEY_ID
APNS_PRIVATE_KEY_P8
```

`APNS_BUNDLE_ID` is committed as `com.moerand.moeai`. Change it before signing if Apple assigns a different bundle identifier.

After adding the secrets, change `APNS_ENABLED` to `true`, deploy, sign the iOS app with the matching App ID, and use `POST /api/mobile/push/test` from an authenticated device.

## Native API paths

```text
POST   /api/tradingview/session
DELETE /api/tradingview/session
GET    /api/tradingview/status
POST   /api/tradingview/refresh
POST   /api/tradingview/repair
POST   /api/tradingview/position/close
POST   /api/tradingview/reception
POST   /api/tradingview/kill-switch
GET    /api/mobile/market-screener
POST   /api/mobile/push/register
DELETE /api/mobile/push/register
GET    /api/mobile/push/status
POST   /api/mobile/push/test
```

## Validation

The dedicated workflow performs:

1. Worker TypeScript type-check.
2. Mobile session token tests.
3. APNs JWT and header tests with a generated P-256 key.
4. Hono route integration tests using in-memory D1 and KV doubles.
5. Wrangler deploy dry-run.

No test contacts Webull or APNs, and Live mobile control remains disabled.
