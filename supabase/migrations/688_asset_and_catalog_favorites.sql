-- 688: favorites for everything a person keeps.
--
-- Two per-user favorite tables, beside the ones that already exist
-- (gallery_favorites 055 for generations, node_preset_favorites 209,
-- voice_favorites 608):
--
--   asset_favorites    a file in the person's library that is not a generation:
--                      an upload has no job, so it could not be starred through
--                      gallery_favorites. A library file a job made keeps its
--                      star on that job (gallery_favorites), so uploads and
--                      generations read back as one favorites list.
--   catalog_favorites  an option of a picker catalog (a style, a mood, a camera
--                      move, a music genre, a Person setting, a shot shape, ...),
--                      keyed by the catalog's own id and the option's id. The
--                      catalogs are code, not rows, so there is no FK: the API
--                      validates both ids against the served catalogs.
--
-- Service-role only, like voice_favorites (608), saved_posts (446) and
-- collections (462): the API routes (backend/src/routes/favorites*.ts and
-- POST /v1/library/:id/favorite) are the one way in, each scoped to the
-- caller. No client role holds a privilege on either table, so RLS is on with
-- no policies and a browser cannot reach the rows through PostgREST.
-- supabase/tests/asset-catalog-favorites.behavior.sql proves it as the roles.
--
-- A deploy of dev runs ahead of this migration (it lands with the release to
-- main): until the tables exist the API treats them as absent — a library read
-- reports an upload as not favorited, the library's `favorited` filter (which
-- reads the functions below) and a write answer 503 not_available, and the
-- combined favorites read leaves the two kinds out (lib/favorites-tables.ts).
--
-- Re-runnable: IF NOT EXISTS for the tables, CREATE OR REPLACE for the
-- functions, DROP TRIGGER IF EXISTS before the trigger; the REVOKE/GRANT pairs
-- are idempotent.
-- Both tables are new, so the only lock taken on an existing table is the
-- FK's SHARE ROW EXCLUSIVE on assets / profiles; the lock_timeout bounds that
-- wait to a failed, safely retried migration instead of a stalled platform.
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.asset_favorites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The file goes, its star goes with it.
  asset_id   UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);

-- The reads: a person's favorites newest first (the combined list), and the
-- library's "which of these files are starred" lookup (the UNIQUE index above).
CREATE INDEX IF NOT EXISTS idx_asset_favorites_user_created
  ON public.asset_favorites (user_id, created_at DESC, id DESC);
-- The FK's own index: a deleted asset finds its stars without a scan.
CREATE INDEX IF NOT EXISTS idx_asset_favorites_asset
  ON public.asset_favorites (asset_id);

ALTER TABLE public.asset_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.asset_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.asset_favorites TO service_role;

COMMENT ON TABLE public.asset_favorites IS
  'Per-user favorite library files that no job made (uploads). A file a job made is starred on its job (gallery_favorites). Service-role only: written through POST /v1/library/:id/favorite.';

CREATE TABLE IF NOT EXISTS public.catalog_favorites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The catalog's own id as the API serves it (a picker catalog's catalogId,
  -- or "shot-shapes" / "style-presets").
  catalog    TEXT NOT NULL CHECK (char_length(catalog) BETWEEN 1 AND 64),
  -- The option's id; a dimension option of a multi-field catalog is
  -- "<field>:<id>". No FK: an option a catalog later drops stays harmless.
  option_id  TEXT NOT NULL CHECK (char_length(option_id) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, catalog, option_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_favorites_user_created
  ON public.catalog_favorites (user_id, created_at DESC, id DESC);

ALTER TABLE public.catalog_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.catalog_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.catalog_favorites TO service_role;

COMMENT ON TABLE public.catalog_favorites IS
  'Per-user favorite picker options (a style, a mood, a camera move, a music genre, ...), keyed by catalog id and option id. Service-role only: written through /v1/favorites/catalog.';

-- ── The library's favorites predicate, in the database ─────────────────────
--
-- A library file is a favorite of a person when EITHER their own star on the
-- file (asset_favorites) OR their favorite of the job that made it
-- (gallery_favorites, 055) says so. A job's favorite counts only while the job
-- is out of the Trash (jobs.deleted_at IS NULL): the Trash hides a job from
-- every favorites list (GET /v1/favorites, GET /v1/gallery/favorites), so the
-- library reads its star the same way; restoring the job brings it back.
--
-- The API used to read every favorite id of the person and send them back in
-- the request line (`id=in.(…)`), which outgrew the gateway's URL limit at a
-- few hundred favorites. These functions keep the predicate here, so a request
-- names only the person.
--
-- SECURITY INVOKER, service-role only, like the tables they read: the API is
-- the one caller and scopes every call to the signed-in person. No SET
-- search_path, on purpose: a SQL function with a SET clause is never inlined,
-- and library_assets_by_favorite must be inlined so the listing's own filters
-- (owner, type, search, cursor, order, limit) reach the scan of `assets`.
-- Every name is schema-qualified instead.

CREATE OR REPLACE FUNCTION public.library_file_is_favorite(p_user_id UUID, p_asset_id UUID, p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.asset_favorites f
           WHERE f.user_id = p_user_id AND f.asset_id = p_asset_id
         )
      OR (p_job_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.gallery_favorites g
           JOIN public.jobs j ON j.id = g.job_id
           WHERE g.user_id = p_user_id AND g.job_id = p_job_id AND j.deleted_at IS NULL
         ))
$$;

-- The rows of `assets` the person may list (their own, or a shared library
-- item: a superset of both library views, so the scan is bounded even where
-- the planner does not inline) that are (`p_favorited` true) or are not
-- (false) their favorites. GET /v1/library?favorited= reads through it and
-- applies every other filter of the listing on top, as on the table itself.
CREATE OR REPLACE FUNCTION public.library_assets_by_favorite(p_user_id UUID, p_favorited BOOLEAN)
RETURNS SETOF public.assets
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT a.*
  FROM public.assets a
  WHERE (a.user_id = p_user_id OR a.is_library_item IS TRUE)
    AND public.library_file_is_favorite(p_user_id, a.id, a.job_id) = p_favorited
$$;

-- Which of these files (one listed page) are the person's favorites: the flag
-- on each listed file, by the same predicate as the filter.
CREATE OR REPLACE FUNCTION public.library_favorite_asset_ids(p_user_id UUID, p_asset_ids UUID[])
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT a.id
  FROM public.assets a
  WHERE a.id = ANY (p_asset_ids)
    AND public.library_file_is_favorite(p_user_id, a.id, a.job_id)
$$;

REVOKE ALL ON FUNCTION public.library_file_is_favorite(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.library_assets_by_favorite(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.library_favorite_asset_ids(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.library_file_is_favorite(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.library_assets_by_favorite(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.library_favorite_asset_ids(UUID, UUID[]) TO service_role;

-- ── At most 1000 favorite picker options per person ────────────────────────
--
-- Enough for any real use; a stop against a runaway client. Enforced here so
-- two stars at once cannot both pass a count read in the API: the insert takes
-- a per-person transaction lock, then counts. A star already there is let
-- through (the unique constraint, or the API's ON CONFLICT DO NOTHING, answers
-- it), so starring it again at the cap still succeeds. Over the cap the insert
-- fails with check_violation and the message `catalog_favorites_per_user_cap`,
-- which the API answers as 409 limit_reached. The number is
-- MAX_CATALOG_FAVORITES_PER_USER in backend/src/lib/catalog-favorites.ts.
CREATE OR REPLACE FUNCTION public.catalog_favorites_enforce_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Two-key form: its own lock space, apart from single-key advisory locks.
  PERFORM pg_catalog.pg_advisory_xact_lock(688, pg_catalog.hashtext(NEW.user_id::text));
  IF EXISTS (
    SELECT 1 FROM public.catalog_favorites c
    WHERE c.user_id = NEW.user_id AND c.catalog = NEW.catalog AND c.option_id = NEW.option_id
  ) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.catalog_favorites c WHERE c.user_id = NEW.user_id) >= 1000 THEN
    RAISE EXCEPTION 'catalog_favorites_per_user_cap'
      USING ERRCODE = 'check_violation',
            HINT = 'A person keeps at most 1000 favorite picker options.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_favorites_enforce_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS catalog_favorites_cap ON public.catalog_favorites;
CREATE TRIGGER catalog_favorites_cap
  BEFORE INSERT ON public.catalog_favorites
  FOR EACH ROW EXECUTE FUNCTION public.catalog_favorites_enforce_cap();
