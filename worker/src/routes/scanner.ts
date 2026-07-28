// MOE-AI — Scanner Routes + Scan Cycle Engine
import { Hono } from 'hono';
import type { Env, TradingMode, ScannerConfig } from '../lib/types';
import type { ScanCandidate } from '../lib/strategy';
import { scoreStock, confidenceMultiplier } from '../lib/strategy';
import { fetchCandles, fetchBatchQuotes, fetchLivePrices } from '../lib/market-data';
import { loadWatchlist, ensureWatchlistTable, addToWatchlist, removeFromWatchlist, DEFAULT_WATCHLIST } from '../lib/watchlist';
import { ensureScannerTables, savePosition, managePositions, loadOpenPositions } from '../lib/position-manager';
import { getKillSwitch, getTradingMode } from '../lib/risk';
import { WebullClient } from '../lib/webull';

const scanner = new Hono<{ Bindings: Env }>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getScannerConfig(env: Env): ScannerConfig {
  return {
    tpPct:       Number(env.SCANNER_TP_PCT       ?? '1.5'),
    trailPct:    Number(env.SCANNER_TRAIL_PCT     ?? '1.0'),
    hardStopPct: Number(env.SCANNER_HARD_STOP_PCT ?? '1.5'),
    priceMin:    Number(env.SCANNER_PRICE_MIN     ?? '10'),
    priceMax:    Number(env.SCANNER_PRICE_MAX     ?? '100'),
    riskPct:     Number(env.RISK_PCT              ?? '5'),
    maxPositions:Number(env.MAX_OPEN_POSITIONS    ?? '4'),
  };
}

// ── Core scan cycle (called by cron + manual trigger) ─────────────────────────
export async function runScanCycle(env: Env): Promise<{
  mode: string; scanned: number; candidates: ScanCandidate[];
  ordersPlaced: number; positionsManaged: number; errors: string[]; ms: number;
}> {
  const start   = Date.now();
  const ks      = await getKillSwitch(env);
  const mode    = await getTradingMode(env) as TradingMode;
  const cfg     = getScannerConfig(env);
  const errors: string[] = [];

  await ensureWatchlistTable(env);
  await ensureScannerTables(env);

  // 1. Manage existing positions (update trailing SL, execute exits)
  const managed = await managePositions(env, mode);
  errors.push(...managed.errors);

  if (ks) {
    return { mode, scanned: 0, candidates: [], ordersPlaced: 0,
             positionsManaged: managed.managed, errors: ['Kill switch engaged'], ms: Date.now() - start };
  }

  // 2. Load watchlist and fetch batch quotes (filter by price range)
  const watchlist = await loadWatchlist(env, mode);
  const inRange   = await fetchBatchQuotes(watchlist, cfg.priceMin, cfg.priceMax);
  const symbols   = inRange.map(q => q.symbol);

  // 3. Score each stock — all in parallel (Cloudflare handles concurrent fetches well)
  const candidates: ScanCandidate[] = [];
  const scored = await Promise.allSettled(
    symbols.map(async (sym) => {
      const candles = await fetchCandles(sym, 30);
      return scoreStock(sym, candles, cfg);
    })
  );
  for (const r of scored) {
    if (r.status === 'fulfilled' && r.value && r.value.confidence !== 'NONE') {
      candidates.push(r.value);
    } else if (r.status === 'rejected') {
      errors.push(String(r.reason).slice(0, 100));
    }
  }

  // Sort by score desc
  candidates.sort((a, b) => b.score - a.score);

  // 4. Place orders for top candidates (not already in a position)
  let ordersPlaced = 0;
  const client    = WebullClient.fromEnv(env, mode);
  const openPos   = await loadOpenPositions(env, mode);
  const openSyms  = new Set(openPos.map(p => p.symbol));

  for (const cand of candidates) {
    if (openPos.length + ordersPlaced >= cfg.maxPositions) break;
    if (openSyms.has(cand.symbol)) continue; // already in position

    if (!client) { errors.push('Webull credentials not configured'); break; }

    try {
      // Calculate qty based on confidence + risk %
      const acct       = await client.getAccount();
      const buyPower   = acct.buyingPower > 0 ? acct.buyingPower : acct.cash;
      const multiplier = confidenceMultiplier(cand.confidence);
      const qty        = Math.max(1, Math.floor((buyPower * (cfg.riskPct / 100) * multiplier) / cand.price));

      const result = await client.placeOrder({
        symbol: cand.symbol, side: 'BUY', type: 'MARKET',
        qty, idempotencyKey: `scanner-${cand.symbol}-${Date.now()}`,
      });

      await savePosition(env, {
        id:            `sp-${cand.symbol}-${Date.now()}`,
        symbol:        cand.symbol,
        quantity:      qty,
        entryPrice:    cand.entry,
        currentPrice:  cand.price,
        highestPrice:  cand.price,
        stopLoss:      cand.entry * (1 - cfg.trailPct / 100),
        takeProfit:    cand.takeProfit,
        hardStop:      cand.stopLoss,
        trailPct:      cfg.trailPct,
        tpPct:         cfg.tpPct,
        confidence:    cand.confidence as 'HIGH' | 'MEDIUM',
        score:         cand.score,
        webullOrderId: result.orderId,
        status:        'OPEN',
        mode,
        openedAt:      new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
      });
      ordersPlaced++;
    } catch (e) { errors.push(`Order ${cand.symbol}: ${String(e).slice(0, 100)}`); }
  }

  // 5. Log scan run
  try {
    await env.DB?.prepare(`
      INSERT INTO scanner_runs (id, mode, scanned_count, candidates_count, orders_placed, positions_managed, errors, duration_ms, ran_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      `sr-${Date.now()}`, mode, symbols.length, candidates.length,
      ordersPlaced, managed.managed, errors.length ? JSON.stringify(errors.slice(0, 5)) : null,
      Date.now() - start, new Date().toISOString(),
    ).run();
  } catch { /* ignore log failure */ }

  return { mode, scanned: symbols.length, candidates: candidates.slice(0, 20),
           ordersPlaced, positionsManaged: managed.managed, errors, ms: Date.now() - start };
}

// ── API Routes ─────────────────────────────────────────────────────────────────

/** POST /api/scanner/run — manual scan trigger */
scanner.post('/run', async (c) => {
  const result = await runScanCycle(c.env);
  return c.json(result);
});

/** GET /api/scanner/positions — active scanner positions */
scanner.get('/positions', async (c) => {
  const mode = (await getTradingMode(c.env)) as TradingMode;
  await ensureScannerTables(c.env);
  const positions = await loadOpenPositions(c.env, mode);
  return c.json({ data: positions, count: positions.length });
});

/** GET /api/scanner/history — closed scanner positions */
scanner.get('/history', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  await ensureScannerTables(c.env);
  try {
    const rows = await c.env.DB?.prepare(
      `SELECT * FROM scanner_positions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>();
    return c.json({ data: rows?.results ?? [] });
  } catch { return c.json({ data: [] }); }
});

/** GET /api/scanner/runs — recent scan logs */
scanner.get('/runs', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
  await ensureScannerTables(c.env);
  try {
    const rows = await c.env.DB?.prepare(
      `SELECT * FROM scanner_runs ORDER BY ran_at DESC LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>();
    return c.json({ data: rows?.results ?? [] });
  } catch { return c.json({ data: [] }); }
});

/** GET /api/scanner/quotes — live prices for entire watchlist (one batch request) */
scanner.get('/quotes', async (c) => {
  await ensureWatchlistTable(c.env);
  const mode    = (await getTradingMode(c.env)) as TradingMode;
  const symbols = await loadWatchlist(c.env, mode);
  try {
    const quotes = await fetchLivePrices(symbols);
    return c.json({ quotes, count: quotes.length, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return c.json({ quotes: [], count: 0, error: String(e) });
  }
});

/** GET /api/scanner/config */
scanner.get('/config', (c) => c.json(getScannerConfig(c.env)));

/** GET /api/scanner/watchlist */
scanner.get('/watchlist', async (c) => {
  await ensureWatchlistTable(c.env);
  const mode     = (await getTradingMode(c.env)) as TradingMode;
  const symbols  = await loadWatchlist(c.env, mode);
  return c.json({ symbols, count: symbols.length, isDefault: symbols === DEFAULT_WATCHLIST });
});

/** POST /api/scanner/watchlist — { symbol, action: 'add'|'remove' } */
scanner.post('/watchlist', async (c) => {
  const { symbol, action } = await c.req.json<{ symbol: string; action: 'add' | 'remove' }>();
  const mode = (await getTradingMode(c.env)) as TradingMode;
  await ensureWatchlistTable(c.env);
  if (action === 'add')    await addToWatchlist(c.env, symbol, mode);
  if (action === 'remove') await removeFromWatchlist(c.env, symbol, mode);
  return c.json({ ok: true });
});

export { scanner };
