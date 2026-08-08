// MOE-AI — Scanner Position Manager
// Tracks pending orders and open scanner positions in D1, reconciles them with Webull,
// updates trailing SL, and executes exits.
import type { Env, TradingMode } from './types';
import type { ScannerPosition } from './types';
import { WebullClient } from './webull';
import {
  getWebullOrderDetail,
  isWebullOrderFullyFilled,
  isWebullOrderTerminal,
} from './webull-order-detail';
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
        WHERE mode = ? AND status IN ('PENDING', 'OPEN', 'EXIT_PENDING')
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

      if (status === 'EXIT_PENDING') {
        const clientOrderId = String(row.webull_order_id ?? '').trim();
        const currentPrice = brokerPosition && brokerPosition.currentPrice > 0
          ? brokerPosition.currentPrice
          : Number(row.current_price ?? row.exit_price ?? row.entry_price);

        if (!clientOrderId) {
          console.error('SCANNER_EXIT_CLIENT_ID_MISSING', JSON.stringify({
            id,
            symbol,
            mode,
          }));
          continue;
        }

        try {
          const details = await getWebullOrderDetail(
            env,
            mode,
            clientOrderId,
          );

          const detail = details.find(
            candidate => candidate.clientOrderId === clientOrderId,
          );

          if (!detail) {
            if (brokerPosition && brokerPosition.quantity > 0) {
              await client.placeOrder({
                symbol,
                side: 'SELL',
                type: 'MARKET',
                qty: brokerPosition.quantity,
                price: currentPrice,
                idempotencyKey: clientOrderId,
              });
            } else {
              try {
                await client.cancelOrder(clientOrderId);
              } catch {
                // Reconciliation will retry without declaring CLOSED.
              }
            }

            await env.DB.prepare(`
              UPDATE scanner_positions
              SET current_price = ?, updated_at = ?
              WHERE id = ?
            `).bind(currentPrice, now, id).run();
            continue;
          }

          const fullyFilled = isWebullOrderFullyFilled(detail)
            || (
              detail.totalQuantity > 0
              && detail.filledQuantity >= detail.totalQuantity
            );

          const terminal = fullyFilled
            || isWebullOrderTerminal(detail.status);

          if (!brokerPosition || brokerPosition.quantity <= 0) {
            if (terminal) {
              await finalizeScannerExit(env, row, now);
              continue;
            }

            try {
              await client.cancelOrder(clientOrderId);
            } catch {
              // Keep EXIT_PENDING until Webull reports a terminal order.
            }

            await env.DB.prepare(`
              UPDATE scanner_positions
              SET current_price = ?, updated_at = ?
              WHERE id = ?
            `).bind(currentPrice, now, id).run();
            continue;
          }

          if (fullyFilled) {
            await env.DB.prepare(`
              UPDATE scanner_positions
              SET current_price = ?, updated_at = ?
              WHERE id = ?
            `).bind(currentPrice, now, id).run();
            continue;
          }

          if (isWebullOrderTerminal(detail.status)) {
            await env.DB.prepare(`
              UPDATE scanner_positions SET
                status = 'OPEN',
                quantity = ?,
                current_price = ?,
                highest_price = MAX(highest_price, ?),
                webull_order_id = NULL,
                exit_price = NULL,
                close_reason = NULL,
                updated_at = ?
              WHERE id = ?
            `).bind(
              brokerPosition.quantity,
              currentPrice,
              currentPrice,
              now,
              id,
            ).run();
            continue;
          }

          await env.DB.prepare(`
            UPDATE scanner_positions
            SET current_price = ?, updated_at = ?
            WHERE id = ?
          `).bind(currentPrice, now, id).run();
        } catch (error) {
          console.error('SCANNER_EXIT_RECONCILE_ERROR', JSON.stringify({
            id,
            symbol,
            mode,
            error: error instanceof Error ? error.message : String(error),
          }));
        }

        continue;
      }
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

      if (status === 'PENDING' && openOrderSymbols.has(symbol)) {
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
      .prepare(`SELECT * FROM scanner_positions WHERE status IN ('OPEN', 'PENDING', 'EXIT_PENDING') AND mode = ?`)
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

function scannerExitClientOrderId(): string {
  return `scx${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

async function finalizeScannerExit(
  env: Env,
  row: Record<string, unknown>,
  now: string,
): Promise<void> {
  if (!env.DB) return;

  const id = String(row.id);
  const symbol = String(row.symbol);
  const mode = String(row.mode);
  const quantity = Number(row.quantity ?? 0);
  const entryPrice = Number(row.entry_price ?? 0);
  const requestedExitPrice = Number(
    row.exit_price ?? row.current_price ?? row.entry_price,
  );
  const exitPrice = requestedExitPrice > 0
    ? requestedExitPrice
    : entryPrice;
  const pnl = (exitPrice - entryPrice) * quantity;
  const pnlPct = entryPrice > 0
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : 0;
  const closeReason = String(
    row.close_reason ?? 'BROKER_POSITION_NOT_FOUND',
  );
  const signal = closeReason === 'MANUAL'
    ? 'Manual close'
    : `Scanner(${String(row.confidence)},score=${Number(row.score)})`;

  await env.DB.prepare(`
    UPDATE scanner_positions SET
      status = 'CLOSED',
      exit_price = ?,
      pnl = ?,
      current_price = ?,
      closed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    exitPrice,
    pnl,
    exitPrice,
    now,
    now,
    id,
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO trades
      (id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_pct,
       stop_loss, take_profit, signal, status, mode, opened_at, closed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    `trade-${id}`,
    symbol,
    'BUY',
    quantity,
    entryPrice,
    exitPrice,
    pnl,
    pnlPct,
    row.stop_loss,
    row.take_profit,
    signal,
    'CLOSED',
    mode,
    row.opened_at,
    now,
  ).run();
}

export async function requestScannerPositionExit(
  env: Env,
  mode: TradingMode,
  positionId: string,
  closeReason: string,
  priceValue?: number,
): Promise<{
  pending: true;
  idempotent: boolean;
  clientOrderId: string;
  orderId?: string;
  orderStatus: string;
  exitPrice: number;
}> {
  if (!env.DB) {
    throw new Error('Scanner database is unavailable.');
  }

  await ensureScannerTables(env);

  const row = await env.DB.prepare(`
    SELECT * FROM scanner_positions
    WHERE id = ? AND mode = ?
      AND status IN ('OPEN', 'EXIT_PENDING')
  `).bind(positionId, mode).first<Record<string, unknown>>();

  if (!row) {
    throw new Error('Scanner position is not open.');
  }

  if (String(row.status).toUpperCase() === 'EXIT_PENDING') {
    return {
      pending: true,
      idempotent: true,
      clientOrderId: String(row.webull_order_id ?? ''),
      orderStatus: 'EXIT_PENDING',
      exitPrice: Number(
        row.exit_price ?? row.current_price ?? row.entry_price,
      ),
    };
  }

  const client = WebullClient.fromEnv(env, mode);
  if (!client) {
    throw new Error(`${mode} Webull credentials are unavailable.`);
  }

  let exitPrice = Number(
    priceValue ?? row.current_price ?? row.entry_price,
  );

  if (priceValue == null) {
    try {
      const quote = await fetchQuote(String(row.symbol));
      if (quote.price > 0) exitPrice = quote.price;
    } catch {
      // Fall back to the last stored broker/scanner price.
    }
  }

  if (!(exitPrice > 0)) {
    throw new Error('A valid exit price is required.');
  }

  const quantity = Number(row.quantity ?? 0);
  if (!(quantity > 0)) {
    throw new Error('A positive scanner position quantity is required.');
  }

  const clientOrderId = scannerExitClientOrderId();
  const now = new Date().toISOString();

  // Atomically claim this OPEN row before contacting Webull.
  // Concurrent close requests must never submit a second SELL.
  const claim = await env.DB.prepare(`
    UPDATE scanner_positions SET
      status = 'EXIT_PENDING',
      webull_order_id = ?,
      exit_price = ?,
      current_price = ?,
      close_reason = ?,
      updated_at = ?
    WHERE id = ? AND mode = ? AND status = 'OPEN'
  `).bind(
    clientOrderId,
    exitPrice,
    exitPrice,
    closeReason,
    now,
    positionId,
    mode,
  ).run();

  if (Number(claim.meta.changes ?? 0) !== 1) {
    throw new Error(
      'Scanner position exit was already claimed or is no longer open.',
    );
  }

  const result = await client.placeOrder({
    symbol: String(row.symbol),
    side: 'SELL',
    type: 'MARKET',
    qty: quantity,
    price: exitPrice,
    idempotencyKey: clientOrderId,
  });

  return {
    pending: true,
    idempotent: false,
    clientOrderId,
    orderId: result.orderId,
    orderStatus: String(result.status ?? 'PENDING').toUpperCase(),
    exitPrice,
  };
}

/** Manage only FILLED/OPEN positions: update trailing SL and execute exits. */
export async function managePositions(env: Env, mode: TradingMode): Promise<{
  managed: number; closed: number; errors: string[];
}> {
  const tracked = await loadOpenPositions(env, mode);
  const positions = tracked.filter(position => String(position.status).toUpperCase() === 'OPEN');
  if (positions.length === 0) return { managed: 0, closed: 0, errors: [] };

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

      if (closeReason) {
        try {
          await requestScannerPositionExit(
            env,
            mode,
            pos.id,
            closeReason,
            price,
          );
        } catch (e) {
          errors.push(`Close ${pos.symbol}: ${String(e)}`);
        }
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
