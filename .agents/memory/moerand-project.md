---
name: MOERAND Project
description: Trading signal PWA ported from Next.js GitHub repo into artifacts/trading-bot React+Vite artifact.
---

## Source
- GitHub: https://github.com/Mosaprajb/MOE-AI branch `feature/moe-core-domain-v2`
- Cloned to /tmp/moe-ai during porting session

## Architecture
- Frontend-only SPA — no backend required
- artifact: `artifacts/trading-bot` (slug: trading-bot, preview path: /)
- All logic in `src/lib/` (plain JS files, use `.js` extensions in imports)

## Key files
- `src/lib/moeEngine.js` — MOE v6.3.1 scoring engine (do not modify)
- `src/lib/stocks.js` — 34-stock universe
- `src/lib/useFinnhubMarket.js` — Finnhub WebSocket + Alpaca hook
- `src/lib/backgroundAlerts.js` — Cloudflare Worker push alerts
- `src/moerand.css` — complete bespoke design system (not Tailwind)
- `src/index.css` — only contains `@import './moerand.css';`
- `public/sw.js` — service worker stub for PWA push notifications

## Design system
- CSS variables: --bg:#061421, --green:#2ee6aa, --cyan:#41c8f5, --red:#ff667a, --yellow:#ffd166
- All class names come from moerand.css — do NOT add Tailwind classes
- lucide-react icons used in bottomNav (wrap in `<span>` inside button, never raw inside button)

## External APIs
- Finnhub WebSocket (user provides their own API key via Settings tab)
- Alpaca IEX bars (user provides key+secret via Settings tab)
- Cloudflare Worker: moerand-alerts.mosaprajb.workers.dev (for Decisions page + push alerts)

**Why:** `m-auto` (Tailwind) was used in nav icons — broke when Tailwind removed. Fix: wrap icon in `<span>` which bottomNav CSS already styles.
**Why:** Nested `<button>` inside `<button>` in stockRow — replace inner with `<span role="button">`.
