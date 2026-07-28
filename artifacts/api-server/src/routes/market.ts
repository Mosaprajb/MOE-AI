// Market data proxy — fetches live prices server-side (no CORS issues for client)
// Uses Yahoo Finance chart API per-symbol (more permissive than batch quote API)
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://finance.yahoo.com",
  "Referer": "https://finance.yahoo.com/",
};

interface QuoteResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  marketState?: string;
  updatedAt: string;
}

async function fetchOneQuote(symbol: string): Promise<QuoteResult | null> {
  try {
    // Yahoo Finance chart endpoint — works without crumb/cookies
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price      = meta.regularMarketPrice ?? meta.previousClose ?? 0;
    const prevClose  = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change     = price - prevClose;
    const changePct  = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      symbol,
      name:       meta.instrumentType === "EQUITY" ? symbol : (meta.shortName ?? symbol),
      price,
      change,
      changePct,
      volume:     meta.regularMarketVolume ?? 0,
      open:       meta.regularMarketOpen,
      high:       meta.regularMarketDayHigh,
      low:        meta.regularMarketDayLow,
      prevClose,
      marketState: meta.marketState ?? "REGULAR",
      updatedAt:  new Date(meta.regularMarketTime * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// GET /api/market/quotes?symbols=AAPL,TSLA,NVDA
router.get("/market/quotes", async (req, res) => {
  const symbolsParam = req.query["symbols"];
  if (!symbolsParam || typeof symbolsParam !== "string") {
    res.status(400).json({ error: "symbols query param required (comma-separated)" });
    return;
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);

  if (symbols.length === 0) {
    res.status(400).json({ error: "No valid symbols provided" });
    return;
  }

  // Fetch all symbols in parallel (max 25 concurrent)
  const results = await Promise.all(symbols.map(fetchOneQuote));
  const quotes  = results.filter((q): q is QuoteResult => q !== null);

  if (quotes.length === 0) {
    res.status(502).json({ error: "Could not fetch any quotes from Yahoo Finance" });
    return;
  }

  res.json({ quotes, source: "yahoo", fetchedAt: new Date().toISOString() });
});

export default router;
