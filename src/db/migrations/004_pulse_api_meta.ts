export const MIGRATION_V4 = `
ALTER TABLE pulse_apis ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pulse_apis ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE pulse_apis ADD COLUMN mock_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pulse_apis ADD COLUMN mock_json TEXT;
ALTER TABLE pulse_apis ADD COLUMN mock_status INTEGER;
ALTER TABLE pulse_apis ADD COLUMN mock_error TEXT;
`;
