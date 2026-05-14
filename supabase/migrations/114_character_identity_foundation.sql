-- supabase/migrations/114_character_identity_foundation.sql
--
-- Character Studio Identity Foundation redesign — new columns + asset backfill.
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
-- shape (description on every item, motionDescription on motions, realLifeRefs
-- on expressions/poses/motions).

-- 1. Add new columns. seed_prompt and canonical_description allow NULL; existing
--    rows get NULL (frontend coerces null → empty string at the form layer).
--    CHECK constraints pass NULL by default per Postgres semantics.
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS reference_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS seed_prompt TEXT CHECK (char_length(seed_prompt) <= 2000),
  ADD COLUMN IF NOT EXISTS canonical_description TEXT CHECK (char_length(canonical_description) <= 4000),
  ADD COLUMN IF NOT EXISTS real_life_refs_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.characters.source_image_url IS
  'Approved canonical portrait (set by POST /v1/characters/:id/approve-portrait). Was previously any-portrait-generated; semantics tightened in the identity-foundation redesign.';
COMMENT ON COLUMN public.characters.reference_photos IS
  'User-uploaded raw photos used as identity references. Array of {url, kind} where kind ∈ {front, sideLeft, sideRight, threeQuarterLeft, threeQuarterRight, fullBody, other}.';
COMMENT ON COLUMN public.characters.canonical_description IS
  'LLM-written deep description of the approved portrait. Set on portrait approval; user-editable thereafter.';
COMMENT ON COLUMN public.characters.real_life_refs_by_variant IS
  'Per-preset-variant slot of real-life photo refs. Keyed lowercased+trimmed (e.g. "smile"). Max 20 keys, 5 photos each.';

-- 2. Backfill existing asset entries — merge new fields into each item rather
--    than replace, so any extra keys past entries carry are preserved.
--    `jsonb_agg(elem || patch) FROM jsonb_array_elements(col) elem` is the idiom.

UPDATE public.characters
SET
  expressions = COALESCE((
    SELECT jsonb_agg(elem || '{"description": ""}'::jsonb)
    FROM jsonb_array_elements(expressions) elem
  ), '[]'::jsonb),
  poses = COALESCE((
    SELECT jsonb_agg(elem || '{"description": ""}'::jsonb)
    FROM jsonb_array_elements(poses) elem
  ), '[]'::jsonb),
  lighting_variations = COALESCE((
    SELECT jsonb_agg(elem || '{"description": ""}'::jsonb)
    FROM jsonb_array_elements(lighting_variations) elem
  ), '[]'::jsonb),
  angles = COALESCE((
    SELECT jsonb_agg(elem || '{"description": ""}'::jsonb)
    FROM jsonb_array_elements(angles) elem
  ), '[]'::jsonb),
  motions = COALESCE((
    SELECT jsonb_agg(elem || '{"description": "", "motionDescription": ""}'::jsonb)
    FROM jsonb_array_elements(motions) elem
  ), '[]'::jsonb);
