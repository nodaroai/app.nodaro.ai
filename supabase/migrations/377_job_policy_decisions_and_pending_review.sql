-- Job policy hook (spec 2026-09-03-job-policy-hook-design rev 3.0, §12).
--
-- The new audit table and its indexes land first, then the `jobs` DDL. That
-- ordering buys a shorter ACCESS EXCLUSIVE window on `jobs` and NOTHING MORE —
-- read the lock note before scheduling this against a production-sized `jobs`.
--
-- WHAT THIS FILE ACTUALLY LOCKS, statement by statement. Probed with pg_locks
-- against supabase/postgres, not inferred from the DDL:
--
--   * Statement 1 — the FK-bearing CREATE TABLE — takes SHARE ROW EXCLUSIVE on
--     `jobs`, `profiles` AND `auth.users` (one per REFERENCES target) and holds
--     all three to COMMIT. SRE conflicts with ROW EXCLUSIVE, so writes to all
--     three tables are blocked from the FIRST statement for the whole file —
--     including GoTrue's UPDATE of auth.users on every sign-in. No statement
--     ordering removes that; putting the `jobs` DDL last does not help it.
--   * The `jobs` DDL below — ADD COLUMN, the policy re-shape, then DROP/ADD
--     CONSTRAINT NOT VALID — takes ACCESS EXCLUSIVE on `jobs`, held to COMMIT.
--     That is the lock that also blocks READS (GET /v1/jobs/:id, every poll
--     loop, Realtime), which is why it is last and why every statement in it is
--     catalog-only: milliseconds. `NOT VALID` is what keeps it catalog-only —
--     no heap scan.
--
-- BOTH TABLE SCANS ARE IN THEIR OWN FILES, for exactly that reason:
--   * `VALIDATE CONSTRAINT` is 378 — SHARE UPDATE EXCLUSIVE, which blocks
--     neither reads nor writes.
--   * `idx_jobs_pending_review` is 379. A plain CREATE INDEX must READ THE
--     WHOLE HEAP once (303:39-41 spells it out: a partial predicate shrinks the
--     resulting index, not the one-time build scan). Inside THIS file that scan
--     would run under the ADD COLUMN's ACCESS EXCLUSIVE and block every read on
--     `jobs` for its duration — the exact hazard the 377/378 split exists to
--     avoid, applied to the one scan that had not been split. Alone in its own
--     file it takes SHARE only: writes wait, reads do not — the profile
--     271:104-112 and 303:31-44 document and accept. It cannot move earlier in
--     THIS file either: it indexes `held_at`, which this file adds.
--
-- Both runners (`supabase db push` and backend/scripts/run-migrations.mjs) are
-- per-FILE transactional, so splitting the file is the only way to split the
-- lock window. 334_recast_audio_rescore_transactions.sql does both in one file;
-- `jobs` is far larger than the rows 334 touched.

-- 1. Audit trail. Service role ONLY: rows carry a moderation reason, which is
--    the deployment's business, not the job owner's.
CREATE TABLE IF NOT EXISTS public.job_policy_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLable on purpose: the REQUEST gate runs BEFORE the insert, so a blocked
  -- request has no job row to point at. SET NULL keeps the audit when a job is
  -- deleted (jobs deletes cascade widely — 001:106).
  job_id          UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  hook_point      TEXT NOT NULL CHECK (hook_point IN ('request','result','review')),
  policy_id       TEXT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('allow','flag','block','hold','approve','reject','withdrawn')),
  reason          TEXT,              -- MACHINE text; the user sees error_hint.reason
  labels          TEXT[],
  payload_hash    TEXT,              -- gate ONCE per (job, hook_point, payload_hash)
  -- Whether the verdict's ACTION landed, and NULL is a real third answer:
  --   NULL  = nothing to apply (an `allow`/`flag`, and every request-gate row —
  --           the request gate's action is simply not inserting the job), OR
  --           the action has not landed YET. A `block`/`hold` row is INSERTed
  --           BEFORE its CAS on purpose, so a crash in that one-round-trip
  --           window leaves NULL rather than a claim that never happened.
  --   TRUE  = the whole action completed (CAS flipped, money moved, objects
  --           deleted) — written afterwards by `setDecisionApplied`.
  --   FALSE = the CAS matched no row: a concurrent terminal writer won.
  applied         BOOLEAN,
  hold_downgraded BOOLEAN NOT NULL DEFAULT FALSE,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_type        TEXT,
  latency_ms      INT,
  resolver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- review rows only
  resolver_email   TEXT,             -- denormalised (admin_messages:31-33 precedent)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_job_hook
  ON public.job_policy_decisions (job_id, hook_point);
CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_reuse
  ON public.job_policy_decisions (job_id, hook_point, payload_hash)
  WHERE verdict IN ('allow','flag','block','hold');
CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_created
  ON public.job_policy_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_open_holds
  ON public.job_policy_decisions (job_id) WHERE hook_point = 'result' AND verdict = 'hold';
-- The SAME partial predicate, led by `policy_id`, for the review queue's
-- `?policyId=` filter (admin-review.ts). It is a second index rather than a
-- widening of the one above because the two predicates want opposite leading
-- columns: `holdDecisionsFor` asks `job_id IN (…)` for the page it just read,
-- which needs `job_id` first, and the queue filter asks `policy_id = X`, which
-- a trailing `policy_id` would leave as a Filter over every hold the policy
-- ever emitted. Both are cheap: this table is created empty in this file.
CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_policy_holds
  ON public.job_policy_decisions (policy_id, job_id) WHERE hook_point = 'result' AND verdict = 'hold';
CREATE INDEX IF NOT EXISTS idx_job_policy_decisions_user_id
  ON public.job_policy_decisions (user_id);   -- FK index precedent: 052:6

ALTER TABLE public.job_policy_decisions ENABLE ROW LEVEL SECURITY;
-- No policies are created, so anon/authenticated read NOTHING even with RLS on;
-- the REVOKE makes that explicit and survives a future permissive GRANT
-- (361_availability_overrides.sql:8 model + the 346 form — anon is granted
-- separately by the Supabase platform, so REVOKE FROM PUBLIC alone leaves it
-- standing; 334:19-22 and 346:37-39 say the same).
REVOKE ALL ON TABLE public.job_policy_decisions FROM PUBLIC;
REVOKE ALL ON TABLE public.job_policy_decisions FROM anon;
REVOKE ALL ON TABLE public.job_policy_decisions FROM authenticated;
GRANT ALL ON TABLE public.job_policy_decisions TO service_role;
COMMENT ON TABLE public.job_policy_decisions IS
  'Audit of every registerJobPolicy decision (request + result) and its review outcome. Service role only.';

-- 2. The held payload. On NEITHER key list in routes/jobs.ts and in NONE of its
--    five explicit selects — AND outside 347's column GRANT
--    (347:60 grants authenticated only id, user_id, status, output_data), so
--    unreachable through PostgREST and through Realtime by construction.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS held_output_data       JSONB,
  ADD COLUMN IF NOT EXISTS held_completion_fields JSONB,
  ADD COLUMN IF NOT EXISTS held_objects           JSONB,
  ADD COLUMN IF NOT EXISTS held_at                TIMESTAMPTZ;

COMMENT ON COLUMN public.jobs.held_output_data IS
  'Quarantined output_data for a status=pending_review job. NEVER exposed through the job API; published into output_data only by the approve path.';
COMMENT ON COLUMN public.jobs.held_completion_fields IS
  'The non-output columns the completion funnel computed (provider, provider_cost, display_cost, provider_task_id, plugin extras) plus the non-column metered/meteredCost pair, replayed verbatim on approve.';
COMMENT ON COLUMN public.jobs.held_objects IS
  'Array of {key, kind, index, sizeBytes} for THIS job''s own R2 objects, computed at hold time. The review preview reads a key by index; reject deletes by key. Never a URL round trip.';
COMMENT ON COLUMN public.jobs.held_at IS 'When the result gate parked this job for review.';

-- `idx_jobs_pending_review` — the index the review queue pages on — is NOT
-- here. It is 379, alone in its own file: see the lock note at the top. Nothing
-- in this file or in 378 needs it.

-- 2b. `pending_review` is a status only the PLATFORM may write.
--
-- Section 3 widens `jobs_status_check` to admit it, and that value is the ONLY
-- authority the review queue has: `admin-review.ts` lists
-- `.eq("status","pending_review")` and joins the hold decision as decoration,
-- not as a filter. Meanwhile `jobs` still carries the table-level INSERT grant
-- to `authenticated` that 347:54-56 deliberately left alone ("the browser never
-- writes jobs, but narrowing writes is a separate change with its own blast
-- radius"), and the sole INSERT policy asks only `auth.uid() = user_id`. So
-- without this clause the CHECK widening would hand any signed-in user a
-- POST /rest/v1/jobs that plants a row in the operator's queue — and with
-- `held_at` NULL the TTL sweep (`lib/reconcile/hold-expiry.ts` filters
-- `.lt('held_at', cutoff)`) never expires it, so it sits there until a human
-- rejects it. Verified end-to-end as role `authenticated` against a database
-- with this chain applied, before and after this clause.
--
-- SURGICAL ON PURPOSE: a status clause, not a write ban. Revoking
-- INSERT/UPDATE/DELETE on `jobs` from anon/authenticated is the change 347
-- deferred and it is still the right eventual answer — but it reaches every
-- client of this schema, including ones outside this repo, and it is not this
-- migration's business. This clause closes exactly the door this migration
-- opens and nothing else. (UPDATE and DELETE need no clause: `jobs` has no
-- UPDATE or DELETE policy at all, so RLS already refuses both — a user cannot
-- insert `pending` and then flip it. `supabase/tests/job-policy-hold-privacy.behavior.sql`
-- pins all of it as behaviour, so a future permissive policy turns it red.)
--
-- DROP + CREATE rather than ALTER POLICY, the repo's convention (345:47,
-- 363:42, 365:201) — and one file is one transaction, so there is no
-- policy-less window.
DROP POLICY IF EXISTS "Users can insert own jobs" ON public.jobs;
CREATE POLICY "Users can insert own jobs" ON public.jobs
  FOR INSERT WITH CHECK (
    (select auth.uid()) = user_id
    AND status IS DISTINCT FROM 'pending_review'
  );

-- 3. Widen the status CHECK. Discovered by conkey, not by name: 001:109 declares
--    it inline as jobs_status_check, but a name is a guess and a wrong DROP
--    silently leaves the old constraint in place. Before/after counts assert it.
--    The other CHECKs on jobs are not single-column-on-status and so cannot be
--    confused with it: progress (001:111) keys on `progress`, and
--    jobs_no_private_recast_audio_url (334:116) keys on {input_data, output_data}.
DO $$
DECLARE v_attnum smallint; v_name text; v_count int;
BEGIN
  SELECT attnum INTO STRICT v_attnum FROM pg_attribute
   WHERE attrelid = 'public.jobs'::regclass AND attname = 'status' AND NOT attisdropped;

  SELECT count(*), min(conname) INTO v_count, v_name FROM pg_constraint
   WHERE conrelid = 'public.jobs'::regclass AND contype = 'c' AND conkey = ARRAY[v_attnum];
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 single-column CHECK on jobs.status before widening, found %', v_count;
  END IF;

  EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_name);
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_status_check CHECK (
      status IN ('pending','queued','processing','pending_review','completed','failed','cancelled')
    ) NOT VALID;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.jobs'::regclass AND contype = 'c' AND conkey = ARRAY[v_attnum];
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 single-column CHECK on jobs.status after widening, found %', v_count;
  END IF;
END;
$$;
