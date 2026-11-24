-- jobs.server_output: what a job stored that its owner must not read, SERVER-ONLY
-- (decided 2026-11-22).
--
-- Two things live here:
--   - `stored`: { <object key>: <bytes> } for each object a video store kept
--     beside its playable copy (a kept original, an Extend's raw reference
--     clip), with the bytes its owner was CHARGED for it (0 where nothing was). Every path
--     that deletes one gives exactly that back, and a job that fails after the
--     store deletes them (lib/job-server-output.ts).
--   - `rawExtensionUrl`: a WATERMARKED Extend's unwatermarked raw clip, which
--     the next extension in the chain reads. It cannot sit in output_data:
--     migration 347 grants `authenticated` SELECT on (id, user_id, status,
--     output_data), and `jobs` is in the Realtime publication, so every key
--     there reaches the job's owner whatever the API redacts (552's reasoning).
--
-- A column of its own is private by construction (347 removed table-level
-- SELECT); the REVOKE below states it, as 394 and 552 do. Clients cannot write
-- jobs at all (474). Added bare (nullable, no default: no rewrite), its CHECK
-- NOT VALID (every row is NULL), under a short lock_timeout (536's form).
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS server_output jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_server_output_object') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_server_output_object
      CHECK (server_output IS NULL OR jsonb_typeof(server_output) = 'object') NOT VALID;
  END IF;
END $$;

REVOKE SELECT (server_output) ON public.jobs FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.jobs.server_output IS
  'Server-only store record { stored: { key: bytes }, rawExtensionUrl? } — never granted to anon/authenticated.';

-- Record one stored object on its LIVE job and charge its owner for it, in one
-- statement (decided 2026-11-22):
--   - live means in flight: pending, queued, processing or pending_review (the
--     repo's IN_FLIGHT_JOB_STATUSES, lib/job-status.ts; a test holds the two
--     lists equal). A job no longer in flight records nothing and charges
--     nothing. It answers {"live": false, "ended": true} when the job was
--     cancelled or failed while the object was stored (the caller then deletes
--     the object), and "ended": false for a completed job or a missing row (a
--     second finalizer of a job already delivered: the object at that key is
--     the delivered one, never deleted);
--   - a key another store of the same job is discarding as unrecorded
--     (`discard_unrecorded_job_object`) is not recorded by a store that began
--     before that discard finished: it answers {"live": true, "discarded":
--     true}, and the caller stores without it (its upload may be the one that
--     discard deleted). `p_begun_at` is when the caller began its store, read
--     from this database's clock (`job_store_now`);
--   - `p_key` NULL: `p_patch` alone is merged (a raw clip reference cleared),
--     nothing recorded or charged;
--   - otherwise the job's own owner (`jobs.user_id`, never a caller-named
--     account) is charged what the key was not already charged, only when
--     `p_charge` (a deployment that keeps storage accounts), and the key
--     records exactly the bytes charged for it — so a retry is never charged
--     twice, and nothing uncharged is ever refunded.
-- SECURITY INVOKER: only the service role can update jobs or call it.
CREATE OR REPLACE FUNCTION public.record_job_stored_object(
  p_job_id uuid,
  p_key text,
  p_bytes bigint,
  p_charge boolean,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_begun_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  job_status text;
  job_user uuid;
  job_output jsonb;
  marker jsonb;
  previous bigint;
  charge bigint;
BEGIN
  SELECT status, user_id, server_output INTO job_status, job_user, job_output
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('live', false, 'ended', false);
  END IF;
  IF job_status NOT IN ('pending', 'queued', 'processing', 'pending_review') THEN
    RETURN jsonb_build_object('live', false, 'ended', job_status IN ('cancelled', 'failed'));
  END IF;
  -- No key: a patch alone (a watermarked Extend clearing its raw clip
  -- reference before it copies its own), on a live job only, charging nothing.
  IF p_key IS NULL THEN
    UPDATE public.jobs
       SET server_output = coalesce(job_output, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
     WHERE id = p_job_id;
    RETURN jsonb_build_object('live', true, 'charged', 0);
  END IF;
  marker := job_output->'discarding'->p_key;
  IF marker IS NOT NULL AND (
       -- A discard still running (its own deletion not confirmed yet), unless
       -- it was left behind long ago by a process that died.
       (marker ? 'pending_since' AND (marker->>'pending_since')::timestamptz > now() - interval '15 minutes')
       -- A finished discard this store began before: its upload may be gone.
    OR (marker ? 'done_at' AND (p_begun_at IS NULL OR (marker->>'done_at')::timestamptz >= p_begun_at))
  ) THEN
    RETURN jsonb_build_object('live', true, 'discarded', true);
  END IF;
  previous := coalesce((job_output->'stored'->>p_key)::bigint, 0);
  -- A negative size is no size: nothing charged, nothing more recorded. A job
  -- with no owner charges no one and records 0.
  charge := CASE WHEN p_charge AND job_user IS NOT NULL THEN greatest(greatest(coalesce(p_bytes, 0), 0) - previous, 0) ELSE 0 END;
  IF charge > 0 THEN
    PERFORM public.increment_storage(job_user, charge);
  END IF;
  -- `unpruned`: the job holds a recorded object its completion has not yet
  -- weighed against its output (lib/job-server-output.ts
  -- `pruneUnnamedStoredObjects` clears it; the ended-jobs sweep retries any
  -- completed row still carrying it, migration 697's index).
  UPDATE public.jobs
     SET server_output = coalesce(job_output, '{}'::jsonb)
           || coalesce(p_patch, '{}'::jsonb)
           || jsonb_build_object('stored', coalesce(job_output->'stored', '{}'::jsonb) || jsonb_build_object(p_key, previous + charge))
           || jsonb_build_object('unpruned', true)
   WHERE id = p_job_id;
  RETURN jsonb_build_object('live', true, 'charged', charge);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_job_stored_object(uuid, text, bigint, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_stored_object(uuid, text, bigint, boolean, jsonb, timestamptz) TO service_role;

-- This database's clock, for a store to say when it began
-- (`record_job_stored_object`'s `p_begun_at`): one clock for both sides of a
-- discard, never two machines'.
CREATE OR REPLACE FUNCTION public.job_store_now() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT now() $$;

REVOKE EXECUTE ON FUNCTION public.job_store_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_store_now() TO service_role;

-- Discard an object a store uploaded and could not record (decided
-- 2026-11-23), without ever deleting one ANOTHER store of the same job
-- recorded under the same key:
--   - phase 'begin', under the row lock: a key that is recorded is never
--     discarded ({"discard": false}); otherwise it is marked as being
--     discarded ({"pending_since": now}) and the caller may delete it
--     ({"discard": true}). While the mark stands, no store records that key.
--   - phase 'done', after the delete: the mark becomes {"done_at": now}, and
--     only a store that began after it may record the key again (its upload
--     came after the delete).
CREATE OR REPLACE FUNCTION public.discard_unrecorded_job_object(
  p_job_id uuid,
  p_key text,
  p_phase text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  job_output jsonb;
  mark jsonb;
BEGIN
  SELECT server_output INTO job_output FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('discard', false);
  END IF;
  IF p_phase = 'begin' THEN
    IF (coalesce(job_output->'stored', '{}'::jsonb)) ? p_key THEN
      RETURN jsonb_build_object('discard', false);
    END IF;
    mark := jsonb_build_object('pending_since', now());
  ELSIF p_phase = 'done' THEN
    mark := jsonb_build_object('done_at', now());
  ELSE
    RAISE EXCEPTION 'DISCARD_PHASE_INVALID';
  END IF;
  UPDATE public.jobs
     SET server_output = coalesce(job_output, '{}'::jsonb)
           || jsonb_build_object('discarding', coalesce(job_output->'discarding', '{}'::jsonb) || jsonb_build_object(p_key, mark))
   WHERE id = p_job_id;
  RETURN jsonb_build_object('discard', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.discard_unrecorded_job_object(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_unrecorded_job_object(uuid, text, text) TO service_role;

-- Claim recorded objects off a job's record, for a delete (decided
-- 2026-11-22): under the row lock, each of `p_keys` still in `stored` is
-- removed from it, and the answer is { "owner": <jobs.user_id>, "claimed":
-- { <key>: <recorded bytes> } }. A key no longer recorded (another path claimed
-- it first) is left out of "claimed", so two paths that both delete one object
-- give its bytes back once: each refunds only what its claim answered, and
-- deletes the object only after its claim.
CREATE OR REPLACE FUNCTION public.claim_job_stored_objects(
  p_job_id uuid,
  p_keys text[]
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  job_user uuid;
  job_output jsonb;
  claimed jsonb := '{}'::jsonb;
  k text;
BEGIN
  SELECT user_id, server_output INTO job_user, job_output FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR job_output IS NULL OR jsonb_typeof(job_output->'stored') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('owner', job_user, 'claimed', claimed);
  END IF;
  FOREACH k IN ARRAY coalesce(p_keys, ARRAY[]::text[]) LOOP
    IF (job_output->'stored') ? k THEN
      claimed := claimed || jsonb_build_object(k, greatest(coalesce((job_output->'stored'->>k)::bigint, 0), 0));
    END IF;
  END LOOP;
  IF claimed <> '{}'::jsonb THEN
    UPDATE public.jobs
       SET server_output = job_output || jsonb_build_object('stored', (job_output->'stored') - coalesce(p_keys, ARRAY[]::text[]))
     WHERE id = p_job_id;
  END IF;
  RETURN jsonb_build_object('owner', job_user, 'claimed', claimed);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_job_stored_objects(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_stored_objects(uuid, text[]) TO service_role;

-- A completed job's record has been weighed against its output (decided
-- 2026-11-23): every recorded object the output does not name was claimed and
-- deleted. Clears `unpruned`, so the ended-jobs sweep stops retrying the row.
-- A row that is not completed is left as it is.
CREATE OR REPLACE FUNCTION public.mark_job_pruned(p_job_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.jobs
     SET server_output = server_output - 'unpruned'
   WHERE id = p_job_id AND status = 'completed' AND server_output ? 'unpruned';
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_job_pruned(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_pruned(uuid) TO service_role;

-- Two lookups the periodic cleanup reads (decided 2026-11-24), each exactly
-- one partial index's condition written literally, so the planner can prove
-- the index's predicate even in a cached generic plan (a value sent as a
-- parameter cannot), and ordered by id, so it walks that small index rather
-- than scanning jobs. Keyset paging: the caller passes the last id it saw as
-- `p_after_id` (NULL for the first page), so rows it cannot clear yet (a held
-- key, a deployment that deletes nothing) never hide the rows behind them.
-- At most 1000 rows a page. They return only what the cleanup needs.
--
-- Cancelled or failed jobs whose record still holds stored objects
-- (migration 696's index).
CREATE OR REPLACE FUNCTION public.ended_jobs_with_stored_objects(
  p_after_id uuid,
  p_limit integer
) RETURNS TABLE (id uuid, user_id uuid, stored jsonb)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT j.id, j.user_id, j.server_output -> 'stored'
    FROM public.jobs j
   WHERE j.status IN ('cancelled', 'failed')
     AND (j.server_output -> 'stored') <> '{}'::jsonb
     AND j.id > coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY j.id
   LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

REVOKE EXECUTE ON FUNCTION public.ended_jobs_with_stored_objects(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ended_jobs_with_stored_objects(uuid, integer) TO service_role;

-- Completed jobs whose completion's prune did not finish (`unpruned` still on
-- the record; migration 697's index).
CREATE OR REPLACE FUNCTION public.completed_jobs_left_unpruned(
  p_after_id uuid,
  p_limit integer
) RETURNS TABLE (id uuid, user_id uuid)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT j.id, j.user_id
    FROM public.jobs j
   WHERE j.status = 'completed'
     AND (j.server_output ->> 'unpruned') = 'true'
     AND j.id > coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY j.id
   LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

REVOKE EXECUTE ON FUNCTION public.completed_jobs_left_unpruned(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.completed_jobs_left_unpruned(uuid, integer) TO service_role;
