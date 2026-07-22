# MOERAND v3.4

Mobile-first Next.js PWA for the MOERAND trading signal command center.

## Included

- Responsive dashboard and ranked multi-symbol scanner
- Default 34-symbol universe matching the active trading list
- On-device stock manager for adding, removing, and persisting ticker symbols
- Persistent watchlist and alert preferences
- Browser notification permission flow and test alerts
- Optional Finnhub live-price connection with the API key stored only in the user's browser
- Finnhub one-minute candle hydration plus real-time trade aggregation for every monitored symbol
- Batched candle requests and incremental history loading for newly added symbols
- MOE Pine Script v6.3.1 scoring with 1-minute triggers and preferred 15-minute context
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

Immediate scanning and notifications require the PWA to remain open because this static GitHub Pages build has no always-on server or push worker. A server-side scanner is the next milestone for alerts while the app is closed.

## Important

Signals are computed from Finnhub data and can differ from TradingView because provider trades, candle construction, session settings, and browser availability can differ. This software is not investment advice; confirm every order independently.
