-- A held job's approval completes and settles in one transaction too.
--
-- Migration 513's `complete_job_and_settle` closed the window between a
-- worker's completion and its ready managed charge. A reviewer's approval
-- (`approveHeldJob`, backend/src/lib/job-policy-review.ts) flips
-- `pending_review → completed` itself and then settled in a separate step, so
-- the same window existed there. The function gains `p_from_review`: false (the
-- default — every existing call is unchanged) keeps the live-status CAS; true
-- admits only `pending_review`. Everything else — the column check, the ready
-- rule, the caught settlement error, the reply — is migration 513's.
--
-- The two-argument function is replaced, not overloaded: two candidates for a
-- two-argument named call would be ambiguous to PostgREST.
DROP FUNCTION IF EXISTS public.complete_job_and_settle(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.complete_job_and_settle(p_job_id UUID, p_fields JSONB, p_from_review BOOLEAN DEFAULT FALSE)
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
  IF p_job_id IS NULL OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR p_from_review IS NULL
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

  -- The CAS. A worker's completion (the default) admits only the LIVE
  -- statuses: single-shot against every terminal state and against
  -- `pending_review`, which a worker must never complete. A reviewer's approval
  -- (`p_from_review`) admits only `pending_review`: the reject, the TTL expiry
  -- and the owner's cancel each win that same CAS. The jobs row is locked
  -- first, then usage_logs (inside the settlement) — the order every reserve,
  -- checkpoint and settle function uses (migrations 391–393).
  EXECUTE format(
    'UPDATE public.jobs AS j SET %s FROM jsonb_populate_record(NULL::public.jobs, $1) AS r
      WHERE j.id = $2 AND (CASE WHEN $3 THEN j.status = ''pending_review''
                                ELSE j.status IN (''pending'', ''processing'') END)
      RETURNING j.usage_log_id', v_set)
    INTO v_usage_log_id USING p_fields, p_job_id, p_from_review;
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

REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.complete_job_and_settle(UUID, JSONB, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_and_settle(UUID, JSONB, BOOLEAN) TO service_role;
