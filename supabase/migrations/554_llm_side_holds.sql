-- 554: metered LLM SIDE holds — a metered hold for one LLM call a job makes
-- beside its own reservation, that never touches the job's billing.
--
-- The UGC Clip job holds ONE managed reservation for the whole clip (391
-- `reserve_job_credits`, 'job-once'; settled from its checkpoints, 393). Its
-- per-take frame check is a metered LLM call (`image-to-text:<model>`) that is
-- charged what it really cost (D1), billed failures included (D10). That
-- metered hold cannot live on the clip's row: a second reservation through the
-- job path would overwrite `jobs.usage_log_id` / `credits` (every checkpoint
-- then raises JOB_SETTLEMENT_CONFLICT), 391 refuses a job that already has
-- usage, and its settle would write the clip's `credits_actual`,
-- `provider_cost` and `llm_billing`.
--
-- A side hold is therefore a usage log that is NOT the job's:
--   * `usage_logs.job_id` is NULL. Every reader keyed on a job's usage logs —
--     391's "job already has usage" refusal, the managed checkpoint and settle
--     (they compare `jobs.usage_log_id`, which a side hold never writes), a
--     cancel's or a failure's refund of the job's holds, the reconcile sweeps,
--     `loadUsageLogId` — cannot see it, by construction. 391/392/393 are not
--     redefined: none of them can reach a log with no job.
--   * its link to the job, its per-hold call-start marker, its billing ledger
--     and its sweep state live in `llm_side_holds` below — SERVER-ONLY, like
--     552's `jobs.llm_billing` (the ledger is the provider's dollar cost and
--     the serving lanes: never readable by a user).
--   * `usage_logs.metadata.reservation_mode = 'side'` marks the log itself.
--
-- It settles through the ordinary metered commit (551 `commit_credits_metered`:
-- the actual, an overrun collected from the payer, the shortfall logged) and
-- the same refund. The payer is the job's: the reserve checks the job's owner
-- and workspace, exactly as 391 does for the job's own reservation.

-- ---------------------------------------------------------------------------
-- 1. The side-hold table (service role only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.llm_side_holds (
  usage_log_id    uuid PRIMARY KEY REFERENCES public.usage_logs(id) ON DELETE CASCADE,
  -- The job the call is made for. SET NULL when the job is deleted: the hold
  -- is still settled by the side-hold sweep.
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- The job's owner (the requester), whoever pays.
  user_id         uuid NOT NULL,
  charge_id       text NOT NULL CHECK (length(charge_id) > 0),
  hold_credits    integer NOT NULL CHECK (hold_credits > 0),
  -- The caller's idempotency key (e.g. one take of a clip): a reserve replayed
  -- with the same key returns the same hold instead of stacking a second one.
  hold_key        text CHECK (hold_key IS NULL OR length(hold_key) BETWEEN 1 AND 200),
  -- The per-hold call-start marker (R38 for a side hold): true until the call
  -- is about to be sent; `call_started_at` is stamped then, through
  -- `llm_side_hold_call_starting` — a CAS on the job being live.
  pre_call        boolean NOT NULL DEFAULT true,
  call_started_at timestamptz,
  -- Once set, no call may start on this hold (a settle, a cancel or the sweep
  -- closed it).
  closed_at       timestamptz,
  -- The billing ledger ({ costUsd, source, calls, lanes, chargeId, attempts }).
  ledger          jsonb CHECK (ledger IS NULL OR jsonb_typeof(ledger) = 'object'),
  -- A CONFIRMED settle (the commit's receipt, or a refund): the sweep stops here.
  settled_at      timestamptz,
  outcome         text CHECK (outcome IS NULL OR outcome IN ('charged', 'refunded')),
  -- The side-hold sweep's own counter (never the job's `reconcile_attempts`).
  sweep_attempts  integer NOT NULL DEFAULT 0,
  sweep_billed    boolean NOT NULL DEFAULT false,
  sweep_last_error text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS llm_side_holds_job_key
  ON public.llm_side_holds (job_id, hold_key) WHERE hold_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS llm_side_holds_job ON public.llm_side_holds (job_id);
-- The sweep reads the holds no settle has confirmed yet, fewest attempts first
-- (a hold retried at the D10 cap never starves a newer one), oldest first.
DROP INDEX IF EXISTS public.llm_side_holds_open;
CREATE INDEX IF NOT EXISTS llm_side_holds_open_by_attempts
  ON public.llm_side_holds (sweep_attempts, created_at) WHERE settled_at IS NULL;
-- The admin credit audit's window read.
CREATE INDEX IF NOT EXISTS llm_side_holds_created_at ON public.llm_side_holds (created_at);

ALTER TABLE public.llm_side_holds ENABLE ROW LEVEL SECURITY;
-- No policy: only the service role (which bypasses RLS) reads or writes it.
REVOKE ALL ON TABLE public.llm_side_holds FROM PUBLIC;
REVOKE ALL ON TABLE public.llm_side_holds FROM anon;
REVOKE ALL ON TABLE public.llm_side_holds FROM authenticated;
GRANT ALL ON TABLE public.llm_side_holds TO service_role;

COMMENT ON TABLE public.llm_side_holds IS
  'Metered LLM side holds (554): a usage log reserved for one LLM call of a job, outside the job''s own reservation. Server-only (the ledger is provider $ and lanes); never granted to anon/authenticated.';

-- ---------------------------------------------------------------------------
-- 2. reserve_llm_side_hold — the debit, the hold row and its ledger line in
--    ONE transaction, like 391. The payer arguments are reserve_credits' own
--    (382), so every gate the RPC runs — balance, daily cap, workspace budget
--    and member cap, the deployment allowance, web-free mode — applies as it
--    does to any reservation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_llm_side_hold(
  p_user_id UUID, p_credits INTEGER, p_job_id UUID, p_charge_id TEXT,
  p_hold_key TEXT DEFAULT NULL,
  p_is_app_run BOOLEAN DEFAULT FALSE, p_daily_limit INTEGER DEFAULT NULL,
  p_web_free_mode BOOLEAN DEFAULT FALSE, p_workspace_id UUID DEFAULT NULL,
  p_on_behalf_of UUID DEFAULT NULL, p_enforce_allowance BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_hold public.llm_side_holds%ROWTYPE;
  v_usage public.usage_logs%ROWTYPE;
  v_owner UUID;
  v_id UUID;
  v_balance INTEGER := 0;
  v_type TEXT;
BEGIN
  -- Validated before anything moves.
  IF p_credits IS NULL OR p_credits <= 0 OR p_job_id IS NULL
    OR p_charge_id IS NULL OR length(p_charge_id) = 0
    OR (p_hold_key IS NOT NULL AND (length(p_hold_key) = 0 OR length(p_hold_key) > 200)) THEN
    RAISE EXCEPTION 'SIDE_HOLD_INVALID: positive credits, a job and a charge id are required' USING ERRCODE = '22023';
  END IF;
  v_owner := coalesce(p_on_behalf_of, p_user_id);
  -- FOR SHARE (391's lock order: the job first): a cancel's flip waits for
  -- this reservation to commit, so the settle it runs after the flip sees it.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM v_owner OR v_job.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'SIDE_HOLD_INACTIVE: owned active job required' USING ERRCODE = '55020';
  END IF;
  -- The job's payer: a side hold is paid by whoever pays for the job.
  IF v_job.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'SIDE_HOLD_CONFLICT: workspace differs from the job' USING ERRCODE = '55021';
  END IF;
  IF p_hold_key IS NOT NULL THEN
    -- Two reserves of the same key (a retried attempt racing its first) are
    -- serialized here: the second waits for the first to commit, then replays it.
    PERFORM pg_advisory_xact_lock(hashtextextended('llm_side_hold:' || p_job_id::text || ':' || p_hold_key, 0));
    SELECT * INTO v_hold FROM public.llm_side_holds WHERE job_id = p_job_id AND hold_key = p_hold_key FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO v_usage FROM public.usage_logs WHERE id = v_hold.usage_log_id;
      -- Another call under the same key. (A different hold amount is not: a
      -- reprice between the attempts replays the hold already reserved.)
      IF v_hold.charge_id IS DISTINCT FROM p_charge_id THEN
        RAISE EXCEPTION 'SIDE_HOLD_CONFLICT: the key names another hold' USING ERRCODE = '55021';
      END IF;
      -- The key's hold is already settled (or closed): its call ran and was
      -- billed, or it was released. A retried attempt must not reuse it — it
      -- either keeps what that reading answered or reserves under a new key.
      IF v_usage.status IS DISTINCT FROM 'reserved' OR v_hold.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'SIDE_HOLD_KEY_SETTLED: the key names a settled hold (%)', coalesce(v_hold.outcome, v_usage.status) USING ERRCODE = '55021';
      END IF;
      -- A replay (a lost response, a retried attempt): the same hold, with
      -- what it recorded so far.
      RETURN jsonb_build_object('usageLogId', v_hold.usage_log_id, 'creditsReserved', v_hold.hold_credits,
        'replayed', true, 'ledger', v_hold.ledger);
    END IF;
  END IF;
  -- The job is deliberately NOT passed: the side hold is no reservation OF the job.
  v_id := public.reserve_credits(p_user_id, p_credits, NULL, p_charge_id, 0, 0, p_is_app_run,
    p_daily_limit, p_web_free_mode, p_workspace_id, p_on_behalf_of, p_enforce_allowance);
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIDE_HOLD_INVALID: debit has no receipt' USING ERRCODE = '55021'; END IF;
  UPDATE public.usage_logs SET metadata = coalesce(metadata, '{}'::jsonb) || '{"reservation_mode":"side"}'::jsonb WHERE id = v_id;
  INSERT INTO public.llm_side_holds (usage_log_id, job_id, user_id, charge_id, hold_credits, hold_key)
    VALUES (v_id, p_job_id, v_owner, p_charge_id, p_credits, p_hold_key);
  IF p_workspace_id IS NOT NULL THEN
    v_type := 'org';
  ELSE
    v_type := CASE WHEN coalesce((v_usage.metadata->>'from_topup')::integer, 0) > 0
      AND coalesce((v_usage.metadata->>'from_sub')::integer, 0) = 0 THEN 'topup' ELSE 'subscription' END;
    SELECT coalesce(subscription_credits, 0) + coalesce(topup_credits, 0) INTO v_balance
      FROM public.profiles WHERE id = p_user_id;
  END IF;
  -- The debit's ledger line in the same transaction (391): a lost response
  -- can neither drop it nor write it twice. It names the job the call was for.
  INSERT INTO public.credit_transactions(user_id, amount, credit_type, source, description,
    job_id, balance_after, workspace_id, org_id)
  VALUES(p_user_id, -p_credits, v_type, CASE WHEN p_workspace_id IS NULL THEN 'usage' ELSE 'org_usage' END,
    'Job ' || p_job_id || ': ' || p_charge_id, p_job_id, coalesce(v_balance, 0), p_workspace_id, v_usage.org_id);
  RETURN jsonb_build_object('usageLogId', v_id, 'creditsReserved', p_credits, 'replayed', false, 'ledger', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_llm_side_hold(UUID,INTEGER,UUID,TEXT,TEXT,BOOLEAN,INTEGER,BOOLEAN,UUID,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_llm_side_hold(UUID,INTEGER,UUID,TEXT,TEXT,BOOLEAN,INTEGER,BOOLEAN,UUID,UUID,BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. llm_side_hold_call_starting — the per-hold call-start CAS, run
--    immediately before the call is sent:
--      'started'  — stamped; send the call;
--      'not-live' — the job is no longer pending/processing (cancelled, gone):
--                   never send it;
--      'closed'   — the hold was settled or closed (or is unknown): never send it.
--    The job row is locked FOR SHARE first (the reserve's order), so a
--    cancel's flip either waits for this stamp — and its settle then sees the
--    call started — or lands first, and this answers 'not-live'. The job's
--    own `provider_call_started_at` and reconcile state are never touched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.llm_side_hold_call_starting(p_usage_log_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job_id UUID;
  v_status TEXT;
  v_hold public.llm_side_holds%ROWTYPE;
  v_log_status TEXT;
BEGIN
  SELECT job_id INTO v_job_id FROM public.llm_side_holds WHERE usage_log_id = p_usage_log_id;
  IF NOT FOUND THEN RETURN 'closed'; END IF;
  IF v_job_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.jobs WHERE id = v_job_id FOR SHARE;
  END IF;
  SELECT * INTO v_hold FROM public.llm_side_holds WHERE usage_log_id = p_usage_log_id FOR UPDATE;
  IF v_hold.closed_at IS NOT NULL OR v_hold.settled_at IS NOT NULL THEN RETURN 'closed'; END IF;
  SELECT status INTO v_log_status FROM public.usage_logs WHERE id = p_usage_log_id FOR SHARE;
  IF v_log_status IS DISTINCT FROM 'reserved' THEN RETURN 'closed'; END IF;
  IF v_status IS NULL OR v_status NOT IN ('pending', 'processing') THEN RETURN 'not-live'; END IF;
  UPDATE public.llm_side_holds SET pre_call = false, call_started_at = now() WHERE usage_log_id = p_usage_log_id;
  RETURN 'started';
END;
$$;
REVOKE ALL ON FUNCTION public.llm_side_hold_call_starting(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.llm_side_hold_call_starting(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. reverse_settled_llm_charge — the reversal of a SETTLED metered charge,
--    shared by the two deliberate platform refunds below. The reverse of the
--    commit, per payer, for what the commit actually moved:
--      * a workspace payer: the budget's (and the member's) spend goes back by
--        what 351's clamp SPENT — the charge minus the overrun it could not
--        fit, which commit_credits wrote as the 'org_usage_variance' line that
--        names this log (382's exact wording) and the platform absorbed;
--      * a deployment payer's enforced allowance: the requester's spend goes
--        back by what the allowance took — the charge minus the 'overrun'
--        grant row commit_credits wrote for this log (382's exact wording);
--      * the payer's pools: what the commit kept of the top-up part (it
--        returns a surplus to the top-up first) plus what an overrun took from
--        it; the rest to the subscription; the daily counter and the app
--        allowance follow.
--    The log turns `refunded` (its charge 0 everywhere a charge is read), the
--    `p_marker` key is stamped in its metadata (the admin credit audit reads
--    it as a deliberate refund, never the D10 bug class) and a refund line
--    naming the job is written. Answers 'refunded', 'not-committed' (nothing
--    to give back, or already given) or 'unsupported' (an external-wallet row:
--    its journal is not reversed here — the caller reports it for review).
--    Never called directly: the two functions below guard which log it gets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_settled_llm_charge(
  p_usage_log_id UUID, p_job_id UUID, p_marker TEXT, p_description TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_usage public.usage_logs%ROWTYPE;
  v_charged INTEGER;
  v_spent INTEGER;
  v_meta JSONB;
  v_kept_topup INTEGER;
  v_refund_topup INTEGER;
  v_refund_sub INTEGER;
  v_delta INTEGER;
  v_adjust INTEGER;
  v_balance INTEGER := 0;
  v_returned INTEGER;
BEGIN
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR v_usage.status IS DISTINCT FROM 'committed' THEN RETURN 'not-committed'; END IF;
  v_charged := coalesce(v_usage.credits_charged, v_usage.credits_used, 0);
  v_meta := coalesce(v_usage.metadata, '{}'::jsonb);
  IF coalesce((v_meta->>'external_wallet')::boolean, false) THEN RETURN 'unsupported'; END IF;
  IF v_charged <= 0 THEN
    UPDATE public.usage_logs SET status = 'refunded', credits_charged = 0,
           metadata = v_meta || jsonb_build_object(p_marker, jsonb_build_object('credits', 0, 'at', now()))
     WHERE id = p_usage_log_id;
    RETURN 'refunded';
  END IF;
  v_returned := v_charged;

  IF v_usage.workspace_id IS NOT NULL THEN
    -- What the commit SPENT: 351's clamp put the charge into the workspace's
    -- spend only up to its headroom and wrote the rest as this log's
    -- org_usage_variance line (absorbed by the platform). Reversing the whole
    -- charge would give the class budget back credits it never spent.
    v_spent := GREATEST(v_charged - coalesce((
      SELECT sum(amount) FROM public.credit_transactions
       WHERE source = 'org_usage_variance' AND workspace_id = v_usage.workspace_id
         AND description = 'Metered overrun beyond workspace headroom, absorbed by the platform (usage_log ' || p_usage_log_id || ')'
    ), 0), 0);
    UPDATE public.workspace_budgets SET spent_credits = GREATEST(spent_credits - v_spent, 0), updated_at = now()
     WHERE workspace_id = v_usage.workspace_id;
    IF coalesce((v_meta->'payer'->>'member_spend')::boolean, false) THEN
      UPDATE public.workspace_member_spend SET spent_credits = GREATEST(spent_credits - v_spent, 0), updated_at = now()
       WHERE workspace_id = v_usage.workspace_id AND user_id = v_usage.user_id;
    END IF;
    v_returned := v_spent;
  ELSE
    -- A deployment payer's enforced allowance: the requester's spend goes back
    -- by what the allowance took — the charge minus the overrun 382's clamp
    -- could not fit (its 'overrun' grant row for this log).
    IF coalesce((v_meta->'payer'->>'allowance_enforced')::boolean, false) AND v_usage.on_behalf_of IS NOT NULL THEN
      PERFORM 1 FROM public.deployment_user_allowances WHERE user_id = v_usage.on_behalf_of FOR UPDATE;
      v_spent := GREATEST(v_charged - coalesce((
        SELECT -sum(credits) FROM public.deployment_allowance_grants
         WHERE user_id = v_usage.on_behalf_of AND kind = 'overrun'
           AND note = 'metered overrun beyond allowance headroom (usage_log ' || p_usage_log_id || ')'
      ), 0), 0);
      UPDATE public.deployment_user_allowances SET spent_credits = GREATEST(spent_credits - v_spent, 0), updated_at = now()
       WHERE user_id = v_usage.on_behalf_of;
    END IF;
    -- The pools it was paid from: what the commit kept of the top-up part (it
    -- returns a surplus to the top-up first) plus what an overrun took from it;
    -- the rest from the subscription.
    v_kept_topup := GREATEST(coalesce((v_meta->>'from_topup')::integer, 0)
                      - GREATEST(coalesce(v_usage.credits_used, 0) - LEAST(v_charged, coalesce(v_usage.credits_used, 0)), 0), 0)
                    + coalesce((v_meta->'overrun'->>'from_topup')::integer, 0);
    v_refund_topup := LEAST(v_charged, v_kept_topup);
    v_refund_sub := v_charged - v_refund_topup;
    v_delta := coalesce((v_meta->>'allowance_delta')::integer, 0);
    v_adjust := CASE WHEN v_delta < 0 THEN LEAST(v_charged, -v_delta + coalesce((v_meta->'overrun'->>'collected')::integer, 0))
                     WHEN v_delta > 0 THEN -LEAST(v_charged, v_delta + coalesce((v_meta->'overrun'->>'collected')::integer, 0))
                     ELSE 0 END;
    UPDATE public.profiles
       SET subscription_credits = subscription_credits + v_refund_sub,
           topup_credits = topup_credits + v_refund_topup,
           daily_spent_credits = GREATEST(0, coalesce(daily_spent_credits, 0) - v_charged),
           app_credits_allowance = GREATEST(0, coalesce(app_credits_allowance, 0) + v_adjust)
     WHERE id = v_usage.user_id;
    SELECT coalesce(subscription_credits, 0) + coalesce(topup_credits, 0) INTO v_balance
      FROM public.profiles WHERE id = v_usage.user_id;
  END IF;

  UPDATE public.usage_logs
     SET status = 'refunded',
         metadata = v_meta || jsonb_build_object(p_marker, jsonb_build_object('credits', v_returned, 'at', now()))
   WHERE id = p_usage_log_id;
  INSERT INTO public.credit_transactions(user_id, amount, credit_type, source, description,
    job_id, balance_after, workspace_id, org_id)
  VALUES(v_usage.user_id, v_returned,
    CASE WHEN v_usage.workspace_id IS NOT NULL THEN 'org'
         WHEN coalesce(v_refund_sub, 0) > 0 AND coalesce(v_refund_topup, 0) > 0 THEN 'mixed'
         WHEN coalesce(v_refund_topup, 0) > 0 THEN 'topup' ELSE 'subscription' END, 'refund',
    p_description,
    -- FK-safe: a usage log can outlive its job.
    (SELECT id FROM public.jobs WHERE id = p_job_id), coalesce(v_balance, 0), v_usage.workspace_id, v_usage.org_id);
  RETURN 'refunded';
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_settled_llm_charge(UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_settled_llm_charge(UUID,UUID,TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. refund_settled_side_hold — a DELIBERATE platform refund of a side hold
--    already charged (R57: a held job the owner withdraws is refunded whole —
--    its readings too, as when they sat inside its own reservation; R61: a
--    result-policy block or a reviewer's reject of the job likewise). Never a
--    D10 path: a billed call settled by its own settle stays charged
--    everywhere else. Only a SIDE log can be refunded here. Answers as
--    reverse_settled_llm_charge; the side-hold row's outcome follows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_settled_side_hold(p_usage_log_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_usage public.usage_logs%ROWTYPE;
  v_job_id UUID;
  v_answer TEXT;
BEGIN
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR v_usage.status IS DISTINCT FROM 'committed'
    OR v_usage.metadata->>'reservation_mode' IS DISTINCT FROM 'side' THEN
    RETURN 'not-committed';
  END IF;
  SELECT job_id INTO v_job_id FROM public.llm_side_holds WHERE usage_log_id = p_usage_log_id;
  v_answer := public.reverse_settled_llm_charge(p_usage_log_id, v_job_id, 'side_refund',
    'Refunded job ' || coalesce(v_job_id::text, '') || ': ' || coalesce(v_usage.action, 'reading'));
  IF v_answer = 'refunded' THEN
    UPDATE public.llm_side_holds SET outcome = 'refunded' WHERE usage_log_id = p_usage_log_id;
  END IF;
  RETURN v_answer;
END;
$$;
REVOKE ALL ON FUNCTION public.refund_settled_side_hold(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_settled_side_hold(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. refund_settled_metered_charge — R61: a DELIBERATE platform refund of a
--    job's OWN metered charge, already settled (a metered LLM job settles
--    BEFORE its completion write, so the result gate finds it committed): a
--    result-policy block, a reviewer's reject or the owner's withdraw of a
--    held job — "a platform gate's false positives are ours" (D19), the same
--    shape as R57. Never a D10 path: nothing else refunds a billed call.
--    Only the job's own log (never a side log, never another job's), and only
--    once the job is no longer live (failed or cancelled — never a completed
--    job). The caller passes metered logs only. Answers as
--    reverse_settled_llm_charge, or 'job-live' when the job is not failed or
--    cancelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_settled_metered_charge(p_usage_log_id UUID, p_job_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_usage public.usage_logs%ROWTYPE;
  v_status TEXT;
BEGIN
  IF p_job_id IS NULL THEN RETURN 'not-committed'; END IF;
  -- The job first (391's lock order), then its log.
  SELECT status INTO v_status FROM public.jobs WHERE id = p_job_id FOR SHARE;
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR v_usage.status IS DISTINCT FROM 'committed'
    OR v_usage.job_id IS DISTINCT FROM p_job_id
    OR v_usage.metadata->>'reservation_mode' IS NOT DISTINCT FROM 'side' THEN
    RETURN 'not-committed';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('failed', 'cancelled') THEN RETURN 'job-live'; END IF;
  RETURN public.reverse_settled_llm_charge(p_usage_log_id, p_job_id, 'policy_refund',
    'Refunded job ' || p_job_id || ': ' || coalesce(v_usage.action, 'generate'));
END;
$$;
REVOKE ALL ON FUNCTION public.refund_settled_metered_charge(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_settled_metered_charge(UUID,UUID) TO service_role;
