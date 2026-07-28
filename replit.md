# MOE-AI Personal Trading Platform

## Overview
Single-owner, institutional-grade automated trading system connected to Webull (paper + live). Private use only — no SaaS, no multi-user, no subscriptions.

## Architecture

### Frontend (`artifacts/trading-bot/`)
- React + Vite SPA with Arabic RTL UI
- PIN-based auth (SHA-256, localStorage session, 8hr TTL)
- Pages: Dashboard, Scanner, Positions, Orders, Risk, Trades, System, Settings
- CSS design system in `src/index.css` (no Tailwind utility classes used)
- API client in `src/lib/api.ts` connecting to Cloudflare Worker

### Backend (Cloudflare Worker)
- Deployed at: `https://moerand-alerts.mosaprajb.workers.dev`
- Handles: Webull sandbox/live connectivity, push alerts, decisions, trade history
- CORS: Worker must allow the Replit dev domain and the production domain

### Signal Engine
- MOE v6.3.1 scoring engine (0–100 scale)
- Scanner watchlist: 20 tickers in `src/lib/stocks.ts`
- Fallback: deterministic demo data when Worker is unreachable

## Key URLs
- CF Worker: `https://moerand-alerts.mosaprajb.workers.dev`
- GitHub: `Mosaprajb/MOE-AI` (main branch)
- Frontend env: `VITE_MOE_API_BASE_URL` in `artifacts/trading-bot/.env`

## Safety Design
- Kill Switch always visible in topbar (defaults ON)
- Sandbox mode is default; Live mode requires explicit modal confirmation
- LIVE automation requires 12 safety gates (see Risk page)

## Credentials Required (in Cloudflare Secrets, NOT here)
- `WEBULL_LIVE_APP_KEY`, `WEBULL_LIVE_APP_SECRET`
- `WEBULL_LIVE_ACCESS_TOKEN`, `WEBULL_LIVE_ACCOUNT_ID`
- `MOE_WEBHOOK_SECRET`

## User Preferences
- **UI language is always English** — the user communicates in Arabic but all app text, labels, buttons, and pages must be in English
- Dark institutional design (`#071018` background)
- No console.log spam — use structured error boundaries
