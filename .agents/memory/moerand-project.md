---
name: MOE-AI Trading Platform
description: Full React+Vite trading SPA — architecture, pages, backend, known quirks
---

## Stack
- Frontend: React + Vite, `artifacts/trading-bot/src/`, TypeScript
- Backend: Cloudflare Worker at `moerand-alerts.mosaprajb.workers.dev`, code in `worker/src/`
- DB: Cloudflare D1 (SQLite) + KV for config

## 4-page nav only
Scanner · Positions · History · Settings

## Key runtime quirks

### Scan result normalization (critical)
Old deployed Worker returns `signals` field; new code expects `candidates`.
`useScanner.ts` now normalizes: `candidates = raw.candidates ?? raw.signals ?? []`.
Never access `result.candidates` directly — always use `result.candidates ?? []`.

### Notification API in iframe
Accessing `Notification.permission` directly in JSX throws `SecurityError` in Replit
preview iframe → black screen. Fixed via `getNotifPerm()` helper in Scanner.tsx that
wraps access in try/catch and returns `'unsupported'` on failure.

### ErrorBoundary
`PageErrorBoundary` wraps all pages in App.tsx. Any render crash shows an error card
with a "Reload Page" button instead of a blank screen.

## Worker deployment status
New Worker code (search endpoint, manual close, KV config) is in GitHub but NOT yet
deployed to Cloudflare. Worker at `moerand-alerts.mosaprajb.workers.dev` is old version.
Frontend falls back to Yahoo Finance directly for stock search until Worker is deployed.

## Search fallback chain
1. `GET /api/scanner/search?q=` via Worker
2. If 404/fail → `query1.finance.yahoo.com/v1/finance/search` directly from browser
Same pattern for quote detail (`/api/scanner/quote/:symbol` → YF v7 quote endpoint).

## Settings
- `sizingSource`: `cash` | `cash_plus_margin` | `buying_power`; default `cash_plus_margin` 50%
- Strategy params (TP%, Trail%, Hard Stop%, price range, max positions) stored in KV
