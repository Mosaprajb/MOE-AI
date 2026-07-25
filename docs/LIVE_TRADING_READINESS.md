# MOERAND Live Trading Readiness

The live execution foundation is present but deliberately disabled. Do not commit credentials to GitHub.

## Required Cloudflare secrets

- `WEBULL_LIVE_APP_KEY`
- `WEBULL_LIVE_APP_SECRET`
- `WEBULL_LIVE_ACCESS_TOKEN`
- `WEBULL_LIVE_ACCOUNT_ID`
- `MOE_WEBHOOK_SECRET`

The deployed Worker exposes only missing secret names through `GET /api/trading/live/readiness`; it never returns secret values.

## Safety gates

All of these must be explicitly changed before LIVE can become selectable:

- `WEBULL_ENVIRONMENT=production`
- `MOE_LIVE_EXECUTION_IMPLEMENTED=true`
- `MOE_LIVE_MODE_UNLOCKED=true`
- `WEBULL_LIVE_TRADING=true`
- `WEBULL_LIVE_ORDER_SUBMISSION=true`
- `WEBULL_LIVE_KILL_SWITCH=false`
- `WEBULL_PROTECTED_ORDERS=true`

Automatic live orders additionally require `WEBULL_LIVE_AUTOMATION_ARMED=true`.

The committed defaults keep every live gate closed, the kill switch engaged, and live automation disarmed.

## Submission flow

1. Account balance and positions are read from the production account.
2. The MOERAND signal, brain, sizing, portfolio and decision layers must accept the trade.
3. The order is previewed with Webull.
4. Preview-only requests stop without submitting.
5. A submission requires `submitLive=true` and the exact request confirmation `liveConfirmation=SUBMIT_LIVE_ORDER`.
6. Only protected BUY entries are supported initially, with linked take-profit and stop-loss orders.

## Order management foundation

The production client includes read-only open-order/history/detail calls plus cancel and replace operations. These functions remain unreachable from public routes until a separate authenticated operations interface is approved.

## Trade history

Open `https://moerand-alerts.mosaprajb.workers.dev/trades` to view all stored MOERAND trades, up to the 2,000-record Durable Object retention limit. The page supports symbol and status filters and refreshes every 30 seconds.

## Important

Code readiness is not broker certification. Before enabling any gate, complete sandbox protected-order testing, verify Webull production OpenAPI permissions, validate preview responses, and perform a manually supervised one-share live test.
