export const MIGRATION_V13 = `
ALTER TABLE call_setups ADD COLUMN block_duplicate_callers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_setups ADD COLUMN duplicate_block_count INTEGER NOT NULL DEFAULT 0;
`;
