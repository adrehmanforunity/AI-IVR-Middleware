export const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS call_setups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  match_did TEXT,
  match_trunk TEXT,
  max_concurrent INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pulse_apis (
  slot TEXT PRIMARY KEY,
  method TEXT NOT NULL DEFAULT 'POST',
  endpoint TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  retries INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_sessions (
  session_id TEXT PRIMARY KEY,
  unique_id TEXT,
  channel TEXT,
  setup_id INTEGER,
  interaction_id TEXT,
  caller_id TEXT,
  did TEXT,
  trunk TEXT,
  state TEXT NOT NULL,
  caller_type TEXT,
  ivr_pointer TEXT,
  customer_json TEXT,
  reject_reason TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_unique ON call_sessions (unique_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_state ON call_sessions (state);
`;
