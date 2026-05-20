-- 147_object-studio-columns.sql — Object Studio Phase 1: schema foundation
--
-- Adds 5 columns to `objects` (motion_clips, reference_photos,
-- canonical_description, style_lock, deleted_at), creates the
-- append_object_asset RPC for worker auto-attach, enables Supabase
-- Realtime on the table.
--
-- Mirrors:
--   - supabase/migrations/124_location-studio-columns.sql (column adds,
--     partial index, RPC body shape with CASE/WHEN + URL dedup)
--   - supabase/migrations/137_locations_jobs_realtime.sql (REPLICA
--     IDENTITY FULL + ALTER PUBLICATION with DO/EXCEPTION idempotency)
--
***REDACTED-OSS-SCRUB***
-- Required-prerequisite PR: #2601 (Furniture parameter-picker, merged)
--
-- Idempotent: every ALTER/CREATE uses IF NOT EXISTS / OR REPLACE,
-- DO/EXCEPTION wraps the publication-add. Safe to re-apply.
--
-- Single-line revert (DESTRUCTIVE — drops the RPC + columns + their
-- data; only run if you really mean it):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.objects;
--   ALTER TABLE public.objects REPLICA IDENTITY DEFAULT;
--   DROP FUNCTION IF EXISTS public.append_object_asset(uuid, text, jsonb);
--   ALTER TABLE objects
--     DROP COLUMN IF EXISTS motion_clips,
--     DROP COLUMN IF EXISTS reference_photos,
--     DROP COLUMN IF EXISTS canonical_description,
--     DROP COLUMN IF EXISTS style_lock,
--     DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS motion_clips           JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_photos       JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_description  TEXT     CHECK (canonical_description IS NULL OR char_length(canonical_description) <= 4000),
  ADD COLUMN IF NOT EXISTS style_lock             BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at             TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_objects_deleted_at
  ON objects (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN objects.motion_clips           IS 'Ambient motion clips (i2v) — JSONB array of { name, url } where url is a video. Object-specific moves: rotate, hover, spin, parallax.';
COMMENT ON COLUMN objects.reference_photos       IS 'Mood-board photos — JSONB array of { kind, url }. Frontend-owned (set via saveObject); kind is descriptive metadata in Phase 1.';
COMMENT ON COLUMN objects.canonical_description  IS 'LLM-authored ~80–120-word object description set on approve-main-image. Form/material/condition/purpose focus — NO scenes, NO people.';
COMMENT ON COLUMN objects.style_lock             IS 'When true, every variant gen passes the main image as reference for shape/material consistency. Default true.';
COMMENT ON COLUMN objects.deleted_at             IS 'Soft-delete timestamp. NULL = active. Mirrors characters.deleted_at + locations.deleted_at.';

-- Append RPC: atomic JSONB append with URL dedup + ownership-via-RLS + soft-delete guard.
-- Mirrors append_location_asset (migration 124) verbatim with location→object substitution.
-- 3-param signature (no p_user_id) — application-layer ownership check happens in
-- backend/src/lib/object-auto-attach.ts before the RPC call.
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
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(angles, '[]'::jsonb)) AS e
                          WHERE e->>'url' = p_value->>'url');
    WHEN 'materials' THEN
      UPDATE objects SET materials = COALESCE(materials, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(materials, '[]'::jsonb)) AS e
                          WHERE e->>'url' = p_value->>'url');
    WHEN 'variations' THEN
      UPDATE objects SET variations = COALESCE(variations, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(variations, '[]'::jsonb)) AS e
                          WHERE e->>'url' = p_value->>'url');
    WHEN 'motion_clips' THEN
      UPDATE objects SET motion_clips = COALESCE(motion_clips, '[]'::jsonb) || p_value
       WHERE id = p_object_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(motion_clips, '[]'::jsonb)) AS e
                          WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;

GRANT EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) TO service_role;

-- Supabase Realtime enablement. REPLICA IDENTITY FULL forces Postgres to include
-- the full pre-image of unchanged columns (including TOAST'd large JSONB) in
-- WAL UPDATE rows — without it, a worker writing to only `angles` produces an
-- event whose payload omits `materials`/`variations`/`motion_clips`/`reference_photos`
-- entirely. The Studio's merge layer would see those as undefined and drop them.
--
-- DO/EXCEPTION wrap mirrors migration 137:44-60 for idempotency on re-runs.
ALTER TABLE public.objects REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.objects;
    EXCEPTION
        WHEN duplicate_object THEN
            -- Already in the publication — safe to ignore.
            NULL;
    END;
END $$;
