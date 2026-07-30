// MOE-AI — Default watchlist (75 liquid US stocks, $10-$100 range)
import type { Env } from './types';

export const DEFAULT_WATCHLIST: string[] = [
  // Tech / Growth
  'SOFI', 'PLTR', 'SNAP', 'INTC', 'RIVN', 'MARA', 'RIOT', 'HOOD',
  'RBLX', 'PINS', 'MTCH', 'AI', 'TDOC', 'HIMS', 'DKNG', 'ZM',
  // Finance / Banks
  'BAC', 'KEY', 'RF', 'USB', 'WFC', 'C', 'SCHW', 'SQ', 'PYPL',
  // Autos / Mobility
  'F', 'GM', 'NIO', 'UBER', 'LYFT',
  // Airlines / Travel / Gaming
  'AAL', 'UAL', 'DAL', 'NCLH', 'CCL', 'MGM', 'LVS', 'PENN', 'CZR',
  // Energy / Materials
  'DVN', 'MRO', 'ET', 'HAL', 'SLB', 'OXY', 'FCX', 'VALE', 'PBR',
  // Telecom / Media
  'T', 'VZ', 'WBD', 'PARA',
  // Asia / Emerging
  'SE', 'BIDU', 'CPNG', 'XPEV', 'LI',
  // Crypto miners
  'HUT', 'CLSK',
  // Pharma / Healthcare
  'PFE', 'MRNA', 'BMY', 'MRK',
  // Hardware / Semis
  'CSCO', 'HPQ', 'MU', 'DELL',
  // Other liquid
  'NEM', 'DOCU', 'WYNN', 'NOG', 'SMCI', 'SOUN',
];

/** Load watchlist from D1 (falls back to default list) */
export async function loadWatchlist(env: Env, mode: string): Promise<string[]> {
  if (!env.DB) return DEFAULT_WATCHLIST;
  try {
    const rows = await env.DB
      .prepare('SELECT symbol FROM watchlist WHERE mode = ? AND active = 1 ORDER BY symbol')
      .bind(mode)
      .all<{ symbol: string }>();
    if (rows.results && rows.results.length > 0) {
      return rows.results.map(r => r.symbol);
    }
  } catch { /* table not yet created */ }
  return DEFAULT_WATCHLIST;
}

/** Upsert a symbol into the D1 watchlist */
export async function addToWatchlist(env: Env, symbol: string, mode: string): Promise<void> {
  await env.DB?.prepare(
    `INSERT INTO watchlist (symbol, mode, active, added_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(symbol, mode) DO UPDATE SET active = 1`
  ).bind(symbol.toUpperCase(), mode, new Date().toISOString()).run();
}

/** Remove a symbol from the D1 watchlist */
export async function removeFromWatchlist(env: Env, symbol: string, mode: string): Promise<void> {
  await env.DB?.prepare(
    `UPDATE watchlist SET active = 0 WHERE symbol = ? AND mode = ?`
  ).bind(symbol.toUpperCase(), mode).run();
}

/** Schema is provisioned exclusively by D1 migrations. */
export async function ensureWatchlistTable(env: Env): Promise<void> {
  void env;
}
