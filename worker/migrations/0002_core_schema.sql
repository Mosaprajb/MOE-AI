-- MOE-AI D1 core schema
-- 0001 was applied empty; this migration creates the operational tables.

CREATE TABLE IF NOT EXISTS scanner_positions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL,
  highest_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  hard_stop REAL NOT NULL,
  trail_pct REAL NOT NULL,
  tp_pct REAL NOT NULL,
  confidence TEXT NOT NULL,
  score INTEGER NOT NULL,
  webull_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  mode TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  exit_price REAL,
  pnl REAL,
  close_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_scanner_positions_mode_status
  ON scanner_positions(mode, status);
CREATE INDEX IF NOT EXISTS idx_scanner_positions_symbol
  ON scanner_positions(symbol);

CREATE TABLE IF NOT EXISTS scanner_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  candidates_count INTEGER NOT NULL DEFAULT 0,
  orders_placed INTEGER NOT NULL DEFAULT 0,
  positions_managed INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  duration_ms INTEGER,
  ran_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scanner_runs_ran_at
  ON scanner_runs(ran_at DESC);

CREATE TABLE IF NOT EXISTS scanner_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  price REAL,
  score INTEGER,
  confidence TEXT,
  entry_price REAL,
  stop_loss REAL,
  take_profit REAL,
  reasons TEXT,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scanner_results_run_id
  ON scanner_results(run_id);
CREATE INDEX IF NOT EXISTS idx_scanner_results_created_at
  ON scanner_results(created_at DESC);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'BUY',
  quantity INTEGER,
  entry_price REAL,
  exit_price REAL,
  pnl REAL,
  pnl_pct REAL,
  stop_loss REAL,
  take_profit REAL,
  signal TEXT,
  status TEXT NOT NULL DEFAULT 'CLOSED',
  mode TEXT NOT NULL,
  opened_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_mode_status
  ON trades(mode, status);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at
  ON trades(closed_at DESC);

CREATE TABLE IF NOT EXISTS decisions (
  signal_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT,
  signal TEXT,
  score REAL,
  entry REAL,
  stop REAL,
  target REAL,
  accepted INTEGER NOT NULL DEFAULT 0,
  submitted INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  reasons TEXT,
  mode TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_created_at
  ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_symbol
  ON decisions(symbol);

CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL,
  PRIMARY KEY (symbol, mode)
);

CREATE TABLE IF NOT EXISTS learning_log (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  symbol TEXT,
  payload TEXT,
  outcome TEXT,
  mode TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_log_created_at
  ON learning_log(created_at DESC);

CREATE TABLE IF NOT EXISTS system_events (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_events_created_at
  ON system_events(created_at DESC);

CREATE TABLE IF NOT EXISTS schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '2', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
