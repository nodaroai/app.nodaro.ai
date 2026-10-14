-- A managed job's completion and its ready charge in ONE transaction.
--
-- `markJobCompleted` (backend/src/workers/shared.ts) used to flip the row to
-- `completed` and then settle a managed (`job-once`) reservation in a second
-- statement. A reader between the two — the orchestrator's run total, a
-- `GET /v1/jobs/:id` poll — saw a completed job with no charge. This function
-- writes the completion and, when the reservation's lane already recorded its
-- final (`ready`) charge, settles it before the transaction commits, so no
-- reader can observe one without the other.
--
-- It is called only on the result gate's ALLOW path: a held job goes to
-- `pending_review` and settles on approval, a blocked one fails and settles at
-- 0 through the refund path — neither reaches here.
--
-- `p_fields` is the whole completion object the funnel used to send through
-- PostgREST (status, progress, completed_at and the caller's columns). Every key
-- must be a `jobs` column, exactly as PostgREST required; values coerce through
-- `jsonb_populate_record`, the same JSON-to-column conversion. Only keys that are
-- present are written.
--
-- A settlement error never undoes the completion: it is caught in its own
-- subtransaction and returned as `settleError`, and the lane's own settle
-- replays the same decision afterwards.
CREATE OR REPLACE FUNCTION public.complete_job_and_settle(p_job_id UUID, p_fields JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_invalid TEXT;
  v_set TEXT;
  v_rows INTEGER;
  v_usage_log_id UUID;
  v_metadata JSONB;
  v_settlement JSONB;
  v_error TEXT;
BEGIN
  IF p_job_id IS NULL OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
    OR p_fields->'status' IS DISTINCT FROM '"completed"'::jsonb THEN
    RAISE EXCEPTION 'JOB_COMPLETION_INVALID: a job id and a completed-status field object are required' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO v_invalid
    FROM jsonb_object_keys(p_fields) AS k
   WHERE k = 'id' OR NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.jobs'::regclass AND a.attname = k
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '');
  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'JOB_COMPLETION_INVALID: not a writable jobs column: %', v_invalid USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(format('%I = r.%I', k, k), ', ' ORDER BY k) INTO v_set
    FROM jsonb_object_keys(p_fields) AS k;

  -- The CAS on LIVE statuses, as before: completion is single-shot against
  -- every terminal state and against `pending_review`. The jobs row is locked
  -- first, then usage_logs (inside the settlement) — the order every reserve,
  -- checkpoint and settle function uses (migrations 391–393).
  EXECUTE format(
    'UPDATE public.jobs AS j SET %s FROM jsonb_populate_record(NULL::public.jobs, $1) AS r
      WHERE j.id = $2 AND j.status IN (''pending'', ''processing'')
      RETURNING j.usage_log_id', v_set)
    INTO v_usage_log_id USING p_fields, p_job_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('completed', false);
  END IF;

  IF v_usage_log_id IS NOT NULL THEN
    SELECT metadata INTO v_metadata FROM public.usage_logs WHERE id = v_usage_log_id;
    -- The SQL twin of `isReadyManagedReservation` (workers/shared.ts): a
    -- `job-once` reservation whose lane wrote its ready checkpoint, or that a
    -- finalizer already decided. Anything else keeps its own commit path.
    IF v_metadata->>'reservation_mode' = 'job-once'
      AND (v_metadata->'job_settlement_checkpoint'->'ready' = 'true'::jsonb OR v_metadata ? 'job_settlement') THEN
      BEGIN
        v_settlement := public.settle_checkpointed_job_reservation(v_usage_log_id);
      EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'usageLogId', v_usage_log_id,
    'settled', v_settlement IS NOT NULL AND v_settlement->>'deferred' = 'false',
    'settleError', v_error);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_and_settle(UUID, JSONB) TO service_role;
