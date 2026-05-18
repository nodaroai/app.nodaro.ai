-- supabase/migrations/124_location-studio-columns.sql
-- Location Studio Phase 1: 7 new columns + append_location_asset RPC + soft-delete

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS lighting              JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS seasons               JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS atmosphere_motions    JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_photos      JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_description TEXT     CHECK (canonical_description IS NULL OR char_length(canonical_description) <= 4000),
  ADD COLUMN IF NOT EXISTS style_lock            BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_deleted_at
  ON locations (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN locations.lighting               IS 'Lighting variants — JSONB array of { name, url }.';
COMMENT ON COLUMN locations.seasons                IS 'Seasonal variants — JSONB array of { name, url }.';
COMMENT ON COLUMN locations.atmosphere_motions     IS 'Ambient motion clips (i2v) — JSONB array of { name, url } where url is a video. Populated in PR-2.';
COMMENT ON COLUMN locations.reference_photos       IS 'Mood-board photos — JSONB array of { kind, url }. User-owned.';
COMMENT ON COLUMN locations.canonical_description  IS 'LLM-authored ~80-120-word scene description set on approve-main-image.';
COMMENT ON COLUMN locations.style_lock             IS 'When true, every variant gen passes the main image as reference for layout consistency. Default true.';
COMMENT ON COLUMN locations.deleted_at             IS 'Soft-delete timestamp. NULL = active.';

-- RPC: atomic per-column JSONB append with URL dedup + deleted_at guard
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
      UPDATE locations SET time_of_day = COALESCE(time_of_day, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(time_of_day, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'weather' THEN
      UPDATE locations SET weather = COALESCE(weather, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(weather, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'seasons' THEN
      UPDATE locations SET seasons = COALESCE(seasons, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(seasons, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'angles' THEN
      UPDATE locations SET angles = COALESCE(angles, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(angles, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'lighting' THEN
      UPDATE locations SET lighting = COALESCE(lighting, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(lighting, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'atmosphere_motions' THEN
      UPDATE locations SET atmosphere_motions = COALESCE(atmosphere_motions, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(atmosphere_motions, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;

GRANT EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO service_role;
