-- Native iOS mobile control, login throttling, and APNs registration.

CREATE TABLE IF NOT EXISTS mobile_login_attempts (
  fingerprint       TEXT PRIMARY KEY,
  failures          INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until      INTEGER,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mobile_audit (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  symbol       TEXT,
  account_type TEXT,
  reason       TEXT,
  error        TEXT,
  request_id   TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_audit_created
  ON mobile_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id              TEXT PRIMARY KEY,
  token           TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  bundle_id       TEXT NOT NULL,
  environment     TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  platform        TEXT NOT NULL DEFAULT 'ios',
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_active
  ON mobile_push_devices(active, environment, bundle_id);

CREATE TABLE IF NOT EXISTS mobile_push_events (
  id                TEXT PRIMARY KEY,
  device_id         TEXT,
  notification_type TEXT NOT NULL,
  symbol            TEXT,
  status            TEXT NOT NULL,
  apns_id           TEXT,
  reason            TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES mobile_push_devices(id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_events_created
  ON mobile_push_events(created_at DESC);
