-- ============================================================================
-- 352 — E2/P14: app monetization learns who the payer is (+ the approval list)
-- ============================================================================
-- Two pieces, one decision (owner decision, 2026-08-26):
--
--   A workspace pays a creator's MARKUP only for apps the organization has
--   APPROVED. An unapproved app run as class work keeps billing its markup to
--   the RUNNER personally — otherwise the workspace budget is a laundering
--   channel (a member runs a confederate's high-markup app and org money
--   exits to a stranger's personal, spendable balance).
--
-- The BASE compute cost needs nothing here: it is paid by the per-node
-- `reserve_credits` calls, which P14 threads with `p_workspace_id` (351).
-- `process_app_monetization` charges ONLY the markup — `p_base_cost` is
-- bookkeeping in `app_earnings`, never a debit (083/173 semantics, kept).
--
-- 1. `organization_approved_apps` — the sanction table. Members can SEE the
--    list (the runtime shows "approved by your school"); writes are
--    service-role only (the plugin's owner-gated routes).
--
--    APPROVAL IDENTITY ACROSS VERSIONS (owner decision, 2026-08-26): the
--    approval is keyed on the WORKFLOW, not the per-version published_apps
--    row — a republish (every `published_apps` version is a NEW row) must
--    not silently un-approve the tool and flip students back to personal
--    payment. The laundering re-open (approve cheap, republish expensive)
--    is closed at the PUBLISH route instead: a republish whose markup RISES
--    deletes the workflow's approval rows, forcing re-approval. Price drops
--    and plain fixes keep the approval.
-- 2. `process_app_monetization` — DROP-then-CREATE (never leave a PostgREST
--    overload pair — the 351 behavior proof caught a stale anon-EXECUTE
--    overload that survived three migrations exactly this way) with one new
--    trailing parameter `p_payer_workspace_id UUID DEFAULT NULL`.
--      NULL, or the workspace/org can't be resolved  → the 173 body verbatim.
--      Set + the app is org-approved                 → the WORKSPACE pays the
--        markup: budget `spent_credits` rises, CLAMPED to headroom; any
--        shortfall is platform-absorbed as an `org_usage_variance` row (the
--        351 discipline — this function is called post-run and its errors are
--        deliberately swallowed by the orchestrator, so raising here would
--        mean silently-free paid apps). The runner's `profiles` row is NEVER
--        touched on this path. The creator is paid IN FULL either way.
--      Set + NOT approved                            → the runner pays the
--        markup personally (the 173 body verbatim).
--
-- Lock discipline: the approved branch locks workspace_budgets, then the
-- creator's profiles row. Nothing in 351 or here ever takes profiles before
-- a budget row, so the order is cycle-free with the whole 351 hierarchy
-- (usage_logs → organization_credit_accounts → workspace_budgets →
-- workspace_member_spend). The personal branch keeps 173's uuid-ordered
-- two-profile lock exactly.
--
-- The member cap is deliberately NOT consulted: caps gate the RESERVE path;
-- the markup is an app-level charge that lands post-run, and a cap raise
-- here would be swallowed (see above). Headroom clamping is the guard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The approval list
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_approved_apps (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The WORKFLOW is the stable identity of a published app across its
  -- versions (see the header decision); published_apps rows are per-version.
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, workflow_id)
);
-- The PK serves org-side lookups; these serve the FK cascades (second PK
-- column cannot) — the 052 unindexed-FK class, closed at birth.
CREATE INDEX IF NOT EXISTS idx_org_approved_apps_workflow ON organization_approved_apps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_org_approved_apps_approved_by
  ON organization_approved_apps(approved_by) WHERE approved_by IS NOT NULL;

ALTER TABLE organization_approved_apps ENABLE ROW LEVEL SECURITY;

-- Members read (the app runtime shows the approval state); writes are
-- service-role only — the plugin's owner-gated routes are the only writers.
-- org_role() is the 332 SECURITY DEFINER helper (never the table itself).
-- DROP-first: the CI migrate job re-runs the newest file, and CREATE POLICY
-- alone is not idempotent (the 351 discipline).
DROP POLICY IF EXISTS approved_apps_member_read ON organization_approved_apps;
CREATE POLICY approved_apps_member_read ON organization_approved_apps
  FOR SELECT USING (org_role(org_id) IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 1b. app_earnings learns who actually paid the markup — without this the
--     ledger asserts the runner was charged base+markup on runs where the
--     workspace paid, and reconciliation "corrects" balances that were never
--     wrong. NULL = the runner paid personally (every pre-352 row).
-- ----------------------------------------------------------------------------
ALTER TABLE app_earnings ADD COLUMN IF NOT EXISTS payer_workspace_id uuid;

-- ----------------------------------------------------------------------------
-- 2. process_app_monetization — the payer-aware markup
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT);

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
  -- A self-contained early block, mirroring 351's reserve_credits structure:
  -- it never touches the runner's `profiles`, and it returns before the
  -- personal body below, which is migration 173's text verbatim.
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
  -- app the organization has NOT approved): migration 173's body verbatim.
  -- ==========================================================================

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

-- Grants — the full org-axis convention, FRESH. 083/173 predate it: they only
-- revoked authenticated/anon, and CREATE OR REPLACE inherits whatever grants
-- the old signature carried. The DROP above severed that history; this block
-- is the complete, explicit truth for the new signature.
REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT, UUID) TO service_role;
