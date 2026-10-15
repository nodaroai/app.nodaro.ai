-- Generation sessions (decided 2026-10-15): a creation tool built on the SDK
-- (tools.nodaro.ai Create Image, later Video and Music) shows
--   Project -> its sessions -> each session's generations
-- the same on every device. Until now a "session" was guessed client-side by
-- grouping jobs by time, and a direct-API job reached no project at all.
--
-- Two tables:
--   * generation_sessions — one row per session. Its project is fixed at birth:
--     there is no "move". To get an item into another project it is imported
--     into a session there, and removed from the old one if unwanted.
--   * session_items       — membership. EVERY item is a row here, the ones born
--     in the session (kind 'native', written by the jobs trigger below) and the
--     ones imported from elsewhere (kind 'imported'). One table, so the feed is
--     one query with one stable order, and "remove from session" is always
--     "delete the link" — it never touches the job or any other session.
--
-- jobs.session_id is the job's immutable "born in": set by the server at insert
-- (lib/insert-job.ts, from the request's validated session) and never changed
-- afterwards, except to NULL when its session is deleted.
--
-- Owner-only, enforced HERE as well as in the API: a session's project must be
-- the session owner's, a job born in a session must be the session owner's, and
-- an item linked into a session must be the session owner's job. A caller can
-- therefore never see another person's work through a session, whatever a
-- route forgets.
--
-- Personal data, reached only through the API, which scopes every query to the
-- caller: RLS on, no client grants (the migration-446 / 462 posture).
--
-- The jobs.session_id index lives in 519, alone: a plain CREATE INDEX on jobs
-- reads the whole heap, and inside this file it would do so while the ADD
-- COLUMN below holds ACCESS EXCLUSIVE on jobs (see 379's header).

CREATE TABLE IF NOT EXISTS public.generation_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Copied from the project at birth (trigger below), else the workspace the
  -- request was made in; NULL = personal. Lists say which side they are on.
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title         TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200),
  tool          TEXT NOT NULL CHECK (tool ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_created
  ON public.generation_sessions (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_generation_sessions_project_created
  ON public.generation_sessions (project_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.session_items (
  session_id                UUID NOT NULL REFERENCES public.generation_sessions(id) ON DELETE CASCADE,
  -- The session owner (= the job owner; the guard below holds all three equal),
  -- so every API query on this table scopes itself by user_id like any other
  -- tenant table, rather than trusting an earlier ownership check.
  user_id                   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- CASCADE, not SET NULL: deleting a job removes it from every session; a
  -- link to nothing would be a ghost card in the feed.
  job_id                    UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind                      TEXT NOT NULL CHECK (kind IN ('native', 'imported')),
  imported_from_session_id  UUID REFERENCES public.generation_sessions(id) ON DELETE SET NULL,
  added_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, job_id),
  CHECK (kind = 'imported' OR imported_from_session_id IS NULL)
);

-- The feed's keyset: (added_at, job_id) within a session, newest first.
CREATE INDEX IF NOT EXISTS idx_session_items_session_added
  ON public.session_items (session_id, added_at DESC, job_id DESC);
-- The CASCADE from a job delete looks links up by job.
CREATE INDEX IF NOT EXISTS idx_session_items_job
  ON public.session_items (job_id);

ALTER TABLE public.generation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.generation_sessions TO service_role;
REVOKE ALL ON public.session_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.session_items TO service_role;

-- A session's project: the owner's own, copied workspace, never changed
-- afterwards except to NULL (the project was deleted). user_id never changes.
CREATE OR REPLACE FUNCTION public.generation_sessions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_workspace uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT user_id, workspace_id INTO v_owner, v_workspace
        FROM public.projects WHERE id = NEW.project_id;
      IF v_owner IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'generation session project must belong to the session owner'
          USING ERRCODE = '42501';
      END IF;
      NEW.workspace_id := v_workspace;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR (NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a generation session''s owner, project and workspace are fixed at creation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_generation_sessions_guard ON public.generation_sessions;
CREATE TRIGGER trg_generation_sessions_guard
  BEFORE INSERT OR UPDATE ON public.generation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.generation_sessions_guard();

-- An item is always the session owner's job. Its arrival is the session's
-- latest activity.
CREATE OR REPLACE FUNCTION public.session_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.generation_sessions s
      JOIN public.jobs j ON j.id = NEW.job_id
     WHERE s.id = NEW.session_id AND j.user_id = s.user_id AND NEW.user_id = s.user_id
  ) THEN
    RAISE EXCEPTION 'a session item must be a job of the session owner, owned by them'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_session_items_guard ON public.session_items;
-- Column-scoped on UPDATE: the FK's own SET NULL on imported_from_session_id
-- must not re-run it. When several of one owner's sessions go in ONE statement
-- (account or workspace deletion), that SET NULL can reach an item whose own
-- session was already deleted in the same statement, and the guard would
-- abort the whole deletion.
CREATE TRIGGER trg_session_items_guard
  BEFORE INSERT OR UPDATE OF session_id, job_id, user_id ON public.session_items
  FOR EACH ROW EXECUTE FUNCTION public.session_items_guard();

CREATE OR REPLACE FUNCTION public.session_items_touch_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.generation_sessions SET updated_at = NOW() WHERE id = NEW.session_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_session_items_touch_session ON public.session_items;
CREATE TRIGGER trg_session_items_touch_session
  AFTER INSERT ON public.session_items
  FOR EACH ROW EXECUTE FUNCTION public.session_items_touch_session();

-- jobs.session_id. Nullable, no default: a metadata-only ADD COLUMN. The FK is
-- added NOT VALID so it scans nothing (every existing row is NULL anyway); new
-- rows are checked.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS session_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_session_id_fkey') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.generation_sessions(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- Born in a session: the native membership row, written in the same statement
-- as the job (the guard above refuses a session that is not the job owner's,
-- which fails the job insert itself).
CREATE OR REPLACE FUNCTION public.jobs_session_native_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.session_items (session_id, user_id, job_id, kind, added_at)
  VALUES (NEW.session_id, NEW.user_id, NEW.id, 'native', NEW.created_at)
  ON CONFLICT (session_id, job_id) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_session_native_item ON public.jobs;
CREATE TRIGGER trg_jobs_session_native_item
  AFTER INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.session_id IS NOT NULL)
  EXECUTE FUNCTION public.jobs_session_native_item();

-- "Born in" is immutable; only the FK's own SET NULL may clear it.
CREATE OR REPLACE FUNCTION public.jobs_session_id_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'jobs.session_id is set at insert and never changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_session_id_immutable ON public.jobs;
CREATE TRIGGER trg_jobs_session_id_immutable
  BEFORE UPDATE OF session_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_session_id_immutable();

-- The session list's per-row summary, for a page of sessions in ONE call:
-- how many items each holds, and its four newest COMPLETED items' output (the
-- API redacts it and keeps image links only). Service role only.
CREATE OR REPLACE FUNCTION public.generation_session_previews(p_session_ids uuid[])
RETURNS TABLE (session_id uuid, item_count bigint, recent jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.id,
         (SELECT count(*) FROM public.session_items i WHERE i.session_id = s.id),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('job_id', t.job_id, 'output_data', t.output_data)
                            ORDER BY t.added_at DESC, t.job_id DESC)
             FROM (
               SELECT i.job_id, i.added_at, j.output_data
                 FROM public.session_items i
                 JOIN public.jobs j ON j.id = i.job_id
                WHERE i.session_id = s.id AND j.status = 'completed'
                ORDER BY i.added_at DESC, i.job_id DESC
                LIMIT 4
             ) t
         ), '[]'::jsonb)
    FROM unnest(p_session_ids) AS s(id)
$$;

REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generation_session_previews(uuid[]) TO service_role;

COMMENT ON TABLE public.generation_sessions IS
  'Per-user creation sessions (Create Image / Video / Music) inside an optional project. Project fixed at birth.';
COMMENT ON TABLE public.session_items IS
  'Session membership: every item, born-in (native) or imported, as a link to the owner''s job. Removing a link never deletes the job.';
COMMENT ON COLUMN public.jobs.session_id IS
  'The generation session this job was born in. Server-set at insert, immutable (NULL when that session is deleted).';
