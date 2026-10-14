-- Settle the credit holds that jobs were never linked to (one-off, idempotent).
--
-- WHY. Until #2202, two reservation lanes reserved credits against a job
-- without writing the job's back-pointer (`jobs.usage_log_id`): the pipeline
-- worker lane (`ee/pipelines/services/_run-worker-job.ts`) and the callers of
-- `POST /v1/credits/reserve`. A worker that reads its reservation off the job
-- row then had nothing to commit or refund, so those `usage_logs` rows stayed
-- `reserved` after the job finished. #2202 makes every reservation that names a
-- job link it. This settles the holds left open before that.
--
-- WHAT IT SETTLES. Exactly that defect class, and only what SQL alone can settle
-- correctly. A row is settled only when all of the following hold:
--   - status is 'reserved' and it names a job;
--   - the job is finished (completed / failed / cancelled) and has NO link
--     (`jobs.usage_log_id IS NULL`). A linked hold is a different lane's gap and
--     is left alone. The job belongs to the hold's user;
--   - it is not a `job-once` reservation (those have their own recovery cron:
--     `ee/billing/managed-job-recovery.ts`);
--   - the payer is personal: no workspace, no external wallet (neither the
--     metadata flag nor a journal row; its settlement has a delivery step SQL
--     cannot run), no enforced deployment allowance;
--   - it was created before the 2026-10-14T09:55Z report the scope was taken
--     from, so this settles the rows that report counted and nothing newer.
-- A completed job's hold is COMMITTED at the job's recorded actual (capped at
-- the reservation), else at the reserved amount. When another usage log of the
-- same job is already committed, the job has already been charged and the hold
-- is left alone (it is not committed a second time). A failed or cancelled job's
-- hold is REFUNDED.
--
-- THE x10 SPLIT. Migration 289 (credit re-denomination) scaled
-- `usage_logs.credits_used` x10 but not the pool split in its metadata
-- (`from_sub`, `from_topup`, `allowance_delta`), and `refund_credits` restores
-- the SPLIT. A pre-289 row's split therefore sums to a tenth of
-- `credits_used`, and refunding it as is would return a tenth. Such a row
-- (split sum x10 = credits_used) has its split rescaled x10 first, in the same
-- transaction. A refund whose split matches neither way, or has no split, is
-- left alone; a commit at the reserved amount never reads the split.
--
-- HOW. Through the existing atomic RPCs, `commit_credits` / `refund_credits`
-- (382), one row at a time, each in its own exception block. A row a worker
-- settles concurrently, or any single failure, is logged as a WARNING and
-- skipped. It never aborts the migration, because a failed migration turns the
-- `migrate` job red and Railway then skips the production deploy. Each settled
-- row is stamped `metadata.reconciled_by = '515'`, and the job's empty link is
-- filled, which is what #2202 now does at reserve time.
--
-- Idempotent: a settled row is no longer 'reserved', so a second run finds
-- nothing. Proven by supabase/tests/settle-unlinked-job-holds.behavior.sql.

DO $$
DECLARE
  c_cutoff CONSTANT timestamptz := '2026-10-14 09:55:00+00';
  r record;
  v_split integer;
  v_meta jsonb;
  v_committed integer := 0;
  v_refunded integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
BEGIN
  FOR r IN
    SELECT ul.id, ul.job_id, ul.credits_used, ul.metadata, j.status AS job_status, j.credits_actual
      FROM public.usage_logs ul
      JOIN public.jobs j ON j.id = ul.job_id
     WHERE ul.status = 'reserved'
       AND ul.created_at < c_cutoff
       AND j.status IN ('completed', 'failed', 'cancelled')
       AND j.usage_log_id IS NULL
       AND j.user_id = ul.user_id
       AND COALESCE(ul.metadata->>'reservation_mode', '') <> 'job-once'
       AND ul.workspace_id IS NULL
       AND COALESCE(ul.metadata->>'external_wallet', '') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM public.external_wallet_operations w WHERE w.usage_log_id = ul.id)
       AND NOT (COALESCE(ul.metadata->'payer'->>'allowance_enforced', '') = 'true' AND ul.on_behalf_of IS NOT NULL)
     ORDER BY ul.created_at, ul.id
       FOR UPDATE OF ul
  LOOP
    BEGIN
      v_split := COALESCE((r.metadata->>'from_sub')::integer, 0) + COALESCE((r.metadata->>'from_topup')::integer, 0);

      IF r.job_status = 'completed' AND EXISTS (
           SELECT 1 FROM public.usage_logs s
            WHERE s.job_id = r.job_id AND s.id <> r.id AND s.status = 'committed') THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF r.job_status <> 'completed' AND NOT (v_split = r.credits_used OR (v_split > 0 AND v_split * 10 = r.credits_used)) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_meta := COALESCE(r.metadata, '{}'::jsonb);
      IF v_split > 0 AND v_split * 10 = r.credits_used THEN
        IF v_meta ? 'from_sub' THEN
          v_meta := jsonb_set(v_meta, '{from_sub}', to_jsonb((v_meta->>'from_sub')::integer * 10));
        END IF;
        IF v_meta ? 'from_topup' THEN
          v_meta := jsonb_set(v_meta, '{from_topup}', to_jsonb((v_meta->>'from_topup')::integer * 10));
        END IF;
        IF v_meta ? 'allowance_delta' THEN
          v_meta := jsonb_set(v_meta, '{allowance_delta}', to_jsonb((v_meta->>'allowance_delta')::integer * 10));
        END IF;
      END IF;
      v_meta := v_meta || jsonb_build_object('reconciled_by', '515');
      UPDATE public.usage_logs SET metadata = v_meta WHERE id = r.id;

      IF r.job_status = 'completed' THEN
        PERFORM public.commit_credits(r.id, LEAST(COALESCE(r.credits_actual, r.credits_used), r.credits_used));
        v_committed := v_committed + 1;
      ELSE
        PERFORM public.refund_credits(r.id);
        v_refunded := v_refunded + 1;
      END IF;

      UPDATE public.jobs SET usage_log_id = r.id WHERE id = r.job_id AND usage_log_id IS NULL;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING '515: could not settle usage log % (%): %', r.id, r.job_status, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '515: committed %, refunded %, skipped %, failed %', v_committed, v_refunded, v_skipped, v_failed;
END $$;
