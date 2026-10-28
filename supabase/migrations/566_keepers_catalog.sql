-- Nodaro Keepers: a shared catalog of characters, creatures, locations and
-- objects (decided 2026-10-28). An admin marks some of their OWN rows as part
-- of the catalog; every signed-in user (and a guest, read-only) browses it
-- through GET /v1/keepers/catalog, and "using" one copies it into the user's
-- own account (POST /v1/keepers/catalog/:kind/:id/copy) — a row of their own,
-- editable in Studio. The original is never changed; a later change to it
-- does not reach the copies; taking it out of the catalog removes no copy.
--
--   * `catalog`           — the row is on the shelf (admin-set, default off).
--   * `catalog_sort`      — the shelf order, lowest first; NOT NULL DEFAULT 0 so
--                           the listing's order (sort, created_at DESC, id DESC)
--                           is total and a keyset cursor can land in it.
--   * `catalog_category`  — an optional shelf heading ("Heroes", "Pets", …).
--   * `catalog_source_id` — on a COPY: the catalog row it was copied from. One
--                           copy per (user, source): the unique index below is
--                           the lock, so a double tap or a replayed request
--                           returns the same copy instead of making a second.
--                           It spans archived copies too — a user who archived
--                           a copy and copies again gets that copy back
--                           (un-archived), never a second row the restore
--                           route would then collide with.
--
-- No RLS change: the API reads the catalog through the service role and
-- hands out display fields only (no user ids, no prompts, no reference
-- photos); the browser's own policies on these tables are untouched. The
-- tables are small (one row per saved item), so the columns and the partial
-- index ride in one file. Safe to re-run.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS catalog BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sort INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_category TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source_id UUID;
ALTER TABLE public.creatures
  ADD COLUMN IF NOT EXISTS catalog BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sort INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_category TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source_id UUID;
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS catalog BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sort INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_category TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source_id UUID;
ALTER TABLE public.objects
  ADD COLUMN IF NOT EXISTS catalog BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sort INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_category TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source_id UUID;

COMMENT ON COLUMN public.characters.catalog IS 'On the shared Nodaro Keepers shelf (admin-set). Read by GET /v1/keepers/catalog.';
COMMENT ON COLUMN public.characters.catalog_source_id IS 'On a copy: the catalog row it was copied from. One copy per (user, source).';
COMMENT ON COLUMN public.creatures.catalog IS 'On the shared Nodaro Keepers shelf (admin-set). Read by GET /v1/keepers/catalog.';
COMMENT ON COLUMN public.creatures.catalog_source_id IS 'On a copy: the catalog row it was copied from. One copy per (user, source).';
COMMENT ON COLUMN public.locations.catalog IS 'On the shared Nodaro Keepers shelf (admin-set). Read by GET /v1/keepers/catalog.';
COMMENT ON COLUMN public.locations.catalog_source_id IS 'On a copy: the catalog row it was copied from. One copy per (user, source).';
COMMENT ON COLUMN public.objects.catalog IS 'On the shared Nodaro Keepers shelf (admin-set). Read by GET /v1/keepers/catalog.';
COMMENT ON COLUMN public.objects.catalog_source_id IS 'On a copy: the catalog row it was copied from. One copy per (user, source).';

-- The shelf listing: only catalog rows, in shelf order. Partial, so it stays
-- as small as the shelf.
CREATE INDEX IF NOT EXISTS idx_characters_catalog
  ON public.characters (catalog_sort, created_at DESC, id DESC) WHERE catalog AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_creatures_catalog
  ON public.creatures (catalog_sort, created_at DESC, id DESC) WHERE catalog AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_locations_catalog
  ON public.locations (catalog_sort, created_at DESC, id DESC) WHERE catalog AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_objects_catalog
  ON public.objects (catalog_sort, created_at DESC, id DESC) WHERE catalog AND deleted_at IS NULL;

-- One copy per (user, source) — archived copies included (see the header).
CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_catalog_copy
  ON public.characters (user_id, catalog_source_id) WHERE catalog_source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_creatures_catalog_copy
  ON public.creatures (user_id, catalog_source_id) WHERE catalog_source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_catalog_copy
  ON public.locations (user_id, catalog_source_id) WHERE catalog_source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_objects_catalog_copy
  ON public.objects (user_id, catalog_source_id) WHERE catalog_source_id IS NOT NULL;
