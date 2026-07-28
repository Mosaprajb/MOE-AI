// MOE-AI — Market Data Client
// Primary source: Yahoo Finance (free, 15-min delay — suitable for paper trading)
// No auth required. For production real-time data, swap the fetch URL.
import type { Candle } from './indicators';

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export interface Quote {
  symbol:      string;
  price:       number;
  open:        number;
  high:        number;
  low:         number;
  volume:      number;
  prevClose:   number;
  changeAmt:   number;
  changePct:   number;
  marketCap?:  number;
  fetchedAt:   string;
}

/** Fetch 5-minute candles for a symbol (last 1 day → ~78 bars) */
export async function fetchCandles(symbol: string, count = 30): Promise<Candle[]> {
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cf: { cacheTtl: 60 }, // cache 1 min in Cloudflare edge
  } as RequestInit);

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);

  const json = await res.json() as Record<string, unknown>;
  const chart = (json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
  if (!chart?.[0]) throw new Error(`No chart data for ${symbol}`);

  const c    = chart[0] as Record<string, unknown>;
  const ts   = (c.timestamp as number[]) ?? [];
  const q    = (c.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined;
  if (!q?.[0]) throw new Error(`No OHLCV for ${symbol}`);

  const ohlcv = q[0] as Record<string, number[]>;
  const candles: Candle[] = [];

  for (let i = 0; i < ts.length; i++) {
    const o = ohlcv.open?.[i], h = ohlcv.high?.[i], l = ohlcv.low?.[i];
    const cl = ohlcv.close?.[i], v = ohlcv.volume?.[i];
    if (o == null || h == null || l == null || cl == null || v == null) continue;
    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) continue;
    candles.push({ ts: ts[i] * 1000, open: o, high: h, low: l, close: cl, volume: v });
  }

  // return latest `count` candles
  return candles.slice(-count);
}

/** Fetch current quote for a single symbol */
export async function fetchQuote(symbol: string): Promise<Quote> {
  const candles = await fetchCandles(symbol, 2);
  if (candles.length < 1) throw new Error(`No quote data for ${symbol}`);

  const latest = candles[candles.length - 1];
  const prev   = candles.length > 1 ? candles[0] : latest;

  return {
    symbol,
    price:     latest.close,
    open:      latest.open,
    high:      latest.high,
    low:       latest.low,
    volume:    latest.volume,
    prevClose: prev.close,
    changeAmt: latest.close - prev.close,
    changePct: prev.close ? ((latest.close - prev.close) / prev.close) * 100 : 0,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch quotes for multiple symbols (sequential with concurrency limit) */
export async function fetchBatchQuotes(
  symbols: string[],
  priceMin: number,
  priceMax: number,
): Promise<{ symbol: string; price: number; error?: string }[]> {
  const CONCURRENCY = 5;
  const results: { symbol: string; price: number; error?: string }[] = [];

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (sym) => {
        const q = await fetchQuote(sym);
        return { symbol: sym, price: q.price };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ symbol: batch[settled.indexOf(r)], price: 0, error: String(r.reason) });
    }
  }

  // filter by price range
  return results.filter(r => !r.error && r.price >= priceMin && r.price <= priceMax);
}
