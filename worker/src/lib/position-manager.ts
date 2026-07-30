// MOE-AI — Scanner Position Manager
// Tracks pending orders and open scanner positions in D1, reconciles them with Webull,
// updates trailing SL, and executes exits.
import type { Env, TradingMode } from './types';
import type { ScannerPosition } from './types';
import { WebullClient } from './webull';
import { fetchQuote } from './market-data';

/** Ensure scanner_positions, scanner_runs, and trades tables exist */
export async function ensureScannerTables(env: Env): Promise<void> {
  if (!env.DB) return;

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
        status          TEXT DEFAULT 'PENDING',
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

function orderSymbol(order: { id: string; symbol: string }): string {
  const direct = String(order.symbol ?? '').trim().toUpperCase();
  if (direct) return direct;
  const match = String(order.id ?? '').match(/scanner-([A-Z.]+)-/i);
  return match?.[1]?.toUpperCase() ?? '';
}

/**
 * Reconcile tracked scanner rows against Webull.
 * - Broker position exists => FILLED, row becomes OPEN.
 * - Broker open order exists => row remains/becomes PENDING.
 * - Neither exists => pending order becomes CANCELLED; vanished open position becomes CLOSED.
 */
export async function syncScannerOrders(env: Env, mode: TradingMode): Promise<void> {
  if (!env.DB) return;
  const client = WebullClient.fromEnv(env, mode);
  if (!client) return;

  try {
    const [brokerPositions, brokerOrders, tracked] = await Promise.all([
      client.getPositions(),
      client.getOrders(),
      env.DB.prepare(`
        SELECT * FROM scanner_positions
        WHERE mode = ? AND status IN ('PENDING', 'OPEN')
      `).bind(mode).all<Record<string, unknown>>(),
    ]);

    const positionBySymbol = new Map(
      brokerPositions.map(position => [position.symbol.toUpperCase(), position]),
    );
    const openOrderSymbols = new Set(
      brokerOrders.map(orderSymbol).filter(Boolean),
    );
    const now = new Date().toISOString();

    for (const row of tracked.results ?? []) {
      const id = String(row.id);
      const symbol = String(row.symbol).toUpperCase();
      const status = String(row.status).toUpperCase();
      const brokerPosition = positionBySymbol.get(symbol);

      if (brokerPosition && brokerPosition.quantity > 0) {
        const avgPrice = brokerPosition.averagePrice > 0
          ? brokerPosition.averagePrice
          : Number(row.entry_price);
        const currentPrice = brokerPosition.currentPrice > 0
          ? brokerPosition.currentPrice
          : avgPrice;
        await env.DB.prepare(`
          UPDATE scanner_positions SET
            status = 'OPEN', quantity = ?, entry_price = ?, current_price = ?,
            highest_price = MAX(highest_price, ?), opened_at = COALESCE(opened_at, ?),
            updated_at = ?, closed_at = NULL, close_reason = NULL
          WHERE id = ?
        `).bind(
          brokerPosition.quantity,
          avgPrice,
          currentPrice,
          currentPrice,
          now,
          now,
          id,
        ).run();
        continue;
      }

      if (openOrderSymbols.has(symbol)) {
        if (status !== 'PENDING') {
          await env.DB.prepare(`
            UPDATE scanner_positions
            SET status = 'PENDING', updated_at = ?, closed_at = NULL, close_reason = NULL
            WHERE id = ?
          `).bind(now, id).run();
        }
        continue;
      }

      if (status === 'PENDING') {
        await env.DB.prepare(`
          UPDATE scanner_positions
          SET status = 'CANCELLED', close_reason = 'BROKER_ORDER_CANCELLED_OR_EXPIRED',
              closed_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(now, now, id).run();
      } else {
        await env.DB.prepare(`
          UPDATE scanner_positions
          SET status = 'CLOSED', close_reason = COALESCE(close_reason, 'BROKER_POSITION_NOT_FOUND'),
              closed_at = COALESCE(closed_at, ?), updated_at = ?
          WHERE id = ?
        `).bind(now, now, id).run();
      }
    }
  } catch (error) {
    console.error('SCANNER_ORDER_SYNC_ERROR', String(error));
  }
}

/** Load all active scanner rows. PENDING rows count toward limits but are not managed as positions. */
export async function loadOpenPositions(env: Env, mode: TradingMode): Promise<ScannerPosition[]> {
  if (!env.DB) return [];
  await syncScannerOrders(env, mode);
  try {
    const rows = await env.DB
      .prepare(`SELECT * FROM scanner_positions WHERE status IN ('OPEN', 'PENDING') AND mode = ?`)
      .bind(mode)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(mapRow);
  } catch { return []; }
}

/** Save an accepted Webull order as PENDING. It becomes OPEN only after reconciliation sees a broker position. */
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
    pos.webullOrderId ?? null, 'PENDING', pos.mode,
    pos.openedAt, pos.updatedAt,
  ).run();
}

/** Manage only FILLED/OPEN positions: update trailing SL and execute exits. */
export async function managePositions(env: Env, mode: TradingMode): Promise<{
  managed: number; closed: number; errors: string[];
}> {
  const tracked = await loadOpenPositions(env, mode);
  const positions = tracked.filter(position => String(position.status).toUpperCase() === 'OPEN');
  if (positions.length === 0) return { managed: 0, closed: 0, errors: [] };

  const client = WebullClient.fromEnv(env, mode);
  let closed = 0;
  const errors: string[] = [];

  await Promise.allSettled(positions.map(async (pos) => {
    try {
      const quote = await fetchQuote(pos.symbol);
      const price = quote.price;
      const newHighest = Math.max(pos.highestPrice, price);
      const newTrailSL = newHighest * (1 - pos.trailPct / 100);
      const newSL = Math.max(newTrailSL, pos.hardStop);

      let closeReason = '';
      if (price >= pos.takeProfit) closeReason = 'TP_HIT';
      else if (price <= newSL) closeReason = 'SL_HIT';

      if (closeReason && client) {
        try {
          await client.placeOrder({
            symbol: pos.symbol,
            side: 'SELL',
            type: 'MARKET',
            qty: pos.quantity,
            price,
            idempotencyKey: `scanner-close-${pos.id}`,
          });
          const pnl = (price - pos.entryPrice) * pos.quantity;
          const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
          const now = new Date().toISOString();
          await env.DB?.prepare(`
            UPDATE scanner_positions SET
              status = 'CLOSED', exit_price = ?, pnl = ?, close_reason = ?,
              current_price = ?, closed_at = ?, updated_at = ?
            WHERE id = ?
          `).bind(price, pnl, closeReason, price, now, now, pos.id).run();
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
    status:         String(r.status) as ScannerPosition['status'],
    mode:           String(r.mode) as TradingMode,
    openedAt:       String(r.opened_at),
    updatedAt:      String(r.updated_at),
    closedAt:       r.closed_at ? String(r.closed_at) : undefined,
    exitPrice:      r.exit_price ? Number(r.exit_price) : undefined,
    pnl:            r.pnl ? Number(r.pnl) : undefined,
    closeReason:    r.close_reason ? String(r.close_reason) : undefined,
  };
}
