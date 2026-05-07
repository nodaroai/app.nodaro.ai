-- Soft-delete + admin-expunge support for published_apps.
-- Owner soft-delete is reversible (no purge). Admin expunge is
-- supported separately in code; this migration sets up the schema
-- so expunge can preserve earnings + run records.

-- 1. Soft-delete column.
ALTER TABLE published_apps
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Partial indexes mirroring migration 101's app_runs pattern.
CREATE INDEX IF NOT EXISTS idx_published_apps_active_by_creator
  ON published_apps(creator_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_published_apps_deleted_by_creator
  ON published_apps(creator_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- 3. workflows.published_app_id FK: NO ACTION (default) → SET NULL.
--    The source workflow keeps existing after expunge; only the
--    dangling reference clears.
ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS workflows_published_app_id_fkey,
  ADD CONSTRAINT workflows_published_app_id_fkey
    FOREIGN KEY (published_app_id) REFERENCES published_apps(id) ON DELETE SET NULL;

-- 4. app_earnings.app_id FK: CASCADE → SET NULL, plus snapshot columns.
ALTER TABLE app_earnings
  DROP CONSTRAINT IF EXISTS app_earnings_app_id_fkey,
  ADD CONSTRAINT app_earnings_app_id_fkey
    FOREIGN KEY (app_id) REFERENCES published_apps(id) ON DELETE SET NULL;

ALTER TABLE app_earnings
  ADD COLUMN IF NOT EXISTS app_name_snapshot TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS app_slug_snapshot TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS app_creator_id_snapshot UUID DEFAULT NULL;

-- 5. app_runs.app_id FK: CASCADE → SET NULL, plus snapshot columns.
ALTER TABLE app_runs
  DROP CONSTRAINT IF EXISTS app_runs_app_id_fkey,
  ADD CONSTRAINT app_runs_app_id_fkey
    FOREIGN KEY (app_id) REFERENCES published_apps(id) ON DELETE SET NULL;

ALTER TABLE app_runs
  ADD COLUMN IF NOT EXISTS app_name_snapshot TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS app_slug_snapshot TEXT DEFAULT NULL;

-- 6. RPC: snapshot app fields onto earnings + runs before expunge.
--    Called by the admin expunge endpoint immediately before the
--    parent published_apps DELETE.
CREATE OR REPLACE FUNCTION expunge_app_snapshots(p_app_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_slug TEXT;
  v_creator_id UUID;
BEGIN
  SELECT name, slug, creator_id INTO v_name, v_slug, v_creator_id
  FROM published_apps WHERE id = p_app_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expunge_app_snapshots: app % not found', p_app_id;
  END IF;

  UPDATE app_earnings
  SET app_name_snapshot = v_name,
      app_slug_snapshot = v_slug,
      app_creator_id_snapshot = v_creator_id
  WHERE app_id = p_app_id;

  UPDATE app_runs
  SET app_name_snapshot = v_name,
      app_slug_snapshot = v_slug
  WHERE app_id = p_app_id;
END;
$$;

-- 7. admin_actions table for expunge audit log (and any future admin destructive actions).
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reason TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON admin_actions(target_type, target_id, created_at DESC);

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
-- No user-facing policies: all writes are service-role only.
-- Admins read via the backend API, not direct Supabase access.
