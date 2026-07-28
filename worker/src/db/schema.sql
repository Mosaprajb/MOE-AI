-- MOE-AI D1 Database Schema
-- Run: wrangler d1 execute moe-db --file=src/db/schema.sql

-- Decisions log (TradingView signals processed by MOE engine)
CREATE TABLE IF NOT EXISTS decisions (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  signal_id    TEXT NOT NULL UNIQUE,
  symbol       TEXT NOT NULL,
  side         TEXT,
  signal       TEXT,
  score        REAL,
  entry        REAL,
  stop         REAL,
  target       REAL,
  accepted     INTEGER NOT NULL DEFAULT 0,
  submitted    INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  reasons      TEXT, -- JSON array
  mode         TEXT NOT NULL DEFAULT 'SANDBOX',
  source       TEXT DEFAULT 'tradingview',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_symbol  ON decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_decisions_mode    ON decisions(mode);

-- Trades (executed + open positions)
CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,  -- BUY | SELL
  quantity      REAL NOT NULL,
  entry_price   REAL NOT NULL,
  exit_price    REAL,
  pnl           REAL,
  pnl_pct       REAL,
  stop_loss     REAL,
  take_profit   REAL,
  signal        TEXT,
  score         REAL,
  order_id      TEXT,
  decision_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | CANCELLED
  mode          TEXT NOT NULL DEFAULT 'SANDBOX',
  reason        TEXT,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol    ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status    ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_mode      ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at DESC);

-- Orders (submitted to Webull)
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  webull_id     TEXT,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'MARKET',
  quantity      REAL NOT NULL,
  price         REAL,
  stop_price    REAL,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  filled        REAL DEFAULT 0,
  avg_fill_price REAL,
  trade_id      TEXT,
  decision_id   TEXT,
  mode          TEXT NOT NULL DEFAULT 'SANDBOX',
  idempotency_key TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_symbol    ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_mode      ON orders(mode);

-- Alerts / push notifications log
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type       TEXT NOT NULL, -- BUY|SELL|STOP|TARGET|RISK|SYSTEM|WEBHOOK
  symbol     TEXT,
  message    TEXT NOT NULL,
  price      REAL,
  mode       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_read    ON alerts(read);

-- System config (key-value store complement to KV)
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
