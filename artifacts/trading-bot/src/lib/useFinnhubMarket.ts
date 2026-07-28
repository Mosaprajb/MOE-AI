// MOE-AI Market Data Hook
// Primary source: Cloudflare Worker scanner endpoint
// Secondary source: local API server → Yahoo Finance proxy (live prices, no key needed)
// Fallback: deterministic demo data
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StockDef } from './stocks';
import type { StockSnapshot, SignalType } from './types';
import { API_BASE, REFRESH_MS } from './config';

// ── Scoring helpers (demo fallback) ───────────────────────────────────────────
function seedScore(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) { h = ((h << 5) - h + sym.charCodeAt(i)) >>> 0; }
  return 30 + (h % 60);
}
function scoreToSignal(score: number): SignalType {
  if (score >= 75) return 'BUY NOW';
  if (score >= 60) return 'BUY AGAIN';
  if (score >= 50) return 'HOLD';
  if (score >= 35) return 'WATCH NOW';
  return 'WAIT';
}
function scoreToGrade(score: number): string {
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function buildDemoSnapshot(def: StockDef): StockSnapshot {
  const score = seedScore(def.symbol);
  const basePrice = 100 + (seedScore(def.symbol + '_p') % 400);
  const changePct = ((seedScore(def.symbol + '_c') % 100) - 40) / 10;
  return {
    symbol:    def.symbol,
    company:   def.company,
    price:     basePrice,
    change:    changePct,
    changePct,
    volume:    1_000_000 + seedScore(def.symbol + '_v') * 100_000,
    signal:    scoreToSignal(score),
    score,
    grade:     scoreToGrade(score),
    reason:    'وضع تجريبي — لم يتم الاتصال بمزود الأسعار',
    entry:     basePrice * 1.001,
    stop:      basePrice * 0.98,
    target:    basePrice * 1.06,
    atr:       basePrice * 0.015,
    vwap:      basePrice * 0.999,
    relVol:    1.0 + (score % 30) / 30,
    timeframe: '5m',
    engineReady: false,
  };
}

// ── Normalise CF Worker decision → StockSnapshot ──────────────────────────────
function normaliseSignal(raw: Record<string, unknown>, def: StockDef): StockSnapshot {
  const score = Number(raw.score ?? raw.moeScore ?? 0);
  return {
    symbol:    def.symbol,
    company:   def.company,
    price:     Number(raw.price ?? raw.currentPrice ?? 0),
    change:    Number(raw.change ?? raw.priceChange ?? 0),
    changePct: Number(raw.changePct ?? raw.priceChangePct ?? 0),
    volume:    Number(raw.volume ?? 0),
    signal:    (raw.signal ?? raw.action ?? scoreToSignal(score)) as SignalType,
    score,
    grade:     (raw.grade as string) ?? scoreToGrade(score),
    reason:    (raw.reason ?? raw.rationale ?? raw.explanation ?? '') as string,
    entry:     Number(raw.entry ?? raw.entryPrice ?? 0) || undefined,
    stop:      Number(raw.stop ?? raw.stopLoss ?? 0) || undefined,
    target:    Number(raw.target ?? raw.takeProfit ?? 0) || undefined,
    atr:       Number(raw.atr ?? 0) || undefined,
    vwap:      Number(raw.vwap ?? 0) || undefined,
    relVol:    Number(raw.relVol ?? raw.relativeVolume ?? 0) || undefined,
    timeframe: (raw.timeframe as string) ?? '5m',
    engineReady: !!(raw.engineReady ?? raw.ready ?? true),
  };
}

// ── Yahoo Finance quote → StockSnapshot ──────────────────────────────────────
interface YahooQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  high?: number;
  low?: number;
  marketState?: string;
}

function normaliseYahoo(q: YahooQuote, def: StockDef): StockSnapshot {
  const score = seedScore(def.symbol); // MOE score stays deterministic (no AI signal yet)
  const relVol = q.volume > 0
    ? q.volume / Math.max(1_000_000, seedScore(def.symbol + '_av') * 50_000)
    : 1;
  return {
    symbol:    def.symbol,
    company:   def.name ?? def.company,
    price:     q.price,
    change:    q.change,
    changePct: q.changePct,
    volume:    q.volume,
    signal:    scoreToSignal(score),
    score,
    grade:     scoreToGrade(score),
    reason:    'سعر مباشر من Yahoo Finance — لا توجد إشارة من MOE Engine بعد',
    entry:     q.price * 1.001,
    stop:      q.price * 0.98,
    target:    q.price * 1.06,
    atr:       q.price * 0.015,
    vwap:      q.price * 0.999,
    relVol,
    timeframe: '1d',
    engineReady: false,
  };
}

// ── Local API proxy URL (same Replit environment, no CORS) ────────────────────
function localApiUrl(symbols: string[]): string {
  return `/api/market/quotes?symbols=${symbols.join(',')}`;
}

// ── Hook types ────────────────────────────────────────────────────────────────
export type MarketStatus = 'loading' | 'live' | 'live-yahoo' | 'demo' | 'error';
export type EngineStatus = 'live' | 'warming' | 'demo';

export interface UseFinnhubMarketResult {
  marketStocks:   StockSnapshot[];
  status:         MarketStatus;
  statusMessage:  string;
  engineStatus:   EngineStatus;
  engineMessage:  string;
  lastUpdated:    Date | null;
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useFinnhubMarket(stockList: StockDef[]): UseFinnhubMarketResult {
  const [marketStocks, setMarketStocks] = useState<StockSnapshot[]>(
    () => stockList.map(buildDemoSnapshot),
  );
  const [status,        setStatus]        = useState<MarketStatus>('loading');
  const [statusMessage, setStatusMessage] = useState('جاري الاتصال…');
  const [engineStatus,  setEngineStatus]  = useState<EngineStatus>('demo');
  const [engineMessage, setEngineMessage] = useState('وضع تجريبي');
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async () => {
    if (!mountedRef.current) return;

    // ── 1. Try Cloudflare Worker (has MOE AI signals) ──────────────────────
    try {
      const res = await fetch(`${API_BASE}/api/tradingview/decisions?limit=50`, {
        mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { decisions?: unknown[] };
      const decisions = json.decisions ?? [];

      if (!mountedRef.current) return;

      if (decisions.length > 0) {
        const decisionMap = new Map<string, Record<string, unknown>>(
          decisions.map((d) => [(d as Record<string,unknown>).symbol as string, d as Record<string,unknown>])
        );
        const updated = stockList.map(def => {
          const d = decisionMap.get(def.symbol);
          return d ? normaliseSignal(d, def) : buildDemoSnapshot(def);
        });
        setMarketStocks(updated);
        setStatus('live');
        setStatusMessage(`${decisions.length} إشارة نشطة من MOE Engine`);
        setEngineStatus('live');
        setEngineMessage('MOE Engine متصل · Cloudflare Worker');
        setLastUpdated(new Date());
        return;
      }

      // Worker up but no decisions yet — fall through to Yahoo for prices
      setStatus('live');
      setStatusMessage('Worker متصل — جاري تحميل الأسعار المباشرة…');
      setEngineStatus('warming');
      setEngineMessage('MOE Engine يبحث عن إشارات…');
    } catch {
      // Worker unreachable — fall through to Yahoo
    }

    // ── 2. Try local API proxy → Yahoo Finance (live prices, no API key) ──
    try {
      const symbols = stockList.map(s => s.symbol);
      const res = await fetch(localApiUrl(symbols), {
        cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { quotes?: YahooQuote[] };
      const quotes = json.quotes ?? [];

      if (!mountedRef.current) return;

      if (quotes.length > 0) {
        const quoteMap = new Map(quotes.map(q => [q.symbol, q]));
        const updated = stockList.map(def => {
          const q = quoteMap.get(def.symbol);
          return q ? normaliseYahoo(q, def) : buildDemoSnapshot(def);
        });
        setMarketStocks(updated);
        setStatus('live-yahoo');
        setStatusMessage(`أسعار مباشرة · ${quotes.length} سهم · Yahoo Finance`);
        setEngineStatus('warming');
        setEngineMessage('أسعار حقيقية · MOE Engine غير متصل');
        setLastUpdated(new Date());
        return;
      }
    } catch {
      // Yahoo proxy failed — fall through to demo
    }

    // ── 3. Demo fallback ───────────────────────────────────────────────────
    if (!mountedRef.current) return;
    setStatus('demo');
    setStatusMessage('وضع تجريبي — تعذّر الاتصال بمزود الأسعار');
    setEngineStatus('demo');
    setEngineMessage('لا يمكن الاتصال — البيانات تجريبية');
    setMarketStocks(stockList.map(buildDemoSnapshot));
    setLastUpdated(new Date());
  }, [stockList]);

  useEffect(() => {
    mountedRef.current = true;
    fetchSignals();
    timerRef.current = setInterval(fetchSignals, REFRESH_MS);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchSignals]);

  return { marketStocks, status, statusMessage, engineStatus, engineMessage, lastUpdated };
}
