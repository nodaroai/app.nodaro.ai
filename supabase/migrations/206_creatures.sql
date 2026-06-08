-- 206_creatures.sql — Animal/Creature entity. Structural mirror of `objects`
-- so the cloned route/adapter/worker code in later phases maps 1:1.
--
-- Column set = the CUMULATIVE objects schema:
--   018 (base CREATE TABLE) + 147 (motion_clips/reference_photos/
--   canonical_description CHECK/style_lock NOT NULL DEFAULT TRUE/deleted_at) +
--   200 (sheets/detail_closeups, both NOT NULL DEFAULT '[]') +
--   204 (image_provider TEXT, nullable) + 205 (selected_asset_by_variant
--   JSONB NOT NULL DEFAULT '{}').
--
-- Deltas vs objects:
--   + species TEXT          (creature-specific; nullable)
--   materials → poses        (objects' `materials` slot becomes `poses`; same
--                             shape: bare JSONB, nullable, no default)
--
-- RLS mirrors objects EXACTLY: a single FOR ALL policy
--   "Users can CRUD own creatures" USING ((select auth.uid()) = user_id)
-- (no WITH CHECK — matches the consolidated objects policy, migration 032).
--
-- append_creature_asset mirrors append_object_asset (migration 202): 3-arg,
-- SECURITY DEFINER, atomic JSONB append with URL dedup + soft-delete guard,
-- CASE arms for the 6 CREATURE_ATTACH_COLUMNS (angles, poses, variations,
-- motion_clips, sheets, detail_closeups). LOCKED DOWN to service_role only
-- (REVOKE PUBLIC/anon/authenticated, GRANT service_role) — same lockdown as
-- migrations 170/200/202 for the object/location RPCs, to prevent the
-- SECURITY-DEFINER cross-tenant IDOR. Ownership is re-verified in the backend
-- application layer (the later creature-auto-attach helper).
--
-- Supabase Realtime enabled (REPLICA IDENTITY FULL + publication add), mirroring
-- migration 147's setup for objects so a worker writing one bucket emits an
-- event carrying the full pre-image of the others.
--
-- updated_at is route-managed (no trigger) — mirrors objects.
--
-- Idempotent: every CREATE uses IF NOT EXISTS / OR REPLACE; the policy is
-- guarded by a pg_policies check; the publication-add is wrapped in
-- DO/EXCEPTION. Safe to re-apply.
--
-- Single-line revert (DESTRUCTIVE — drops the table + RPC + all data):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.creatures;
--   DROP FUNCTION IF EXISTS public.append_creature_asset(uuid, text, jsonb);
--   DROP TABLE IF EXISTS public.creatures;

CREATE TABLE IF NOT EXISTS creatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id UUID,
  node_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  species TEXT,
  category TEXT,
  style TEXT,
  main_image_url TEXT,
  source_image_url TEXT,
  image_provider TEXT,
  angles JSONB,
  poses JSONB,
  variations JSONB,
  custom_variations JSONB,
  motion_clips JSONB DEFAULT '[]'::jsonb,
  reference_photos JSONB DEFAULT '[]'::jsonb,
  sheets JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_closeups JSONB NOT NULL DEFAULT '[]'::jsonb,
  canonical_description TEXT CHECK (canonical_description IS NULL OR char_length(canonical_description) <= 4000),
  style_lock BOOLEAN NOT NULL DEFAULT TRUE,
  selected_asset_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE
);

COMMENT ON COLUMN creatures.species               IS 'Creature/animal species or type (e.g. "wolf", "dragon"). Nullable; creature-specific delta vs objects.';
COMMENT ON COLUMN creatures.poses                 IS 'Pose variation assets — JSONB array of { name, url }. Creature analogue of objects.materials.';
COMMENT ON COLUMN creatures.motion_clips          IS 'Ambient motion clips (i2v) — JSONB array of { name, url } where url is a video.';
COMMENT ON COLUMN creatures.reference_photos      IS 'Mood-board photos — JSONB array of { kind, url }. Frontend-owned (set via save route).';
COMMENT ON COLUMN creatures.canonical_description IS 'LLM-authored ~80–120-word creature description set on approve-main-image. Form/anatomy/markings focus — NO scenes, NO people.';
COMMENT ON COLUMN creatures.style_lock            IS 'When true, every variant gen passes the main image as reference for shape/anatomy consistency. Default true.';
COMMENT ON COLUMN creatures.deleted_at            IS 'Soft-delete timestamp. NULL = active. Mirrors objects.deleted_at.';

CREATE INDEX IF NOT EXISTS idx_creatures_user_id ON creatures (user_id);
CREATE INDEX IF NOT EXISTS idx_creatures_project_id ON creatures (project_id);
CREATE INDEX IF NOT EXISTS idx_creatures_node_id ON creatures (node_id);
CREATE INDEX IF NOT EXISTS idx_creatures_deleted_at
  ON creatures (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE creatures ENABLE ROW LEVEL SECURITY;

-- RLS: mirror objects EXACTLY — single FOR ALL policy, USING only (no WITH CHECK),
-- with the (select auth.uid()) wrapper form (consolidated objects policy, migration 032).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creatures' AND policyname = 'Users can CRUD own creatures') THEN
    CREATE POLICY "Users can CRUD own creatures" ON creatures
      FOR ALL USING ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Append RPC: atomic JSONB append with URL dedup + soft-delete guard.
-- Mirrors append_object_asset (migration 202) with object→creature substitution
-- and the materials→poses arm rename. 3-param signature (no p_user_id) —
-- ownership is enforced in the backend application layer before the RPC call.
CREATE OR REPLACE FUNCTION public.append_creature_asset(
  p_creature_id uuid,
  p_column      text,
  p_value       jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  CASE p_column
    WHEN 'angles' THEN
      UPDATE creatures SET angles = COALESCE(angles, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(angles, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'poses' THEN
      UPDATE creatures SET poses = COALESCE(poses, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(poses, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'variations' THEN
      UPDATE creatures SET variations = COALESCE(variations, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(variations, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'motion_clips' THEN
      UPDATE creatures SET motion_clips = COALESCE(motion_clips, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(motion_clips, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'sheets' THEN
      UPDATE creatures SET sheets = COALESCE(sheets, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(sheets, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    WHEN 'detail_closeups' THEN
      UPDATE creatures SET detail_closeups = COALESCE(detail_closeups, '[]'::jsonb) || p_value
       WHERE id = p_creature_id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(detail_closeups, '[]'::jsonb)) AS e WHERE e->>'url' = p_value->>'url');
    ELSE
      RAISE EXCEPTION 'invalid column: %', p_column;
  END CASE;
END
$$;

-- Lock down to service_role only (mirror migrations 170/200/202). The RPC is
-- SECURITY DEFINER (bypasses RLS); it must NOT be callable by authenticated via
-- PostgREST or a caller could append into another tenant's creature buckets.
REVOKE EXECUTE ON FUNCTION public.append_creature_asset(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_creature_asset(uuid, text, jsonb) TO service_role;

-- Supabase Realtime enablement. REPLICA IDENTITY FULL forces Postgres to include
-- the full pre-image of unchanged columns (incl. TOAST'd large JSONB) in WAL
-- UPDATE rows, so a worker writing only one bucket still emits an event carrying
-- the others (the Studio merge layer would otherwise drop them as undefined).
-- DO/EXCEPTION wrap mirrors migration 147 for idempotency on re-runs.
ALTER TABLE public.creatures REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.creatures;
    EXCEPTION
        WHEN duplicate_object THEN
            -- Already in the publication — safe to ignore.
            NULL;
    END;
END $$;
