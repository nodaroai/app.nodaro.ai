-- ============================================================================
-- 722 — the ledger of a routed video run (the alternate route, Admin → Video
-- route): what a routed job's settlement is computed from, written as the run
-- goes, so every exit that settles it (the worker's completion, a recovery,
-- the retry sweep, a deferred child's release) reads the same facts and
-- charges the same.
--
-- One row per (job, kind, send, key):
--   start   — a start of send `send` is about to go out (written BEFORE the
--             call; a second insert for the same send is refused, so a crash
--             between the start and the saved reference never starts a second
--             paid task).
--   task    — the route's task of send `send` ended: its reference and the
--             verified bill the route REPORTED (`billed_usd`; `cost_basis`
--             says what it is: a money receipt, or the seconds the upstream
--             billed at the agreed rate). NULL: it reported none — the
--             settlement remains pending until it does. `estimated_usd` is
--             the route's own estimate, kept for the record, never charged.
--             A plugin's segments are rows of their PARENT job, told apart by
--             `key` (the segment's own key from the plugin, else its task
--             reference); a job's own sends have key ''.
--   addons  — the add-ons the run DELIVERED (the seamless-loop trim, the voice
--             track), in base credits (marked up at settlement, as at the hold).
--   settle  — the settlement's own state: `retry` (since `created_at`),
--             `done` (with the credits charged), `shortfall` (the payer could not
--             cover the charge; `uncollected` is outstanding), `hold` (the
--             verified bill is far above the quote: an admin confirms or
--             rejects it — `decision` — and nothing is charged meanwhile),
--             `waived` (an admin rejected the bill: the hold was released and
--             `uncollected` is the charge not taken), `unbilled` (the route
--             reported no bill after every re-read — `attempts`,
--             `next_attempt_at` — so an admin settles it at its quote or
--             releases it).
--   A task row's `outcome` says how its send ended when that is not a plain
--   delivery: `failed` / `expired` (not billed), or `unresolved` (it started
--   and could not be read to an end: a loss candidate the daily report lists).
--
-- Written and read by the server only (service role): RLS on, no policy.
--
-- This file creates NEW objects only: four tables and the functions that work
-- on them. It changes no existing table, so it takes no lock that a live
-- request can wait behind or deadlock with (measured: applying it holds no
-- lock on any existing table, on a first apply or a re-run). Nothing here
-- runs until the files that follow attach it: 723 (jobs),
-- 724 (usage_logs), 725 (topup_grants), 726 (deployment_user_allowances),
-- 727 (workspace_budgets), 728 (workflow_executions), 729 (assets) and
-- 730 (the jobs index) — ONE existing table per file, because a file is
-- applied as one transaction and a transaction that holds a lock on one live
-- table while it waits for another can deadlock with a request that takes
-- them in the other order. Some function bodies below read columns that
-- 723 adds; a body is resolved when it first runs, and nothing calls
-- these before 723 has applied. Safe to re-run.
-- ============================================================================

SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.video_route_ledger (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL,
  env text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('start', 'task', 'addons', 'settle')),
  send integer NOT NULL DEFAULT 1 CHECK (send >= 1),
  key text NOT NULL DEFAULT '',
  ref text,
  estimated_usd numeric(12, 6) CHECK (estimated_usd IS NULL OR estimated_usd >= 0),
  billed_usd numeric(12, 6) CHECK (billed_usd IS NULL OR billed_usd >= 0),
  cost_basis text CHECK (cost_basis IS NULL OR cost_basis IN ('receipt', 'billed-seconds')),
  -- A segment's start: the price id it is charged at, its quote (USD, times
  -- its factor) and that quote in charged credits.
  price_id text,
  quote_factor numeric CHECK (quote_factor IS NULL OR quote_factor >= 1),
  quoted_usd numeric(12, 6) CHECK (quoted_usd IS NULL OR quoted_usd >= 0),
  addons_base integer CHECK (addons_base IS NULL OR addons_base >= 0),
  state text CHECK (state IS NULL OR state IN ('retry', 'hold', 'unbilled', 'done', 'shortfall', 'waived')),
  -- A settlement's re-reads of the route's bill: how many, and when the next is due.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  -- How a task's send ended when it did not simply deliver.
  outcome text CHECK (outcome IS NULL OR outcome IN ('done', 'failed', 'expired', 'unresolved')),
  -- Anything else worth keeping beside a row (never read to decide a charge).
  detail jsonb,
  -- An admin's decision on a held settlement, and who made it.
  decision text CHECK (decision IS NULL OR decision IN ('confirmed', 'rejected', 'quote')),
  decided_by uuid,
  decided_at timestamptz,
  credits integer,
  uncollected integer CHECK (uncollected IS NULL OR uncollected >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind, send, key)
);

-- The retry sweep: settlements marked `retry`, oldest first, per environment.
CREATE INDEX IF NOT EXISTS video_route_ledger_retry_idx
  ON public.video_route_ledger (env, id)
  WHERE kind = 'settle' AND state = 'retry';

-- Admin → Video route: settlements held for a decision, per environment.
CREATE INDEX IF NOT EXISTS video_route_ledger_hold_idx
  ON public.video_route_ledger (env, id)
  WHERE kind = 'settle' AND state IN ('hold', 'unbilled');

-- The daily reconciliation: billed tasks of a day, per environment.
CREATE INDEX IF NOT EXISTS video_route_ledger_task_day_idx
  ON public.video_route_ledger (env, created_at)
  WHERE kind = 'task';

ALTER TABLE public.video_route_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_route_ledger FROM PUBLIC;
REVOKE ALL ON public.video_route_ledger FROM anon;
REVOKE ALL ON public.video_route_ledger FROM authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.video_route_ledger TO service_role;
-- Supabase's default privileges open a new sequence to the client roles.
REVOKE ALL ON SEQUENCE public.video_route_ledger_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.video_route_ledger_id_seq TO service_role;


-- The conventional reservation supplies payer, balance and ledger semantics.
-- Give the routed hold its own ownership mode atomically, so checkpointed-job
-- sweeps cannot settle it at the admitted ceiling.
CREATE OR REPLACE FUNCTION public.reserve_video_route_credits(
  p_user_id uuid, p_credits integer, p_job_id uuid, p_model_identifier text,
  p_run_token text, p_env text, p_provider_cost_usd numeric DEFAULT NULL,
  p_display_cost_usd numeric DEFAULT NULL, p_is_app_run boolean DEFAULT false,
  p_daily_limit integer DEFAULT NULL, p_web_free_mode boolean DEFAULT false,
  p_workspace_id uuid DEFAULT NULL, p_on_behalf_of uuid DEFAULT NULL,
  p_enforce_allowance boolean DEFAULT false, p_watermark boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j public.jobs%ROWTYPE;
  l public.usage_logs%ROWTYPE;
  reservation jsonb;
BEGIN
  SELECT * INTO STRICT j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.user_id IS DISTINCT FROM coalesce(p_on_behalf_of, p_user_id)
     OR j.workspace_id IS DISTINCT FROM p_workspace_id OR j.status NOT IN ('pending','processing') THEN
    RAISE EXCEPTION 'Routed reservation requires an owned active job';
  END IF;
  IF j.usage_log_id IS NOT NULL THEN
    SELECT * INTO STRICT l FROM public.usage_logs WHERE id = j.usage_log_id FOR UPDATE;
    IF l.job_id IS DISTINCT FROM j.id OR l.user_id IS DISTINCT FROM p_user_id OR
       l.on_behalf_of IS DISTINCT FROM p_on_behalf_of OR l.workspace_id IS DISTINCT FROM p_workspace_id OR
       l.action IS DISTINCT FROM p_model_identifier OR l.credits_used IS DISTINCT FROM p_credits OR
       l.metadata->>'reservation_mode' IS DISTINCT FROM 'video-route' OR l.status IS DISTINCT FROM 'reserved' OR
       j.metadata->'videoRouteRun'->>'usageLogId' IS DISTINCT FROM l.id::text THEN
      RAISE EXCEPTION 'Conflicting routed reservation';
    END IF;
    RETURN jsonb_build_object('usageLogId', l.id, 'creditsReserved', l.credits_used,
      'watermark', coalesce(j.should_watermark, false), 'replayed', true, 'routedRunToken',j.metadata->'videoRouteRun'->>'token');
  END IF;
  reservation := public.reserve_job_credits(p_user_id,p_credits,p_job_id,p_model_identifier,
    p_provider_cost_usd,p_display_cost_usd,p_is_app_run,p_daily_limit,p_web_free_mode,p_workspace_id,
    p_on_behalf_of,p_enforce_allowance,p_watermark);
  UPDATE public.usage_logs SET metadata = coalesce(metadata,'{}'::jsonb) || '{"reservation_mode":"video-route"}'
    WHERE id = (reservation->>'usageLogId')::uuid;
  UPDATE public.jobs SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{videoRouteRun}',
    jsonb_build_object('token',p_run_token,'usageLogId',reservation->>'usageLogId')) WHERE id = p_job_id;
  INSERT INTO public.video_route_ledger (job_id, env, kind, state) VALUES (p_job_id,p_env,'settle','retry')
    ON CONFLICT (job_id,kind,send,key) DO NOTHING;
  RETURN reservation || jsonb_build_object('routedRunToken',p_run_token);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_video_route_credits(uuid,integer,uuid,text,text,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_video_route_credits(uuid,integer,uuid,text,text,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_video_route_run(
  p_job_id uuid, p_user_id uuid, p_usage_log_id uuid, p_fee_id text,
  p_hold integer, p_token text, p_env text, p_opts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j public.jobs%ROWTYPE;
  marker jsonb;
BEGIN
  SELECT * INTO STRICT j FROM public.jobs WHERE id = p_job_id AND user_id = p_user_id FOR UPDATE;
  IF j.usage_log_id IS DISTINCT FROM p_usage_log_id OR NOT EXISTS (
    SELECT 1 FROM public.usage_logs l WHERE l.id = p_usage_log_id AND l.job_id = j.id
    AND l.action = p_fee_id AND l.credits_used = p_hold AND l.status = 'reserved'
    AND l.metadata->>'reservation_mode' = 'video-route'
  ) THEN RAISE EXCEPTION 'Routed run reservation does not match'; END IF;
  marker := j.metadata->'videoRouteRun';
  IF marker IS NULL OR marker->>'usageLogId' IS DISTINCT FROM p_usage_log_id::text THEN
    RAISE EXCEPTION 'Different routed reservation';
  END IF;
  IF p_opts IS NULL THEN RAISE EXCEPTION 'Missing routed delivery'; END IF;
  IF marker->>'token' IS DISTINCT FROM p_token OR jsonb_typeof(p_opts) <> 'object' THEN
    RAISE EXCEPTION 'Conflicting routed delivery';
  END IF;
  IF j.status IN ('pending', 'processing') THEN
    IF marker ? 'opts' AND ((marker->'opts') - 'waiveFee') IS DISTINCT FROM (p_opts - 'waiveFee') THEN
      RAISE EXCEPTION 'Conflicting routed delivery quantities';
    END IF;
    IF marker->'opts'->'waiveFee' = 'true'::jsonb THEN
      p_opts := p_opts || '{"waiveFee":true}'::jsonb;
    END IF;
  ELSIF marker->'opts' IS DISTINCT FROM p_opts THEN
    RAISE EXCEPTION 'Cannot change a published routed delivery';
  END IF;
  marker := marker || jsonb_build_object('opts', p_opts);
  INSERT INTO public.video_route_ledger (job_id, env, kind, state)
    VALUES (j.id, p_env, 'settle', 'retry') ON CONFLICT (job_id,kind,send,key) DO NOTHING;
  UPDATE public.jobs SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{videoRouteRun}', marker) WHERE id = j.id;
  RETURN marker;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_video_route_run(uuid,uuid,uuid,text,integer,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_video_route_run(uuid,uuid,uuid,text,integer,text,text,jsonb) TO service_role;

-- A direct completion (including a recovered or HD result) becomes
-- recoverable in the very transaction that publishes it.
CREATE OR REPLACE FUNCTION public.queue_completed_video_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.metadata ? 'videoRouteRun' AND NOT ((NEW.metadata->'videoRouteRun') ? 'opts') THEN
    RAISE EXCEPTION 'Routed run delivery was not prepared';
  END IF;
  IF NEW.status = 'completed' AND NEW.video_route_addons_base IS NOT NULL THEN
    INSERT INTO public.video_route_ledger(job_id,env,kind,addons_base)
      SELECT NEW.id, env, 'addons', NEW.video_route_addons_base FROM public.video_route_ledger WHERE job_id=NEW.id AND kind='start' LIMIT 1
      ON CONFLICT (job_id,kind,send,key) DO UPDATE SET addons_base=excluded.addons_base;
  END IF;
  IF NEW.parent_job_id IS NOT NULL AND NEW.input_data->'__deferSettlement' = 'true'::jsonb THEN RETURN NEW; END IF;
  INSERT INTO public.video_route_ledger (job_id, env, kind, state)
    SELECT NEW.id, env, 'settle', 'retry' FROM public.video_route_ledger
    WHERE job_id = NEW.id AND kind = 'start' LIMIT 1
    ON CONFLICT (job_id,kind,send,key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_completed_video_settlement() FROM PUBLIC, anon, authenticated;

-- Unpaid credits stay tied to the original receipt, even when a job or its
-- usage history is purged. The external customer wallet and its deployment's
-- prepaid pool are separate obligations for the same work.
CREATE TABLE IF NOT EXISTS public.video_route_debts (
  usage_log_id uuid PRIMARY KEY, job_id uuid NOT NULL, env text NOT NULL,
  user_id uuid NOT NULL, requester_id uuid, workspace_id uuid, org_id uuid,
  payer text NOT NULL CHECK (payer IN ('personal','deployment','workspace','external_wallet')),
  original_shortfall integer NOT NULL CHECK (original_shortfall > 0),
  requested integer NOT NULL CHECK (requested >= original_shortfall),
  verified_charged integer NOT NULL CHECK (verified_charged >= 0),
  remaining integer NOT NULL CHECK (remaining BETWEEN 0 AND original_shortfall),
  refunded boolean NOT NULL DEFAULT false,
  pool_remaining integer NOT NULL CHECK (pool_remaining BETWEEN 0 AND original_shortfall),
  allowance_enforced boolean NOT NULL, member_spend boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_route_debts_payer_idx ON public.video_route_debts(user_id,created_at,usage_log_id) WHERE pool_remaining > 0;
CREATE INDEX IF NOT EXISTS video_route_debts_workspace_idx ON public.video_route_debts(workspace_id) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS video_route_debts_external_idx ON public.video_route_debts(env,requester_id,usage_log_id) WHERE payer='external_wallet' AND remaining > 0;
CREATE INDEX IF NOT EXISTS video_route_debts_external_gate_idx ON public.video_route_debts(user_id,requester_id) WHERE payer='external_wallet' AND remaining>0;
-- The allowance trigger's first, cheap look: a requester's enforced debts.
CREATE INDEX IF NOT EXISTS video_route_debts_requester_idx ON public.video_route_debts(requester_id) WHERE allowance_enforced AND pool_remaining > 0;
CREATE TABLE IF NOT EXISTS public.video_route_repayments (
  usage_log_id uuid NOT NULL REFERENCES public.video_route_debts(usage_log_id),
  source text NOT NULL, receipt_id text NOT NULL, credits integer NOT NULL CHECK (credits > 0),
  remaining integer NOT NULL CHECK (remaining >= 0), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_log_id,source,receipt_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS video_route_external_repayment_once ON public.video_route_repayments(source,receipt_id) WHERE source LIKE 'external:%';
ALTER TABLE public.video_route_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_route_repayments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_route_debts, public.video_route_repayments FROM PUBLIC,anon,authenticated;
-- Exactly what the server needs, whatever the schema's default privileges granted: a debt is
-- never deleted, and a repayment is never changed or deleted.
REVOKE ALL ON public.video_route_debts, public.video_route_repayments FROM service_role;
GRANT SELECT,INSERT,UPDATE ON public.video_route_debts TO service_role;
GRANT SELECT,INSERT ON public.video_route_repayments TO service_role;

-- A repayment that could not take its locks when the funding arrived. Funding
-- is NEVER failed or delayed by a repayment: the grant commits, the repayment
-- is noted here, and `retry_deferred_video_repayments` applies it later with
-- the same source and receipt (so it is applied once). `attempts`,
-- `last_error` and `last_attempt_at` record the retries that failed; after
-- ten the row is left for an admin (the daily report lists it).
CREATE TABLE IF NOT EXISTS public.video_route_deferred_repayments (
  id bigserial PRIMARY KEY,
  env text,
  kind text NOT NULL CHECK (kind IN ('pool','workspace')),
  user_id uuid, workspace_id uuid, requester_id uuid,
  available integer NOT NULL CHECK (available > 0),
  source text NOT NULL, receipt_id text NOT NULL,
  use_subscription boolean NOT NULL DEFAULT false,
  reason text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS video_route_deferred_repayments_once ON public.video_route_deferred_repayments
  (kind, source, receipt_id, coalesce(user_id, workspace_id), coalesce(requester_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE public.video_route_deferred_repayments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_route_deferred_repayments FROM PUBLIC,anon,authenticated,service_role;
-- UPDATE: the retry locks the rows it takes (FOR UPDATE) and records a failed attempt.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.video_route_deferred_repayments TO service_role;
REVOKE ALL ON SEQUENCE public.video_route_deferred_repayments_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.video_route_deferred_repayments_id_seq TO service_role;

-- The environment of the server making this request (staging and production
-- share this database): the `x-nodaro-env` header its service-role client
-- sends with every call. NULL when the caller is not the service role, or sent
-- none (a server that predates the header, a direct connection): nothing is
-- then enforced or collected, which is the safe direction.
CREATE OR REPLACE FUNCTION public.video_route_request_env()
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  claims text := current_setting('request.jwt.claims', true);
  headers text := current_setting('request.headers', true);
BEGIN
  IF claims IS NULL OR claims = '' OR headers IS NULL OR headers = '' THEN RETURN NULL; END IF;
  BEGIN
    IF claims::jsonb ->> 'role' IS DISTINCT FROM 'service_role' THEN RETURN NULL; END IF;
    RETURN nullif(headers::jsonb ->> 'x-nodaro-env', '');
  EXCEPTION WHEN OTHERS THEN
    -- A setting that is not JSON names no environment: nothing is enforced, and nothing fails.
    RETURN NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.video_route_request_env() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.video_route_request_env() TO service_role;

-- Whether a debt of environment `p_env` is ENFORCED for THIS request: the
-- admin's `enforceUnpaidCharges` on that environment's routing policy row is
-- on, AND the request itself comes from that environment's server. So a debt
-- blocks, and is repaid from, only reservations and funding made in its own
-- environment: enforcing on staging never touches a production run or
-- top-up. Off unless saved on: a debt is then only recorded (and alerted).
-- A debt whose environment could not be told (`unknown`) is never enforced,
-- whatever a server calls itself.
CREATE OR REPLACE FUNCTION public.video_route_debt_enforced(p_env text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_env IS NULL OR p_env = '' OR p_env = 'unknown' THEN RETURN false; END IF;
  IF p_env IS DISTINCT FROM public.video_route_request_env() THEN RETURN false; END IF;
  RETURN coalesce((SELECT s.value->'enforceUnpaidCharges' = 'true'::jsonb
    FROM public.app_settings s WHERE s.key = 'video_route_policy:' || p_env), false);
END;
$$;
REVOKE ALL ON FUNCTION public.video_route_debt_enforced(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.video_route_debt_enforced(text) TO service_role;

-- Brings a job and its settlement row in line with its debt. Every lock is
-- taken NOWAIT — the job, and the settlement row before it is written — so a
-- caller never waits behind a settlement in progress: it fails, and a funding
-- caller defers the repayment.
CREATE OR REPLACE FUNCTION public.sync_video_route_debt(p_usage_log_id uuid,p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.video_route_debts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT d FROM public.video_route_debts WHERE usage_log_id=p_usage_log_id AND job_id=p_job_id FOR UPDATE NOWAIT;
  PERFORM id FROM public.video_route_ledger WHERE job_id=d.job_id AND kind='settle' FOR UPDATE NOWAIT;
  PERFORM id FROM public.jobs WHERE id=d.job_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    UPDATE public.video_route_ledger SET credits=CASE WHEN d.refunded THEN 0 ELSE d.requested-d.remaining END,
      uncollected=greatest(d.remaining,d.pool_remaining),state=CASE WHEN greatest(d.remaining,d.pool_remaining)>0 THEN 'shortfall' ELSE 'done' END,
      updated_at=now() WHERE job_id=d.job_id AND kind='settle';
    RETURN;
  END IF;
  UPDATE public.jobs SET credits_actual=CASE WHEN d.refunded THEN 0 ELSE d.requested-d.remaining END WHERE id=d.job_id;
  INSERT INTO public.video_route_ledger(job_id,env,kind,state,credits,uncollected)
    VALUES (d.job_id,d.env,'settle',CASE WHEN greatest(d.remaining,d.pool_remaining)>0 THEN 'shortfall' ELSE 'done' END,
      CASE WHEN d.refunded THEN 0 ELSE d.requested-d.remaining END,greatest(d.remaining,d.pool_remaining))
    ON CONFLICT (job_id,kind,send,key) DO UPDATE SET state=excluded.state,credits=excluded.credits,
      uncollected=excluded.uncollected,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.sync_video_route_debt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_video_route_debt(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.block_unpaid_video_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Only a debt of an environment that enforces unpaid charges blocks anything.
  IF EXISTS (SELECT 1 FROM public.video_route_debts WHERE workspace_id=NEW.workspace_id AND remaining>0
      AND public.video_route_debt_enforced(env))
    OR (NEW.workspace_id IS NULL AND EXISTS (
      SELECT 1 FROM public.video_route_debts WHERE user_id=NEW.user_id AND workspace_id IS NULL AND
        (pool_remaining>0 OR (payer='external_wallet' AND remaining>0 AND requester_id=coalesce(NEW.on_behalf_of,NEW.user_id)))
        AND public.video_route_debt_enforced(env)
    )) THEN RAISE EXCEPTION 'ROUTED_BALANCE_DUE: unsettled video charge'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_unpaid_video_reservation() FROM PUBLIC,anon,authenticated;

-- Spend only the newly funded amount, oldest bill first. A payer's enforced
-- per-requester allowance remains binding, including after the job has ended.
CREATE OR REPLACE FUNCTION public.recover_video_pool_credits(
  p_user_id uuid,p_available integer,p_source text,p_receipt text,p_requester uuid DEFAULT NULL,p_use_subscription boolean DEFAULT false
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  d public.video_route_debts%ROWTYPE; n integer; spent integer:=0;
  headroom integer; balance integer; sub integer; from_sub integer; delta integer;
BEGIN
  -- Nothing is collected for a debt of an environment that does not enforce unpaid charges.
  IF NOT EXISTS (SELECT 1 FROM public.video_route_debts WHERE user_id=p_user_id AND workspace_id IS NULL AND pool_remaining>0
    AND public.video_route_debt_enforced(env)) THEN RETURN 0; END IF;
  SELECT coalesce(topup_credits,0),coalesce(subscription_credits,0) INTO balance,sub FROM public.profiles WHERE id=p_user_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT p_use_subscription THEN sub:=0; END IF;
  p_available:=least(p_available,balance+sub);
  FOR d IN SELECT * FROM public.video_route_debts
    WHERE user_id=p_user_id AND workspace_id IS NULL AND pool_remaining>0
      AND (p_requester IS NULL OR requester_id=p_requester)
      AND public.video_route_debt_enforced(env)
    ORDER BY created_at,usage_log_id FOR UPDATE NOWAIT LOOP
    EXIT WHEN spent>=p_available;
    IF EXISTS (SELECT 1 FROM public.video_route_repayments WHERE usage_log_id=d.usage_log_id AND source=p_source AND receipt_id=p_receipt) THEN CONTINUE; END IF;
    n:=least(d.pool_remaining,p_available-spent);
    IF d.allowance_enforced THEN
      SELECT granted_credits-reserved_credits-spent_credits INTO headroom FROM public.deployment_user_allowances
        WHERE user_id=d.requester_id FOR UPDATE NOWAIT;
      n:=least(n,coalesce(headroom,0));
      IF n>0 THEN UPDATE public.deployment_user_allowances SET spent_credits=spent_credits+n,updated_at=now() WHERE user_id=d.requester_id; END IF;
    END IF;
    IF n<=0 THEN CONTINUE; END IF;
    PERFORM id FROM public.jobs WHERE id=d.job_id FOR UPDATE NOWAIT;
    SELECT coalesce((metadata->>'allowance_delta')::integer,0) INTO delta FROM public.usage_logs WHERE id=d.usage_log_id FOR UPDATE NOWAIT;
    from_sub:=least(n,sub);
    sub:=sub-from_sub;
    UPDATE public.profiles SET subscription_credits=subscription_credits-from_sub,topup_credits=topup_credits-(n-from_sub),daily_spent_credits=coalesce(daily_spent_credits,0)+n,
      app_credits_allowance=greatest(0,coalesce(app_credits_allowance,0)+sign(coalesce(delta,0))::integer*n)
      WHERE id=p_user_id;
    UPDATE public.video_route_debts SET pool_remaining=pool_remaining-n,
      remaining=CASE WHEN payer='external_wallet' THEN remaining ELSE remaining-n END,updated_at=now()
      WHERE usage_log_id=d.usage_log_id;
    -- The external operation's original capture is immutable. Its additional
    -- payments are carried only by the repayment journal.
    IF d.payer <> 'external_wallet' THEN
      UPDATE public.usage_logs SET credits_charged=credits_charged+n,
        metadata=jsonb_set(metadata,'{overrun}',coalesce(metadata->'overrun','{}'::jsonb)||
          jsonb_build_object('from_topup',coalesce((metadata->'overrun'->>'from_topup')::integer,0)+n-from_sub,
            'from_sub',coalesce((metadata->'overrun'->>'from_sub')::integer,0)+from_sub,
            'collected',coalesce((metadata->'overrun'->>'collected')::integer,0)+n,'shortfall',d.pool_remaining-n))
        WHERE id=d.usage_log_id AND status='committed';
    END IF;
    INSERT INTO public.video_route_repayments(usage_log_id,source,receipt_id,credits,remaining)
      VALUES(d.usage_log_id,p_source,p_receipt,n,d.pool_remaining-n);
    INSERT INTO public.credit_transactions(user_id,amount,credit_type,source,description,job_id,balance_after)
      SELECT p_user_id,-n,CASE WHEN from_sub=0 THEN 'topup' WHEN from_sub=n THEN 'subscription' ELSE 'mixed' END,'usage','Outstanding video charge paid',(SELECT id FROM public.jobs WHERE id=d.job_id),
        coalesce(subscription_credits,0)+coalesce(topup_credits,0) FROM public.profiles WHERE id=p_user_id;
    PERFORM public.sync_video_route_debt(d.usage_log_id,d.job_id);
    spent:=spent+n;
  END LOOP;
  RETURN spent;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_pool_credits(uuid,integer,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_video_pool_credits(uuid,integer,text,text,uuid,boolean) TO service_role;

-- The same repayment, for a caller that is FUNDING an account (a top-up, an
-- admin grant, a new allowance): it never fails the funding and never makes it
-- wait.
--   * First, one read and nothing else: with no ENFORCED debt to repay — the
--     state of every environment that has not turned enforcement on — it
--     answers 0 and the funding is exactly the grant it was before this file.
--   * Otherwise the repayment runs in the block below, its own subtransaction.
--     Every row lock in it is NOWAIT, and the function's own short
--     lock_timeout (restored when it returns) ends any other wait, so a lock
--     held elsewhere fails it at once. Whatever fails it — a timeout or a
--     cancel of the statement included — everything it did is undone, the
--     funding goes on untouched, and the repayment is noted for
--     `retry_deferred_video_repayments` (a note that cannot be written is
--     only a warning).
CREATE OR REPLACE FUNCTION public.try_recover_video_pool_credits(
  p_user_id uuid,p_available integer,p_source text,p_receipt text,p_requester uuid DEFAULT NULL,p_use_subscription boolean DEFAULT false
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '250ms' AS $$
BEGIN
  IF p_available IS NULL OR p_available <= 0 OR NOT EXISTS (SELECT 1 FROM public.video_route_debts
    WHERE user_id=p_user_id AND workspace_id IS NULL AND pool_remaining>0 AND public.video_route_debt_enforced(env)) THEN RETURN 0; END IF;
  BEGIN
    RETURN public.recover_video_pool_credits(p_user_id,p_available,p_source,p_receipt,p_requester,p_use_subscription);
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING 'video route: a repayment was deferred (%), the funding went on', SQLERRM;
    BEGIN
      INSERT INTO public.video_route_deferred_repayments(env,kind,user_id,requester_id,available,source,receipt_id,use_subscription,reason)
        VALUES(public.video_route_request_env(),'pool',p_user_id,p_requester,p_available,p_source,p_receipt,p_use_subscription,left(SQLERRM,300))
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      RAISE WARNING 'video route: a deferred repayment could not be noted (%)', SQLERRM;
    END;
    RETURN 0;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.try_recover_video_pool_credits(uuid,integer,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.try_recover_video_pool_credits(uuid,integer,text,text,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_video_topup_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.source IN ('purchase','admin') AND (TG_OP='INSERT' OR OLD.source IS DISTINCT FROM NEW.source) THEN
    -- The grant always commits: the repayment is best effort (see try_recover_video_pool_credits).
    PERFORM public.try_recover_video_pool_credits(NEW.user_id,NEW.amount,'topup',NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_topup_grant() FROM PUBLIC,anon,authenticated;

-- A requester whose deployment allowance was exhausted can repay once its
-- administrator grants new headroom, using only the deployment's own funds.
-- The allowance grant always commits: one read first (no enforced debt of this
-- requester: nothing more happens), then the repayment, best effort.
CREATE OR REPLACE FUNCTION public.recover_video_allowance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '250ms' AS $$
DECLARE payer_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.video_route_debts WHERE requester_id=NEW.user_id
    AND allowance_enforced AND pool_remaining>0 AND public.video_route_debt_enforced(env)) THEN RETURN NEW; END IF;
  BEGIN
    FOR payer_id IN SELECT DISTINCT user_id FROM public.video_route_debts WHERE requester_id=NEW.user_id
      AND allowance_enforced AND pool_remaining>0 AND public.video_route_debt_enforced(env) LOOP
      PERFORM public.try_recover_video_pool_credits(payer_id,NEW.granted_credits-OLD.granted_credits,'allowance',gen_random_uuid()::text,NEW.user_id,true);
    END LOOP;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING 'video route: an allowance repayment was skipped (%), the allowance went on', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_allowance() FROM PUBLIC,anon,authenticated;

-- Repays a workspace's debts from `p_available` newly allocated credits, oldest
-- first, and answers how many it spent (the caller adds them to the budget's
-- spent credits). Once per (debt, receipt).
CREATE OR REPLACE FUNCTION public.recover_video_workspace_credits(p_workspace_id uuid,p_available integer,p_receipt text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.video_route_debts%ROWTYPE; n integer; available integer:=p_available; spent integer:=0;
BEGIN
  FOR d IN SELECT * FROM public.video_route_debts WHERE workspace_id=p_workspace_id AND remaining>0
    AND public.video_route_debt_enforced(env)
    ORDER BY created_at,usage_log_id FOR UPDATE NOWAIT LOOP
    EXIT WHEN available<=0;
    IF EXISTS (SELECT 1 FROM public.video_route_repayments WHERE usage_log_id=d.usage_log_id AND source='allocation' AND receipt_id=p_receipt) THEN CONTINUE; END IF;
    n:=least(d.remaining,available);
    IF d.member_spend THEN
      PERFORM user_id FROM public.workspace_member_spend WHERE workspace_id=p_workspace_id AND user_id=d.user_id FOR UPDATE NOWAIT;
      UPDATE public.workspace_member_spend SET spent_credits=spent_credits+n,updated_at=now()
        WHERE workspace_id=p_workspace_id AND user_id=d.user_id;
    END IF;
    UPDATE public.video_route_debts SET remaining=remaining-n,updated_at=now() WHERE usage_log_id=d.usage_log_id;
    INSERT INTO public.video_route_repayments(usage_log_id,source,receipt_id,credits,remaining) VALUES(d.usage_log_id,'allocation',p_receipt,n,d.remaining-n);
    -- Offsetting the original variance preserves the refund calculation of
    -- the workspace credits actually spent by this usage log.
    INSERT INTO public.credit_transactions(user_id,amount,credit_type,source,description,workspace_id,org_id,job_id)
    VALUES(d.user_id,-n,'org','org_usage_variance',
      'Metered overrun beyond workspace headroom, absorbed by the platform (usage_log '||d.usage_log_id||')',
      d.workspace_id,d.org_id,(SELECT id FROM public.jobs WHERE id=d.job_id));
    PERFORM public.sync_video_route_debt(d.usage_log_id,d.job_id);
    available:=available-n;
    spent:=spent+n;
  END LOOP;
  RETURN spent;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_workspace_credits(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_video_workspace_credits(uuid,integer,text) TO service_role;

-- A workspace's new allocation repays its debts. The allocation always
-- commits: one read first (no enforced debt of this workspace: nothing more
-- happens), then the repayment in its own subtransaction, never more than the
-- budget's headroom. When a lock it needs is held, or anything else goes
-- wrong, it is undone whole and noted for a later retry.
CREATE OR REPLACE FUNCTION public.recover_video_workspace_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '250ms' AS $$
DECLARE available integer; grant_id text; n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.video_route_debts WHERE workspace_id=NEW.workspace_id AND remaining>0
    AND public.video_route_debt_enforced(env)) THEN RETURN NEW; END IF;
  available := least(NEW.allocated_credits-OLD.allocated_credits, NEW.allocated_credits-NEW.reserved_credits-NEW.spent_credits);
  IF available IS NULL OR available <= 0 THEN RETURN NEW; END IF;
  grant_id := gen_random_uuid()::text;
  BEGIN
    n := public.recover_video_workspace_credits(NEW.workspace_id,available,grant_id);
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    n := 0;
    RAISE WARNING 'video route: a workspace repayment was deferred (%), the allocation went on', SQLERRM;
    BEGIN
      INSERT INTO public.video_route_deferred_repayments(env,kind,workspace_id,available,source,receipt_id,reason)
        VALUES(public.video_route_request_env(),'workspace',NEW.workspace_id,available,'allocation',grant_id,left(SQLERRM,300))
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      RAISE WARNING 'video route: a deferred repayment could not be noted (%)', SQLERRM;
    END;
  END;
  NEW.spent_credits := NEW.spent_credits + coalesce(n,0);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_workspace_allocation() FROM PUBLIC,anon,authenticated;

-- Applies the repayments that could not take their locks when the funding
-- arrived, for the environment of the server asking; called on a timer by the
-- server, safe to call at any time. Each is its own subtransaction.
--   * A repayment takes what can be taken NOW: a payer's balance, or a
--     workspace budget's headroom (never past it). Whatever it could not cover
--     stays owed, and the next funding collects it; the note is then removed
--     (a repayment is applied once per debt and receipt, so the same note
--     could not collect the rest).
--   * A note with no enforced debt left to repay is removed (`dropped`).
--   * One that fails, or finds nothing it can take, stays noted with the
--     reason and the time; those tried longest ago go first, so one stuck note
--     never holds back the others. After ten failed tries (a lock held
--     elsewhere is not counted) it is left for an admin: `stuck` counts them,
--     and the daily report lists them.
-- Answers {applied, credits, dropped, failed, stuck}: notes applied, the
-- credits they collected, notes removed with nothing to repay, tries that
-- failed in this call, and notes left for an admin.
CREATE OR REPLACE FUNCTION public.retry_deferred_video_repayments(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '250ms' AS $$
DECLARE
  r public.video_route_deferred_repayments%ROWTYPE;
  my_env text := public.video_route_request_env();
  n integer; headroom integer; owed boolean;
  applied integer:=0; credits integer:=0; dropped integer:=0; failed integer:=0;
BEGIN
  FOR r IN SELECT * FROM public.video_route_deferred_repayments
    WHERE env IS NOT DISTINCT FROM my_env AND attempts < 10
    ORDER BY last_attempt_at NULLS FIRST, id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(coalesce(p_limit,100),1000)) LOOP
    BEGIN
      IF r.kind='pool' THEN
        n := public.recover_video_pool_credits(r.user_id,r.available,r.source,r.receipt_id,r.requester_id,r.use_subscription);
        owed := EXISTS (SELECT 1 FROM public.video_route_debts WHERE user_id=r.user_id AND workspace_id IS NULL AND pool_remaining>0
          AND (r.requester_id IS NULL OR requester_id=r.requester_id) AND public.video_route_debt_enforced(env));
      ELSE
        SELECT allocated_credits-reserved_credits-spent_credits INTO headroom FROM public.workspace_budgets
          WHERE workspace_id=r.workspace_id FOR UPDATE NOWAIT;
        n := 0;
        IF coalesce(headroom,0) > 0 THEN
          n := public.recover_video_workspace_credits(r.workspace_id,least(r.available,headroom),r.receipt_id);
          IF n > 0 THEN UPDATE public.workspace_budgets SET spent_credits=spent_credits+n WHERE workspace_id=r.workspace_id; END IF;
        END IF;
        owed := EXISTS (SELECT 1 FROM public.video_route_debts WHERE workspace_id=r.workspace_id AND remaining>0
          AND public.video_route_debt_enforced(env));
      END IF;
      IF coalesce(n,0) > 0 THEN
        DELETE FROM public.video_route_deferred_repayments WHERE id=r.id;
        applied := applied + 1;
        credits := credits + n;
      ELSIF NOT owed THEN
        DELETE FROM public.video_route_deferred_repayments WHERE id=r.id;
        dropped := dropped + 1;
      ELSE
        UPDATE public.video_route_deferred_repayments SET attempts=attempts+1,last_attempt_at=now(),
          last_error='nothing could be taken: the balance or the budget''s headroom is used up' WHERE id=r.id;
        failed := failed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Still not possible: it stays noted, with why. A lock held elsewhere is not a failed try.
      UPDATE public.video_route_deferred_repayments SET attempts=attempts+CASE WHEN SQLSTATE='55P03' THEN 0 ELSE 1 END,
        last_attempt_at=now(),last_error=left(SQLSTATE||': '||SQLERRM,300) WHERE id=r.id;
      failed := failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('applied',applied,'credits',credits,'dropped',dropped,'failed',failed,
    'stuck',(SELECT count(*) FROM public.video_route_deferred_repayments WHERE env IS NOT DISTINCT FROM my_env AND attempts >= 10));
END;
$$;
REVOKE ALL ON FUNCTION public.retry_deferred_video_repayments(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_deferred_video_repayments(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.repay_external_video_route_debt(p_usage_log_id uuid,p_provider text,p_receipt_id text,p_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.video_route_debts%ROWTYPE; payment public.video_route_repayments%ROWTYPE; src text:='external:'||p_provider;
BEGIN
  SELECT * INTO STRICT d FROM public.video_route_debts WHERE usage_log_id=p_usage_log_id AND payer='external_wallet' FOR UPDATE NOWAIT;
  IF p_credits IS NULL OR p_credits<=0 OR p_receipt_id IS NULL OR length(p_receipt_id) NOT BETWEEN 1 AND 512
     OR NOT EXISTS(SELECT 1 FROM public.external_wallet_operations WHERE usage_log_id=p_usage_log_id AND provider=p_provider
       AND requester_id=d.requester_id AND job_id=d.job_id AND actual_credits=reserved_credits AND authorized_at IS NOT NULL AND delivered_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Unverified external wallet recovery'; END IF;
  -- A replay answers with what was recorded, whatever enforcement is now: a payment already taken stays acknowledged.
  SELECT * INTO payment FROM public.video_route_repayments WHERE source=src AND receipt_id=p_receipt_id;
  IF FOUND THEN
    IF payment.usage_log_id<>p_usage_log_id OR payment.credits<>p_credits THEN RAISE EXCEPTION 'Conflicting external recovery receipt'; END IF;
    RETURN jsonb_build_object('usageLogId',p_usage_log_id,'recovered',payment.credits,'remaining',payment.remaining);
  END IF;
  IF NOT public.video_route_debt_enforced(d.env) THEN RAISE EXCEPTION 'Unpaid video charges are not enforced in this environment'; END IF;
  IF p_credits>d.remaining THEN RAISE EXCEPTION 'External recovery exceeds outstanding amount'; END IF;
  UPDATE public.video_route_debts SET remaining=remaining-p_credits,updated_at=now() WHERE usage_log_id=p_usage_log_id;
  INSERT INTO public.video_route_repayments(usage_log_id,source,receipt_id,credits,remaining) VALUES(p_usage_log_id,src,p_receipt_id,p_credits,d.remaining-p_credits);
  PERFORM public.sync_video_route_debt(d.usage_log_id,d.job_id);
  RETURN jsonb_build_object('usageLogId',p_usage_log_id,'recovered',p_credits,'remaining',d.remaining-p_credits);
END;
$$;
REVOKE ALL ON FUNCTION public.repay_external_video_route_debt(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repay_external_video_route_debt(uuid,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_refunded_video_debt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.video_route_debts SET remaining=0,pool_remaining=0,refunded=true,updated_at=now() WHERE usage_log_id=NEW.id;
  IF FOUND THEN
    UPDATE public.video_route_ledger SET state='done',credits=0,uncollected=0,updated_at=now(),note='refunded'
      WHERE job_id=NEW.job_id AND kind='settle';
    UPDATE public.jobs SET credits_actual=0 WHERE id=NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_refunded_video_debt() FROM PUBLIC,anon,authenticated;

-- Persist the full receipt alongside the charge, including workspace
-- shortfalls. A lost response can replay without making a second debit.
CREATE OR REPLACE FUNCTION public.commit_video_route_credits(
  p_usage_log_id uuid, p_job_id uuid, p_actual_credits integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  l public.usage_logs%ROWTYPE;
  receipt jsonb;
BEGIN
  PERFORM id FROM public.jobs WHERE id = p_job_id AND usage_log_id = p_usage_log_id AND status = 'completed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Routed credits require a delivered job and its reservation'; END IF;
  -- A reversal locks the usage row first. Retry the rolled-back transaction on contention.
  SELECT * INTO STRICT l FROM public.usage_logs WHERE id = p_usage_log_id AND job_id = p_job_id FOR UPDATE NOWAIT;
  IF l.status = 'committed' AND l.metadata->'videoRouteReceipt' IS NOT NULL THEN
    RETURN l.metadata->'videoRouteReceipt';
  END IF;
  IF l.status <> 'reserved' THEN RAISE EXCEPTION 'Missing routed settlement receipt'; END IF;
  receipt := public.commit_credits_metered(p_usage_log_id, p_actual_credits);
  IF receipt->>'charged' IS NULL OR receipt->>'shortfall' IS NULL OR receipt->>'collected_over_hold' IS NULL THEN
    RAISE EXCEPTION 'Missing metered settlement receipt';
  END IF;
  UPDATE public.usage_logs SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('videoRouteReceipt', receipt)
    WHERE id = p_usage_log_id AND status = 'committed' AND credits_charged = (receipt->>'charged')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Metered receipt does not match the committed charge'; END IF;
  IF (receipt->>'shortfall')::integer > 0 THEN
    INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,requester_id,workspace_id,org_id,payer,
      original_shortfall,requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(l.id,p_job_id,
      -- The environment that ran the job, always the same one: its settlement's row, else its
      -- first ledger row, else the decision stored on the job, else the server asking.
      coalesce((SELECT env FROM public.video_route_ledger WHERE job_id=p_job_id AND kind='settle' ORDER BY id LIMIT 1),
        (SELECT env FROM public.video_route_ledger WHERE job_id=p_job_id ORDER BY id LIMIT 1),
        (SELECT input_data->'__videoRoute'->>'env' FROM public.jobs WHERE id=p_job_id),
        public.video_route_request_env(),'unknown'),l.user_id,
      coalesce(l.on_behalf_of,l.user_id),l.workspace_id,l.org_id,receipt->>'payer',(receipt->>'shortfall')::integer,
      p_actual_credits,p_actual_credits-(receipt->>'shortfall')::integer,(receipt->>'shortfall')::integer,
      CASE WHEN l.workspace_id IS NULL THEN (receipt->>'shortfall')::integer ELSE 0 END,
      coalesce((l.metadata->'payer'->>'allowance_enforced')::boolean,false),coalesce((l.metadata->'payer'->>'member_spend')::boolean,false));
    IF receipt->>'payer'='external_wallet' THEN
      PERFORM public.recover_video_pool_credits(l.user_id,(receipt->>'shortfall')::integer,'external-reserve',l.id::text,coalesce(l.on_behalf_of,l.user_id),true);
    END IF;
  END IF;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_video_route_credits(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_video_route_credits(uuid,uuid,integer) TO service_role;

-- A set of published clips can be assembled later without re-entering the
-- original job or any billing funnel. The service stamps this private manifest
-- in the SAME completion update as the first playable clip. A crashed worker's
-- lease becomes eligible again. The fourth failed/expired lease exhausts it.

CREATE OR REPLACE FUNCTION public.claim_video_assembly(p_env text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j public.jobs%ROWTYPE;
  m jsonb;
  now_ms bigint := floor(extract(epoch FROM now()) * 1000)::bigint;
BEGIN
  SELECT * INTO j FROM public.jobs
  WHERE video_assembly_recovery->>'env' = p_env AND video_assembly_recovery->>'state' IN ('pending','leased')
    AND (video_assembly_recovery->>'due')::bigint <= now_ms
  ORDER BY (video_assembly_recovery->>'due')::bigint FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  m := j.video_assembly_recovery;
  -- A prior worker could have stopped between storing its file and publishing it.
  -- The claim remembers expired attempts until their deterministic files are cleared.
  IF m->>'state' = 'leased' THEN
    m := m || jsonb_build_object('abandoned',coalesce(m->'abandoned','[]'::jsonb) || jsonb_build_array(m->>'attemptId'));
  END IF;
  IF j.status <> 'completed' OR j.restricted_at IS NOT NULL OR j.deleted_at IS NOT NULL
    OR j.user_id::text IS DISTINCT FROM m->>'owner' OR j.job_type IS DISTINCT FROM m->>'jobType'
    OR coalesce(j.should_watermark,false) IS DISTINCT FROM (m->>'watermark')::boolean
    OR j.output_data->>'deliveryMode' IS DISTINCT FROM 'separate_clips'
    OR j.output_data->>'videoUrl' IS DISTINCT FROM m->>'primary'
    OR j.output_data->'unassembledClips' IS DISTINCT FROM m->'delivered' THEN
    UPDATE public.jobs SET video_assembly_recovery = NULL WHERE id = j.id;
    RETURN jsonb_build_object('id',j.id,'cleanupOnly',true,'manifest',m);
  END IF;
  IF (m->>'attempts')::integer >= 4 THEN
    UPDATE public.jobs SET video_assembly_recovery = jsonb_build_object('state','exhausted','env',p_env,'attempts',4),
      output_data = output_data || '{"assemblyRetryFinished":true}'::jsonb WHERE id = j.id;
    RETURN jsonb_build_object('id',j.id,'cleanupOnly',true,'manifest',m);
  END IF;
  m := m || jsonb_build_object('attemptId',gen_random_uuid(),'state','leased',
    'attempts',(m->>'attempts')::integer + 1,'due',now_ms + 1800000);
  UPDATE public.jobs SET video_assembly_recovery = m WHERE id = j.id;
  RETURN jsonb_build_object('id',j.id,'output',j.output_data,'manifest',m);
END;
$$;

-- A server execution can still be writing its in-memory first-clip snapshot
-- after a repair has published. Resolve only this execution's jobs and only
-- the primary that still equals that job's first delivered clip. App-run
-- edits live separately, so a runner's replacement remains authoritative.
CREATE OR REPLACE FUNCTION public.file_recovered_execution_videos() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j record;
  outp jsonb;
  row_idx integer;
  node_key text;
BEGIN
  IF current_user IN ('anon','authenticated') THEN RETURN NEW; END IF;
  FOR j IN SELECT id, input_data->>'node_id' AS node_id,
      output_data->'unassembledClips'->0->>'url' AS first_clip, output_data->>'videoUrl' AS repaired
    FROM public.jobs WHERE workflow_execution_id=NEW.id AND status='completed'
      AND restricted_at IS NULL AND deleted_at IS NULL AND video_assembly_recovery->>'state'='done'
  LOOP
    node_key := j.node_id;
    IF node_key IS NULL THEN CONTINUE; END IF;
    outp := NEW.node_states #> ARRAY[node_key,'output'];
    IF outp IS NULL OR j.first_clip IS NULL OR j.repaired IS NULL THEN CONTINUE; END IF;
    IF outp->>'clipJobId'=j.id::text AND outp->>'videoUrl'=j.first_clip THEN
      outp := jsonb_set(outp,'{videoUrl}',to_jsonb(j.repaired));
    END IF;
    IF jsonb_typeof(outp->'listResultStamps')='array' AND jsonb_typeof(outp->'listResults')='array' THEN
      FOR row_idx IN SELECT (ordinality-1)::int FROM jsonb_array_elements(outp->'listResultStamps') WITH ORDINALITY
        WHERE value->>'clipJobId'=j.id::text AND (outp->'listResults'->>(ordinality-1)::int)=j.first_clip
      LOOP
        outp := jsonb_set(outp,ARRAY['listResults',row_idx::text],to_jsonb(j.repaired));
      END LOOP;
    END IF;
    NEW.node_states := jsonb_set(NEW.node_states,ARRAY[node_key,'output'],outp);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.file_recovered_execution_videos() FROM PUBLIC,anon,authenticated;

-- The attempt id fences off an expired worker. Checking the approved output
-- again keeps a reaper, review, restriction or expunge from being reversed.
-- The Library row is changed in the same transaction, retaining its visibility.
CREATE OR REPLACE FUNCTION public.finish_video_assembly(p_job_id uuid, p_attempt_id uuid, p_state text,
  p_expected_output jsonb DEFAULT NULL, p_video_url text DEFAULT NULL, p_key text DEFAULT NULL,
  p_size bigint DEFAULT NULL, p_source_keys text[] DEFAULT NULL, p_companions jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j public.jobs%ROWTYPE;
  m jsonb;
  n integer;
  a record;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  m := j.video_assembly_recovery;
  IF m->>'state' IS DISTINCT FROM 'leased' OR m->>'attemptId' IS DISTINCT FROM p_attempt_id::text THEN RETURN FALSE; END IF;
  n := (m->>'attempts')::integer;
  IF p_state = 'retry' AND n < 4 THEN
    UPDATE public.jobs SET video_assembly_recovery = m || jsonb_build_object('state','pending',
      'due', floor(extract(epoch FROM now()) * 1000)::bigint + (60000 * power(4,n))::bigint) WHERE id = j.id;
    RETURN TRUE;
  ELSIF p_state IN ('retry','discard') THEN
    UPDATE public.jobs SET video_assembly_recovery = jsonb_build_object('state', CASE WHEN p_state='retry' THEN 'exhausted' ELSE 'discarded' END,
      'attempts',n,'env',m->>'env'),
      output_data = CASE WHEN j.status='completed' AND j.restricted_at IS NULL AND j.deleted_at IS NULL
        AND output_data->>'deliveryMode'='separate_clips' AND output_data->>'videoUrl'=m->>'primary'
        THEN output_data || '{"assemblyRetryFinished":true}'::jsonb ELSE output_data END WHERE id = j.id;
    RETURN TRUE;
  ELSIF p_state IS DISTINCT FROM 'publish' THEN RAISE EXCEPTION 'Unknown assembly outcome'; END IF;
  IF j.status <> 'completed' OR j.restricted_at IS NOT NULL OR j.deleted_at IS NOT NULL
    OR j.user_id::text IS DISTINCT FROM m->>'owner' OR j.job_type IS DISTINCT FROM m->>'jobType'
    OR coalesce(j.should_watermark,false) IS DISTINCT FROM (m->>'watermark')::boolean
    OR j.output_data IS DISTINCT FROM p_expected_output OR j.output_data->>'deliveryMode' IS DISTINCT FROM 'separate_clips'
    OR j.output_data->>'videoUrl' IS DISTINCT FROM m->>'primary'
    OR j.output_data->'unassembledClips' IS DISTINCT FROM m->'delivered'
    OR p_key IS DISTINCT FROM 'videos/' || j.id::text || '-assembly-' || p_attempt_id::text || '.mp4'
    OR p_video_url IS NULL OR p_size IS NULL OR p_size <= 0 OR p_source_keys IS NULL
    OR EXISTS (SELECT 1 FROM public.content_restrictions r WHERE r.lifted_at IS NULL AND (r.r2_keys && p_source_keys OR p_key = ANY(r.r2_keys)))
    OR EXISTS (SELECT 1 FROM public.account_blocks b WHERE b.user_id = j.user_id)
    OR EXISTS (SELECT 1 FROM public.account_sanctions s WHERE s.user_id = j.user_id AND s.kind = 'suspended' AND s.lifted_at IS NULL AND s.ends_at > now())
    OR EXISTS (SELECT 1 FROM public.quiet_stops q JOIN public.profiles p ON p.id = q.user_id WHERE q.user_id = j.user_id
       AND lower(coalesce(p.tier,'free')) = 'free' AND coalesce(p.topup_credits,0) <= 0) THEN
    UPDATE public.jobs SET video_assembly_recovery = NULL WHERE id = j.id;
    RETURN FALSE;
  END IF;
  -- A restricted or expired result must never gain a replacement address.
  FOR a IN SELECT id, restricted_at, expires_at FROM public.assets WHERE job_id=j.id AND user_id=j.user_id AND type='video' AND r2_url=m->>'primary' FOR UPDATE LOOP
    IF a.restricted_at IS NOT NULL OR a.expires_at <= now() THEN
      UPDATE public.jobs SET video_assembly_recovery = NULL WHERE id = j.id;
      RETURN FALSE;
    END IF;
  END LOOP;
  UPDATE public.jobs SET output_data = (output_data - 'assemblyInputsPending') || jsonb_build_object('videoUrl',p_video_url,'deliveryMode','simple_cuts'),
    video_assembly_recovery = jsonb_build_object('state','done','env',m->>'env','attempts',n,'attemptId',p_attempt_id,
      'size',p_size,'companions',coalesce(p_companions,'[]'::jsonb))
    WHERE id=j.id;
  UPDATE public.assets SET r2_url=p_video_url, r2_key=p_key, filename=split_part(p_key,'/',2), size_bytes=p_size,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('companions',coalesce(p_companions,'[]'::jsonb))
    WHERE job_id=j.id AND user_id=j.user_id AND type='video' AND r2_url=m->>'primary';
  IF j.workflow_execution_id IS NOT NULL THEN
    -- Take the execution lock even when its worker has not filed this output
    -- yet. A concurrent or later snapshot also runs the trigger above.
    UPDATE public.workflow_executions SET node_states=node_states WHERE id=j.workflow_execution_id;
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_video_assembly(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_assembly(text) TO service_role;
REVOKE ALL ON FUNCTION public.finish_video_assembly(uuid,uuid,text,jsonb,text,text,bigint,text[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_video_assembly(uuid,uuid,text,jsonb,text,text,bigint,text[],jsonb) TO service_role;

-- The initial asset filing can straddle recovery (e.g. a slow storage HEAD).
-- Serialize with the publisher's job lock. A late insert files the new primary;
-- an earlier committed insert will be upgraded by finish_video_assembly.
CREATE OR REPLACE FUNCTION public.file_recovered_video_primary() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j record;
BEGIN
  IF current_user IN ('anon','authenticated') THEN RETURN NEW; END IF;
  SELECT user_id, output_data, video_assembly_recovery AS m INTO j FROM public.jobs WHERE id=NEW.job_id FOR SHARE;
  IF FOUND AND j.user_id=NEW.user_id AND j.m->>'state'='done'
    AND NEW.r2_url=j.output_data->'unassembledClips'->0->>'url' THEN
    NEW.r2_key := 'videos/' || NEW.job_id::text || '-assembly-' || (j.m->>'attemptId') || '.mp4';
    NEW.r2_url := j.output_data->>'videoUrl';
    NEW.filename := split_part(NEW.r2_key,'/',2);
    NEW.size_bytes := (j.m->>'size')::bigint;
    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('companions',j.m->'companions');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.file_recovered_video_primary() FROM PUBLIC,anon,authenticated;
