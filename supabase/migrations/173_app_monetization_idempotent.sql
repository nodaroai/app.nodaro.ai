-- 173: Make app-run monetization idempotent per run_id.
--
-- Bug (H5)
-- --------
-- process_app_monetization (migration 083) unconditionally debits the runner,
-- credits the creator's topup_credits + total_earnings, and INSERTs an
-- app_earnings row — with NO idempotency guard and no UNIQUE on
-- app_earnings.run_id. If the same execution reaches the end-of-run
-- monetization call twice (the orchestrator stalled-re-pick recovery path —
-- see the resume guard added to orchestrator-worker.ts), the runner is
-- debited twice and the creator credited twice for one run.
--
-- Fix
-- ---
-- (1) UNIQUE (run_id) on app_earnings — one earnings row per run.
-- (2) Rebuild the RPC to INSERT the earnings row FIRST as the mutex
--     (ON CONFLICT (run_id) DO NOTHING). If the row already exists (run
--     already monetized) the function returns early WITHOUT re-charging the
--     runner or re-crediting the creator. Mirrors the 23505/ON CONFLICT
--     idempotency pattern used by the Stripe webhook handlers.
--
-- Existing duplicate rows (from the bug, if any) are collapsed to the earliest
-- per run_id so the UNIQUE constraint can be added. NOTE: this does not reverse
-- any historical double-credit already applied to balances — the window is
-- narrow (worker death between the RPC and BullMQ ack) and reversing balances
-- blind is riskier than the small, rare drift it would correct.

-- (0) Collapse any pre-existing duplicate earnings rows (keep earliest;
--     tie-break on id) so the UNIQUE constraint below can be created.
DELETE FROM app_earnings a
USING app_earnings b
WHERE a.run_id = b.run_id
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- (1) One earnings row per run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_earnings_run_id_unique'
  ) THEN
    ALTER TABLE app_earnings
      ADD CONSTRAINT app_earnings_run_id_unique UNIQUE (run_id);
  END IF;
END $$;

-- (2) Idempotent RPC: insert-first mutex, return early on conflict.
CREATE OR REPLACE FUNCTION process_app_monetization(
  p_runner_id    UUID,
  p_creator_id   UUID,
  p_markup_amount INT,
  p_app_id       UUID,
  p_run_id       UUID,
  p_base_cost    INT,
  p_flat_fee     INT,
  p_percent_fee  INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runner_sub     INT;
  v_runner_topup   INT;
  v_from_sub       INT := 0;
  v_from_topup     INT := 0;
  v_runner_balance INT;
  v_creator_balance INT;
BEGIN
  -- Return 0 if nothing to charge
  IF p_markup_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Idempotency mutex: exactly one earnings row per run. If this run was
  -- already monetized (e.g. a stalled orchestrator re-pick re-invoked us),
  -- the insert conflicts and we return WITHOUT re-charging / re-crediting.
  -- All inserted values come from params, so this is safe to do first.
  INSERT INTO app_earnings (app_id, run_id, runner_id, creator_id, base_cost, flat_fee, percent_fee, total_earned, total_charged)
  VALUES (p_app_id, p_run_id, p_runner_id, p_creator_id, p_base_cost, p_flat_fee, p_percent_fee, p_markup_amount, p_base_cost + p_markup_amount)
  ON CONFLICT (run_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Already processed for this run_id — no-op (idempotent re-entry).
    RETURN 0;
  END IF;

  -- Lock both profile rows ordered by UUID to prevent deadlocks
  IF p_runner_id < p_creator_id THEN
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
  END IF;

  -- Read runner balances
  SELECT subscription_credits, topup_credits
  INTO v_runner_sub, v_runner_topup
  FROM profiles WHERE id = p_runner_id;

  -- Deduct from runner: subscription first, then topup (balance can go negative)
  IF v_runner_sub >= p_markup_amount THEN
    v_from_sub := p_markup_amount;
  ELSE
    v_from_sub := GREATEST(v_runner_sub, 0);
    v_from_topup := p_markup_amount - v_from_sub;
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup
  WHERE id = p_runner_id;

  -- Credit creator: topup_credits + total_earnings
  UPDATE profiles
  SET topup_credits = topup_credits + p_markup_amount,
      total_earnings = total_earnings + p_markup_amount
  WHERE id = p_creator_id;

  -- Get balances for transaction records
  SELECT (subscription_credits + topup_credits)
  INTO v_runner_balance
  FROM profiles WHERE id = p_runner_id;

  SELECT (subscription_credits + topup_credits)
  INTO v_creator_balance
  FROM profiles WHERE id = p_creator_id;

  -- Insert credit_transaction for runner (debit)
  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
  VALUES (
    p_runner_id,
    -p_markup_amount,
    CASE WHEN v_from_sub > 0 AND v_from_topup > 0 THEN 'mixed'
         WHEN v_from_topup > 0 THEN 'topup'
         ELSE 'subscription' END,
    'app_markup',
    'App creator markup',
    v_runner_balance
  );

  -- Insert credit_transaction for creator (credit)
  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
  VALUES (
    p_creator_id,
    p_markup_amount,
    'topup',
    'app_earnings',
    'Earnings from app run',
    v_creator_balance
  );

  RETURN p_markup_amount;
END;
$$;

-- Restrict direct invocation from client roles (signature unchanged)
REVOKE EXECUTE ON FUNCTION process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT) FROM authenticated, anon;
