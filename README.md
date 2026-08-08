# MOERAND v3.8

Mobile-first Next.js PWA for the MOERAND trading signal command center.

## Included

- Responsive dashboard and ranked multi-symbol scanner
- Default 34-symbol universe matching the active trading list
- On-device stock manager for adding, removing, and persisting ticker symbols
- Persistent watchlist and alert preferences
- Browser notification permission flow and test alerts
- Cloud Web Push subscriptions for closed-app and Apple Watch notifications
- Automatic cloud synchronization of the selected timeframe and managed symbol list
- Smart filters for all symbols or watchlist-only cloud monitoring
- Selectable 70+, 80+, or 90+ score thresholds and signal-type controls
- Per-symbol alert cooldown plus cloud health and delivery activity history
- Persistent 5m, 15m, 30m, and 1h alert-timeframe selector
- Signal evaluation and notification delivery only after the selected candle closes
- Optional Finnhub live-price connection with the API key stored only in the user's browser
- Finnhub candle hydration plus real-time trade aggregation for every monitored symbol
- Alpaca IEX historical-bar fallback when a Finnhub key does not include stock candles
- Batched candle requests and incremental history loading for newly added symbols
- MOE Pine Script v6.3.1 scoring on the selected timeframe with higher-timeframe context
- Stateful BUY NOW, repeated BUY AGAIN, HOLD, smart rising stop, and SELL NOW handling
- Preserved multi-symbol signal history and distinct notifications for repeated signals
- Automatic WebSocket reconnection and REST quote hydration for the monitored symbols
- Installable web-app manifest, app icons, and offline shell
- iPhone safe-area support and Add to Home Screen guide
- Explicit engine loading/error states when candle history is not available

## Run locally

```bash
npm install
npm run dev
```

## Production

The production PWA is exported for GitHub Pages. Browser notifications require HTTPS. On iPhone, notification permission is available after the site is added to the Home Screen.

## Signal engine

The on-device engine ports the supplied `Moe Day Trading Indicator v6.3.1 Master Alert` rules. It calculates EMA, ATR, RSI, MACD, VWAP, relative volume, breakout/reclaim triggers, preferred-timeframe context, position sizing, repeated entries, the smart rising stop, and weakness exits.

Foreground scanning runs inside the PWA. The Cloudflare Worker exposes server-side scanner and trading APIs, while automatic scheduled scanning remains intentionally disabled until a dedicated scheduler is safety-reviewed and explicitly activated.

## Cloudflare Worker

The current Cloudflare Worker entry point is `worker/src/index.ts`. It exposes
the TradingView bridge, native mobile APIs, Sandbox scanner routes, broker
reconciliation, and production safety/read-only controls.

The scanner can be invoked explicitly through `POST /api/scanner/run`.
Automatic Cron execution is intentionally disabled in every committed
environment. `worker/wrangler.jsonc` declares `triggers.crons = []` so a
deployment also removes any stale Cron Trigger that may have existed from an
older Worker configuration.

A future scheduled scanner requires a dedicated `scheduled()` handler and a
separate safety-reviewed activation. It must remain fail-closed for Live
execution.

## Important

Signals are computed from the configured Finnhub/Alpaca market data and can differ from TradingView because provider trades, candle construction, session settings, and browser availability can differ. This software is not investment advice; confirm every order independently.
