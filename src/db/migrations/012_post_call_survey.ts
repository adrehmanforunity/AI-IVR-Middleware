export const MIGRATION_V12 = `
ALTER TABLE call_setups ADD COLUMN post_call_survey_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_setups ADD COLUMN post_call_survey_ivr_id INTEGER;
ALTER TABLE outbound_routes ADD COLUMN post_call_survey_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_routes ADD COLUMN post_call_survey_ivr_id INTEGER;
`;
