# Guarded Live control rollout

This phase makes Live account access observable while keeping all Live order execution fail-closed.

## Runtime contract

The Worker exposes:

- `GET /api/trading/live/status` — effective server policy, blockers, stored mode, safe mode, and session state.
- `POST /api/trading/live/unlock` — verifies the dedicated Live PIN and creates a short-lived HMAC session only when every server-side gate is open.
- `POST /api/trading/live/lock` — tells the client to discard its Live session and return to Sandbox.
- `GET /api/trading/live/dashboard` and related account endpoints remain usable for read-only observation when Live credentials exist.

The `x-moe-live-session` header is required for switching the Worker to Live and for direct Live order submission. TradingView webhook execution has a separate explicit gate and does not inherit an interactive browser session.

## Committed safety state

Sandbox and Staging are permanently rejected by the environment gate. Production is committed as `live-read-only` with all order switches off and the configuration kill switch on. A stale `trading_mode=LIVE` value in KV is exposed as `storedMode`, but the effective `currentMode` remains `SANDBOX`.

Every deployment runs `scripts/verify-deployment-safety.mjs` after publishing. The workflow fails unless health, Live status, and mode endpoints all confirm that Live execution is disabled and the effective mode is Sandbox.

## Required secrets for a future reviewed activation

Do not commit these values:

- `MOE_LIVE_TRADING_PIN`
- `MOE_LIVE_SESSION_SECRET`
- `WEBULL_LIVE_APP_KEY`
- `WEBULL_LIVE_APP_SECRET`
- `WEBULL_LIVE_ACCESS_TOKEN`
- `WEBULL_LIVE_ACCOUNT_ID`
- `MOE_WEBHOOK_SECRET` (required only before TradingView Live execution is enabled)

## Future production-only activation checklist

A later reviewed change must intentionally set all of the following in the Production environment only:

- `MOE_DEPLOYMENT_ENV=production`
- `MOE_EXECUTION_POLICY=live-enabled`
- `MOE_LIVE_EXECUTION_IMPLEMENTED=true`
- `MOE_LIVE_READ_ONLY=false`
- `WEBULL_LIVE_TRADING=true`
- `WEBULL_LIVE_ORDER_SUBMISSION=true`
- `WEBULL_LIVE_AUTOMATION_ARMED=true`
- `WEBULL_LIVE_KILL_SWITCH=false`

TradingView Live execution remains disabled unless `MOE_LIVE_WEBHOOK_EXECUTION_ENABLED=true` is reviewed separately. Before any future activation, the post-deploy verifier must be changed in the same reviewed change so it does not silently normalize an unsafe deployment.

## Client and mobile behavior

Clients may open the Live account dashboard endpoint for observation without changing the Worker's stored execution mode. The server response always includes `executionAllowed` and `observationOnly`; clients must present the view as read-only while execution remains blocked. A dedicated dashboard control update can consume this contract without weakening the server gates.

The app edge also protects the authenticated mobile close-position, Live reception, and kill-switch-clear paths. This prevents those routes from bypassing the same central Live policy used by direct orders and TradingView webhooks.
