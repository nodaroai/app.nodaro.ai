-- 200_reference_sheet_columns_and_pricing.sql
-- Reference Sheet (Plan 03): storage + pricing.
--   1. New JSONB buckets: sheets (characters/objects/locations), detail_closeups
--      (all three), outfit_variations (characters only).
--   2. Extend the three append_*_asset RPC whitelists to write the new columns.
--      CREATE OR REPLACE preserves grants; object/location stay service_role-only
--      (migration 170) — re-asserted below to be safe.
--   3. Pricing: reference-sheet:assembly = 4 credits (flat sheet-assembly fee).

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS sheets            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_closeups   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outfit_variations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.objects
  ADD COLUMN IF NOT EXISTS sheets          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_closeups JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS sheets          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_closeups JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.characters.sheets IS 'Generated reference sheets (ReferenceSheet records).';
COMMENT ON COLUMN public.characters.detail_closeups IS 'Macro close-up panels (eyes/hands/...) for the detail board.';
COMMENT ON COLUMN public.characters.outfit_variations IS 'Wardrobe/outfit-variation panels (same subject, different outfits).';

-- ── 2a. character append (4-arg, has user_id) — add the three new columns ─────
CREATE OR REPLACE FUNCTION public.append_character_asset(
  p_character_id UUID,
  p_user_id UUID,
  p_column TEXT,
  p_item JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_column NOT IN ('expressions', 'poses', 'lighting_variations', 'angles', 'body_angles', 'motions', 'sheets', 'detail_closeups', 'outfit_variations') THEN
    RAISE EXCEPTION 'invalid column: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.characters
        SET %I = COALESCE(%I, ''[]''::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2 AND user_id = $3',
    p_column, p_column
  ) USING p_item, p_character_id, p_user_id;
END;
$$;

-- ── 2b. object append (3-arg, dedup-by-url) — add sheets + detail_closeups ────
CREATE OR REPLACE FUNCTION public.append_object_asset(
  p_object_id  uuid,
  p_column     text,
  p_value      jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  CASE p_column
    WHEN 'angles' THEN
      UPDATE objects SET angles = COALESCE(angles, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(angles, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'materials' THEN
      UPDATE objects SET materials = COALESCE(materials, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(materials, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'variations' THEN
      UPDATE objects SET variations = COALESCE(variations, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(variations, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'motion_clips' THEN
      UPDATE objects SET motion_clips = COALESCE(motion_clips, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(motion_clips, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'sheets' THEN
      UPDATE objects SET sheets = COALESCE(sheets, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(sheets, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'detail_closeups' THEN
      UPDATE objects SET detail_closeups = COALESCE(detail_closeups, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(detail_closeups, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;
-- Preserve migration 170 lockdown (service_role only).
REVOKE EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) TO service_role;

-- ── 2c. location append (3-arg, dedup-by-url) — add sheets + detail_closeups ──
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
    WHEN 'sheets' THEN
      UPDATE public.locations SET sheets = COALESCE(sheets, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(sheets, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'detail_closeups' THEN
      UPDATE public.locations SET detail_closeups = COALESCE(detail_closeups, '[]'::jsonb) || p_value
       WHERE id = p_location_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(detail_closeups, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;
-- Preserve migration 170 lockdown (service_role only).
REVOKE EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO service_role;

-- ── 3. Pricing seed ───────────────────────────────────────────────────────────
-- Flat sheet-assembly fee. Per-panel generation is priced separately by the
-- existing per-asset routes (bare provider key). A missing row here → admin
-- can't see/edit it; STATIC_CREDIT_COSTS is the runtime fallback.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('reference-sheet:assembly', 4, true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
