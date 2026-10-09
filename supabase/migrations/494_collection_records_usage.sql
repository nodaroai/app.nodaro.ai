-- Collection records know whether they were USED (decided 2026-10-08): a
-- publishing queue reads a record from one collection, posts it, and marks it
-- used; the Collections page shows "not used yet" and "used" apart, and a
-- Read Collection node can read only what is left. Who used it is kept in the
-- same shape as who saved it (`source`): via, node, workflow, run.
--
-- Written by the API only (service role; the tables stay closed to clients —
-- the migration-462 posture). Both columns have a default, so a backend from
-- before this migration keeps inserting rows unchanged.

-- A delete on the page, the API or the CLI moves a record to the Trash (`deleted_at`)
-- rather than removing it: the live lists, the nodes, exports and MCP read only
-- records with no `deleted_at`, the page's Trash tab shows the rest, and a
-- restore clears the stamp. A record in the Trash still counts toward the cap
-- and is evicted past it like any other (oldest first).

ALTER TABLE public.collection_records
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The queue's read ("not used yet", newest or oldest first), the page's "used"
-- list and its Trash: one partial index per list, each already in (created_at,
-- id) order, so none needs a sort, and each serves its own count. (`used_at IS
-- NULL` is not an equality, so a plain index on used_at could not keep that order.)
DROP INDEX IF EXISTS public.idx_collection_records_collection_used;
DROP INDEX IF EXISTS public.idx_collection_records_unused;
DROP INDEX IF EXISTS public.idx_collection_records_used;
CREATE INDEX IF NOT EXISTS idx_collection_records_live_unused
  ON public.collection_records (collection_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collection_records_live_used
  ON public.collection_records (collection_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND used_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collection_records_trash
  ON public.collection_records (collection_id, created_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;
-- The live list itself (every record not in the Trash, no usage filter): the most common read.
CREATE INDEX IF NOT EXISTS idx_collection_records_live
  ON public.collection_records (collection_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.collection_records.used_at IS
  'When the record was used (marked by a Save to Collection node, the API or the page); NULL until then.';
COMMENT ON COLUMN public.collection_records.used_by IS
  'Who used it — {via, nodeType, workflowId, executionId, nodeId}, the shape of source; {} until then.';
COMMENT ON COLUMN public.collection_records.deleted_at IS
  'When the record was moved to the Trash (a delete on the page, the API or the CLI); NULL while it is live.';
