-- Flip the default identity-lock for NEW characters from 'strict' to 'off'.
-- Migration 245 shipped the column as NOT NULL DEFAULT 'strict'; product decision
-- is that characters should default to no identity lock (users opt in to soft/
-- strict when they want facial-likeness preservation). Mirrors the shared
-- DEFAULT_IDENTITY_LOCK constant (@nodaro/prompts), which the app-level create
-- defaults (characters route, MCP create_character, asset generation) also read.
--
-- DEFAULT change only — existing rows are intentionally NOT touched: every
-- current character carries an explicit value (245's backfill to 'strict' or a
-- later user choice), and rewriting them would override deliberate settings.
ALTER TABLE characters
  ALTER COLUMN identity_lock SET DEFAULT 'off';

COMMENT ON COLUMN characters.identity_lock IS
  'Identity-lock strength for Character Studio asset generation: off / soft / strict (default off). Read by /v1/generate-character-asset to control facial-likeness preservation in the prompt.';
