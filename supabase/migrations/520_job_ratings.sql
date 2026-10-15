-- Ratings on generations (decided 2026-10-15): a job's owner marks it good or
-- bad, from any surface (PUT /v1/jobs/:id/rating, the SDK's jobs.rate, the
-- CLI, MCP rate_job), and filters their jobs by it (GET /v1/jobs?rating=
-- good|bad|rated|unrated). Clearing a rating deletes its row.
--
-- One rating per job per person (the unique key), and only the job's OWNER
-- rates it — enforced HERE as well as in the API (the guard trigger below), so
-- a route that forgets the ownership check still cannot write one.
--
-- Shape, on purpose: a surrogate `id` primary key plus UNIQUE (user_id,
-- job_id), like the other per-person marks (gallery_favorites 055,
-- node_preset_favorites 209, competitor_card_actions 450) — NOT a composite
-- primary key of the two foreign keys. PostgREST reads a table whose primary
-- key is made of foreign keys to two tables as a many-to-many junction, so a
-- (user_id, job_id) key would add a second profiles <-> jobs relationship and
-- make every embed between those two tables that names no key ambiguous
-- (PGRST201: the whole select fails).
--
-- The foreign key to jobs is named, because the list filter embeds this table
-- by it (lib/job-list-filters.ts: job_ratings!job_ratings_job_id_fkey).
--
-- Personal data, reached only through the API, which scopes every query to the
-- owner: RLS on, no policies, no client grants (the 446 / 462 / 518 posture).
--
-- Also here, because the jobs list now filters on favorites too: the client
-- write policies of gallery_favorites (055) go — see the end of this file.

CREATE TABLE IF NOT EXISTS public.job_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL,
  rating      TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_ratings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE,
  CONSTRAINT uq_job_ratings_user_job UNIQUE (user_id, job_id)
);

-- The list filters join ratings to jobs by job (the unique key above serves
-- the per-owner reads), and a job delete's CASCADE looks them up the same way.
CREATE INDEX IF NOT EXISTS idx_job_ratings_job ON public.job_ratings (job_id);

ALTER TABLE public.job_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_ratings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_ratings TO service_role;

-- Only the job's owner rates it.
CREATE OR REPLACE FUNCTION public.job_ratings_owner_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'a job is rated by its owner only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_job_ratings_owner_guard ON public.job_ratings;
CREATE TRIGGER trg_job_ratings_owner_guard
  BEFORE INSERT OR UPDATE OF user_id, job_id ON public.job_ratings
  FOR EACH ROW EXECUTE FUNCTION public.job_ratings_owner_guard();

DROP TRIGGER IF EXISTS trg_job_ratings_updated_at ON public.job_ratings;
CREATE TRIGGER trg_job_ratings_updated_at
  BEFORE UPDATE ON public.job_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.job_ratings IS
  'A job owner''s rating of their job (good / bad). One per job, owner only; clearing a rating deletes its row.';

-- gallery_favorites (055): the API is its only writer. 055's client policies
-- let any signed-in user insert a favorite for ANY job id straight through
-- PostgREST — past the rule POST /v1/gallery/favorite and MCP favorite_asset
-- apply (your own job, or a public completed one) — and so learn which job ids
-- exist (a foreign-key error, or a row). Nothing writes the table from a client
-- (the web app and every other surface go through the API), so the write
-- policies go and the API roles lose the write privileges, as 480 did for the
-- asset tables. Reading your own favorites is unchanged.
DROP POLICY IF EXISTS "Users can insert own favorites" ON public.gallery_favorites;
DROP POLICY IF EXISTS "Users can delete own favorites" ON public.gallery_favorites;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gallery_favorites FROM anon, authenticated;
