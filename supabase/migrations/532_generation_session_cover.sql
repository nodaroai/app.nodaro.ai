-- A generation session's cover image (decided 2026-10-18): a person picks one
-- of the session's own items to lead its preview; NULL = automatic (the newest
-- completed items, as before).
--
-- The cover is always an item of THIS session, enforced here as well as in the
-- API (PATCH /v1/sessions/:id answers 404 otherwise):
--   * setting it requires a session_items row (session, job) — so it is also the
--     session owner's job (518's item guard);
--   * removing that item from the session, or deleting the job, sends the
--     session back to automatic (the session_items trigger below, and the FK's
--     ON DELETE SET NULL).
--
-- generation_sessions is a small, API-only table (518: RLS on, no client
-- grants), so the ADD COLUMN and its index are cheap. The FK is NOT free on
-- jobs: adding it installs RI triggers there and takes SHARE ROW EXCLUSIVE on
-- jobs for the statement — behind a long transaction on jobs it would wait, and
-- every jobs write would queue behind it. The lock_timeout bounds that wait to
-- a failed (and safely retried: IF NOT EXISTS / OR REPLACE throughout)
-- migration instead of a stalled platform; no rows of jobs are scanned (the new
-- column is all NULL).
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.generation_sessions
  ADD COLUMN IF NOT EXISTS cover_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

-- Serves the FK's ON DELETE SET NULL when a job is deleted.
CREATE INDEX IF NOT EXISTS idx_generation_sessions_cover_job
  ON public.generation_sessions (cover_job_id) WHERE cover_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generation_sessions_cover_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cover_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.session_items i
     WHERE i.session_id = NEW.id AND i.job_id = NEW.cover_job_id
  ) THEN
    RAISE EXCEPTION 'a session''s cover must be one of its items'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_generation_sessions_cover_guard ON public.generation_sessions;
CREATE TRIGGER trg_generation_sessions_cover_guard
  BEFORE INSERT OR UPDATE OF cover_job_id ON public.generation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.generation_sessions_cover_guard();

-- The cover's item left the session: back to automatic. Fires for a removed
-- link and for the CASCADE of a deleted job alike; on a deleted session the
-- UPDATE finds no row.
CREATE OR REPLACE FUNCTION public.session_items_clear_cover()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.generation_sessions
     SET cover_job_id = NULL
   WHERE id = OLD.session_id AND cover_job_id = OLD.job_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_session_items_clear_cover ON public.session_items;
CREATE TRIGGER trg_session_items_clear_cover
  AFTER DELETE ON public.session_items
  FOR EACH ROW EXECUTE FUNCTION public.session_items_clear_cover();

COMMENT ON COLUMN public.generation_sessions.cover_job_id IS
  'The item a person picked to lead the session''s preview; NULL = automatic. Always one of the session''s own items.';
