-- 708 — A delete for good settles the stored-file records of the jobs it takes
-- (decided 2026-11-25).
--
-- `jobs.server_output.stored` (migration 695) records, per job, each file a
-- video store kept beside its playable copy and the bytes its owner was charged
-- for it. Every path that deletes such a file claims it off that record
-- (`claim_job_stored_objects`) and gives back exactly what the claim answered.
-- A job deleted for good destroys its record, so a later claim answers nothing
-- and the charge would stay for good.
--
-- So each delete function below now reads the records of every job it deletes,
-- under the row lock, in the same transaction as the delete, and answers the
-- bytes per owner as `storedBytesByOwner` ({ <user id>: <bytes> }, beside what
-- it answered before). The caller gives those back only when `deleted` is
-- true: a delete the database refuses (a trigger, an error) rolls back with
-- the record intact and answers nothing. The files themselves stay, as a job
-- delete has always left a job's files.
--
-- Each body is its latest definition (migration 334) with only that added:
-- the deleted jobs' ids gathered first (the same cascade the delete takes:
-- the workflows' jobs, or the job, and their child jobs by `parent_job_id`),
-- their rows locked in id order, their records summed per owner, and the
-- field in the answer. Same signatures, so the grants stand; they are stated
-- again for the record. `delete_trashed_job_with_recast_cleanup` (migration
-- 561) answers whatever `delete_job_with_recast_cleanup` answers, so it carries
-- the field unchanged.
SET LOCAL lock_timeout = '2s';

-- The bytes each owner was charged for what `p_job_ids` recorded as stored,
-- read under the row lock (a concurrent claim either finished first, and its
-- keys are gone from the record, or waits for this transaction).
CREATE OR REPLACE FUNCTION public.stored_bytes_by_owner(p_job_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id = ANY(p_job_ids) ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_object_agg(owner_id, bytes), '{}'::jsonb)
  INTO v_result
  FROM (
    SELECT j.user_id::text AS owner_id, sum(greatest(coalesce((e.value #>> '{}')::numeric, 0), 0))::bigint AS bytes
    FROM public.jobs AS j
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(j.server_output -> 'stored') = 'object' THEN j.server_output -> 'stored' ELSE '{}'::jsonb END
    ) AS e
    WHERE j.id = ANY(p_job_ids)
      AND j.user_id IS NOT NULL
      AND jsonb_typeof(e.value) = 'number'
    GROUP BY j.user_id
  ) AS per_owner
  WHERE bytes > 0;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stored_bytes_by_owner(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stored_bytes_by_owner(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.stored_bytes_by_owner(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.stored_bytes_by_owner(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_workflow_with_recast_cleanup(
  p_workflow_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workflow_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
  v_job_ids uuid[];
  v_stored jsonb;
BEGIN
  SELECT id INTO v_workflow_id
  FROM public.workflows
  WHERE id = p_workflow_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN public.jobs AS gvp_job ON gvp_job.id = private_base.gvp_job_id
    WHERE gvp_job.workflow_id = p_workflow_id
      AND gvp_job.user_id = p_user_id
      AND private_base.user_id = p_user_id
  ) AS owned_bases;

  -- The jobs the delete cascades away: the workflow's (any member's) and their child jobs.
  v_job_ids := ARRAY(
    WITH RECURSIVE deleting_jobs(id) AS (
      SELECT j.id FROM public.jobs AS j WHERE j.workflow_id = v_workflow_id
      UNION
      SELECT child.id
      FROM public.jobs AS child
      JOIN deleting_jobs ON child.parent_job_id = deleting_jobs.id
    )
    SELECT id FROM deleting_jobs
  );
  v_stored := public.stored_bytes_by_owner(v_job_ids);

  DELETE FROM public.workflows
  WHERE id = v_workflow_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls, 'storedBytesByOwner', v_stored);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_with_recast_cleanup(
  p_project_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
  v_job_ids uuid[];
  v_stored jsonb;
BEGIN
  SELECT id INTO v_project_id
  FROM public.projects
  WHERE id = p_project_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN public.jobs AS gvp_job ON gvp_job.id = private_base.gvp_job_id
    JOIN public.workflows AS workflow ON workflow.id = gvp_job.workflow_id
    WHERE workflow.project_id = p_project_id
      AND workflow.user_id = p_user_id
      AND gvp_job.user_id = p_user_id
      AND private_base.user_id = p_user_id
  ) AS owned_bases;

  -- The jobs the delete cascades away: those of the project's workflows (any member's) and their child jobs.
  v_job_ids := ARRAY(
    WITH RECURSIVE deleting_jobs(id) AS (
      SELECT j.id
      FROM public.jobs AS j
      JOIN public.workflows AS workflow ON workflow.id = j.workflow_id
      WHERE workflow.project_id = v_project_id
      UNION
      SELECT child.id
      FROM public.jobs AS child
      JOIN deleting_jobs ON child.parent_job_id = deleting_jobs.id
    )
    SELECT id FROM deleting_jobs
  );
  v_stored := public.stored_bytes_by_owner(v_job_ids);

  DELETE FROM public.projects
  WHERE id = v_project_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls, 'storedBytesByOwner', v_stored);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_job_with_recast_cleanup(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_is_admin boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
  v_job_ids uuid[];
  v_stored jsonb;
BEGIN
  SELECT id INTO v_job_id
  FROM public.jobs
  WHERE id = p_job_id AND (p_is_admin OR user_id = p_actor_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  WITH RECURSIVE deleting_jobs(id) AS (
    SELECT v_job_id
    -- UNION deduplicates defensively if historic/corrupt parent links contain
    -- a cycle; deletion must terminate even when the tree invariant did not.
    UNION
    SELECT child.id
    FROM public.jobs AS child
    JOIN deleting_jobs ON child.parent_job_id = deleting_jobs.id
  )
  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN deleting_jobs ON deleting_jobs.id = private_base.gvp_job_id
  ) AS owned_bases;

  -- The jobs the delete cascades away: the job and its child jobs.
  v_job_ids := ARRAY(
    WITH RECURSIVE deleting_jobs(id) AS (
      SELECT v_job_id
      UNION
      SELECT child.id
      FROM public.jobs AS child
      JOIN deleting_jobs ON child.parent_job_id = deleting_jobs.id
    )
    SELECT id FROM deleting_jobs
  );
  v_stored := public.stored_bytes_by_owner(v_job_ids);

  DELETE FROM public.jobs
  WHERE id = v_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job delete lost its authorized row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls, 'storedBytesByOwner', v_stored);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) TO service_role;
