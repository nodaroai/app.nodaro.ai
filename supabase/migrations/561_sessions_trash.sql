-- The Trash for generation sessions and jobs (decided 2026-10-25), for every
-- creation tool that uses sessions (Create Image / Video / Music, and the next).
--
--   * Removing an item from a session no longer deletes its link: it stamps
--     `session_items.removed_at`. The removed link sits in the Trash until it is
--     restored or deleted for good — no automatic cleanup. The job is untouched.
--   * Deleting a job no longer deletes the row: it stamps `jobs.deleted_at`. The
--     job is hidden from every read, stays restorable for 30 days, and is then
--     purged for good (media included) by the API's scheduled sweep through
--     `delete_trashed_job_with_recast_cleanup` below. Its session links stay
--     while it is in the Trash (the CASCADE fires only on the purge), so a
--     restored job is back exactly where it was.
--   * Moving items between sessions is one transaction (`move_session_items`):
--     the target gains a live link, the source keeps a removed one, so a move is
--     undone from the source's Trash. A target session in another project is how
--     an item moves to another project; a session's own project stays fixed.
--
-- "Live" therefore means BOTH: a link with no `removed_at` to a job with no
-- `deleted_at`. Everything that counts or shows a session's items (the
-- previews, the cover) is restated here on live links only. A removed link
-- whose job is also deleted is shown once in the Trash, as the deleted job.
-- Deleting a SESSION still cascades all its links, removed ones included: they
-- leave the Trash with it (the jobs stay, as before).
--
-- The API hides a deleted job from every read it serves; the browser's own
-- read path (RLS, migration 032's "Users can read own jobs", used by Realtime)
-- gets the same rule here as a RESTRICTIVE policy: a deleted job is nobody's
-- to read but an admin's — before this migration a deleted job was simply
-- gone, and someone else's public one must not linger readable for 30 days.
-- The session tables stay service-role only (518), and 347's column grant to
-- `authenticated` on jobs does not name `deleted_at`. Every new function is
-- service-role only.
--
-- Lock order: jobs first (the ADD COLUMN takes ACCESS EXCLUSIVE), then
-- session_items. A job inserted in a session takes the same two in the same
-- order (the native-item trigger), so the two never deadlock. Every statement
-- on jobs is metadata-only and bounded by the lock_timeout (532's reasoning);
-- the jobs index lives in 562, alone (379's header). Safe to re-run.
SET LOCAL lock_timeout = '2s';

-- ------------------------------------------------------------------- jobs

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN public.jobs.deleted_at IS
  'When the job was deleted (it is in the Trash, hidden from every read); NULL = live. Purged for good 30 days later.';

DROP POLICY IF EXISTS "A deleted job is hidden" ON public.jobs;
CREATE POLICY "A deleted job is hidden" ON public.jobs
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL OR (SELECT public.is_admin()));

-- Deleting the cover's job sends its sessions back to automatic, as the hard
-- delete did (the FK's ON DELETE SET NULL): a cover never names a deleted job.
CREATE OR REPLACE FUNCTION public.jobs_trash_clear_cover()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.generation_sessions SET cover_job_id = NULL WHERE cover_job_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_trash_clear_cover ON public.jobs;
CREATE TRIGGER trg_jobs_trash_clear_cover
  AFTER UPDATE OF deleted_at ON public.jobs
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION public.jobs_trash_clear_cover();

-- ---------------------------------------------------------- session_items

ALTER TABLE public.session_items ADD COLUMN IF NOT EXISTS removed_at timestamptz;
COMMENT ON COLUMN public.session_items.removed_at IS
  'When the item was removed from the session (it is in the Trash); NULL = live. A move leaves the source link removed.';

-- The Trash listing's removed half, newest first per owner. (The live reads
-- keep using 518's indexes: the removed rows they skip are few.)
CREATE INDEX IF NOT EXISTS idx_session_items_removed
  ON public.session_items (user_id, removed_at DESC) WHERE removed_at IS NOT NULL;

-- A cover is a LIVE item: a removed link, or a job in the Trash, is refused.
-- The link and the job are locked FOR SHARE, so a remove or a delete running
-- at the same moment waits for this write (or this one sees it) — a cover can
-- never be committed beside the removal of its own item.
CREATE OR REPLACE FUNCTION public.generation_sessions_cover_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cover_job_id IS NOT NULL THEN
    PERFORM 1 FROM public.session_items i
      JOIN public.jobs j ON j.id = i.job_id
     WHERE i.session_id = NEW.id AND i.job_id = NEW.cover_job_id
       AND i.removed_at IS NULL AND j.deleted_at IS NULL
       FOR SHARE OF i, j;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a session''s cover must be one of its items'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Removing the cover's item sends the session back to automatic, as deleting
-- the link did (532's AFTER DELETE trigger stays for a delete for good). The
-- same function: it reads OLD.session_id / OLD.job_id, which an UPDATE has.
DROP TRIGGER IF EXISTS trg_session_items_clear_cover_on_remove ON public.session_items;
CREATE TRIGGER trg_session_items_clear_cover_on_remove
  AFTER UPDATE OF removed_at ON public.session_items
  FOR EACH ROW WHEN (NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL)
  EXECUTE FUNCTION public.session_items_clear_cover();

-- An item coming back (restored, re-imported, moved back) is the session's
-- latest activity, like an item arriving (518's AFTER INSERT trigger).
DROP TRIGGER IF EXISTS trg_session_items_touch_session_on_revive ON public.session_items;
CREATE TRIGGER trg_session_items_touch_session_on_revive
  AFTER UPDATE OF removed_at ON public.session_items
  FOR EACH ROW WHEN (NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL)
  EXECUTE FUNCTION public.session_items_touch_session();

-- --------------------------------------------------------------- previews

-- The session list's summary on live items only, plus how many of its items
-- are in the Trash (`removed_count`: removed links of live jobs — a deleted
-- job is counted by the Trash as a deleted job, never twice). A new return
-- column, so the function is dropped and created again (same argument list;
-- the API reads its columns by name).
DROP FUNCTION IF EXISTS public.generation_session_previews(uuid[]);
CREATE OR REPLACE FUNCTION public.generation_session_previews(p_session_ids uuid[])
RETURNS TABLE (session_id uuid, item_count bigint, recent jsonb, removed_count bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.id,
         (SELECT count(*) FROM public.session_items i
            JOIN public.jobs j ON j.id = i.job_id
           WHERE i.session_id = s.id AND i.removed_at IS NULL AND j.deleted_at IS NULL),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('job_id', t.job_id, 'output_data', t.output_data)
                            ORDER BY t.added_at DESC, t.job_id DESC)
             FROM (
               SELECT i.job_id, i.added_at, j.output_data
                 FROM public.session_items i
                 JOIN public.jobs j ON j.id = i.job_id
                WHERE i.session_id = s.id AND i.removed_at IS NULL
                  AND j.deleted_at IS NULL AND j.status = 'completed'
                ORDER BY i.added_at DESC, i.job_id DESC
                LIMIT 4
             ) t
         ), '[]'::jsonb),
         (SELECT count(*) FROM public.session_items i
            JOIN public.jobs j ON j.id = i.job_id
           WHERE i.session_id = s.id AND i.removed_at IS NOT NULL AND j.deleted_at IS NULL)
    FROM unnest(p_session_ids) AS s(id)
$$;

REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.generation_session_previews(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generation_session_previews(uuid[]) TO service_role;

-- ------------------------------------------------------------------ move

-- Move some of the owner's items from one session to another, all or nothing
-- (at most 100 a call). Every job must be a LIVE item of the source and the
-- owner's own live, non-child job; both sessions the owner's, on the request's
-- side of the workspace line (p_workspace_id NULL = personal). Anything else
-- changes nothing and answers an error code the API maps to 404 / 400:
--   {"error": "same_session" | "session_not_found" | "item_not_found" | "too_many"}
-- Otherwise: the target gets a live link (a new one is `native` when the job
-- was born there, else `imported` from the source; a removed one is revived
-- where it was — its kind, origin and position kept), the source link is
-- removed (in its Trash, so the move can be undone), and the answer is
-- {"moved": n}. A trigger refusing any row aborts the whole statement. The
-- source links are locked in job order, so two moves of the same items never
-- deadlock on each other's source.
CREATE OR REPLACE FUNCTION public.move_session_items(
  p_user_id uuid,
  p_workspace_id uuid,
  p_target_session_id uuid,
  p_from_session_id uuid,
  p_job_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_sessions int;
  v_items int;
BEGIN
  IF p_target_session_id IS NULL OR p_from_session_id IS NULL OR p_job_ids IS NULL
     OR array_position(p_job_ids, NULL) IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'item_not_found');
  END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids FROM unnest(p_job_ids) AS x;
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('error', 'item_not_found');
  END IF;
  IF cardinality(v_ids) > 100 THEN
    RETURN jsonb_build_object('error', 'too_many');
  END IF;
  IF p_target_session_id = p_from_session_id THEN
    RETURN jsonb_build_object('error', 'same_session');
  END IF;

  SELECT count(*) INTO v_sessions
    FROM public.generation_sessions s
   WHERE s.id IN (p_target_session_id, p_from_session_id)
     AND s.user_id = p_user_id
     AND s.workspace_id IS NOT DISTINCT FROM p_workspace_id;
  IF v_sessions <> 2 THEN
    RETURN jsonb_build_object('error', 'session_not_found');
  END IF;

  -- The source links, locked: a concurrent remove / move of the same items
  -- waits, and then finds them no longer live.
  SELECT count(*) INTO v_items FROM (
    SELECT i.job_id
      FROM public.session_items i
      JOIN public.jobs j ON j.id = i.job_id
     WHERE i.session_id = p_from_session_id
       AND i.user_id = p_user_id
       AND i.job_id = ANY (v_ids)
       AND i.removed_at IS NULL
       AND j.user_id = p_user_id
       AND j.deleted_at IS NULL
       AND j.parent_job_id IS NULL
     ORDER BY i.job_id
       FOR UPDATE OF i
  ) AS live;
  IF v_items <> cardinality(v_ids) THEN
    RETURN jsonb_build_object('error', 'item_not_found');
  END IF;

  INSERT INTO public.session_items (session_id, user_id, job_id, kind, imported_from_session_id)
  SELECT p_target_session_id, p_user_id, j.id,
         CASE WHEN j.session_id = p_target_session_id THEN 'native' ELSE 'imported' END,
         CASE WHEN j.session_id = p_target_session_id THEN NULL ELSE p_from_session_id END
    FROM public.jobs j
   WHERE j.id = ANY (v_ids)
   ORDER BY j.id
  ON CONFLICT (session_id, job_id) DO UPDATE
     SET removed_at = NULL
   WHERE public.session_items.removed_at IS NOT NULL;

  UPDATE public.session_items
     SET removed_at = now()
   WHERE session_id = p_from_session_id
     AND user_id = p_user_id
     AND job_id = ANY (v_ids)
     AND removed_at IS NULL;

  RETURN jsonb_build_object('moved', cardinality(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.move_session_items(uuid, uuid, uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_session_items(uuid, uuid, uuid, uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.move_session_items(uuid, uuid, uuid, uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.move_session_items(uuid, uuid, uuid, uuid, uuid[]) TO service_role;

-- ------------------------------------------------------------- the Trash

-- One newest-first page of the owner's Trash, on the request's side of the
-- workspace line: the links removed from sessions (`removed`, at removed_at,
-- with their session) and the deleted jobs (`deleted`, at deleted_at). Child
-- jobs, and the inner jobs of a component or use-case run, are never listed
-- (they are shown only through what started them).
--
-- Scope, all optional and combined with AND:
--   p_tool        removed: its session's tool. deleted: the tool of a session
--                 that holds or held it (any link, or the session it was born
--                 in) — a job no session ever held has no tool.
--   p_project_id  removed: its session is in that project. deleted: a live
--                 link to a session of that project.
--   p_no_project  removed: its session has no project. deleted: no live link
--                 to a session that has one (in General, or only in
--                 project-less sessions).
--   p_types       the job's `input_data.type` is one of them (NULL = any).
-- Keyset: (at DESC, sort_key DESC), strictly after (p_before_at, p_before_key)
-- — both given or neither. sort_key compares bytewise (COLLATE "C").
CREATE OR REPLACE FUNCTION public.list_trash(
  p_user_id uuid,
  p_workspace_id uuid,
  p_tool text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_no_project boolean DEFAULT false,
  p_types text[] DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL,
  p_before_key text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (kind text, at timestamptz, job_id uuid, session_id uuid, sort_key text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF (p_before_at IS NULL) <> (p_before_key IS NULL) THEN
    RAISE EXCEPTION 'list_trash: p_before_at and p_before_key go together'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT t.kind, t.at, t.job_id, t.session_id, t.sort_key
    FROM (
      SELECT 'removed'::text AS kind, i.removed_at AS at, i.job_id, i.session_id,
             ('r:' || i.session_id::text || ':' || i.job_id::text) COLLATE "C" AS sort_key
        FROM public.session_items i
        JOIN public.generation_sessions s ON s.id = i.session_id
        JOIN public.jobs j ON j.id = i.job_id
       WHERE i.user_id = p_user_id
         AND i.removed_at IS NOT NULL
         AND (p_before_at IS NULL OR i.removed_at <= p_before_at)
         AND s.user_id = p_user_id
         AND s.workspace_id IS NOT DISTINCT FROM p_workspace_id
         AND j.user_id = p_user_id
         AND j.deleted_at IS NULL
         AND j.parent_job_id IS NULL
         AND (p_tool IS NULL OR s.tool = p_tool)
         AND (p_project_id IS NULL OR s.project_id = p_project_id)
         AND (NOT coalesce(p_no_project, false) OR s.project_id IS NULL)
         AND (p_types IS NULL OR (j.input_data ->> 'type') = ANY (p_types))
      UNION ALL
      SELECT 'deleted'::text, j.deleted_at, j.id, NULL::uuid,
             ('d:' || j.id::text) COLLATE "C"
        FROM public.jobs j
       WHERE j.user_id = p_user_id
         AND j.deleted_at IS NOT NULL
         AND (p_before_at IS NULL OR j.deleted_at <= p_before_at)
         AND j.workspace_id IS NOT DISTINCT FROM p_workspace_id
         AND j.parent_job_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.workflow_executions e
            WHERE e.id = j.workflow_execution_id
              AND (e.is_component_execution IS TRUE OR e.trigger_type = 'use_case')
         )
         AND (p_types IS NULL OR (j.input_data ->> 'type') = ANY (p_types))
         AND (p_tool IS NULL
              OR EXISTS (
                SELECT 1 FROM public.session_items i
                  JOIN public.generation_sessions s ON s.id = i.session_id
                 WHERE i.job_id = j.id AND s.tool = p_tool)
              OR EXISTS (
                SELECT 1 FROM public.generation_sessions s
                 WHERE s.id = j.session_id AND s.tool = p_tool))
         AND (p_project_id IS NULL OR EXISTS (
                SELECT 1 FROM public.session_items i
                  JOIN public.generation_sessions s ON s.id = i.session_id
                 WHERE i.job_id = j.id AND i.removed_at IS NULL AND s.project_id = p_project_id))
         AND (NOT coalesce(p_no_project, false) OR NOT EXISTS (
                SELECT 1 FROM public.session_items i
                  JOIN public.generation_sessions s ON s.id = i.session_id
                 WHERE i.job_id = j.id AND i.removed_at IS NULL AND s.project_id IS NOT NULL))
    ) AS t
   WHERE p_before_at IS NULL
      OR t.at < p_before_at
      OR (t.at = p_before_at AND t.sort_key < (p_before_key COLLATE "C"))
   ORDER BY t.at DESC, t.sort_key DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer) TO service_role;

-- ------------------------------------------------------- delete for good

-- The job delete (334's `delete_job_with_recast_cleanup`: the job, its child
-- jobs and their private media manifest), but only for a job in the Trash
-- since before `p_trashed_before`, re-checked under the row lock: a job
-- restored meanwhile is never purged. Used by "delete forever"
-- (`p_trashed_before` = 'infinity': any job in the Trash) and by the 30-day
-- purge (p_is_admin, p_trashed_before = now - 30 days). Same answer shape:
-- {"deleted": bool, "baseUrls": [...]}.
CREATE OR REPLACE FUNCTION public.delete_trashed_job_with_recast_cleanup(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_is_admin boolean,
  p_trashed_before timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
     FROM public.jobs
    WHERE id = p_job_id
      AND (p_is_admin OR user_id = p_actor_user_id)
      AND deleted_at IS NOT NULL
      AND deleted_at < p_trashed_before
      FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', '[]'::jsonb);
  END IF;
  RETURN public.delete_job_with_recast_cleanup(p_job_id, p_actor_user_id, p_is_admin);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz) TO service_role;
