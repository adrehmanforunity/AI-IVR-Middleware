export const MIGRATION_V14 = `
ALTER TABLE call_setups ADD COLUMN voice_folder TEXT NOT NULL DEFAULT '';
`;
