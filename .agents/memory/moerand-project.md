---
name: MOE-AI Trading Platform
description: TradingView → Cloudflare Worker → Webull automated trading bridge. React+Vite frontend, Hono Worker backend.
---

## Architecture (v5.0)

**Flow:** TradingView alert → POST /api/tradingview/webhook → Worker validates secret + checks kill switch → executes on SANDBOX or LIVE Webull

**Frontend:** `artifacts/trading-bot/` — React+Vite, dark theme, English UI, PIN auth (6-digit SHA-256, 8hr session)
- 6 pages: Dashboard, Positions, Orders, History, System, Settings
- DEMO/LIVE toggle syncs to Worker KV via POST /api/trading/mode
- Kill switch toggle syncs to Worker KV via POST /api/trading/kill-switch
- Kill switch defaults to FALSE (disengaged) — trading allowed by default

**Worker:** `worker/src/` — Hono on Cloudflare Workers
- `index.ts` — main entry, routes registered
- `lib/cors.ts` — wildcard pattern CORS (*.replit.dev, *.replit.app)
- `lib/risk.ts` — kill switch, trading mode, risk state, safety gates
- `lib/types.ts` — all TypeScript types including TVWebhookPayload
- `lib/webull.ts` — Webull API client, fromEnv() picks SANDBOX or LIVE creds
- `routes/health.ts` — GET /api/health, GET /api/system/health
- `routes/webhook.ts` — POST /api/tradingview/webhook (main bridge)
- `routes/trading.ts` — dashboard, positions, orders, trades, mode, kill-switch

**Worker URL:** https://moerand-alerts.mosaprajb.workers.dev
**Webhook URL:** https://moerand-alerts.mosaprajb.workers.dev/api/tradingview/webhook

**GitHub repo:** Mosaprajb/MOE-AI, branch: main (via feature/moe-ai-v4-platform)

## Key Decisions

- **Kill switch default OFF** — `getKillSwitch()` returns false when KV key is absent (was `val !== 'false'`, now `val === 'true'`)
- **Trading mode in KV** — `getTradingMode()` reads `trading_mode` key from CONFIG KV, defaults SANDBOX
- **Worker excludes pnpm workspace** — `pnpm-workspace.yaml` excludes `worker/`; all worker CI uses `npm ci`
- **`package-lock.json` committed** for `npm ci --ignore-scripts` + npm cache in GitHub Actions
- **CORS uses regex** — `DEFAULT_PATTERNS` in cors.ts handles `*.replit.dev` and `*.replit.app` wildcards
- **KV/D1 bindings optional** — deploy workflow strips `[[kv_namespaces]]` and `[[d1_databases]]` blocks if secrets not set
- **No scanner, no Yahoo Finance proxy** — signals come exclusively from TradingView webhooks
- **preinstall guard is a warning** (not exit 1) — Replit deployment infrastructure uses npm directly

## TradingView Alert Payload
```json
{
  "secret":  "your-MOE_WEBHOOK_SECRET",
  "symbol":  "{{ticker}}",
  "action":  "{{strategy.order.action}}",
  "qty":     10,
  "price":   "{{close}}",
  "stop":    "{{low}}",
  "target":  0
}
```

## Required Cloudflare Secrets
- `MOE_WEBHOOK_SECRET`
- `WEBULL_SANDBOX_APP_KEY/APP_SECRET/ACCESS_TOKEN/ACCOUNT_ID`
- `WEBULL_LIVE_APP_KEY/APP_SECRET/ACCESS_TOKEN/ACCOUNT_ID` (when ready for live)
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (GitHub Secrets for deploy workflow)

## Current Status (as of rebuild)
- Frontend: ✅ Running, English, 6 pages
- Worker: ✅ TypeScript compiles clean, pushed to main
- Worker Deploy: ⏳ Awaiting CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID GitHub Secrets
- KV/D1: ⏳ Not created yet — Worker runs without them (all calls use optional chaining)
- Webull credentials: ⏳ Not set yet — Worker returns "credentials not configured" gracefully

## Remaining Setup Steps
1. Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets → Worker deploys
2. Set Webull sandbox secrets via `wrangler secret put` in `worker/` directory
3. Test webhook on demo: send test POST to webhook URL from curl or TradingView
4. When demo validated → set live credentials + toggle LIVE in frontend
5. User will send TradingView indicator code for review/improvement
