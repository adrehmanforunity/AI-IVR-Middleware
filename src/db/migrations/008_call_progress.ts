export const MIGRATION_V8 = `
ALTER TABLE call_sessions ADD COLUMN pulse_session_id TEXT;
ALTER TABLE call_sessions ADD COLUMN agent_id TEXT;
ALTER TABLE call_sessions ADD COLUMN agent_extension TEXT;
ALTER TABLE call_sessions ADD COLUMN bridge_id TEXT;
ALTER TABLE call_sessions ADD COLUMN language INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_sessions ADD COLUMN queue_position INTEGER;
ALTER TABLE call_sessions ADD COLUMN expected_wait_sec INTEGER;
`;
