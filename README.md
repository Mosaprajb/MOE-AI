# MOERAND v3.6

Mobile-first Next.js PWA for the MOERAND trading signal command center.

## Included

- Responsive dashboard and ranked multi-symbol scanner
- Default 34-symbol universe matching the active trading list
- On-device stock manager for adding, removing, and persisting ticker symbols
- Persistent watchlist and alert preferences
- Browser notification permission flow and test alerts
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

Deploy the repository with Vercel. Next.js is detected automatically. Browser notifications require HTTPS. On iPhone, notification permission is available after the site is added to the Home Screen.

## Signal engine

The on-device engine ports the supplied `Moe Day Trading Indicator v6.3.1 Master Alert` rules. It calculates EMA, ATR, RSI, MACD, VWAP, relative volume, breakout/reclaim triggers, preferred-timeframe context, position sizing, repeated entries, the smart rising stop, and weakness exits.

Foreground scanning runs inside the PWA. The Cloudflare Worker below provides the always-on scanner required for notifications while the app is closed.

## Background alert worker

`worker/src/index.js` contains the Cloudflare Worker used for closed-app scanning and Web Push. It uses a SQLite-backed Durable Object to persist device subscriptions, per-symbol MOE state, and signal deduplication. The included Cron Trigger runs once per minute and evaluates only the timeframes whose candles have just closed.

Cloudflare must configure these encrypted secrets before background scanning is activated:

- `ALPACA_KEY_ID`
- `ALPACA_SECRET_KEY`
- `VAPID_PRIVATE_JWK`

The public VAPID key, application origin, application URL, Durable Object binding, and one-minute Cron Trigger are declared in `wrangler.jsonc`.

## Important

Signals are computed from the configured Finnhub/Alpaca market data and can differ from TradingView because provider trades, candle construction, session settings, and browser availability can differ. This software is not investment advice; confirm every order independently.
