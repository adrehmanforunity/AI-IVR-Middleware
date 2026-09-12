export const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS ivrs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  entry_menu_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ivr_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ivr_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  prompt_sound TEXT NOT NULL DEFAULT '',
  no_input_sound TEXT NOT NULL DEFAULT '',
  invalid_sound TEXT NOT NULL DEFAULT '',
  timeout_sec INTEGER NOT NULL DEFAULT 5,
  max_no_input INTEGER NOT NULL DEFAULT 3,
  max_invalid INTEGER NOT NULL DEFAULT 3,
  on_no_input TEXT NOT NULL DEFAULT 'replay',
  on_no_input_menu_id INTEGER,
  on_max_no_input TEXT NOT NULL DEFAULT 'hangup',
  on_max_no_input_menu_id INTEGER,
  on_max_invalid TEXT NOT NULL DEFAULT 'hangup',
  on_max_invalid_menu_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ivr_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  digits TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'goto',
  target_menu_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
`;
