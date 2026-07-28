---
name: MOE Scalp Scanner
description: Architecture decisions for the autonomous stock scanner added to MOE-AI
---

## Strategy: MOE Scalp v1
- Scoring (0-10): EMA9>EMA21 (+3), RSI 45-65 (+2), Volume ×1.5 (+2), Price>EMA20 (+1), Green candle (+2)
- HIGH ≥8 → full RISK_PCT; MEDIUM ≥5 → half RISK_PCT; <5 → skip
- TP: +1.5%, Trailing Stop: 1.0% below highest price, Hard Stop: -1.5% (all configurable via wrangler.toml vars)

## Data Source
- **Yahoo Finance** (free, 15-min delay) via `worker/src/lib/market-data.ts`
- URL: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=5m&range=1d`
- No auth needed. Concurrency limited to 5 parallel fetches in batch.
- **Why:** Webull Open API uses numeric ticker IDs (not symbols) for market data, making batch quote fetching complex. YF works for sandbox/paper trading.

## Key Files
- `worker/src/lib/indicators.ts` — pure EMA, RSI, ATR, avgVolume
- `worker/src/lib/strategy.ts` — scoreStock(), confidenceMultiplier()
- `worker/src/lib/market-data.ts` — fetchCandles(), fetchBatchQuotes()
- `worker/src/lib/watchlist.ts` — 75 preset stocks + D1 watchlist table
- `worker/src/lib/position-manager.ts` — trailing SL updates in D1 scanner_positions
- `worker/src/routes/scanner.ts` — runScanCycle() + API routes

## D1 Tables Added
- `scanner_positions` — active/closed scanner positions with trailing SL tracking
- `scanner_runs` — log of each cron cycle
- `watchlist` — per-mode configurable stock list (falls back to DEFAULT_WATCHLIST)

## Cron
- wrangler.toml: `[triggers] crons = ["*/5 * * * *"]`
- index.ts exports `{ fetch, scheduled }` object (not bare `app`) to support cron handler

## Wrangler Vars Added
SCANNER_TP_PCT, SCANNER_TRAIL_PCT, SCANNER_HARD_STOP_PCT, SCANNER_PRICE_MIN, SCANNER_PRICE_MAX (all in [vars])

**Why:** Keeping strategy params as env vars (not D1) avoids DB round-trips on every scan and lets the user change them via `wrangler secret put` or a redeploy without code changes.
