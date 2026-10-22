-- jobs.llm_billing: the metered LLM billing ledger, SERVER-ONLY.
--
-- A metered LLM job's settle records what it cost: the provider's own dollar
-- cost (costUsd), where the figure came from, how many attempts billed and on
-- which serving lanes. That is Nodaro's economics and internal routing — it
-- must never reach the person who ran the job.
--
-- It cannot live in output_data: migration 347 grants `authenticated` SELECT
-- on (id, user_id, status, output_data) for the studios' Realtime feed, so
-- every key in output_data is readable by the job's owner straight over
-- PostgREST and arrives on every Realtime UPDATE of their row, whatever the
-- API's own job serializers redact.
--
-- A column of its own is private by construction: 347 removed table-level
-- SELECT and grants only that four-column list, so a new column is readable by
-- nobody but the service role (the settle, the reconcile sweep, admin tooling,
-- cost monitoring). The REVOKE below states it explicitly, as 394 does for
-- submission_context. Clients cannot write jobs at all (474).
--
-- `jobs` is the hottest table in the platform (every worker heartbeat, every
-- status write). Each ALTER below takes ACCESS EXCLUSIVE on it, so behind a
-- long transaction it would wait and every read and write of jobs would queue
-- behind it. The lock_timeout bounds that wait to a failed (and safely
-- retried: every step is guarded) migration instead of a stalled platform
-- (536's form). The column is added bare (nullable, no default: no rewrite)
-- and its CHECK NOT VALID (no scan under the lock: every row is NULL).
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS llm_billing jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_llm_billing_object') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_llm_billing_object
      CHECK (llm_billing IS NULL OR jsonb_typeof(llm_billing) = 'object') NOT VALID;
  END IF;
END $$;

REVOKE SELECT (llm_billing) ON public.jobs FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.jobs.llm_billing IS
  'Metered LLM billing ledger { costUsd, source, calls, lanes } — server-only (provider $ and lanes); never granted to anon/authenticated.';
