-- 736 — A delete for good answers the files its jobs' server-only records hold
-- (decided 2026-11-23).
--
-- `jobs.server_output.stored` (migration 695) records each file a video store
-- kept beside its playable copy (a kept original, a watermarked Extend's raw
-- clip), with the bytes its owner was charged for it. Migration 708 made each
-- delete function answer those bytes per owner (`storedBytesByOwner`) so the
-- caller gives them back; the files themselves stayed, and with their job and
-- its record gone nothing could ever find them again.
--
-- So each delete function below now also answers, per deleted job whose record
-- holds any file, the keys of those files and the urls the job's own output
-- names (`recordedFilesByJob`: { <job id>: { recorded: [<key>], named: [<url>]
-- } }), from exactly the rows it deletes, in the same transaction. The caller
-- removes a recorded file only when `deleted` is true and nothing still uses
-- it: a delete the database refuses (a trigger, an error) rolls back and
-- answers nothing. `named` lets the caller keep a recorded file the job
-- delivered as its result (an original the job completed on); it holds the
-- output's urls that carry the job's own id (a superset of the job's own key
-- family, which the caller applies), with the output's `originalVideoUrl`
-- field left out, since that field only points at the recorded original.
-- Removing a file gives nothing back: its bytes are the ones
-- `storedBytesByOwner` already answers.
--
-- EXACTLY THE ROWS IT DELETES. A delete collects the ids its cascade will take
-- (the workflows' jobs, or the job, and their child jobs) and locks them
-- (`deleting_jobs_records`, which also reads their records, as 708's
-- `stored_bytes_by_owner` did). Nothing else can delete a row it holds locked,
-- but a row can still LEAVE the cascade before the DELETE runs: a workflow
-- moved to another project, a job moved to another workflow or parent (those
-- writes lock the workflow or the referenced row, never the job rows held
-- here). So the answer is built after the DELETE (`deleted_jobs_answer`), from
-- the collected rows that no longer exist: a row that left the cascade still
-- exists and is answered for neither its bytes nor its files. Both answers,
-- `storedBytesByOwner` (708) and `recordedFilesByJob`, are built that way, so
-- a live job's bytes are never given back and its files never removed. (A row
-- that JOINS a cascade after the collection is deleted without being answered:
-- its files stay and its bytes stay charged, as before 708.)
--
-- `in_flight_job_inputs_naming` answers which of a set of strings (the deleted
-- jobs' ids, which every key of theirs carries) a job still on its way to a
-- result names in its input, so a file an unfinished job may be about to read
-- (its own source, or a later Extend reading its source's raw clip) is kept.
-- It reads only the in-flight rows, through the index on `jobs.status`, and
-- casts each one's input to text once: the statuses are written out (the
-- backend's `IN_FLIGHT_JOB_STATUSES`, a test holds the two equal), so the
-- planner reads the index even from a generic plan.
--
-- Each delete body is its latest definition (migration 708) with only its
-- answer changed as above. Same signatures, so the grants stand; they are
-- stated again for the record. `delete_trashed_job_with_recast_cleanup`
-- (migration 561) answers whatever `delete_job_with_recast_cleanup` answers,
-- so it carries both fields unchanged. `stored_bytes_by_owner` (708) stays
-- defined, no longer called. Safe to re-run.
SET LOCAL lock_timeout = '2s';

-- Before a delete: lock the rows it will take, in id order, and read what each
-- one's server-only record holds: its owner, the bytes recorded, the keys
-- recorded, and the urls its own output names that carry its id. Only rows
-- whose record holds anything are answered.
CREATE OR REPLACE FUNCTION public.deleting_jobs_records(p_job_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id = ANY(p_job_ids) ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_object_agg(j.id::text, jsonb_build_object(
    'owner', j.user_id,
    'bytes', (
      SELECT coalesce(sum(greatest(coalesce((e.value #>> '{}')::numeric, 0), 0)), 0)::bigint
      FROM jsonb_each(j.server_output -> 'stored') AS e
      WHERE jsonb_typeof(e.value) = 'number'
    ),
    'recorded', (
      SELECT coalesce(jsonb_agg(k.key ORDER BY k.key), '[]'::jsonb)
      FROM jsonb_object_keys(j.server_output -> 'stored') AS k(key)
    ),
    'named', (
      SELECT coalesce(jsonb_agg(u.url ORDER BY u.url), '[]'::jsonb)
      FROM unnest(public.job_output_urls(
        CASE WHEN jsonb_typeof(j.output_data) = 'object' THEN j.output_data - 'originalVideoUrl' ELSE j.output_data END
      )) AS u(url)
      WHERE strpos(lower(u.url), j.id::text) > 0
    )
  )), '{}'::jsonb)
  INTO v_result
  FROM public.jobs AS j
  WHERE j.id = ANY(p_job_ids)
    AND jsonb_typeof(j.server_output -> 'stored') = 'object'
    AND j.server_output -> 'stored' <> '{}'::jsonb;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deleting_jobs_records(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deleting_jobs_records(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deleting_jobs_records(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deleting_jobs_records(uuid[]) TO service_role;

-- After a delete: its answer, from the records `deleting_jobs_records` read,
-- for the rows that no longer exist (the ones the delete took): the bytes per
-- owner (`storedBytesByOwner`) and each job's files (`recordedFilesByJob`). A
-- collected row that left the cascade still exists and is answered for
-- neither.
CREATE OR REPLACE FUNCTION public.deleted_jobs_answer(p_records jsonb)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH gone AS (
    SELECT r.key AS id, r.value AS rec
    FROM jsonb_each(coalesce(p_records, '{}'::jsonb)) AS r
    WHERE NOT EXISTS (SELECT 1 FROM public.jobs AS j WHERE j.id = r.key::uuid)
  ), per_owner AS (
    SELECT g.rec ->> 'owner' AS owner_id, sum((g.rec ->> 'bytes')::bigint)::bigint AS bytes
    FROM gone AS g
    WHERE g.rec ->> 'owner' IS NOT NULL
    GROUP BY g.rec ->> 'owner'
  )
  SELECT jsonb_build_object(
    'storedBytesByOwner', coalesce((SELECT jsonb_object_agg(p.owner_id, p.bytes) FROM per_owner AS p WHERE p.bytes > 0), '{}'::jsonb),
    'recordedFilesByJob', coalesce((
      SELECT jsonb_object_agg(g.id, jsonb_build_object('recorded', g.rec -> 'recorded', 'named', g.rec -> 'named'))
      FROM gone AS g
      WHERE jsonb_array_length(g.rec -> 'recorded') > 0
    ), '{}'::jsonb)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.deleted_jobs_answer(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deleted_jobs_answer(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deleted_jobs_answer(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deleted_jobs_answer(jsonb) TO service_role;

-- Which of `p_needles` a job still in flight names anywhere in its input. The
-- in-flight inputs are read and cast to text once (MATERIALIZED), then each
-- needle stops at its first hit.
CREATE OR REPLACE FUNCTION public.in_flight_job_inputs_naming(p_needles text[])
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH needles AS (
    SELECT DISTINCT n.needle
    FROM unnest(p_needles) AS n(needle)
    WHERE n.needle IS NOT NULL
      AND n.needle <> ''
  ), inputs AS MATERIALIZED (
    SELECT j.input_data::text AS input
    FROM public.jobs AS j
    WHERE j.status IN ('pending', 'queued', 'processing', 'pending_review')
      AND j.input_data IS NOT NULL
  )
  SELECT n.needle
  FROM needles AS n
  WHERE EXISTS (SELECT 1 FROM inputs AS i WHERE strpos(i.input, n.needle) > 0)
$$;

REVOKE EXECUTE ON FUNCTION public.in_flight_job_inputs_naming(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.in_flight_job_inputs_naming(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.in_flight_job_inputs_naming(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.in_flight_job_inputs_naming(text[]) TO service_role;

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
  v_records jsonb;
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
  -- Locked here, answered after the DELETE for the rows it really took.
  v_records := public.deleting_jobs_records(v_job_ids);

  DELETE FROM public.workflows
  WHERE id = v_workflow_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls) || public.deleted_jobs_answer(v_records);
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
  v_records jsonb;
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
  -- Locked here, answered after the DELETE for the rows it really took.
  v_records := public.deleting_jobs_records(v_job_ids);

  DELETE FROM public.projects
  WHERE id = v_project_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls) || public.deleted_jobs_answer(v_records);
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
  v_records jsonb;
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
  -- Locked here, answered after the DELETE for the rows it really took.
  v_records := public.deleting_jobs_records(v_job_ids);

  DELETE FROM public.jobs
  WHERE id = v_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job delete lost its authorized row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls) || public.deleted_jobs_answer(v_records);
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
