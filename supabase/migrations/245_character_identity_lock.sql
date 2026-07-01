-- Per-character identity-lock strength for Character Studio asset generation.
-- Values: off (free reinterpretation) / soft (encourage likeness) / strict
-- (exact face match). Default 'strict' preserves the behavior that
-- generate-character-asset shipped with (it previously hardcoded a strict lock);
-- the setting lets users dial it down. Reuses the shared IdentityLockMode type
-- from @nodaro/shared. Consumed by POST /v1/generate-character-asset.
--
-- Constant-default ADD COLUMN is metadata-only in Postgres 11+ (no table rewrite);
-- the NOT NULL + default backfills all existing rows to 'strict'.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS identity_lock TEXT NOT NULL DEFAULT 'strict'
  CHECK (identity_lock IN ('off', 'soft', 'strict'));

COMMENT ON COLUMN characters.identity_lock IS
  'Identity-lock strength for Character Studio asset generation: off / soft / strict (default). Read by /v1/generate-character-asset to control facial-likeness preservation in the prompt.';
