---
name: MOE-AI Trading Platform
description: Architecture decisions, key URLs, and lessons for the MOE-AI personal trading platform.
---

## Core Architecture

- **Frontend**: React+Vite SPA in `artifacts/trading-bot/` — Arabic RTL, dark institutional theme
- **Backend**: Cloudflare Worker at `https://moerand-alerts.mosaprajb.workers.dev`
- **Auth**: PIN-based, SHA-256 hashed, localStorage session (8hr TTL) — `src/lib/auth.ts`
- **API client**: `src/lib/api.ts` — fetches from CF Worker, CORS-dependent
- **Scanner**: Uses CF Worker decisions endpoint; falls back to deterministic demo data when offline

## Key File Locations
- Design system: `artifacts/trading-bot/src/index.css` (pure CSS custom properties, no Tailwind utilities)
- Stocks watchlist: `artifacts/trading-bot/src/lib/stocks.ts`
- Market hook: `artifacts/trading-bot/src/lib/useFinnhubMarket.ts`
- App shell + routing: `artifacts/trading-bot/src/App.tsx`
- Pages: `artifacts/trading-bot/src/pages/`

## CF Worker Endpoints (known)
- `GET /api/trading/live/readiness` — 12-gate live safety check
- `GET /api/tradingview/decisions?limit=N` — trading signals/decisions
- `GET /api/trading/trades?limit=N&mode=` — trade history
- `GET /api/system/health` or `/api/health` — system health

## Safety Design Rules
- Kill Switch defaults to **engaged** (true) on app load
- Sandbox is always the default mode
- Live mode requires modal confirmation + all 12 safety gates
- No credentials stored in frontend — Cloudflare Secrets only

**Why:** Single-owner platform; catastrophic loss from accidental live order is the main risk to prevent.

## CORS Issue
The CF Worker blocks `http://127.0.0.1` (Replit dev). The app falls back gracefully to demo data. In production deployment, the Worker must be configured to allow the Replit production domain.

**How to apply:** When deploying, add the production URL to the Worker's CORS allowlist in Cloudflare.

## GitHub Repo
- `Mosaprajb/MOE-AI`, main branch
- GitHub integration: `connector:ccfg_github_01K4B9XD3VRVD2F99YM91YTCAF` (needs OAuth setup)

## Tailwind vs Plain CSS
The vite.config.ts includes `@tailwindcss/vite` plugin but we use pure CSS custom properties in `src/index.css`. Both coexist without conflict.
