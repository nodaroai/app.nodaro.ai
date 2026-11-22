-- 684: "First Remake on us" — an account that never paid gets its FIRST Video
-- Remake run (a direct run or a trend run) even when the run's quote is above
-- its balance. The run reserves and charges as any run; the offer covers only
-- what the account's own credits cannot, and the balance ends at 0.
--
-- THE COVER NEVER ENTERS THE ACCOUNT'S POOLS. It lives on the offer row
-- (`cover_remaining`), and only a hold of the covered run's own job tree may
-- draw on it (reserve_credits, below): the run's job, its descendants by
-- parent_job_id, and the LLM side holds of those jobs. Every other debit path
-- (an app's creator fee, a metered overrun, an admin adjustment, any direct
-- debit) reads the pools only and cannot see it. A hold that drew on the cover
-- returns its unused part to the cover, never to the pools (commit_credits,
-- refund_credits, reverse_settled_llm_charge); once the offer has ended that
-- part goes nowhere.
--
-- The offer is the first run itself, needed or not: every Video Remake run of
-- a personal payer calls grant_first_remake_cover at its fee reservation, and
-- an eligible account's first run is recorded in_use (with a cover of 0 when
-- its own credits pay). It ends (finalize_first_remake_offer_row) once the run
-- job is terminal and none of the run's recorded holds is still reserved:
--   completed                    -> used;
--   failed / cancelled / gone    -> used when the cover paid anything (that part
--                                   is ours to lose) or another Video Remake run
--                                   of the account completed meanwhile; else
--                                   released (the account keeps its chance).
-- Either way the unspent cover is dropped (zeroed) — the account's own and
-- newly bought credits are never touched. Triggers on the run job's status and
-- on every settlement of the account's holds finalize it; a sweep is the
-- backstop and alerts on finalize errors and on offers in use for hours.
--
-- Lock order everywhere: profiles, THEN the offer row. Re-running this file is
-- a no-op.

-- ---------------------------------------------------------------------------
-- 1. The offer, one row per attempt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.first_remake_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- SET NULL, never cascade: a deleted run must not erase a used offer (the
  -- account would be offered again). The run's holds are recorded below, so
  -- its end still waits for them.
  job_id uuid UNIQUE REFERENCES public.jobs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('in_use', 'used', 'released')),
  -- The quote the cover was sized from; NULL for a first run its own credits
  -- paid (cover 0).
  quote_credits integer CHECK (quote_credits IS NULL OR quote_credits > 0),
  balance_before integer NOT NULL CHECK (balance_before >= 0),
  cover_credits integer NOT NULL CHECK (cover_credits >= 0),
  -- The cover still to draw on (the run's holds draw it down, their unused
  -- parts give it back); 0 once the offer ends.
  cover_remaining integer NOT NULL DEFAULT 0 CHECK (cover_remaining >= 0),
  -- What the cover paid: charged by the run's committed holds.
  cover_spent integer NOT NULL DEFAULT 0 CHECK (cover_spent >= 0),
  -- Every hold of the run (usage_logs ids), recorded by reserve_credits.
  hold_ids uuid[] NOT NULL DEFAULT '{}',
  -- Another Video Remake run of the account completed while this one held it.
  other_run_completed boolean NOT NULL DEFAULT false,
  -- What the run's committed holds settled at (when it ended).
  settled_credits integer,
  finalize_error text,
  finalize_error_alerted_at timestamptz,
  stale_alerted_at timestamptz,
  -- When the run job reached a terminal status (the sweep ends an offer still
  -- in use 24 hours after it).
  run_ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

-- THE RACE BACKSTOP: an account holds at most one offer that is running or
-- used. Two parallel first runs cannot both take it, and a used offer is never
-- taken again. A released attempt leaves the index.
CREATE UNIQUE INDEX IF NOT EXISTS first_remake_offers_one_per_user
  ON public.first_remake_offers (user_id) WHERE status IN ('in_use', 'used');

-- Server only: the state reaches a client through the API.
ALTER TABLE public.first_remake_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_remake_offers FROM anon;
REVOKE ALL ON public.first_remake_offers FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. The ledger admits what the cover paid for a run (one row, when it ends).
--    365's full list plus one value, added NOT VALID (685 validates it).
-- ---------------------------------------------------------------------------
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_created', 'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    'app_markup', 'app_earnings',
    'stripe_refund',
    'org_purchase', 'org_admin_grant', 'org_allocation', 'org_reclaim',
    'org_usage', 'org_refund', 'org_usage_variance',
    'signup_grant',
    'first_remake_cover',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  )) NOT VALID;
-- Validated by 685, in its own transaction: this one does not hold the table's
-- lock through a full scan.

-- ---------------------------------------------------------------------------
-- 3. Never paid, and the offer's state.
-- ---------------------------------------------------------------------------
-- The free-video rule's facts (purchase-on-record.ts, free-video-limits-for.ts:
-- an effective tier of free and no real payment): a paid transaction (a top-up
-- or a subscription invoice, refunded or not), a legacy completed credit
-- purchase, top-up credits ever bought, a paid tier, or a credit purchase in
-- the ledger. A free TRIAL is not a purchase (its plan grant writes no paid
-- transaction); a trial that converted to paid is (its first invoice is one).
-- While a trial runs the account's tier is the plan's, so it is not eligible
-- then; ended unpaid, it is again. Also required: the signup grant was made
-- (`free_grant_state = 'granted'`) — an account the signup signals withheld
-- it from gets no offer either.
CREATE OR REPLACE FUNCTION public.first_remake_never_paid(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = p_user_id
        AND COALESCE(p.lifetime_topup_credits, 0) = 0
        AND COALESCE(p.tier, 'free') = 'free'
        AND COALESCE(p.subscription_tier, 'free') = 'free'
        AND p.free_grant_state = 'granted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.user_id = p_user_id
        AND t.amount_usd > 0
        AND COALESCE(t.status, 'completed') NOT IN ('pending', 'failed')
    )
    AND NOT EXISTS (
      SELECT 1 FROM credit_purchases c WHERE c.user_id = p_user_id AND c.status = 'completed'
    )
    AND NOT EXISTS (
      SELECT 1 FROM credit_transactions ct
      WHERE ct.user_id = p_user_id
        -- Credit purchases only: a plan's grant rows (subscription_created /
        -- renewal) are also written for a trial, whose paid invoice, if any,
        -- is the transactions row above.
        AND ct.source IN ('one_time_purchase', 'org_purchase', 'purchase', 'topup')
    );
$$;

-- 'in_use' (a run holds it), 'not_eligible' (a purchase on record), 'used',
-- or 'available'.
CREATE OR REPLACE FUNCTION public.first_remake_offer_state(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM first_remake_offers WHERE user_id = p_user_id AND status = 'in_use') THEN
    RETURN 'in_use';
  END IF;
  IF NOT first_remake_never_paid(p_user_id) THEN
    RETURN 'not_eligible';
  END IF;
  IF EXISTS (SELECT 1 FROM first_remake_offers WHERE user_id = p_user_id AND status = 'used') THEN
    RETURN 'used';
  END IF;
  RETURN 'available';
END;
$$;

-- What the API reads in one call: the state and the spendable balance.
CREATE OR REPLACE FUNCTION public.first_remake_offer_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'state', first_remake_offer_state(p_user_id),
    'balance', COALESCE((SELECT COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0) FROM profiles WHERE id = p_user_id), 0)
  );
$$;

-- Whether `p_job` is `p_run` or one of its descendants (parent_job_id).
CREATE OR REPLACE FUNCTION public.first_remake_job_in_run(p_run uuid, p_job uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE up(id, depth) AS (
    SELECT p_job, 0
    UNION ALL
    SELECT j.parent_job_id, up.depth + 1 FROM jobs j JOIN up ON j.id = up.id
    WHERE j.parent_job_id IS NOT NULL AND up.depth < 32
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE id = p_run);
$$;


-- The cover a hold for `p_job` could draw on right now (0 when the job is no
-- part of a running covered run): what the API's credit pre-checks add to the
-- balance for the covered run's own steps, so they are judged as the reserve
-- will judge them.
CREATE OR REPLACE FUNCTION public.first_remake_cover_available(p_user_id uuid, p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT o.cover_remaining FROM first_remake_offers o
    WHERE o.user_id = p_user_id AND o.status = 'in_use' AND o.job_id IS NOT NULL
      AND p_job_id IS NOT NULL AND first_remake_job_in_run(o.job_id, p_job_id)
  ), 0);
$$;

-- ---------------------------------------------------------------------------
-- 4. The grant, at the run's fee reservation.
-- ---------------------------------------------------------------------------
-- Called for EVERY Video Remake run of a personal payer, when its job's fee is
-- reserved. Returns the cover held for the run (0: its own credits pay). The account's
-- first run takes the offer whether or not it needs a cover:
--   p_quote given (the run was admitted for the cover, quote above balance):
--     the offer must be available, else FIRST_REMAKE_UNAVAILABLE (the caller
--     refuses the run: it was admitted only for the cover);
--   p_quote NULL (the balance paid at admit): the offer is recorded in use with
--     a cover of 0 when it is available; anything else (used, running for
--     another run, a purchase on record) returns 0 and records nothing — never
--     an error: the run pays and runs as before.
-- Idempotent per job: a repeat for the job that holds the offer returns its
-- cover and grants nothing. A job that is not the account's open Video Remake
-- run raises FIRST_REMAKE_UNAVAILABLE.
CREATE OR REPLACE FUNCTION public.grant_first_remake_cover(p_user_id uuid, p_job_id uuid, p_quote integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub integer;
  v_topup integer;
  v_balance integer;
  v_cover integer;
  v_existing first_remake_offers%ROWTYPE;
BEGIN
  IF p_quote IS NOT NULL AND p_quote <= 0 THEN
    RAISE EXCEPTION 'FIRST_REMAKE_INVALID: the quote must be positive, got %', p_quote;
  END IF;

  -- The lock every reserve takes: the grant serializes with every spend, and
  -- two first runs of the account with each other.
  SELECT COALESCE(subscription_credits, 0), COALESCE(topup_credits, 0) INTO v_sub, v_topup
  FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIRST_REMAKE_UNAVAILABLE: no profile %', p_user_id;
  END IF;

  SELECT * INTO v_existing FROM first_remake_offers WHERE job_id = p_job_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id = p_user_id AND v_existing.status = 'in_use' THEN
      RETURN v_existing.cover_credits;
    END IF;
    IF p_quote IS NULL THEN RETURN 0; END IF;
    RAISE EXCEPTION 'FIRST_REMAKE_UNAVAILABLE: job % already settled its offer', p_job_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = p_job_id
      AND j.user_id = p_user_id
      AND j.status IN ('pending', 'queued', 'processing')
      AND COALESCE(NULLIF(j.job_type, ''), j.input_data->>'type') = 'cast-swap'
  ) THEN
    RAISE EXCEPTION 'FIRST_REMAKE_UNAVAILABLE: job % is not an open Video Remake run of the account', p_job_id;
  END IF;

  IF first_remake_offer_state(p_user_id) <> 'available' THEN
    IF p_quote IS NULL THEN RETURN 0; END IF;
    RAISE EXCEPTION 'FIRST_REMAKE_UNAVAILABLE: the offer is not available to %', p_user_id;
  END IF;

  v_balance := v_sub + v_topup;
  IF p_quote IS NULL THEN
    v_cover := 0;
  ELSE
    -- An overdrawn balance is never covered: the cover pays for a run, not a debt.
    IF v_balance < 0 THEN
      RAISE EXCEPTION 'FIRST_REMAKE_UNAVAILABLE: the balance is overdrawn (%)', v_balance;
    END IF;
    v_cover := GREATEST(0, p_quote - v_balance);
  END IF;

  -- The first run takes the offer, covered or not. The cover is held on the
  -- offer row for the run's own holds; the pools are not touched.
  INSERT INTO first_remake_offers (user_id, job_id, status, quote_credits, balance_before, cover_credits, cover_remaining)
  VALUES (p_user_id, p_job_id, 'in_use', p_quote, GREATEST(v_balance, 0), v_cover, v_cover);

  RETURN v_cover;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The cover's own bookkeeping, for the settle paths patched below. A hold
--    counts only while its offer runs and names it; after, nothing moves.
-- ---------------------------------------------------------------------------
-- A hold that drew `p_back + p_charged` on the cover settled: `p_back` goes
-- back to the cover, `p_charged` is what the cover paid.
CREATE OR REPLACE FUNCTION public.first_remake_cover_settled(p_user_id uuid, p_usage_log_id uuid, p_back integer, p_charged integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE first_remake_offers
     SET cover_remaining = cover_remaining + GREATEST(p_back, 0),
         cover_spent = cover_spent + GREATEST(p_charged, 0)
   WHERE user_id = p_user_id AND status = 'in_use' AND p_usage_log_id = ANY(hold_ids);
$$;

-- A settled charge the cover paid `p_amount` of was reversed: back to the cover.
CREATE OR REPLACE FUNCTION public.first_remake_cover_returned_charged(p_user_id uuid, p_usage_log_id uuid, p_amount integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE first_remake_offers
     SET cover_remaining = cover_remaining + GREATEST(p_amount, 0),
         cover_spent = GREATEST(cover_spent - GREATEST(p_amount, 0), 0)
   WHERE user_id = p_user_id AND status = 'in_use' AND p_usage_log_id = ANY(hold_ids);
$$;

-- ---------------------------------------------------------------------------
-- 6. Finalize.
-- ---------------------------------------------------------------------------
-- The state the offer is left in ('in_use' = not yet: the run is still going,
-- or one of its recorded holds is still reserved). `p_abandoned`: the run job
-- is about to be deleted after a refused reservation (its holds refunded) —
-- finalized as failed now. `p_ignore_holds` (the sweep's auto-end, 24 hours
-- after the run ended): finalized by the job's status without waiting for its
-- holds — the unspent cover is dropped, and a hold that settles later gives
-- back only the account's own share (its cover share goes nowhere).
CREATE OR REPLACE FUNCTION public.finalize_first_remake_offer_row(p_offer_id uuid, p_abandoned boolean DEFAULT false, p_ignore_holds boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_offer first_remake_offers%ROWTYPE;
  v_job_status text;
  v_completed boolean;
  v_status text;
  v_settled integer;
  v_balance integer;
  v_pending_cover integer := 0;
BEGIN
  SELECT user_id INTO v_user FROM first_remake_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RETURN 'none'; END IF;

  -- Locks first, then reads: two settlements racing each other cannot both
  -- see the other's hold as still reserved.
  SELECT COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0) INTO v_balance
  FROM profiles WHERE id = v_user FOR UPDATE;
  SELECT * INTO v_offer FROM first_remake_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.status <> 'in_use' THEN RETURN v_offer.status; END IF;

  IF p_abandoned THEN
    v_completed := false;
  ELSE
    IF v_offer.job_id IS NULL THEN
      v_completed := false;
    ELSE
      SELECT status INTO v_job_status FROM jobs WHERE id = v_offer.job_id;
      IF NOT FOUND THEN
        v_completed := false;
      ELSIF v_job_status = 'completed' THEN
        v_completed := true;
      ELSIF v_job_status IN ('failed', 'cancelled') THEN
        v_completed := false;
      ELSE
        RETURN 'in_use';
      END IF;
      -- When the run ended, noted under the locks above (profile, then offer:
      -- the order of every path) for the sweep's 24-hour auto-end.
      IF v_offer.run_ended_at IS NULL THEN
        UPDATE first_remake_offers SET run_ended_at = now() WHERE id = p_offer_id;
      END IF;
    END IF;
    -- Any recorded hold of the run still reserved (a cancelled run's child
    -- still out, a job row gone with its hold): not yet.
    IF NOT p_ignore_holds AND EXISTS (SELECT 1 FROM usage_logs u WHERE u.id = ANY(v_offer.hold_ids) AND u.status = 'reserved') THEN
      RETURN 'in_use';
    END IF;
  END IF;

  SELECT COALESCE(SUM(COALESCE(u.credits_charged, u.credits_used, 0)), 0)::integer INTO v_settled
  FROM usage_logs u WHERE u.id = ANY(v_offer.hold_ids) AND u.status = 'committed';

  IF p_ignore_holds THEN
    -- A hold still out that drew on the cover may yet be charged: the offer
    -- counts as used, so a later charge can never come with a second chance.
    SELECT COALESCE(SUM(COALESCE((u.metadata->>'from_cover')::integer, 0)), 0)::integer INTO v_pending_cover
    FROM usage_logs u WHERE u.id = ANY(v_offer.hold_ids) AND u.status = 'reserved';
  END IF;

  v_status := CASE
    WHEN v_completed THEN 'used'
    -- A run that ended without delivering but was paid for in part by the
    -- cover has used it (that part is ours to lose); so has an account whose
    -- other Video Remake run completed meanwhile.
    WHEN v_offer.cover_spent > 0 OR v_offer.other_run_completed OR v_pending_cover > 0 THEN 'used'
    ELSE 'released'
  END;

  IF v_offer.cover_spent > 0 THEN
    -- What the cover paid, in the ledger (the account's balance did not move).
    INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, job_id, balance_after)
    VALUES (v_user, v_offer.cover_spent, 'subscription', 'first_remake_cover',
            'First Remake on us: what the offer paid for this run',
            (SELECT id FROM jobs WHERE id = v_offer.job_id), v_balance);
  END IF;

  -- The unspent cover is dropped: it was never in the account's pools.
  UPDATE first_remake_offers
  SET status = v_status, cover_remaining = 0, settled_credits = v_settled, settled_at = now()
  WHERE id = p_offer_id;

  RETURN v_status;
END;
$$;

-- By the run job: 'none' when no offer names it.
CREATE OR REPLACE FUNCTION public.finalize_first_remake_offer(p_job_id uuid, p_abandoned boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM first_remake_offers WHERE job_id = p_job_id;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  RETURN finalize_first_remake_offer_row(v_id, p_abandoned);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. The triggers. A finalize that raises never fails the write that fired
--    it: its error is kept on the offer for the sweep's alert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.first_remake_offer_note_error(p_offer_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Profile, then offer: the lock order of every path.
  PERFORM 1 FROM profiles WHERE id = (SELECT user_id FROM first_remake_offers WHERE id = p_offer_id) FOR UPDATE;
  UPDATE first_remake_offers SET finalize_error = left(p_error, 500), finalize_error_alerted_at = NULL WHERE id = p_offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.first_remake_offer_on_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM first_remake_offers WHERE job_id = NEW.id AND status = 'in_use';
  IF FOUND THEN
    BEGIN
      PERFORM finalize_first_remake_offer_row(v_id, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[first-remake] finalize on job % failed: %', NEW.id, SQLERRM;
      PERFORM first_remake_offer_note_error(v_id, SQLERRM);
    END;
  ELSIF NEW.status = 'completed' AND NEW.workspace_id IS NULL
        AND COALESCE(NULLIF(NEW.job_type, ''), NEW.input_data->>'type') = 'cast-swap' THEN
    BEGIN
      -- Another Video Remake run of the account completed: its offer, running
      -- for another run, is used whatever that run's end; with no offer taken
      -- yet (a run that started while another held it), this one was the
      -- account's first finished run and uses it now.
      -- Profile, then offer: the lock order of every path.
      PERFORM 1 FROM profiles WHERE id = NEW.user_id FOR UPDATE;
      UPDATE first_remake_offers SET other_run_completed = true
       WHERE user_id = NEW.user_id AND status = 'in_use' AND job_id IS DISTINCT FROM NEW.id;
      IF NOT FOUND AND first_remake_offer_state(NEW.user_id) = 'available' THEN
        INSERT INTO first_remake_offers (user_id, job_id, status, balance_before, cover_credits, settled_at)
        VALUES (NEW.user_id, NEW.id, 'used', 0, 0, now())
        ON CONFLICT DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[first-remake] noting the completed run % failed: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS first_remake_offer_job_status ON public.jobs;
CREATE TRIGGER first_remake_offer_job_status
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'failed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.first_remake_offer_on_job_status();

CREATE OR REPLACE FUNCTION public.first_remake_offer_on_hold_settled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- The partial unique index answers this: almost always no row.
  SELECT id INTO v_id FROM first_remake_offers WHERE user_id = NEW.user_id AND status = 'in_use';
  IF FOUND THEN
    BEGIN
      PERFORM finalize_first_remake_offer_row(v_id, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[first-remake] finalize on usage log % failed: %', NEW.id, SQLERRM;
      PERFORM first_remake_offer_note_error(v_id, SQLERRM);
    END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS first_remake_offer_hold_settled ON public.usage_logs;
CREATE TRIGGER first_remake_offer_hold_settled
  AFTER UPDATE OF status ON public.usage_logs
  FOR EACH ROW
  WHEN (OLD.status = 'reserved' AND NEW.status IS DISTINCT FROM 'reserved')
  EXECUTE FUNCTION public.first_remake_offer_on_hold_settled();

-- A covered run is never trashed or deleted while its offer is in use — that
-- is, until the offer has ended, whatever the job's own status (a cancelled
-- run's child may still be out, billing): neither the run job nor any job of
-- its tree, directly (FIRST_REMAKE_RUN_ACTIVE) or by deleting what holds it —
-- its workflow or project, through their cascades (FIRST_REMAKE_RUN_HELD).
-- Only deleting the account itself passes: its profile row is already gone
-- when the cascade reaches the job (and the offer goes with the profile).
CREATE OR REPLACE FUNCTION public.first_remake_offer_keep_running_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The run job itself always; a job of its tree when it still has a hold of
  -- the run reserved (a step out, billing). A child row that never reserved
  -- anything — e.g. a `pending` child the run's cleanup removes after a
  -- refusal — holds nothing the offer waits for, so its delete passes; were it
  -- refused, the row would merely stay `pending` until the offer ends.
  IF EXISTS (
       SELECT 1 FROM first_remake_offers o
       WHERE o.user_id = OLD.user_id AND o.status = 'in_use' AND o.job_id IS NOT NULL
         AND (o.job_id = OLD.id
              OR (first_remake_job_in_run(o.job_id, OLD.id)
                  AND EXISTS (SELECT 1 FROM usage_logs u WHERE u.job_id = OLD.id AND u.status = 'reserved' AND u.id = ANY(o.hold_ids))))
     )
     AND EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'FIRST_REMAKE_RUN_HELD: this holds the running first Remake run %; it can be removed once that run has finished', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'FIRST_REMAKE_RUN_ACTIVE: job % is a running first Remake; it can be removed once it has finished', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS first_remake_offer_keep_running_job_delete ON public.jobs;
CREATE TRIGGER first_remake_offer_keep_running_job_delete
  BEFORE DELETE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.first_remake_offer_keep_running_job();

DROP TRIGGER IF EXISTS first_remake_offer_keep_running_job_trash ON public.jobs;
CREATE TRIGGER first_remake_offer_keep_running_job_trash
  BEFORE UPDATE OF deleted_at ON public.jobs
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION public.first_remake_offer_keep_running_job();

-- An ORPHANED hold of an offer whose run has ended (its job terminal or gone):
-- a recorded hold still reserved an hour later whose own job no longer exists.
-- The delete guard keeps every job of a running offer's tree, so this should
-- never happen; if it does, its work may STILL be billing (a provider call out
-- when the row went), so the sweep never refunds it — it alerts
-- ('orphaned_hold'). This is the ADMIN path, called deliberately once the work
-- is known dead: refund_credits gives the account's own share back to its
-- pools and the cover's share back to the cover (which the next finalize
-- drops), so the offer can end by its rule. Returns how many it refunded.
CREATE OR REPLACE FUNCTION public.first_remake_release_orphan_holds(p_offer_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer first_remake_offers%ROWTYPE;
  v_log uuid;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_offer FROM first_remake_offers WHERE id = p_offer_id;
  IF NOT FOUND OR v_offer.status <> 'in_use' THEN RETURN 0; END IF;
  IF v_offer.job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM jobs WHERE id = v_offer.job_id AND status NOT IN ('completed', 'failed', 'cancelled')
  ) THEN
    RETURN 0;
  END IF;
  FOR v_log IN
    SELECT u.id FROM usage_logs u
    LEFT JOIN llm_side_holds h ON h.usage_log_id = u.id
    WHERE u.id = ANY(v_offer.hold_ids) AND u.status = 'reserved'
      AND u.created_at < now() - interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = COALESCE(u.job_id, h.job_id))
  LOOP
    PERFORM refund_credits(v_log);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. The sweep: every offer still in_use is finalized, then what to alert on
--    is handed back, each once: a finalize that raised, and an offer in use
--    for more than 6 hours.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_first_remake_offers()
RETURNS TABLE (offer_id uuid, user_id uuid, job_id uuid, status text, reason text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT o.id FROM first_remake_offers o WHERE o.status = 'in_use' ORDER BY o.created_at LOOP
    BEGIN
      PERFORM finalize_first_remake_offer_row(v_id, false);
      -- AUTO-END: still in use 24 hours after its run ended (a hold that never
      -- settles): ended by the job's status, without waiting for that hold.
      IF EXISTS (
        SELECT 1 FROM first_remake_offers o
        WHERE o.id = v_id AND o.status = 'in_use'
          AND (o.run_ended_at < now() - interval '24 hours'
               OR (o.job_id IS NULL AND o.created_at < now() - interval '24 hours'))
      ) THEN
        PERFORM finalize_first_remake_offer_row(v_id, false, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[first-remake] sweep finalize of offer % failed: %', v_id, SQLERRM;
      PERFORM first_remake_offer_note_error(v_id, SQLERRM);
    END;
  END LOOP;

  RETURN QUERY
  UPDATE first_remake_offers o
  SET finalize_error_alerted_at = now()
  WHERE o.finalize_error IS NOT NULL AND o.finalize_error_alerted_at IS NULL
  RETURNING o.id, o.user_id, o.job_id, o.status, 'finalize_error'::text, o.finalize_error;

  -- An orphaned hold (see first_remake_release_orphan_holds): alerted with the
  -- in-use-too-long alert below (the offer waits for it), never refunded here.
  RETURN QUERY
  UPDATE first_remake_offers o
  SET stale_alerted_at = now()
  WHERE o.status = 'in_use' AND o.created_at < now() - interval '6 hours' AND o.stale_alerted_at IS NULL
  RETURNING o.id, o.user_id, o.job_id, o.status, 'in_use_too_long'::text,
    ('cover remaining ' || o.cover_remaining || ', orphaned holds ' || (
      SELECT count(*) FROM usage_logs u LEFT JOIN llm_side_holds h ON h.usage_log_id = u.id
      WHERE u.id = ANY(o.hold_ids) AND u.status = 'reserved'
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = COALESCE(u.job_id, h.job_id))))::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. The settle paths, as they stand after the earlier migrations (their
--    bodies verbatim), with the cover added: only a hold of the covered run
--    draws on it, and what such a hold gives back goes to the cover, never to
--    the pools. commit_credits_metered's overrun collects from the pools only
--    (never the cover); its one change keeps the metadata commit_credits wrote.
-- ---------------------------------------------------------------------------

-- ---- reserve_credits (382's, with the cover)
CREATE OR REPLACE FUNCTION public.reserve_credits(p_user_id uuid, p_credits integer, p_job_id uuid, p_model_identifier text DEFAULT NULL::text, p_provider_cost_usd numeric DEFAULT NULL::numeric, p_display_cost_usd numeric DEFAULT NULL::numeric, p_is_app_run boolean DEFAULT false, p_daily_limit integer DEFAULT NULL::integer, p_web_free_mode boolean DEFAULT false, p_workspace_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid, p_enforce_allowance boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sub_credits INTEGER;
  v_topup_credits INTEGER;
  v_tier TEXT;
  v_app_allowance INTEGER;
  v_lifetime INTEGER;
  v_usage_log_id UUID;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
  v_allowance_delta INTEGER := 0;
  v_daily_spent INTEGER;
  v_last_reset DATE;
  v_effective_daily INTEGER;
  v_pool_restricted BOOLEAN := FALSE;
  -- Workspace-payer branch only:
  v_ws_org UUID;
  v_ws_archived BOOLEAN;
  v_ws_status TEXT;
  v_cap INTEGER;
  v_has_member_row BOOLEAN := FALSE;
  v_caps_enabled BOOLEAN := FALSE;
  v_member_spend BOOLEAN := FALSE;
  v_b_allocated INTEGER;
  v_b_reserved INTEGER;
  v_b_spent INTEGER;
  v_ms_reserved INTEGER;
  v_ms_spent INTEGER;
  -- Deployment-allowance branch only (382). The `v_a_` prefix is deliberate:
  -- 351 already declares `v_app_allowance` and `v_allowance_delta`, which are
  -- the FREE-TIER app allowance — an unrelated concept on the payer's own row.
  v_a_default INTEGER;
  v_a_payer UUID;
  v_a_inserted UUID;
  v_a_granted INTEGER;
  v_a_reserved INTEGER;
  v_a_spent INTEGER;
  v_allowance_touched BOOLEAN := FALSE;
  -- First Remake on us (684): the covered run's share drawn from its own cover.
  v_fr_id UUID;
  v_fr_run UUID;
  v_fr_left INTEGER;
  v_fr_job UUID;
  v_fr_in_run BOOLEAN := FALSE;
  v_fr_cover INTEGER := 0;
  v_own INTEGER;
BEGIN
  -- ==========================================================================
  -- WORKSPACE PAYER. A self-contained early block: it never touches
  -- `profiles` (the member's own balance, subscription, daily counter and
  -- allowance are all untouched — work done inside a class is paid by the
  -- class — owner decision, 2026-08-25), and it returns before the personal body below,
  -- which is migration 311's text verbatim.
  -- ==========================================================================
  IF p_workspace_id IS NOT NULL THEN
    IF p_credits <= 0 THEN
      RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
    END IF;

    SELECT org_id, (archived_at IS NOT NULL) INTO v_ws_org, v_ws_archived
    FROM workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WORKSPACE_NOT_FOUND: no workspace %', p_workspace_id;
    END IF;

    -- Budget row first — it is the lock every concurrent reserve serializes
    -- on, so the headroom check below reads a settled number. No row means
    -- nothing was ever allocated: same refusal as an exhausted budget, so
    -- every caller maps one code.
    SELECT allocated_credits, reserved_credits, spent_credits
    INTO v_b_allocated, v_b_reserved, v_b_spent
    FROM workspace_budgets WHERE workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUDGET_EXCEEDED: workspace % has no credit allocation (need %, headroom 0)',
        p_workspace_id, p_credits;
    END IF;

    IF v_ws_archived THEN
      RAISE EXCEPTION 'WORKSPACE_ARCHIVED: workspace % is archived (read-only)', p_workspace_id;
    END IF;
    v_ws_status := workspace_member_status(p_workspace_id, p_user_id);
    -- NULL = not a member AT ALL (the helper returns NULL for a stranger,
    -- and — fail-CLOSED — for its own internal errors). Without this check a
    -- complete non-member sails past the suspension test (NULL <> 'suspended')
    -- and drains a workspace budget they were never part of; implicit org
    -- admins are unaffected (the helper answers 'active' for them, no row
    -- needed). Second-review finding, 2026-08-26.
    IF v_ws_status IS NULL THEN
      RAISE EXCEPTION 'MEMBER_NOT_FOUND: user % is not a member of workspace %', p_user_id, p_workspace_id;
    END IF;
    IF v_ws_status = 'suspended' THEN
      RAISE EXCEPTION 'MEMBER_SUSPENDED: user % is suspended in workspace %', p_user_id, p_workspace_id;
    END IF;

    -- Member cap: an EXPLICIT workspace_members row AND caps enabled AND a
    -- cap set — all three. Implicit admins (org owner/admin, no row) are
    -- never capped and never get a spend row (the FK would refuse one).
    SELECT credit_cap INTO v_cap
    FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    v_has_member_row := FOUND;
    IF v_has_member_row AND v_cap IS NOT NULL THEN
      v_caps_enabled := COALESCE(ws_setting_bool(p_workspace_id, 'member_caps_enabled'), FALSE);
      IF v_caps_enabled THEN
        -- Lazily created on first capped reserve; then locked.
        INSERT INTO workspace_member_spend (workspace_id, user_id)
        VALUES (p_workspace_id, p_user_id)
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
        SELECT reserved_credits, spent_credits INTO v_ms_reserved, v_ms_spent
        FROM workspace_member_spend
        WHERE workspace_id = p_workspace_id AND user_id = p_user_id FOR UPDATE;
        IF (v_cap - v_ms_reserved - v_ms_spent) < p_credits THEN
          RAISE EXCEPTION 'MEMBER_CAP_EXCEEDED: cap %, headroom %, need %',
            v_cap, GREATEST(v_cap - v_ms_reserved - v_ms_spent, 0), p_credits;
        END IF;
        v_member_spend := TRUE;
      END IF;
    END IF;

    IF (v_b_allocated - v_b_reserved - v_b_spent) < p_credits THEN
      RAISE EXCEPTION 'BUDGET_EXCEEDED: allocated %, headroom %, need %',
        v_b_allocated, GREATEST(v_b_allocated - v_b_reserved - v_b_spent, 0), p_credits;
    END IF;

    UPDATE workspace_budgets
    SET reserved_credits = reserved_credits + p_credits, updated_at = now()
    WHERE workspace_id = p_workspace_id;
    IF v_member_spend THEN
      UPDATE workspace_member_spend
      SET reserved_credits = reserved_credits + p_credits, updated_at = now()
      WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    END IF;

    -- `member_spend` is recorded AT RESERVE TIME: commit and refund must know
    -- whether a spend row was touched without re-resolving `member_caps_enabled`
    -- (which may have changed in between — reversing a row that was never
    -- incremented is the bug that recording prevents).
    INSERT INTO usage_logs (user_id, job_id, action, provider, credits_used, cost_usd, status, workspace_id, org_id, metadata)
    VALUES (
      p_user_id,
      p_job_id,
      COALESCE(p_model_identifier, 'generate'),
      'reserved',
      p_credits,
      p_provider_cost_usd,
      'reserved',
      p_workspace_id,
      v_ws_org,
      jsonb_build_object(
        'model', p_model_identifier,
        'display_cost', p_display_cost_usd,
        'is_app_run', p_is_app_run,
        'payer', jsonb_build_object(
          'kind', 'workspace',
          'workspace_id', p_workspace_id,
          'org_id', v_ws_org,
          'member_spend', v_member_spend
        )
      )
    )
    RETURNING id INTO v_usage_log_id;

    RETURN v_usage_log_id;
  END IF;


  -- ==========================================================================
  -- DEPLOYMENT PAYER — the per-user allowance (382). Runs BEFORE the personal
  -- body so the lock order is ALLOWANCE -> PROFILES (D8). Skipped entirely —
  -- not one table read — unless enforcement was asked for.
  -- ==========================================================================
  -- The `p_credits <= 0` guard is DUPLICATED here rather than hoisted out of
  -- the verbatim personal body below: a zero-credit call must not create an
  -- allowance row on its way to being rejected, and the body it belongs to is
  -- marked "do not edit". Behaviour case 9e.
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;

  IF p_enforce_allowance
     AND p_on_behalf_of IS NOT NULL
     -- The payer is EXEMPT (D13). It holds the real credits, not an
     -- allocation; giving it a quota would be a concept that does not exist,
     -- and answering `remaining: 0` for it would refuse its own runs.
     AND p_on_behalf_of <> p_user_id
  THEN
    -- The default's single source of truth is the database (D6/D3), never a
    -- third parameter: decision (3) puts it where only the billing account can
    -- change it. One indexed single-row read, taken only when enforcing.
    SELECT payer_user_id, default_allowance_credits
      INTO v_a_payer, v_a_default
      FROM deployment_payer_settings WHERE id = true;
    -- A missing row and a row with a NULL payer are the SAME fault: both mean
    -- `configureDeploymentPayer()` has not written this deployment's identity.
    -- Checking only NOT FOUND would let the NULL case fail deep inside the
    -- grant INSERT below on `granted_by NOT NULL`, with an opaque constraint
    -- violation instead of this stable prefix. Mapped to a 500 by
    -- `reserve-errors.ts`: a misconfiguration is a fault, not a refusal.
    IF NOT FOUND OR v_a_payer IS NULL THEN
      RAISE EXCEPTION 'ALLOWANCE_UNCONFIGURED: enforcement requested but deployment_payer_settings names no payer';
    END IF;

    -- LAZY PROVISION (D7). `RETURNING` is load-bearing: under concurrency two
    -- first-reserves race on the primary key, and ONLY the winning inserter
    -- may write the 'default' grant row — otherwise `granted = SUM(grants)`
    -- breaks on the very first generation of the instance's life.
    INSERT INTO deployment_user_allowances (user_id, granted_credits)
    VALUES (p_on_behalf_of, v_a_default)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id INTO v_a_inserted;
    IF v_a_inserted IS NOT NULL THEN
      INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by)
      VALUES (p_on_behalf_of, v_a_default, 'default', v_a_payer);
    END IF;

    -- THE AUTHORITY. Every allowance decision that matters happens here, under
    -- FOR UPDATE, in the same transaction that debits the payer below. The
    -- read in `creditGuardImpl` is read-then-reserve and is UX only; the
    -- overshoot a TOCTOU race there can produce is bounded by this lock.
    SELECT granted_credits, reserved_credits, spent_credits
      INTO v_a_granted, v_a_reserved, v_a_spent
      FROM deployment_user_allowances WHERE user_id = p_on_behalf_of FOR UPDATE;

    -- The prefix is stable and load-bearing in three ways: it must not contain
    -- "insufficient" or "not enough" (the pipeline lane matches those by
    -- SUBSTRING before consulting RESERVE_PREFIX_MAP), it must not collide
    -- with the workspace `BUDGET_EXCEEDED`, and it must read as this user's
    -- quota rather than the deployment's wallet. The interpolated figures
    -- survive only in `.raw`, for logs; the wire message is fixed.
    IF (v_a_granted - v_a_reserved - v_a_spent) < p_credits THEN
      RAISE EXCEPTION 'USER_ALLOWANCE_EXCEEDED: granted %, remaining %, need %',
        v_a_granted, GREATEST(v_a_granted - v_a_reserved - v_a_spent, 0), p_credits;
    END IF;

    UPDATE deployment_user_allowances
       SET reserved_credits = reserved_credits + p_credits, updated_at = now()
     WHERE user_id = p_on_behalf_of;
    v_allowance_touched := TRUE;
  END IF;
  -- ==========================================================================
  -- PERSONAL PAYER — migration 311's body, verbatim. Do not edit.
  -- ==========================================================================
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;

  SELECT subscription_credits, topup_credits, COALESCE(tier, 'free'),
         COALESCE(app_credits_allowance, 0),
         COALESCE(lifetime_topup_credits, 0),
         COALESCE(daily_spent_credits, 0),
         COALESCE(last_daily_reset::DATE, '1970-01-01'::DATE)
  INTO v_sub_credits, v_topup_credits, v_tier, v_app_allowance, v_lifetime,
       v_daily_spent, v_last_reset
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  -- FIRST REMAKE ON US (684). The cover lives on the offer row, never in the
  -- pools above: only a hold of the covered run's own job tree (its job, its
  -- descendants by parent_job_id, or an LLM side hold for one of them, named by
  -- reserve_llm_side_hold through `nodaro.first_remake_side_job`) may draw on
  -- it, and only for what the account's own balance cannot pay (own credits
  -- first). Every such hold is recorded on the offer (`hold_ids`), so its end
  -- waits for them even if a job row disappears. Lock order: profile (above),
  -- then the offer row.
  IF p_on_behalf_of IS NULL THEN
    SELECT id, job_id, cover_remaining INTO v_fr_id, v_fr_run, v_fr_left
      FROM first_remake_offers WHERE user_id = p_user_id AND status = 'in_use' FOR UPDATE;
    IF FOUND THEN
      v_fr_job := COALESCE(p_job_id, NULLIF(current_setting('nodaro.first_remake_side_job', true), '')::uuid);
      IF v_fr_run IS NOT NULL AND v_fr_job IS NOT NULL AND first_remake_job_in_run(v_fr_run, v_fr_job) THEN
        v_fr_in_run := TRUE;
        -- On the run job ITSELF only its own fee (`cast-swap`) or one of its
        -- LLM side holds may draw on the cover; its descendants' holds may.
        IF v_fr_job <> v_fr_run OR p_model_identifier = 'cast-swap' OR p_job_id IS NULL THEN
          v_fr_cover := LEAST(GREATEST(v_fr_left, 0), GREATEST(0, p_credits - GREATEST(0, COALESCE(v_sub_credits, 0) + COALESCE(v_topup_credits, 0))));
        END IF;
      ELSIF v_fr_left > 0 AND p_credits > 0 THEN
        -- THE NARROW FENCE: while a cover is held for the account's covered run,
        -- its other holds are refused, so a parallel spend cannot starve that
        -- run of the account's own credits (which it draws first). A cover of 0
        -- fences nothing; a workspace-paid hold never reaches this branch.
        RAISE EXCEPTION 'FIRST_REMAKE_IN_PROGRESS: the account''s first Remake run % is using its credits until it finishes', v_fr_run
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  v_own := p_credits - v_fr_cover;

  -- Pool restriction fires ONLY for payg accounts (self-gating; see header).
  v_pool_restricted := p_web_free_mode AND v_tier = 'free' AND v_lifetime > 0;

  -- Effective daily spent — same UTC-day reset rule as reset_daily_spent_if_needed.
  IF v_last_reset < CURRENT_DATE THEN
    v_effective_daily := 0;
  ELSE
    v_effective_daily := v_daily_spent;
  END IF;

  -- Atomic daily cap under FOR UPDATE (only when a limit is supplied).
  IF p_daily_limit IS NOT NULL AND (v_effective_daily + p_credits) > p_daily_limit THEN
    RAISE EXCEPTION 'Daily credit limit reached: limit %, spent today %, need %',
      p_daily_limit, v_effective_daily, p_credits
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_own = 0 THEN
    -- The cover pays the whole hold: nothing from the pools.
    v_from_sub := 0;
    v_from_topup := 0;
  ELSIF v_pool_restricted THEN
    -- Web spending draws the free pool only; the top-up pool is reserved
    -- for the developer surfaces. The guard maps this prefix to the
    -- subscription_required 403 (approved modal) rather than a plain 402.
    IF v_sub_credits < v_own THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: web spending draws only free-pool credits: need %, free pool has %',
        v_own, v_sub_credits;
    END IF;
    v_from_sub := v_own;
  ELSE
    IF (v_sub_credits + v_topup_credits) < v_own THEN
      RAISE EXCEPTION 'Insufficient credits: need %, have %', v_own, (v_sub_credits + v_topup_credits);
    END IF;

    -- Deduct from subscription first, then topup
    IF v_sub_credits >= v_own THEN
      v_from_sub := v_own;
    ELSE
      v_from_sub := v_sub_credits;
      v_from_topup := v_own - v_from_sub;
    END IF;
  END IF;

  -- App allowance check: genuinely-free users (never purchased) with no topup
  -- must have enough allowance. Payg (v_lifetime > 0) is paid-path: exempt.
  IF p_is_app_run AND v_tier = 'free' AND v_topup_credits = 0 AND v_lifetime = 0 THEN
    IF v_app_allowance < p_credits THEN
      RAISE EXCEPTION 'Insufficient app credits: need %, have %. Earn app credits by running flows.', p_credits, v_app_allowance;
    END IF;
  END IF;

  -- Allowance deltas — unchanged from 308: payg users neither earn nor
  -- consume allowance (they left the free economy at first purchase), and
  -- that holds in web-free-mode too.
  IF p_is_app_run AND v_tier = 'free' AND v_topup_credits = 0 AND v_lifetime = 0 THEN
    v_allowance_delta := -p_credits;   -- app run consumes allowance
  ELSIF NOT p_is_app_run AND v_tier = 'free' AND v_lifetime = 0 THEN
    v_allowance_delta := p_credits;    -- flow run earns allowance
  ELSE
    v_allowance_delta := 0;            -- paid tier, payg, or free+app-run+has-topup
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup,
      daily_spent_credits = v_effective_daily + p_credits,
      last_daily_reset = CURRENT_DATE,
      app_credits_allowance = COALESCE(app_credits_allowance, 0) + v_allowance_delta
  WHERE id = p_user_id;

  -- The two edits to 311's INSERT, and the only edits anywhere in the personal
  -- body: the `on_behalf_of` COLUMN (D5 — attribution is now transactional),
  -- and the payer object CONCATENATED onto the existing metadata.
  --
  -- WHY `||` AND NOT A `CASE` INSIDE jsonb_build_object: `jsonb_build_object
  -- ('payer', NULL)` writes the key with a JSON null, and today's mainline
  -- rows have NO `payer` key at all. `|| '{}'::jsonb` adds nothing. Behaviour
  -- case 9b asserts `metadata ? 'payer'` is FALSE on a mainline call, which is
  -- the only form of "byte-identical" a JSONB column can be checked for.
  --
  -- `allowance_enforced` is recorded HERE, AT RESERVE TIME, and is the only
  -- thing commit and refund consult (D4). This is 351's `member_spend` lesson
  -- applied exactly (351:317-320): "reversing a row that was never incremented
  -- is the bug that recording prevents". Without it the step-8 flip corrupts
  -- every in-flight row — a job reserved while enforcement was off, committing
  -- after the flip, would spend against an allowance that never reserved it.
  INSERT INTO usage_logs (user_id, job_id, action, provider, credits_used, cost_usd, status, on_behalf_of, metadata)
  VALUES (
    p_user_id,
    p_job_id,
    COALESCE(p_model_identifier, 'generate'),
    'reserved',
    p_credits,
    p_provider_cost_usd,
    'reserved',
    p_on_behalf_of,
    jsonb_build_object(
      'model', p_model_identifier,
      'display_cost', p_display_cost_usd,
      'from_sub', v_from_sub,
      'from_topup', v_from_topup,
      'is_app_run', p_is_app_run,
      'allowance_delta', v_allowance_delta,
      'web_free_mode', v_pool_restricted
    )
    || CASE WHEN p_on_behalf_of IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('payer', jsonb_build_object(
                   'kind', 'deployment',
                   'account', p_user_id,
                   'allowance_enforced', v_allowance_touched
                 ))
       END
  )
  RETURNING id INTO v_usage_log_id;

  IF v_fr_in_run THEN
    UPDATE usage_logs SET metadata = metadata || jsonb_build_object('from_cover', v_fr_cover) WHERE id = v_usage_log_id;
    UPDATE first_remake_offers
       SET cover_remaining = cover_remaining - v_fr_cover,
           hold_ids = array_append(hold_ids, v_usage_log_id)
     WHERE id = v_fr_id;
  END IF;

  RETURN v_usage_log_id;
END;
$function$;

-- ---- commit_credits (382's, with the cover)
CREATE OR REPLACE FUNCTION public.commit_credits(p_usage_log_id uuid, p_actual_credits integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_reserved INTEGER;
  v_actual INTEGER;
  v_diff INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_refund_topup INTEGER;
  v_refund_sub INTEGER;
  v_allowance_delta INTEGER;
  v_allowance_adjust INTEGER;
  -- Workspace-payer branch only:
  v_workspace_id UUID;
  v_org_id UUID;
  v_b_allocated INTEGER;
  v_b_reserved INTEGER;
  v_b_spent INTEGER;
  v_remaining_reserved INTEGER;
  v_spend_delta INTEGER;
  v_shortfall INTEGER;
  -- Deployment-allowance branch only (382):
  v_on_behalf_of UUID;
  v_a_granted INTEGER;
  v_a_reserved INTEGER;
  v_a_spent INTEGER;
  v_a_remaining_reserved INTEGER;
  v_a_spend_delta INTEGER;
  v_a_shortfall INTEGER;
  v_fr_cover INTEGER;
  v_fr_back INTEGER := 0;
BEGIN
  -- + on_behalf_of (382). The row is still the unit of settlement.
  SELECT user_id, credits_used, metadata, workspace_id, org_id, on_behalf_of
  INTO v_user_id, v_reserved, v_metadata, v_workspace_id, v_org_id, v_on_behalf_of
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_actual := COALESCE(p_actual_credits, v_reserved);

  -- ==========================================================================
  -- WORKSPACE PAYER. Arithmetic written so the budget CHECK holds by
  -- construction: after releasing this reservation, spend takes at most the
  -- remaining headroom; a metered overrun beyond it becomes an
  -- org_usage_variance ledger row (platform-absorbed, admin-visible in §8.7's
  -- report) instead of a constraint violation.
  -- ==========================================================================
  IF v_workspace_id IS NOT NULL THEN
    SELECT allocated_credits, reserved_credits, spent_credits
    INTO v_b_allocated, v_b_reserved, v_b_spent
    FROM workspace_budgets WHERE workspace_id = v_workspace_id FOR UPDATE;

    IF FOUND THEN
      v_remaining_reserved := GREATEST(v_b_reserved - v_reserved, 0);
      v_spend_delta := LEAST(v_actual, GREATEST(v_b_allocated - v_b_spent - v_remaining_reserved, 0));
      v_shortfall := v_actual - v_spend_delta;

      UPDATE workspace_budgets
      SET reserved_credits = v_remaining_reserved,
          spent_credits = spent_credits + v_spend_delta,
          updated_at = now()
      WHERE workspace_id = v_workspace_id;

      IF COALESCE((v_metadata->'payer'->>'member_spend')::BOOLEAN, FALSE) THEN
        UPDATE workspace_member_spend
        SET reserved_credits = GREATEST(reserved_credits - v_reserved, 0),
            spent_credits = spent_credits + v_spend_delta,
            updated_at = now()
        WHERE workspace_id = v_workspace_id AND user_id = v_user_id;
      END IF;

      IF v_shortfall > 0 THEN
        INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, workspace_id, job_id)
        VALUES (
          v_user_id,
          v_shortfall,
          'org',
          'org_usage_variance',
          'Metered overrun beyond workspace headroom, absorbed by the platform (usage_log ' || p_usage_log_id || ')',
          v_org_id,
          v_workspace_id,
          NULL
        );
      END IF;
    END IF;
    -- No budget row (workspace deleted between reserve and commit): nothing
    -- to reconcile — the reservation died with the row. Still mark the log.

    UPDATE usage_logs
    SET status = 'committed',
        credits_charged = v_actual
    WHERE id = p_usage_log_id;
    RETURN;
  END IF;

  -- ==========================================================================
  -- DEPLOYMENT PAYER — settle the allowance (382). BEFORE the personal
  -- profiles UPDATE below, so the lock order is ALLOWANCE -> PROFILES (D8).
  -- ==========================================================================
  -- Branches on the flag STAMPED AT RESERVE TIME, never on `on_behalf_of IS
  -- NOT NULL` (D4): a row reserved before the enforcement flip carries
  -- attribution but never bumped a ledger, and must settle against nothing.
  IF COALESCE((v_metadata->'payer'->>'allowance_enforced')::BOOLEAN, FALSE)
     AND v_on_behalf_of IS NOT NULL THEN
    SELECT granted_credits, reserved_credits, spent_credits
      INTO v_a_granted, v_a_reserved, v_a_spent
      FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE;
    -- No row (the user was deleted between reserve and commit) reconciles
    -- nothing — 351's posture for a deleted workspace, verbatim.
    IF FOUND THEN
      -- 351's clamp (351:515-535), copied. After releasing THIS reservation,
      -- spend takes at most the remaining headroom; anything beyond it is a
      -- metered overrun the platform absorbs. The CHECK therefore holds BY
      -- CONSTRUCTION and a metered overrun can never abort this function and
      -- strand the payer's real debit in `reserved` forever.
      v_a_remaining_reserved := GREATEST(v_a_reserved - v_reserved, 0);
      v_a_spend_delta := LEAST(v_actual,
          GREATEST(v_a_granted - v_a_spent - v_a_remaining_reserved, 0));
      v_a_shortfall := v_actual - v_a_spend_delta;

      UPDATE deployment_user_allowances
         SET reserved_credits = v_a_remaining_reserved,
             spent_credits = spent_credits + v_a_spend_delta,
             updated_at = now()
       WHERE user_id = v_on_behalf_of;

      -- The shortfall becomes an AUDIT row, not an org_usage_variance line
      -- (that table is org-scoped). Kind 'overrun', negative, and EXCLUDED
      -- from the `granted = SUM(grants)` reconciliation, so `granted_credits`
      -- does not move and the payer can still see what was absorbed.
      --
      -- COALESCE on `granted_by`: the column is NOT NULL, and a NULL settings
      -- payer here would abort the commit and strand the debit — the exact
      -- failure the clamp above exists to prevent. On this lane
      -- `usage_logs.user_id` IS the payer, so the fallback means the same
      -- thing. (A deviation from the spec's bare subselect, taken so a
      -- misconfiguration can never cost money.)
      IF v_a_shortfall > 0 THEN
        INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by, note)
        VALUES (v_on_behalf_of, -v_a_shortfall, 'overrun',
                COALESCE((SELECT payer_user_id FROM deployment_payer_settings WHERE id = true), v_user_id),
                'metered overrun beyond allowance headroom (usage_log ' || p_usage_log_id || ')');
      END IF;
    END IF;
  END IF;

  -- ==========================================================================
  -- PERSONAL PAYER — migration 176's body, verbatim. Do not edit.
  -- ==========================================================================
  -- If actual < reserved, refund the surplus to the originating pool(s) AND
  -- reverse the surplus portion of the daily-cap counter + app allowance.
  -- First Remake on us (684): a hold that drew on the cover gives the unused
  -- part back to the COVER first (never to the pools), and what the cover
  -- paid is counted on the offer. Profile, then offer: the lock order.
  v_fr_cover := COALESCE((v_metadata->>'from_cover')::INTEGER, 0);
  IF v_fr_cover > 0 THEN
    PERFORM 1 FROM profiles WHERE id = v_user_id FOR UPDATE;
    IF v_actual < v_reserved THEN
      v_fr_back := LEAST(v_reserved - v_actual, v_fr_cover);
    END IF;
    PERFORM first_remake_cover_settled(v_user_id, p_usage_log_id, v_fr_back, v_fr_cover - v_fr_back);
  END IF;

  IF v_actual < v_reserved THEN
    v_diff := v_reserved - v_actual;

    v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
    v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);

    IF v_from_sub + v_from_topup = 0 AND v_fr_cover = 0 THEN
      -- Legacy row without pool metadata → preserve prior all-to-topup behavior.
      v_refund_topup := v_diff;
      v_refund_sub := 0;
    ELSE
      -- Refund the LAST-deducted pool first (topup), so the kept `actual` stays
      -- attributed subscription-first. Clamp to each pool's contribution. The
      -- cover's share of the diff went back to the cover above (684).
      v_refund_topup := LEAST(v_diff - v_fr_back, v_from_topup);
      v_refund_sub := v_diff - v_fr_back - v_refund_topup;
    END IF;

    -- Reverse the surplus fraction of the app-allowance delta reserve applied.
    -- delta < 0 (app run consumed allowance): give back the unused surplus.
    -- delta > 0 (flow run earned allowance): un-earn the surplus.
    v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);
    IF v_allowance_delta < 0 THEN
      v_allowance_adjust := LEAST(v_diff, -v_allowance_delta);    -- restore (+)
    ELSIF v_allowance_delta > 0 THEN
      v_allowance_adjust := -LEAST(v_diff, v_allowance_delta);    -- un-earn (-)
    ELSE
      v_allowance_adjust := 0;
    END IF;

    UPDATE profiles
    SET subscription_credits = subscription_credits + v_refund_sub,
        topup_credits = topup_credits + v_refund_topup,
        daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_diff),
        app_credits_allowance = GREATEST(0, COALESCE(app_credits_allowance, 0) + v_allowance_adjust)
    WHERE id = v_user_id;
  END IF;

  UPDATE usage_logs
  SET status = 'committed',
      metadata = CASE WHEN v_fr_cover > 0 THEN metadata || jsonb_build_object('cover_charged', v_fr_cover - v_fr_back) ELSE metadata END,
      credits_charged = v_actual
  WHERE id = p_usage_log_id;
END;
$function$;

-- ---- refund_credits (382's, with the cover)
CREATE OR REPLACE FUNCTION public.refund_credits(p_usage_log_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_allowance_delta INTEGER;
  -- Workspace-payer branch only:
  v_workspace_id UUID;
  -- Deployment-allowance branch only (382):
  v_on_behalf_of UUID;
  v_a_reserved INTEGER;
  v_fr_cover INTEGER;
BEGIN
  -- + on_behalf_of (382).
  SELECT user_id, credits_used, metadata, workspace_id, on_behalf_of
  INTO v_user_id, v_credits, v_metadata, v_workspace_id, v_on_behalf_of
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  -- ==========================================================================
  -- WORKSPACE PAYER: release the reservation, spend nothing. The member's
  -- personal pools were never touched, so there is nothing to restore there.
  -- ==========================================================================
  IF v_workspace_id IS NOT NULL THEN
    UPDATE workspace_budgets
    SET reserved_credits = GREATEST(reserved_credits - v_credits, 0),
        updated_at = now()
    WHERE workspace_id = v_workspace_id;

    IF COALESCE((v_metadata->'payer'->>'member_spend')::BOOLEAN, FALSE) THEN
      UPDATE workspace_member_spend
      SET reserved_credits = GREATEST(reserved_credits - v_credits, 0),
          updated_at = now()
      WHERE workspace_id = v_workspace_id AND user_id = v_user_id;
    END IF;

    UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
    RETURN;
  END IF;

  -- ==========================================================================
  -- DEPLOYMENT PAYER — release the allowance (382). Before the personal
  -- restore below: ALLOWANCE -> PROFILES, the same order as reserve and
  -- commit (D8).
  -- ==========================================================================
  -- The explicit SELECT ... FOR UPDATE is not redundant with the UPDATE's own
  -- row lock: it states the lock ORDER in the text, which is the only place
  -- the deadlock discipline can be reviewed, and the behaviour proof asserts
  -- it there (a single-connection proof cannot assert it any other way).
  IF COALESCE((v_metadata->'payer'->>'allowance_enforced')::BOOLEAN, FALSE)
     AND v_on_behalf_of IS NOT NULL THEN
    SELECT reserved_credits INTO v_a_reserved
      FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE;
    IF FOUND THEN
      UPDATE deployment_user_allowances
         SET reserved_credits = GREATEST(v_a_reserved - v_credits, 0),
             updated_at = now()
       WHERE user_id = v_on_behalf_of;
    END IF;
  END IF;

  -- ==========================================================================
  -- PERSONAL PAYER — migration 171's body, verbatim. Do not edit.
  -- ==========================================================================
  -- Restore to original pools using metadata from reserve_credits
  v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
  v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);

  -- Fallback: if metadata doesn't have pool info, refund all to topup
  -- First Remake on us (684): the cover's share goes back to the cover (or,
  -- after the offer ended, nowhere) — never into the pools.
  v_fr_cover := COALESCE((v_metadata->>'from_cover')::INTEGER, 0);
  IF v_fr_cover > 0 THEN
    PERFORM 1 FROM profiles WHERE id = v_user_id FOR UPDATE;
    PERFORM first_remake_cover_settled(v_user_id, p_usage_log_id, v_fr_cover, 0);
  END IF;

  IF v_from_sub + v_from_topup = 0 AND v_fr_cover = 0 THEN
    v_from_topup := v_credits;
  END IF;

  -- (a) Reverse EXACTLY the app-allowance delta reserve_credits applied
  -- (recorded in metadata). Legacy rows without the field → 0 (no change),
  -- which is correct: the old asymmetric re-derivation is what minted allowance.
  v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);

  UPDATE profiles
  SET subscription_credits = subscription_credits + v_from_sub,
      topup_credits = topup_credits + v_from_topup,
      daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits),
      app_credits_allowance = GREATEST(0, COALESCE(app_credits_allowance, 0) - v_allowance_delta)
  WHERE id = v_user_id;

  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$function$;

-- ---- reverse_settled_llm_charge (554's, with the cover)
CREATE OR REPLACE FUNCTION public.reverse_settled_llm_charge(p_usage_log_id uuid, p_job_id uuid, p_marker text, p_description text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_fr_back INTEGER := 0;
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
  -- First Remake on us (684): what the cover paid of the charge goes back to
  -- the cover while its offer runs, else nowhere — never into the pools.
  v_fr_back := LEAST(v_charged, COALESCE((v_meta->>'cover_charged')::integer, 0));
  IF v_fr_back > 0 AND v_usage.workspace_id IS NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_usage.user_id FOR UPDATE;
    PERFORM public.first_remake_cover_returned_charged(v_usage.user_id, p_usage_log_id, v_fr_back);
  ELSE
    v_fr_back := 0;
  END IF;

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
                      - GREATEST(GREATEST(coalesce(v_usage.credits_used, 0) - LEAST(v_charged, coalesce(v_usage.credits_used, 0)), 0)
                                 - (coalesce((v_meta->>'from_cover')::integer, 0) - coalesce((v_meta->>'cover_charged')::integer, 0)), 0), 0)
                    + coalesce((v_meta->'overrun'->>'from_topup')::integer, 0);
    -- The pools get back only what they paid (684: the cover's share is above).
    v_refund_topup := LEAST(v_charged - v_fr_back, v_kept_topup);
    v_refund_sub := v_charged - v_fr_back - v_refund_topup;
    v_returned := v_charged - v_fr_back;
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
$function$;

-- ---- commit_credits_metered (551's; its overrun note keeps the row's metadata)
CREATE OR REPLACE FUNCTION public.commit_credits_metered(p_usage_log_id uuid, p_actual_credits integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_reserved INTEGER;
  v_metadata JSONB;
  v_workspace_id UUID;
  v_on_behalf_of UUID;
  v_job_id UUID;
  v_action TEXT;
  v_payer TEXT;
  v_extra INTEGER;
  v_collect INTEGER := 0;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
  v_shortfall INTEGER := 0;
  v_charged INTEGER;
  v_enforced BOOLEAN;
  v_sub INTEGER;
  v_topup INTEGER;
  v_avail INTEGER;
  v_allowance_delta INTEGER;
  v_a_granted INTEGER;
  v_a_reserved INTEGER;
  v_a_spent INTEGER;
  v_a_found BOOLEAN := FALSE;
  v_b_spent_before INTEGER;
  v_b_spent_after INTEGER;
  v_line_job UUID;
  v_balance_after INTEGER;
BEGIN
  -- Validated BEFORE anything moves, so a refusal leaves the row reserved.
  IF p_actual_credits IS NULL OR p_actual_credits < 0 THEN
    RAISE EXCEPTION 'METERED_ACTUAL_REQUIRED: a metered settle needs a non-negative actual, got %', p_actual_credits;
  END IF;

  SELECT user_id, credits_used, COALESCE(metadata, '{}'::jsonb), workspace_id, on_behalf_of, job_id, action
    INTO v_user_id, v_reserved, v_metadata, v_workspace_id, v_on_behalf_of, v_job_id, v_action
    FROM usage_logs
   WHERE id = p_usage_log_id AND status = 'reserved'
   FOR UPDATE;
  -- The same message commit_credits raises, so a replayed settle reads the same.
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_payer := CASE
    WHEN v_workspace_id IS NOT NULL THEN 'workspace'
    WHEN COALESCE((v_metadata->>'external_wallet')::BOOLEAN, FALSE) THEN 'external_wallet'
    WHEN v_on_behalf_of IS NOT NULL OR v_metadata->'payer'->>'kind' = 'deployment' THEN 'deployment'
    ELSE 'personal'
  END;

  -- 1. At or under the hold: today's settle, refund and all.
  IF p_actual_credits <= v_reserved THEN
    PERFORM commit_credits(p_usage_log_id, p_actual_credits);
    RETURN jsonb_build_object('charged', p_actual_credits, 'collected_over_hold', 0,
                              'shortfall', 0, 'payer', v_payer);
  END IF;

  v_extra := p_actual_credits - v_reserved;

  -- 2. Workspace payer: exactly commit_credits(id, actual). The budget is
  --    read under the same lock commit_credits takes (usage_logs ->
  --    workspace_budgets, its own order), only to REPORT what it did.
  IF v_workspace_id IS NOT NULL THEN
    SELECT spent_credits INTO v_b_spent_before
      FROM workspace_budgets WHERE workspace_id = v_workspace_id FOR UPDATE;
    PERFORM commit_credits(p_usage_log_id, p_actual_credits);
    IF v_b_spent_before IS NOT NULL THEN
      SELECT spent_credits INTO v_b_spent_after
        FROM workspace_budgets WHERE workspace_id = v_workspace_id;
      v_collect := GREATEST(v_b_spent_after - v_b_spent_before - v_reserved, 0);
      v_shortfall := GREATEST(p_actual_credits - (v_b_spent_after - v_b_spent_before), 0);
    END IF;
    RETURN jsonb_build_object('charged', p_actual_credits, 'collected_over_hold', v_collect,
                              'shortfall', v_shortfall, 'payer', v_payer);
  END IF;

  -- 3 and 4 both settle the hold first: the allowance moves reserved -> spent
  -- for the hold, and no surplus is refunded (actual = reserved).
  PERFORM commit_credits(p_usage_log_id, v_reserved);

  IF v_payer = 'external_wallet' THEN
    -- 3. The wallet journal is immutable past the hold (434): collect nothing.
    v_shortfall := v_extra;
  ELSE
    -- 4. Collect from the payer (usage_logs.user_id — the payer account under
    --    a deployment payer, never the requester). Lock order ALLOWANCE ->
    --    PROFILES (382's D8), and both re-read AFTER the inner commit, which
    --    has just released the hold from the allowance's `reserved`.
    v_enforced := COALESCE((v_metadata->'payer'->>'allowance_enforced')::BOOLEAN, FALSE)
                  AND v_on_behalf_of IS NOT NULL;
    IF v_enforced THEN
      SELECT granted_credits, reserved_credits, spent_credits
        INTO v_a_granted, v_a_reserved, v_a_spent
        FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE;
      v_a_found := FOUND;
    END IF;

    SELECT subscription_credits, topup_credits INTO v_sub, v_topup
      FROM profiles WHERE id = v_user_id FOR UPDATE;

    IF FOUND THEN
      v_sub := GREATEST(COALESCE(v_sub, 0), 0);
      v_topup := GREATEST(COALESCE(v_topup, 0), 0);
      -- A web-free-mode row (stamped at reserve, 311) draws the free pool only.
      IF COALESCE((v_metadata->>'web_free_mode')::BOOLEAN, FALSE) THEN
        v_avail := v_sub;
      ELSE
        v_avail := v_sub + v_topup;
      END IF;
      -- An enforced allowance caps the collection at the requester's quota.
      -- A missing ledger row (requester deleted since the reserve) cannot
      -- vouch for any quota, so it caps at 0.
      IF v_enforced THEN
        IF v_a_found THEN
          v_avail := LEAST(v_avail, v_a_granted - v_a_reserved - v_a_spent);
        ELSE
          v_avail := 0;
        END IF;
      END IF;

      v_collect := LEAST(v_extra, GREATEST(v_avail, 0));
      v_from_sub := LEAST(v_collect, v_sub);
      v_from_topup := v_collect - v_from_sub;

      IF v_collect > 0 THEN
        IF v_enforced AND v_a_found THEN
          UPDATE deployment_user_allowances
             SET spent_credits = spent_credits + v_collect,
                 updated_at = now()
           WHERE user_id = v_on_behalf_of;
        END IF;

        -- The daily counter records the spend, with NO daily-limit check: the
        -- limit is enforced at reserve; the overrun is work already done.
        -- The app allowance moves in the sign reserve stamped (308):
        -- negative consumes (floored at 0), positive earns.
        v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);
        UPDATE profiles
           SET subscription_credits = subscription_credits - v_from_sub,
               topup_credits = topup_credits - v_from_topup,
               daily_spent_credits = COALESCE(daily_spent_credits, 0) + v_collect,
               app_credits_allowance = CASE
                 WHEN v_allowance_delta < 0 THEN GREATEST(0, COALESCE(app_credits_allowance, 0) - v_collect)
                 WHEN v_allowance_delta > 0 THEN COALESCE(app_credits_allowance, 0) + v_collect
                 ELSE app_credits_allowance
               END
         WHERE id = v_user_id;
      END IF;
    END IF;

    v_shortfall := v_extra - v_collect;
  END IF;

  v_charged := v_reserved + v_collect;

  -- The external-wallet trigger re-fires on this UPDATE and accepts it:
  -- credits_charged is unchanged (= the hold) on that branch.
  UPDATE usage_logs
     SET credits_charged = v_charged,
         -- The row's metadata as commit_credits left it (684: it records what the
         -- first Remake's cover paid), with the overrun added.
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('overrun', jsonb_build_object(
           'collected', v_collect,
           'from_sub', v_from_sub,
           'from_topup', v_from_topup,
           'shortfall', v_shortfall))
   WHERE id = p_usage_log_id;

  -- 6. The collected overrun's ledger line (credits only): the payer's
  --    history shows the reserve's -hold line and this one, so the two sum to
  --    what was charged. Guarded like the anomaly below: the money is already
  --    settled, and a ledger fault must never roll that back. The job link is
  --    FK-safe (a usage log can outlive its job); a SIDE hold's log carries no
  --    job, so its row (554's llm_side_holds) names it.
  IF v_collect > 0 THEN
    BEGIN
      v_line_job := v_job_id;
      IF v_line_job IS NULL AND to_regclass('public.llm_side_holds') IS NOT NULL THEN
        EXECUTE 'SELECT job_id FROM public.llm_side_holds WHERE usage_log_id = $1' INTO v_line_job USING p_usage_log_id;
      END IF;
      SELECT COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0) INTO v_balance_after
        FROM profiles WHERE id = v_user_id;
      INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, job_id, balance_after)
      VALUES (
        v_user_id,
        -v_collect,
        CASE WHEN v_from_sub > 0 AND v_from_topup > 0 THEN 'mixed'
             WHEN v_from_topup > 0 THEN 'topup' ELSE 'subscription' END,
        'usage',
        CASE WHEN v_line_job IS NOT NULL THEN 'Job ' || v_line_job || ': ' ELSE '' END
          || COALESCE(v_action, 'generate') || ' — usage above the hold',
        (SELECT id FROM jobs WHERE id = v_line_job),
        COALESCE(v_balance_after, 0));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'commit_credits_metered: could not write the ledger line of the % collected on usage log %: %',
        v_collect, p_usage_log_id, SQLERRM;
    END;
  END IF;

  -- 5. Log what could not be collected. Guarded: the money is already settled,
  --    and a logging fault must never roll that back.
  IF v_shortfall > 0 THEN
    BEGIN
      INSERT INTO credit_anomalies (job_id, user_id, usage_log_id, model_identifier,
                                    credits_estimated, credits_actual, diff, anomaly_type)
      VALUES (
        -- job_id is a foreign key; a usage log can outlive its job.
        (SELECT id FROM jobs WHERE id = v_job_id),
        v_user_id,
        p_usage_log_id,
        COALESCE(v_action, 'generate'),
        v_reserved,
        p_actual_credits,
        v_shortfall,
        'uncollected_overrun');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'commit_credits_metered: could not log the uncollected overrun of % on usage log %: %',
        v_shortfall, p_usage_log_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('charged', v_charged, 'collected_over_hold', v_collect,
                            'shortfall', v_shortfall, 'payer', v_payer);
END;
$function$;

-- ---- reserve_llm_side_hold (554's, naming its job for the cover)
CREATE OR REPLACE FUNCTION public.reserve_llm_side_hold(p_user_id uuid, p_credits integer, p_job_id uuid, p_charge_id text, p_hold_key text DEFAULT NULL::text, p_is_app_run boolean DEFAULT false, p_daily_limit integer DEFAULT NULL::integer, p_web_free_mode boolean DEFAULT false, p_workspace_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid, p_enforce_allowance boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- First Remake on us (684): the hold names no job, so the job it is for is
  -- told to reserve_credits for this one call — a covered run's side hold may
  -- draw on the run's cover, and is recorded on its offer.
  PERFORM set_config('nodaro.first_remake_side_job', p_job_id::text, true);
  v_id := public.reserve_credits(p_user_id, p_credits, NULL, p_charge_id, 0, 0, p_is_app_run,
    p_daily_limit, p_web_free_mode, p_workspace_id, p_on_behalf_of, p_enforce_allowance);
  PERFORM set_config('nodaro.first_remake_side_job', '', true);
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
$function$;

-- ---------------------------------------------------------------------------
-- 10. Server only.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.first_remake_never_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_job_in_run(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_cover_available(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_first_remake_cover(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_cover_settled(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_cover_returned_charged(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_first_remake_offer_row(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_first_remake_offer(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_note_error(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_on_job_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_on_hold_settled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_offer_keep_running_job() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_first_remake_offers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.first_remake_release_orphan_holds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_remake_offer_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.first_remake_cover_available(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_first_remake_cover(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_first_remake_offer(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_first_remake_offers() TO service_role;
GRANT EXECUTE ON FUNCTION public.first_remake_release_orphan_holds(uuid) TO service_role;
-- The patched settle paths keep their grants (CREATE OR REPLACE keeps them).
