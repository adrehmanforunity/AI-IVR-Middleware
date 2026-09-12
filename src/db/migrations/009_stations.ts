export const MIGRATION_V9 = `
CREATE TABLE IF NOT EXISTS stations (
  extension TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`;
