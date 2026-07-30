// MOE-AI — Scanner Position Manager
// Tracks open scanner positions in D1, updates trailing SL, executes exits.
import type { Env, TradingMode } from './types';
import type { ScannerPosition } from './types';
import { WebullClient } from './webull';
import { fetchQuote } from './market-data';

/** Ensure scanner_positions, scanner_runs, and trades tables exist */
export async function ensureScannerTables(env: Env): Promise<void> {
  if (!env.DB) return;

  // D1Database.exec() splits newline-delimited SQL and can submit incomplete
  // CREATE TABLE statements. Execute each statement independently instead.
  const statements = [
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scanner_positions (
        id              TEXT PRIMARY KEY,
        symbol          TEXT NOT NULL,
        quantity        INTEGER NOT NULL,
        entry_price     REAL NOT NULL,
        current_price   REAL,
        highest_price   REAL NOT NULL,
        stop_loss       REAL NOT NULL,
        take_profit     REAL NOT NULL,
        hard_stop       REAL NOT NULL,
        trail_pct       REAL NOT NULL,
        tp_pct          REAL NOT NULL,
        confidence      TEXT NOT NULL,
        score           INTEGER NOT NULL,
        webull_order_id TEXT,
        status          TEXT DEFAULT 'OPEN',
        mode            TEXT NOT NULL,
        opened_at       TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        closed_at       TEXT,
        exit_price      REAL,
        pnl             REAL,
        close_reason    TEXT
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scanner_runs (
        id                TEXT PRIMARY KEY,
        mode              TEXT NOT NULL,
        scanned_count     INTEGER DEFAULT 0,
        candidates_count  INTEGER DEFAULT 0,
        orders_placed     INTEGER DEFAULT 0,
        positions_managed INTEGER DEFAULT 0,
        errors            TEXT,
        duration_ms       INTEGER,
        ran_at            TEXT NOT NULL
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS trades (
        id          TEXT PRIMARY KEY,
        symbol      TEXT NOT NULL,
        side        TEXT NOT NULL DEFAULT 'BUY',
        quantity    INTEGER,
        entry_price REAL,
        exit_price  REAL,
        pnl         REAL,
        pnl_pct     REAL,
        stop_loss   REAL,
        take_profit REAL,
        signal      TEXT,
        status      TEXT DEFAULT 'CLOSED',
        mode        TEXT NOT NULL,
        opened_at   TEXT,
        closed_at   TEXT
      )
    `),
  ];

  await env.DB.batch(statements);
}

/** Load all OPEN scanner positions for a mode */
export async function loadOpenPositions(env: Env, mode: TradingMode): Promise<ScannerPosition[]> {
  if (!env.DB) return [];
  try {
    const rows = await env.DB
      .prepare(`SELECT * FROM scanner_positions WHERE status = 'OPEN' AND mode = ?`)
      .bind(mode)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(mapRow);
  } catch { return []; }
}

/** Save a new scanner position after order is placed */
export async function savePosition(env: Env, pos: ScannerPosition): Promise<void> {
  await env.DB?.prepare(`
    INSERT INTO scanner_positions
      (id, symbol, quantity, entry_price, current_price, highest_price,
       stop_loss, take_profit, hard_stop, trail_pct, tp_pct,
       confidence, score, webull_order_id, status, mode, opened_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    pos.id, pos.symbol, pos.quantity, pos.entryPrice, pos.currentPrice,
    pos.highestPrice, pos.stopLoss, pos.takeProfit, pos.hardStop,
    pos.trailPct, pos.tpPct, pos.confidence, pos.score,
    pos.webullOrderId ?? null, 'OPEN', pos.mode,
    pos.openedAt, pos.updatedAt,
  ).run();
}

/** Manage all open positions: update trailing SL, execute exits */
export async function managePositions(env: Env, mode: TradingMode): Promise<{
  managed: number; closed: number; errors: string[];
}> {
  const positions = await loadOpenPositions(env, mode);
  if (positions.length === 0) return { managed: 0, closed: 0, errors: [] };

  const client = WebullClient.fromEnv(env, mode);
  let closed = 0;
  const errors: string[] = [];

  await Promise.allSettled(positions.map(async (pos) => {
    try {
      const quote = await fetchQuote(pos.symbol);
      const price = quote.price;

      // Update highest price seen
      const newHighest = Math.max(pos.highestPrice, price);

      // Update trailing stop: SL = highest × (1 - trailPct%)
      const newTrailSL = newHighest * (1 - pos.trailPct / 100);
      const newSL      = Math.max(newTrailSL, pos.hardStop); // never below hard stop

      // Check exit conditions
      let closeReason = '';
      if (price >= pos.takeProfit)        closeReason = 'TP_HIT';
      else if (price <= newSL)            closeReason = 'SL_HIT';

      if (closeReason && client) {
        // Place SELL order
        try {
          await client.placeOrder({
            symbol: pos.symbol, side: 'SELL', type: 'MARKET',
            qty: pos.quantity, idempotencyKey: `scanner-close-${pos.id}`,
          });
          const pnl    = (price - pos.entryPrice) * pos.quantity;
          const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
          const now    = new Date().toISOString();
          await env.DB?.prepare(`
            UPDATE scanner_positions SET
              status = 'CLOSED', exit_price = ?, pnl = ?, close_reason = ?,
              current_price = ?, closed_at = ?, updated_at = ?
            WHERE id = ?
          `).bind(price, pnl, closeReason, price, now, now, pos.id).run();
          // Also write to unified trades table so History page shows it
          await env.DB?.prepare(`
            INSERT OR IGNORE INTO trades
              (id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_pct,
               stop_loss, take_profit, signal, status, mode, opened_at, closed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).bind(
            `trade-${pos.id}`, pos.symbol, 'BUY', pos.quantity,
            pos.entryPrice, price, pnl, pnlPct,
            pos.stopLoss, pos.takeProfit,
            `Scanner(${pos.confidence},score=${pos.score})`,
            'CLOSED', pos.mode, pos.openedAt, now,
          ).run();
          closed++;
        } catch (e) { errors.push(`Close ${pos.symbol}: ${String(e)}`); }
      } else {
        // Just update tracking data
        await env.DB?.prepare(`
          UPDATE scanner_positions SET
            current_price = ?, highest_price = ?, stop_loss = ?, updated_at = ?
          WHERE id = ?
        `).bind(price, newHighest, newSL, new Date().toISOString(), pos.id).run();
      }
    } catch (e) { errors.push(`Manage ${pos.symbol}: ${String(e)}`); }
  }));

  return { managed: positions.length, closed, errors };
}

function mapRow(r: Record<string, unknown>): ScannerPosition {
  return {
    id:             String(r.id),
    symbol:         String(r.symbol),
    quantity:       Number(r.quantity),
    entryPrice:     Number(r.entry_price),
    currentPrice:   Number(r.current_price ?? r.entry_price),
    highestPrice:   Number(r.highest_price),
    stopLoss:       Number(r.stop_loss),
    takeProfit:     Number(r.take_profit),
    hardStop:       Number(r.hard_stop),
    trailPct:       Number(r.trail_pct),
    tpPct:          Number(r.tp_pct),
    confidence:     String(r.confidence) as 'HIGH' | 'MEDIUM',
    score:          Number(r.score),
    webullOrderId:  r.webull_order_id ? String(r.webull_order_id) : undefined,
    status:         String(r.status) as 'OPEN' | 'CLOSED',
    mode:           String(r.mode) as TradingMode,
    openedAt:       String(r.opened_at),
    updatedAt:      String(r.updated_at),
    closedAt:       r.closed_at ? String(r.closed_at) : undefined,
    exitPrice:      r.exit_price ? Number(r.exit_price) : undefined,
    pnl:            r.pnl ? Number(r.pnl) : undefined,
    closeReason:    r.close_reason ? String(r.close_reason) : undefined,
  };
}
