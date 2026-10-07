-- Collections: where a workflow's records live (decided 2026-10-05). A
-- collection belongs to one person and holds records — text and links only,
-- never files: a title, a text, a link, the links of its pictures / videos /
-- sounds, a small bag of extra fields, and where the record came from. The
-- "Save to Collection" node writes one record per item, the "Read Collection"
-- node reads what was saved in the last N hours / days, the Collections page
-- browses, searches, deletes and exports.
--
-- Two unique rules the API relies on (both partial — a NULL key is "no rule"):
--   * (collection_id, dedupe_key)       — the same story saved twice is one
--                                          record (the key defaults to the link);
--   * (collection_id, idempotency_key)  — a replayed write (the orchestrator
--                                          re-picking a node) is one record.
-- The index names are distinct on purpose: the API tells the two violations
-- apart by the constraint name in the error.
--
-- Caps (per plan) are enforced by the API, which evicts the OLDEST records past
-- a collection's cap after each write; nothing here enforces a size.
--
-- Personal data. Reached only through the API, which scopes every query to the
-- caller, so both tables are closed to direct client access (RLS on, no client
-- grants) — the migration-446 posture.

CREATE TABLE IF NOT EXISTS public.collections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One name per person, whatever its case ("News" and "news" are one).
CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_user_name
  ON public.collections (user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_collections_user_created
  ON public.collections (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.collection_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dedupe_key       TEXT CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 300),
  idempotency_key  TEXT CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 200),
  title            TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 500),
  text             TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 20000),
  url              TEXT CHECK (url IS NULL OR char_length(url) <= 2000),
  media            JSONB NOT NULL DEFAULT '[]'::jsonb,
  fields           JSONB NOT NULL DEFAULT '{}'::jsonb,
  source           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_records_dedupe
  ON public.collection_records (collection_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_records_idempotency
  ON public.collection_records (collection_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Newest first within a collection (the page, the read node, the export), and
-- the eviction's "oldest past the cap" read the same index backwards.
CREATE INDEX IF NOT EXISTS idx_collection_records_collection_created
  ON public.collection_records (collection_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_collection_records_user_created
  ON public.collection_records (user_id, created_at DESC);

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.collections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.collections TO service_role;

REVOKE ALL ON public.collection_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.collection_records TO service_role;

COMMENT ON TABLE public.collections IS
  'Per-user collections: named sets of records a workflow writes to and reads from.';
COMMENT ON TABLE public.collection_records IS
  'A collection''s records: title, text, link, media links, extra fields, provenance. Text and links only, never files.';
