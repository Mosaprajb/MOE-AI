# MOE AI Pro v3.1

Mobile-first Next.js PWA foundation for the MOE AI trading signal command center.

## Included

- Responsive dashboard and ranked multi-symbol scanner
- Persistent watchlist and alert preferences
- Browser notification permission flow and test alerts
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

Connect a protected server-side market-data provider and replace `lib/stocks.js` with validated real-time data. Never expose a market-data API key in client-side code.

## Important

The prices, scores, and signals currently displayed are simulated product-demo data. They are not investment advice and must not be used for live trading.
