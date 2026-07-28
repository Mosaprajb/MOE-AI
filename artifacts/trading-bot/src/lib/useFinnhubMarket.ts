// MOE-AI Market Data Hook
// Primary source: Cloudflare Worker scanner endpoint
// Fallback: static demo data so the scanner is always usable
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StockDef } from './stocks';
import type { StockSnapshot, SignalType } from './types';
import { API_BASE, REFRESH_MS } from './config';

// ── Scoring seed (deterministic demo when no market data) ──────────────────
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
    reason:    'البيانات التجريبية — قم بتوصيل مزود سوق لبيانات حقيقية',
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

// ── API response normaliser ────────────────────────────────────────────────
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

// ── Hook ───────────────────────────────────────────────────────────────────
export type MarketStatus = 'loading' | 'live' | 'demo' | 'error';
export type EngineStatus = 'live' | 'warming' | 'demo';

export interface UseFinnhubMarketResult {
  marketStocks:   StockSnapshot[];
  status:         MarketStatus;
  statusMessage:  string;
  engineStatus:   EngineStatus;
  engineMessage:  string;
  lastUpdated:    Date | null;
}

export function useFinnhubMarket(stockList: StockDef[]): UseFinnhubMarketResult {
  const [marketStocks, setMarketStocks] = useState<StockSnapshot[]>(
    () => stockList.map(buildDemoSnapshot),
  );
  const [status,        setStatus]        = useState<MarketStatus>('loading');
  const [statusMessage, setStatusMessage] = useState('جاري الاتصال…');
  const [engineStatus,  setEngineStatus]  = useState<EngineStatus>('demo');
  const [engineMessage, setEngineMessage] = useState('وضع تجريبي');
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tradingview/decisions?limit=50`, {
        mode: 'cors', cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { decisions?: unknown[] };
      const decisions = json.decisions ?? [];

      if (!mountedRef.current) return;

      if (decisions.length > 0) {
        // Overlay live decisions onto the stock list
        const decisionMap = new Map<string, Record<string, unknown>>(
          decisions.map((d) => [(d as Record<string,unknown>).symbol as string, d as Record<string,unknown>])
        );
        const updated = stockList.map(def => {
          const d = decisionMap.get(def.symbol);
          return d ? normaliseSignal(d, def) : buildDemoSnapshot(def);
        });
        setMarketStocks(updated);
        setStatus('live');
        setStatusMessage(`${decisions.length} إشارة نشطة من Cloudflare Worker`);
        setEngineStatus('live');
        setEngineMessage('MOE Engine متصل · Cloudflare Worker');
      } else {
        // Worker responded but no decisions yet
        setStatus('live');
        setStatusMessage('Worker متصل — لا توجد إشارات نشطة حالياً');
        setEngineStatus('warming');
        setEngineMessage('محرك MOE يبحث عن إشارات…');
        setMarketStocks(stockList.map(buildDemoSnapshot));
      }
      setLastUpdated(new Date());
    } catch {
      if (!mountedRef.current) return;
      // Fallback to demo
      setStatus('demo');
      setStatusMessage('وضع تجريبي — Cloudflare Worker غير متاح');
      setEngineStatus('demo');
      setEngineMessage('لا يمكن الاتصال بـ Cloudflare Worker');
      setMarketStocks(stockList.map(buildDemoSnapshot));
      setLastUpdated(new Date());
    }
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
