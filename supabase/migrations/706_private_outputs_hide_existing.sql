-- ============================================================================
-- Switching outputs to private also takes the person's EXISTING items out of
-- the public gallery, in the same action. Switching back to public republishes
-- nothing: what was hidden stays private.
--
-- Four pieces, all re-runnable (CI re-applies the newest migration):
--
-- 1. jobs.hidden_by_owner_at: set on every row the private switch took out of
--    the gallery, and on a row of theirs under an active content restriction
--    that was public when it was restricted. Such a row never turns public
--    again on its own (piece 4), so switching back to public, or an admin
--    lifting the restriction later (the lift restores the visibility the
--    restriction record kept, and that record is immutable by design), does
--    not republish it. Clearing the marker is the one way back, for a future
--    "share this item" action. A nullable column with no default: a metadata
--    change, nothing rewritten.
--
-- 2. remove_jobs_from_gallery(job ids, mark): THE definition of "take out of
--    the gallery" — `is_public = false` on the rows (the job and its file
--    stay, the creator still sees it; only discovery ends) and every pending
--    gallery report on them marked reviewed. The admin single and bulk
--    removals (lib/gallery-removal.ts) and the private switch below all come
--    through it, so they cannot drift. `mark` (the private switch only) also
--    sets hidden_by_owner_at, in the same UPDATE.
--
-- 3. make_outputs_private(user id): sets profiles.public_outputs = false AND
--    hides every public row of that user, in ONE transaction. It either does
--    both or neither, so a person is never told "private" while items stay
--    public, and a retry is safe (a second call hides only what turned public
--    since). One set-based statement per table: an account with thousands of
--    public rows is one UPDATE over the (user_id, ...) indexes, not a loop.
--
-- 4. A clamp on jobs: a row becomes public only if its owner's profile is
--    public AND the row was never hidden by the owner (piece 1). Both media
--    workers read public_outputs when they PICK UP a job and write is_public
--    when it COMPLETES, so a generation in flight at the switch would
--    otherwise land in the gallery minutes later; the clamp also covers every
--    other writer of is_public (plugin workers, a lifted content restriction).
--    It fires only on a transition TO public (the WHEN clauses are evaluated
--    without entering PL/pgSQL), so on the jobs table's normal traffic it
--    costs one boolean test per row.
--
--    What the clamp cannot see: a completion whose trigger ran BEFORE the
--    switch committed read the old, public preference. The settings route
--    therefore calls make_outputs_private a second time once the first has
--    committed (lib/gallery-removal.ts); every completion after that commit
--    reads the committed `false`.
--
-- Service role only: every function is REVOKEd from PUBLIC, anon and
-- authenticated (Supabase grants anon explicitly, so FROM PUBLIC alone is not
-- enough); otherwise anyone could hide anyone's gallery over PostgREST.
--
-- jobs is the busiest table: the ADD COLUMN takes ACCESS EXCLUSIVE, CREATE
-- TRIGGER takes SHARE ROW EXCLUSIVE and a re-apply's DROP TRIGGER ACCESS
-- EXCLUSIVE. Behind a long transaction any of them would wait with every
-- write of jobs queued behind it, so the wait is bounded (536's form): a
-- timeout fails the migration, which is safe to retry (every step is guarded).
-- ============================================================================
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS hidden_by_owner_at timestamptz;
COMMENT ON COLUMN public.jobs.hidden_by_owner_at IS
  'Set when the owner''s switch to private took this row out of the public gallery (or kept a restricted public row from being restored public). While set, the row never turns public (trigger keep_private_owner_jobs_private). Migration 706.';

CREATE OR REPLACE FUNCTION public.remove_jobs_from_gallery(p_job_ids uuid[], p_mark_hidden_by_owner boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer;
BEGIN
  IF p_job_ids IS NULL OR cardinality(p_job_ids) = 0 THEN
    RETURN 0;
  END IF;

  WITH hidden AS (
    UPDATE public.jobs
       SET is_public = false,
           hidden_by_owner_at = CASE
             WHEN p_mark_hidden_by_owner THEN coalesce(hidden_by_owner_at, now())
             ELSE hidden_by_owner_at
           END
     WHERE id = ANY (p_job_ids)
    RETURNING id
  )
  SELECT count(*)::integer INTO v_removed FROM hidden;

  UPDATE public.gallery_reports
     SET status = 'reviewed'
   WHERE job_id = ANY (p_job_ids)
     AND status = 'pending';

  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_jobs_from_gallery(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_jobs_from_gallery(uuid[], boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.make_outputs_private(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_hidden integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'make_outputs_private: name a user' USING ERRCODE = '22023';
  END IF;

  -- The preference first. Once this commits, the clamp below keeps every
  -- later completion of this user's jobs private; the hide that follows takes
  -- everything already public. A completion whose trigger ran before this
  -- commit read the old preference: the route's second call, after the
  -- commit, takes it.
  UPDATE public.profiles SET public_outputs = false WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_outputs_private: no such profile' USING ERRCODE = 'P0002';
  END IF;

  -- Every public row, whatever its status or trash state: nothing is left
  -- behind to resurface later.
  SELECT coalesce(array_agg(j.id), '{}'::uuid[])
    INTO v_ids
    FROM public.jobs j
   WHERE j.user_id = p_user_id
     AND j.is_public IS TRUE;

  v_hidden := public.remove_jobs_from_gallery(v_ids, true);

  -- A row of theirs that is restricted right now is already private, so the
  -- hide above skips it; but if it was public when it was restricted, the
  -- restriction record says so and a later lift would restore it public. The
  -- record itself is immutable (preserve_content_restriction), so the row is
  -- marked instead, and the clamp keeps the lift from republishing it.
  UPDATE public.jobs j
     SET hidden_by_owner_at = now()
   WHERE j.user_id = p_user_id
     AND j.restricted_at IS NOT NULL
     AND j.hidden_by_owner_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.content_restrictions r
        WHERE r.lifted_at IS NULL
          AND j.id = ANY (r.job_ids)
          AND (r.prior -> 'jobs' -> j.id::text ->> 'is_public')::boolean IS TRUE
     );

  RETURN v_hidden;
END;
$$;

REVOKE ALL ON FUNCTION public.make_outputs_private(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.make_outputs_private(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.keep_private_owner_jobs_private()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.hidden_by_owner_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.user_id
       AND p.public_outputs IS FALSE
  ) THEN
    NEW.is_public := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.keep_private_owner_jobs_private() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_keep_private_owner_jobs_private_insert ON public.jobs;
CREATE TRIGGER trg_keep_private_owner_jobs_private_insert
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  WHEN (NEW.is_public IS TRUE AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.keep_private_owner_jobs_private();

DROP TRIGGER IF EXISTS trg_keep_private_owner_jobs_private_update ON public.jobs;
CREATE TRIGGER trg_keep_private_owner_jobs_private_update
  BEFORE UPDATE OF is_public ON public.jobs
  FOR EACH ROW
  WHEN (NEW.is_public IS TRUE AND OLD.is_public IS DISTINCT FROM TRUE AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.keep_private_owner_jobs_private();
