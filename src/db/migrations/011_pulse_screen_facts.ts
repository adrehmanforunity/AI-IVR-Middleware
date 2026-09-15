export const MIGRATION_V11 = `
ALTER TABLE call_sessions ADD COLUMN is_cli_already_exist INTEGER;
ALTER TABLE call_sessions ADD COLUMN ivr_routing INTEGER;
ALTER TABLE call_sessions ADD COLUMN is_priority INTEGER;
ALTER TABLE call_sessions ADD COLUMN is_high_alert INTEGER;
ALTER TABLE call_sessions ADD COLUMN recording_relative_path TEXT;
`;
