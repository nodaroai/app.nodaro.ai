-- ============================================================================
-- 599 — an app's fee settles only what the runner actually paid
-- ============================================================================
-- `process_app_monetization` settles a monetized app's creator fee (the
-- markup) once per run, after the run ends. On the personal-payer path the
-- runner's balance was debited the WHOLE fee whatever it held ("balance can go
-- negative"), and the creator was credited the whole fee as spendable top-up
-- credits. A fee larger than the runner's balance therefore credited the
-- creator with credits nobody paid.
--
-- From here the personal path collects at most what the runner can pay:
--
--   collected = LEAST(fee, GREATEST(subscription + topup, 0))
--
-- (the spendable balance the run's credit checks read), taken from the
-- subscription pool first, then the top-up pool; a pool is never taken below
-- zero. The creator is credited exactly `collected` (topup_credits and
-- total_earnings). The runner's balance never goes below zero through this
-- function, and a runner already at or below zero pays nothing.
--
-- Bookkeeping shows the real amounts:
--   * app_earnings keeps `flat_fee` and `percent_fee` as the fee that was
--     asked; `total_earned` is what was collected and `total_charged` is
--     base + collected. The part not collected is
--     `flat_fee + percent_fee - total_earned`.
--   * the runner's `app_markup` row and the creator's `app_earnings` row in
--     credit_transactions both carry `collected`. Neither row is written when
--     nothing was collected (app_earnings still records the run).
--   * the function returns `collected`.
--
-- Unchanged:
--   * the run-id mutex (migration 173): the app_earnings INSERT ... ON
--     CONFLICT (run_id) DO NOTHING still runs first and a repeat call for the
--     same run returns 0 without touching any balance. The earnings row is
--     corrected by an UPDATE inside the same call that claimed it.
--   * the lock order: the earnings row, then both profiles rows in uuid order.
--   * the workspace-payer branch for an organization-approved app (migration
--     352), byte for byte: the workspace budget is charged up to its headroom,
--     the uncovered part is recorded as `org_usage_variance`, and the creator
--     is paid the whole fee. That outcome is a documented behaviour of
--     organization billing (the usage report's `appMarkupAbsorbedCredits`);
--     this migration does not change it.
--   * the signature, the return type, the default and the grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_app_monetization(
  p_runner_id    UUID,
  p_creator_id   UUID,
  p_markup_amount INT,
  p_app_id       UUID,
  p_run_id       UUID,
  p_base_cost    INT,
  p_flat_fee     INT,
  p_percent_fee  INT,
  p_payer_workspace_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_runner_sub     INT;
  v_runner_topup   INT;
  v_from_sub       INT := 0;
  v_from_topup     INT := 0;
  v_collected      INT := 0;
  v_runner_balance INT;
  v_creator_balance INT;
  v_ws_org         UUID;
  v_workflow_id    UUID;
  v_ws_paying      BOOLEAN := FALSE;
  v_b_allocated    INT;
  v_b_reserved     INT;
  v_b_spent        INT;
  v_headroom       INT;
  v_charge         INT;
  v_shortfall      INT;
BEGIN
  -- Return 0 if nothing to charge
  IF p_markup_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Decide the payer BEFORE the mutex so the earnings row can record who
  -- actually pays. Reads only; no locks yet.
  IF p_payer_workspace_id IS NOT NULL THEN
    SELECT org_id INTO v_ws_org FROM workspaces WHERE id = p_payer_workspace_id;
    SELECT workflow_id INTO v_workflow_id FROM published_apps WHERE id = p_app_id;
    -- Unresolvable workspace or app ⇒ personal: the charge must land
    -- somewhere, and the runner is the only payer left standing.
    v_ws_paying := v_ws_org IS NOT NULL AND v_workflow_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_approved_apps
        WHERE org_id = v_ws_org AND workflow_id = v_workflow_id
      );
  END IF;

  -- Idempotency mutex: exactly one earnings row per run. If this run was
  -- already monetized (e.g. a stalled orchestrator re-pick re-invoked us),
  -- the insert conflicts and we return WITHOUT re-charging / re-crediting.
  -- All inserted values come from params, so this is safe to do first.
  -- Shared by BOTH payer branches — the mutex must claim before any fork.
  -- The personal branch below corrects total_earned / total_charged to what
  -- it actually collects.
  INSERT INTO app_earnings (app_id, run_id, runner_id, creator_id, base_cost, flat_fee, percent_fee, total_earned, total_charged, payer_workspace_id)
  VALUES (p_app_id, p_run_id, p_runner_id, p_creator_id, p_base_cost, p_flat_fee, p_percent_fee, p_markup_amount, p_base_cost + p_markup_amount,
          CASE WHEN v_ws_paying THEN p_payer_workspace_id END)
  ON CONFLICT (run_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Already processed for this run_id — no-op (idempotent re-entry).
    RETURN 0;
  END IF;

  -- ==========================================================================
  -- WORKSPACE PAYER, ORG-APPROVED APP: the workspace pays the markup.
  -- Migration 352's block, unchanged.
  -- ==========================================================================
  IF v_ws_paying THEN

      SELECT allocated_credits, reserved_credits, spent_credits
      INTO v_b_allocated, v_b_reserved, v_b_spent
      FROM workspace_budgets
      WHERE workspace_id = p_payer_workspace_id
      FOR UPDATE;

      IF NOT FOUND THEN
        -- No budget row: nothing chargeable — the whole markup is absorbed
        -- as variance (the creator is still paid in full below).
        v_charge := 0;
        v_shortfall := p_markup_amount;
      ELSE
        v_headroom := GREATEST(v_b_allocated - v_b_reserved - v_b_spent, 0);
        v_charge := LEAST(p_markup_amount, v_headroom);
        v_shortfall := p_markup_amount - v_charge;
        IF v_charge > 0 THEN
          UPDATE workspace_budgets
          SET spent_credits = spent_credits + v_charge,
              updated_at = now()
          WHERE workspace_id = p_payer_workspace_id;
        END IF;
      END IF;

      IF v_shortfall > 0 THEN
        -- 351's variance discipline: the platform absorbs what the budget
        -- could not cover, visibly — never a raise (swallowed post-run),
        -- never the runner's personal pocket on an approved app.
        INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, workspace_id, job_id)
        VALUES (
          p_runner_id,
          v_shortfall,
          'org',
          'org_usage_variance',
          'App markup beyond workspace headroom, absorbed by the platform (run ' || p_run_id || ')',
          v_ws_org,
          p_payer_workspace_id,
          NULL
        );
      END IF;

      -- The creator is paid IN FULL regardless of the clamp — customer-facing
      -- outcomes stay whole; the shortfall above is the platform's ledger.
      PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;

      UPDATE profiles
      SET topup_credits = topup_credits + p_markup_amount,
          total_earnings = total_earnings + p_markup_amount
      WHERE id = p_creator_id;

      SELECT (subscription_credits + topup_credits)
      INTO v_creator_balance
      FROM profiles WHERE id = p_creator_id;

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
  END IF;

  -- ==========================================================================
  -- PERSONAL PAYER (p_payer_workspace_id NULL, unresolvable workspace, or an
  -- app the organization has NOT approved): the runner pays what they can,
  -- and the creator is credited exactly that.
  -- ==========================================================================

  -- Lock both profile rows ordered by UUID to prevent deadlocks
  IF p_runner_id < p_creator_id THEN
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
  END IF;

  -- Read runner balances (a missing row reads as nothing to pay with)
  SELECT COALESCE(subscription_credits, 0), COALESCE(topup_credits, 0)
  INTO v_runner_sub, v_runner_topup
  FROM profiles WHERE id = p_runner_id;
  v_runner_sub := COALESCE(v_runner_sub, 0);
  v_runner_topup := COALESCE(v_runner_topup, 0);

  -- Collect at most the runner's spendable balance (both pools together,
  -- never below zero): subscription first, then topup. Neither pool is taken
  -- below zero, and the total never goes below zero.
  v_collected := LEAST(p_markup_amount, GREATEST(v_runner_sub + v_runner_topup, 0));
  v_from_sub := LEAST(GREATEST(v_runner_sub, 0), v_collected);
  v_from_topup := v_collected - v_from_sub;

  -- The earnings row claimed above records what was actually collected.
  UPDATE app_earnings
  SET total_earned = v_collected,
      total_charged = p_base_cost + v_collected
  WHERE run_id = p_run_id;

  IF v_collected <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup
  WHERE id = p_runner_id;

  -- Credit creator exactly what was collected: topup_credits + total_earnings
  UPDATE profiles
  SET topup_credits = topup_credits + v_collected,
      total_earnings = total_earnings + v_collected
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
    -v_collected,
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
    v_collected,
    'topup',
    'app_earnings',
    'Earnings from app run',
    v_creator_balance
  );

  RETURN v_collected;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) TO service_role;
