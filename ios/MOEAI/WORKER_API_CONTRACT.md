# MOE-AI Native iOS ↔ Cloudflare Worker Contract

The iOS app uses native `URLSession` requests only. Safari and `WKWebView` are not part of the authentication or trading-control flow.

Every native request includes:

- `Accept: application/json`
- `x-moe-mobile-client: 1`
- `x-moe-request-id: <UUID>`
- `Cache-Control: no-store`
- `Content-Type: application/json` when a JSON body is present

The Worker session cookie must be `Secure`, `HttpOnly`, and accepted by the app's shared cookie storage.

## Authentication

### `POST /api/tradingview/session`

Request:

```json
{
  "pin": "<control PIN>"
}
```

Success:

```json
{
  "ok": true,
  "expiresAt": "2026-08-05T12:00:00.000Z"
}
```

Expected failures:

- `401` wrong PIN.
- `403` rejected request origin/policy.
- `503` control PIN or session secret is not configured.

## Status snapshot

### `GET /api/tradingview/status`

Returns the current settings, runtime, Demo/Live accounts, positions, archive, audit, and connection state. Most fields are optional so the app can render degraded responses safely.

Minimum accepted response:

```json
{
  "ok": true,
  "mode": "TRADINGVIEW_ONLY"
}
```

A `401` response causes the app to clear its local authenticated state and show the login screen.

## Market screener

### `GET /api/mobile/market-screener?search=&sort=VOLUME`

Success:

```json
{
  "ok": true,
  "rows": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "price": 200.0,
      "changePercent": 1.25,
      "volume": 1000000,
      "available": true
    }
  ]
}
```

Supported app sort values:

- `VOLUME`
- `CHANGE`
- `PRICE_DESC`

## Position maintenance

### `POST /api/tradingview/refresh`

Body: `{}`

### `POST /api/tradingview/repair`

Body: `{}`

Both return an envelope containing at least `ok` and optional `error`/`message` fields.

## Manual position close

### `POST /api/tradingview/position/close`

Request:

```json
{
  "symbol": "AAPL",
  "confirmation": "CLOSE"
}
```

The Worker remains authoritative and must reject an unknown symbol, invalid state, missing confirmation, or unsafe Live operation.

## TradingView reception

### `POST /api/tradingview/reception`

Demo request:

```json
{
  "enabled": true,
  "accountType": "DEMO",
  "confirmation": null
}
```

First Live activation request:

```json
{
  "enabled": true,
  "accountType": "LIVE",
  "confirmation": "CONFIRM"
}
```

The client confirmation does not bypass Worker readiness, Live locks, account connectivity, or Kill Switch rules.

## Kill Switch

### Activate

`POST /api/tradingview/kill-switch`

```json
{
  "action": "ACTIVATE"
}
```

### Clear

`POST /api/tradingview/kill-switch`

```json
{
  "action": "CLEAR",
  "confirmation": "CLEAR"
}
```

The Worker must disable reception when the Kill Switch is activated.

## Native APNs registration

### `POST /api/mobile/push/register`

```json
{
  "token": "<hex APNs device token>",
  "platform": "ios",
  "bundleIdentifier": "com.moerand.moeai",
  "environment": "development"
}
```

Release builds send `environment: production`.

Expected success:

```json
{
  "ok": true,
  "registered": true
}
```

### Unregister

`DELETE /api/mobile/push/register`

```json
{
  "token": "<hex APNs device token>",
  "platform": "ios"
}
```

APNs private keys must remain in server-side secrets. They must never be bundled in the application or stored in GitHub source files.

## Retry and mutation rules

The app may retry idempotent `GET` requests after transient transport failures or status codes `408`, `429`, `500`, `502`, `503`, and `504`.

The app does not automatically retry PIN login, reception changes, Kill Switch actions, repairs, refresh mutations, token registration, or manual position close requests. This prevents duplicate control actions and duplicate broker-side effects.
