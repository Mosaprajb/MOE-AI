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
import { getTradingSettings } from './trading-settings';

const scanner = new Hono<{ Bindings: Env }>();

// ── Scanner config (KV-backed, falls back to env vars) ─────────────────────────
const SCANNER_CFG_KEY = 'scanner:config';

function getScannerConfigDefaults(env: Env): ScannerConfig {
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

async function getScannerConfig(env: Env): Promise<ScannerConfig> {
  const defaults = getScannerConfigDefaults(env);
  if (!env.CONFIG) return defaults;
  try {
    const saved = await env.CONFIG.get(SCANNER_CFG_KEY, 'json') as Partial<ScannerConfig> | null;
    if (!saved) return defaults;
    return {
      tpPct:       saved.tpPct       ?? defaults.tpPct,
      trailPct:    saved.trailPct    ?? defaults.trailPct,
      hardStopPct: saved.hardStopPct ?? defaults.hardStopPct,
      priceMin:    saved.priceMin    ?? defaults.priceMin,
      priceMax:    saved.priceMax    ?? defaults.priceMax,
      riskPct:     saved.riskPct     ?? defaults.riskPct,
      maxPositions:saved.maxPositions?? defaults.maxPositions,
    };
  } catch { return defaults; }
}

// ── Core scan cycle (called by cron + manual trigger) ─────────────────────────
export async function runScanCycle(env: Env): Promise<{
  mode: string; scanned: number; candidates: ScanCandidate[];
  ordersPlaced: number; positionsManaged: number; errors: string[]; ms: number;
}> {
  const start   = Date.now();
  const ks      = await getKillSwitch(env);
  const mode    = await getTradingMode(env) as TradingMode;
  const cfg     = await getScannerConfig(env);
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
      const tradeSettings = await getTradingSettings(env);
      const cashBudget = acct.cash * (tradeSettings.maxCashPct / 100);
      const marginBudget = tradeSettings.sizingSource === 'cash_plus_margin'
        ? acct.cash * (tradeSettings.marginPct / 100)
        : 0;
      const requestedBudget = tradeSettings.sizingSource === 'buying_power'
        ? (acct.buyingPower > 0 ? acct.buyingPower : acct.cash) * (tradeSettings.maxCashPct / 100)
        : cashBudget + marginBudget;
      const budget = tradeSettings.sizingSource === 'cash_plus_margin'
        ? Math.min(requestedBudget, acct.buyingPower > 0 ? acct.buyingPower : requestedBudget)
        : requestedBudget;
      const multiplier = confidenceMultiplier(cand.confidence);
      const cappedBudget = tradeSettings.maxPositionUsd > 0
        ? Math.min(budget, tradeSettings.maxPositionUsd)
        : budget;
      const qty        = Math.max(1, Math.floor((cappedBudget * multiplier) / cand.price));

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
scanner.get('/config', async (c) => c.json(await getScannerConfig(c.env)));

/** POST /api/scanner/config — save strategy params to KV */
scanner.post('/config', async (c) => {
  if (!c.env.CONFIG) return c.json({ error: 'CONFIG KV not bound' }, 503);
  const body = await c.req.json<Partial<ScannerConfig>>();
  const defaults = getScannerConfigDefaults(c.env);
  const merged: ScannerConfig = {
    tpPct:        clamp(Number(body.tpPct        ?? defaults.tpPct),        0.1, 20),
    trailPct:     clamp(Number(body.trailPct     ?? defaults.trailPct),     0.1, 20),
    hardStopPct:  clamp(Number(body.hardStopPct  ?? defaults.hardStopPct),  0.1, 30),
    priceMin:     clamp(Number(body.priceMin     ?? defaults.priceMin),     0,  9999),
    priceMax:     clamp(Number(body.priceMax     ?? defaults.priceMax),     1, 99999),
    riskPct:      clamp(Number(body.riskPct      ?? defaults.riskPct),      0.1, 50),
    maxPositions: clamp(Number(body.maxPositions ?? defaults.maxPositions), 1,  20),
  };
  await c.env.CONFIG.put(SCANNER_CFG_KEY, JSON.stringify(merged));
  return c.json({ ok: true, config: merged });
});

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, isFinite(v) ? v : min));
}

/** POST /api/scanner/positions/:id/close — manual close */
scanner.post('/positions/:id/close', async (c) => {
  const posId = c.req.param('id');
  const mode  = (await getTradingMode(c.env)) as TradingMode;
  await ensureScannerTables(c.env);

  // Load the position
  const row = await c.env.DB?.prepare(
    `SELECT * FROM scanner_positions WHERE id = ? AND status = 'OPEN'`
  ).bind(posId).first<Record<string, unknown>>();

  if (!row) return c.json({ error: 'Position not found or already closed' }, 404);

  const sym = String(row.symbol);
  const qty = Number(row.quantity);
  const entryPrice = Number(row.entry_price);

  // Fetch current price
  let exitPrice = Number(row.current_price ?? row.entry_price);
  try {
    const { fetchQuote } = await import('../lib/market-data');
    const q = await fetchQuote(sym);
    exitPrice = q.price;
  } catch { /* use stored price */ }

  // Place SELL MARKET order
  const client = WebullClient.fromEnv(c.env, mode);
  let webullOrderId: string | undefined;
  if (client) {
    try {
      const r = await client.placeOrder({
        symbol: sym, side: 'SELL', type: 'MARKET', qty,
        idempotencyKey: `manual-close-${posId}-${Date.now()}`,
      });
      webullOrderId = r.orderId;
    } catch (e) {
      return c.json({ error: `Webull order failed: ${String(e)}` }, 502);
    }
  }

  const pnl    = (exitPrice - entryPrice) * qty;
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const now    = new Date().toISOString();

  await c.env.DB?.prepare(`
    UPDATE scanner_positions SET
      status = 'CLOSED', exit_price = ?, pnl = ?, close_reason = 'MANUAL',
      current_price = ?, closed_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(exitPrice, pnl, exitPrice, now, now, posId).run();

  // Write to unified trades table
  await c.env.DB?.prepare(`
    INSERT OR IGNORE INTO trades
      (id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_pct,
       stop_loss, take_profit, signal, status, mode, opened_at, closed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    `trade-${posId}`, sym, 'BUY', qty,
    entryPrice, exitPrice, pnl, pnlPct,
    row.stop_loss, row.take_profit,
    `Manual close`,
    'CLOSED', mode, row.opened_at, now,
  ).run();

  return c.json({ ok: true, symbol: sym, exitPrice, pnl, webullOrderId });
});

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
