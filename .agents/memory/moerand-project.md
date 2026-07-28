---
name: MOE-AI Trading Platform
description: Architecture decisions, key URLs, and lessons for the MOE-AI personal trading platform.
---

## Core Architecture

- **Frontend**: React+Vite SPA in `artifacts/trading-bot/` — Arabic RTL, dark institutional theme
- **Backend**: Cloudflare Worker — source in `worker/src/`, deployed to `moerand-alerts.mosaprajb.workers.dev`
- **Auth**: PIN-based, SHA-256 hashed, localStorage session (8hr TTL) — `src/lib/auth.ts`
- **API client**: `src/lib/api.ts` — fetches from CF Worker, CORS-dependent
- **Scanner**: Uses CF Worker decisions endpoint; falls back to deterministic demo data when offline

## Key File Locations

### Frontend (`artifacts/trading-bot/`)
- Design system: `src/index.css` (pure CSS custom properties, no Tailwind utilities)
- Stocks watchlist: `src/lib/stocks.ts` (20 tickers)
- Market hook: `src/lib/useFinnhubMarket.ts`
- App shell + routing: `src/App.tsx`
- Pages: `src/pages/` (Dashboard, Scanner, Positions, Orders, Risk, Trades, System, Settings)

### Worker (`worker/`)
- Entry: `src/index.ts` (Hono app)
- Webull adapter: `src/lib/webull.ts`
- Risk engine: `src/lib/risk.ts`
- Routes: `src/routes/{health,trading,webhook}.ts`
- Schema: `src/db/schema.sql` (D1 — decisions, trades, orders, alerts tables)
- Config: `wrangler.toml`

### CI/CD (`.github/workflows/`)
- `deploy-cloudflare-worker.yml` — deploys Worker on push to `main`
- `deploy-cloudflare-sandbox.yml` — deploys sandbox on `develop`
- `worker-safety-tests.yml` — safety checks on PRs
- `deploy-pages.yml` — verifies frontend build

## CF Worker Endpoints
- `GET /` — worker info + route list
- `GET /api/health` or `/api/system/health`
- `POST /api/tradingview/webhook` — TradingView signals
- `GET /api/tradingview/decisions?limit=N`
- `GET /api/trading/sandbox/dashboard` or `/live/dashboard`
- `GET /api/trading/live/readiness` — 12-gate safety check
- `POST /api/trading/orders` — order placement with idempotency
- `GET /api/trading/trades?limit=N&mode=`
- `GET|POST /api/trading/kill-switch`

## Safety Design Rules
- Kill Switch defaults to **engaged** (true) on app load and Worker startup
- Sandbox is always the default mode
- Live mode requires modal confirmation + all 12 safety gates
- All orders use idempotency keys to prevent duplicates
- No credentials stored in frontend — Cloudflare Secrets only

**Why:** Single-owner platform; catastrophic loss from accidental live order is the main risk.

## CORS Issue
The CF Worker blocks `http://127.0.0.1` (Replit dev). The app falls back gracefully to demo data.
After deployment, add the `*.replit.app` production URL to `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy Worker.

**How to apply:** `wrangler.toml` → `[vars]` → `ALLOWED_ORIGINS` → add the Replit production domain → `pnpm deploy`.

## Build Quirk
`vite.config.ts` originally threw if `PORT`/`BASE_PATH` env vars were missing. Fixed to use defaults (`3000` / `/`) so `vite build` works without env vars set.

**Why:** Cloudflare Pages / CI environments don't inject these at build time.

## GitHub Secrets Required
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — for GitHub Actions → Wrangler deploy

## Cloudflare Secrets Required (via Wrangler)
- `WEBULL_SANDBOX_*` (4 keys) — for sandbox mode
- `WEBULL_LIVE_*` (4 keys) — for live mode
- `MOE_WEBHOOK_SECRET` — for TradingView webhook auth

## Worker Not in pnpm Workspace
The `worker/` directory is intentionally excluded from `pnpm-workspace.yaml`. It uses its own `pnpm install` via GitHub Actions (`cd worker && pnpm install`). This avoids Cloudflare Workers types conflicting with Node types in the monorepo.
