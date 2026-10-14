-- Settle the credit holds that 515 left open on finished work: linked holds on
-- finished jobs, and holds whose job no longer exists. One-off, idempotent,
-- safe to re-run.
--
-- WHY. 515 settled the holds a job was never linked to (the #2202 class). The
-- other open holds on finished work fall into two groups.
--   A. LINKED holds (`jobs.usage_log_id = usage_logs.id`) whose job finished,
--      left open by other lanes: the synchronous `POST /social-publish` route
--      marks its job completed and never commits (fixed separately; until that
--      ships it keeps adding rows), and older cancel and failure paths never
--      refunded. A completed job's hold is committed; a failed or cancelled
--      job's hold is refunded.
--   B. JOB-LESS holds from before August 2026 (`job_id IS NULL`), all refunded.
--      Pipeline-orchestration holds have no job by design. Their pipeline
--      points at them (`pipelines.reservation_usage_log_id`), and the pipeline
--      lane never commits such a hold: it refunds `reserved - spent`
--      (`refundPipelineCredits`), and every one it ever settled was refunded.
--      Such a hold is refunded only when its pipeline spent nothing and is not
--      running. The pointer is then cleared, as the lane does. A pipeline still
--      `queued` or `awaiting_approval` after months is abandoned to `failed`,
--      as the reconcile cron does, so it can never resume without a
--      reservation. Every other pre-August hold whose job row was deleted has
--      no record of its outcome, and is refunded. August is a fixed frontier:
--      a job-less hold reserved since then may belong to a pipeline that is
--      still live, and is never touched.
--
-- EVERY SETTLED ROW: status 'reserved'; not `job-once`; a personal payer (no
-- workspace, no external wallet by flag or journal row, no enforced
-- allowance); a refund needs a pool split it can trust. In group A, the hold is
-- older than 24 hours and its job finished more than an hour ago, and a
-- completed job already charged through another log is left alone.
--
-- THE x10 SPLIT, as in 515: a pre-289 row (split sum x10 = credits_used) is
-- rescaled first, so its refund returns the full amount.
--
-- TODAY'S DAILY COUNTER IS LEFT ALONE: it is read under a row lock before each
-- settlement and written back after it. The RPCs would otherwise subtract
-- months-old holds from today's counter. Lock order: usage_logs, then profiles.
--
-- HOW: the existing atomic RPCs, one row per exception block (a failure is a
-- WARNING and is never a red `migrate` job), each row stamped
-- `reconciled_by = '516'`. A second run finds nothing.

CREATE OR REPLACE FUNCTION pg_temp.settle_516_split_ok(p_meta jsonb, p_used integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT s = p_used OR (s > 0 AND s * 10 = p_used)
    FROM (SELECT COALESCE((p_meta->>'from_sub')::integer, 0) + COALESCE((p_meta->>'from_topup')::integer, 0) AS s) x
$$;

CREATE OR REPLACE FUNCTION pg_temp.settle_516_meta(p_meta jsonb, p_used integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m jsonb := COALESCE(p_meta, '{}'::jsonb);
  s integer := COALESCE((m->>'from_sub')::integer, 0) + COALESCE((m->>'from_topup')::integer, 0);
  k text;
BEGIN
  IF s > 0 AND s * 10 = p_used THEN
    FOREACH k IN ARRAY ARRAY['from_sub', 'from_topup', 'allowance_delta'] LOOP
      IF m ? k THEN m := jsonb_set(m, ARRAY[k], to_jsonb((m->>k)::integer * 10)); END IF;
    END LOOP;
  END IF;
  RETURN m || jsonb_build_object('reconciled_by', '516');
END $$;

-- A. Linked holds on finished jobs.
DO $$
DECLARE
  r record; v_daily integer;
  v_committed integer := 0; v_refunded integer := 0; v_skipped integer := 0; v_failed integer := 0;
BEGIN
  FOR r IN
    SELECT ul.id, ul.user_id, ul.job_id, ul.credits_used, ul.metadata, j.status AS job_status, j.credits_actual
      FROM public.usage_logs ul
      JOIN public.jobs j ON j.id = ul.job_id
     WHERE ul.status = 'reserved'
       AND j.usage_log_id = ul.id
       AND j.status IN ('completed', 'failed', 'cancelled')
       AND j.user_id = ul.user_id
       AND ul.created_at < now() - interval '24 hours'
       AND COALESCE(j.completed_at, ul.created_at) < now() - interval '1 hour'
       AND COALESCE(ul.metadata->>'reservation_mode', '') <> 'job-once'
       AND ul.workspace_id IS NULL
       AND COALESCE(ul.metadata->>'external_wallet', '') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM public.external_wallet_operations w WHERE w.usage_log_id = ul.id)
       AND NOT (COALESCE(ul.metadata->'payer'->>'allowance_enforced', '') = 'true' AND ul.on_behalf_of IS NOT NULL)
     ORDER BY ul.created_at, ul.id
       FOR UPDATE OF ul
  LOOP
    BEGIN
      IF r.job_status = 'completed' AND EXISTS (
           SELECT 1 FROM public.usage_logs s WHERE s.job_id = r.job_id AND s.id <> r.id AND s.status = 'committed') THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      IF r.job_status <> 'completed' AND NOT pg_temp.settle_516_split_ok(r.metadata, r.credits_used) THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      UPDATE public.usage_logs SET metadata = pg_temp.settle_516_meta(r.metadata, r.credits_used) WHERE id = r.id;
      SELECT daily_spent_credits INTO v_daily FROM public.profiles WHERE id = r.user_id FOR UPDATE;
      IF r.job_status = 'completed' THEN
        PERFORM public.commit_credits(r.id, LEAST(COALESCE(r.credits_actual, r.credits_used), r.credits_used));
        v_committed := v_committed + 1;
      ELSE
        PERFORM public.refund_credits(r.id);
        v_refunded := v_refunded + 1;
      END IF;
      UPDATE public.profiles SET daily_spent_credits = v_daily WHERE id = r.user_id;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING '516: could not settle linked usage log % (%): %', r.id, r.job_status, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '516 linked: committed %, refunded %, skipped %, failed %', v_committed, v_refunded, v_skipped, v_failed;
END $$;

-- B. Job-less holds from before August 2026: refunded.
DO $$
DECLARE
  r record; v_daily integer;
  v_refunded integer := 0; v_skipped integer := 0; v_failed integer := 0;
BEGIN
  FOR r IN
    SELECT ul.id, ul.user_id, ul.credits_used, ul.metadata,
           p.id AS pipeline_id, p.status AS pipeline_status, p.spent_credits, p.user_id AS pipeline_user_id
      FROM public.usage_logs ul
      LEFT JOIN public.pipelines p ON p.reservation_usage_log_id = ul.id
     WHERE ul.status = 'reserved'
       AND ul.job_id IS NULL
       AND ul.created_at < '2026-08-01 00:00:00+00'
       AND COALESCE(ul.metadata->>'reservation_mode', '') <> 'job-once'
       AND ul.workspace_id IS NULL
       AND COALESCE(ul.metadata->>'external_wallet', '') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM public.external_wallet_operations w WHERE w.usage_log_id = ul.id)
       AND NOT (COALESCE(ul.metadata->'payer'->>'allowance_enforced', '') = 'true' AND ul.on_behalf_of IS NOT NULL)
     ORDER BY ul.created_at, ul.id
       FOR UPDATE OF ul
  LOOP
    BEGIN
      IF r.pipeline_id IS NOT NULL AND (
           r.pipeline_user_id IS DISTINCT FROM r.user_id
           OR r.pipeline_status IN ('running', 'stopping')
           OR COALESCE(r.spent_credits, 0) <> 0) THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      IF NOT pg_temp.settle_516_split_ok(r.metadata, r.credits_used) THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      UPDATE public.usage_logs SET metadata = pg_temp.settle_516_meta(r.metadata, r.credits_used) WHERE id = r.id;
      SELECT daily_spent_credits INTO v_daily FROM public.profiles WHERE id = r.user_id FOR UPDATE;
      PERFORM public.refund_credits(r.id);
      UPDATE public.profiles SET daily_spent_credits = v_daily WHERE id = r.user_id;
      IF r.pipeline_id IS NOT NULL THEN
        UPDATE public.pipelines
           SET reservation_usage_log_id = NULL,
               status = CASE WHEN status IN ('queued', 'awaiting_approval') THEN 'failed' ELSE status END,
               failure_reason = CASE WHEN status IN ('queued', 'awaiting_approval')
                                     THEN 'stale_hold_refunded_516' ELSE failure_reason END
         WHERE id = r.pipeline_id;
      END IF;
      v_refunded := v_refunded + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING '516: could not refund job-less usage log %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '516 job-less: refunded %, skipped %, failed %', v_refunded, v_skipped, v_failed;
END $$;
