export const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asterisk_targets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL,
  ami_port INTEGER NOT NULL,
  ami_user TEXT NOT NULL,
  ami_password TEXT,
  ari_base_url TEXT NOT NULL,
  ari_user TEXT NOT NULL,
  ari_password TEXT,
  stasis_app TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`;
