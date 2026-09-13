export const MIGRATION_V10 = `
CREATE TABLE IF NOT EXISTS outbound_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trunk TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'both',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
