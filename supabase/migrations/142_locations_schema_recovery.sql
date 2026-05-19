-- Migration 142 — Recovery: re-assert all 7 columns + index from migration 124.
--
-- Why this exists: on 2026-05-19, prod CI surfaced `column "deleted_at" does
-- not exist` when migration 141 tried to build a partial index on
-- locations(deleted_at). The 141 PR patched THAT column defensively
-- (PR #2550 / commit `89078146`), but it was unclear whether the OTHER
-- six columns from migration 124 (lighting, seasons, atmosphere_motions,
-- reference_photos, canonical_description, style_lock) were also missing.
--
-- History of the drift: PRs #2449 and #2484 both shipped migrations as
-- `124_*.sql`. PR #2493 resolved the collision by renaming the seedance
-- migration to `133_*.sql`. Whichever 124 file ran on each environment
-- FIRST stayed as `schema_migrations` version 124; the other was permanently
-- skipped on that env because Supabase saw 124 as already applied.
-- Backend route `locations.ts` SELECTs all 7 columns by name, so if any
-- were missing on prod the location-studio feature would 500 — but the
-- feature has been live since #2484 merged, which implies the columns
-- DID land. Either via the location-studio 124 winning the prod race, or
-- via manual ALTER outside the migration framework.
--
-- This migration is defensive and idempotent. Every statement is guarded
-- with `IF NOT EXISTS` / `CREATE OR REPLACE`, so:
--   - On environments where 124 (location-studio) applied: NO-OP.
--   - On environments where 124 (seedance) won the race: recovers the
--     missing columns + index + RPC + grants without disturbing existing data.
--
-- Cross-reference: the RPC `append_location_asset` shipped in 124 is
-- replayed below via `CREATE OR REPLACE` so partial-state recovery brings
-- it back if missing; on healthy environments this is also a no-op (same
-- body as the previous definition).

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS lighting              JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS seasons               JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS atmosphere_motions    JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_photos      JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_description TEXT,
  ADD COLUMN IF NOT EXISTS style_lock            BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMPTZ DEFAULT NULL;

-- canonical_description has a CHECK constraint in 124. ADD COLUMN IF NOT
-- EXISTS doesn't re-add a constraint to an already-existing column, so the
-- constraint is asserted separately and conditionally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_canonical_description_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_canonical_description_check
      CHECK (canonical_description IS NULL OR char_length(canonical_description) <= 4000);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_locations_deleted_at
  ON public.locations (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Re-assert the RPC body verbatim from migration 124.
-- CREATE OR REPLACE is idempotent — no-op on healthy environments.
CREATE OR REPLACE FUNCTION public.append_location_asset(
  p_location_id uuid,
  p_column text,
  p_value jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  CASE p_column
    WHEN 'time_of_day' THEN
      UPDATE public.locations SET time_of_day = COALESCE(time_of_day, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(time_of_day, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'weather' THEN
      UPDATE public.locations SET weather = COALESCE(weather, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(weather, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'seasons' THEN
      UPDATE public.locations SET seasons = COALESCE(seasons, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(seasons, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'angles' THEN
      UPDATE public.locations SET angles = COALESCE(angles, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(angles, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'lighting' THEN
      UPDATE public.locations SET lighting = COALESCE(lighting, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(lighting, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'atmosphere_motions' THEN
      UPDATE public.locations SET atmosphere_motions = COALESCE(atmosphere_motions, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(atmosphere_motions, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;

GRANT EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO service_role;
