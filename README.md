# MOE AI Pro v3.2

Mobile-first Next.js PWA foundation for the MOE AI trading signal command center.

## Included

- Responsive dashboard and ranked multi-symbol scanner
- Persistent watchlist and alert preferences
- Browser notification permission flow and test alerts
- Optional Finnhub live-price connection with the API key stored only in the user's browser
- Automatic WebSocket reconnection and REST quote hydration for the monitored symbols
- Installable web-app manifest, app icons, and offline shell
- iPhone safe-area support and Add to Home Screen guide
- Demo/simulated signals clearly separated from live trading data

## Run locally

```bash
npm install
npm run dev
```

## Production

Deploy the repository with Vercel. Next.js is detected automatically. Browser notifications require HTTPS. On iPhone, notification permission is available after the site is added to the Home Screen.

## Next milestone

Port and validate the exact MOE Pine Script strategy rules before promoting BUY/SELL labels from demo to live signals. The current Finnhub integration updates prices only; it intentionally does not treat the demo labels as real trading signals.

## Important

When Finnhub is connected, prices are live but scores and BUY/SELL signals remain simulated product-demo data. They are not investment advice and must not be used for live trading.
