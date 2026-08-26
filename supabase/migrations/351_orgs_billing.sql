-- ============================================================================
-- 351_orgs_billing.sql — E2 / P12: pools, allocations, caps, and the
-- payer-aware reserve/commit/refund.
--
-- An organization buys credits once (P13 wires the money in), moves them into
-- per-workspace allocations, optionally caps individual members, and every
-- charge a member incurs while working in that workspace comes out of the
-- workspace's allocation instead of their own balance.
--
-- THE INVARIANT lives in the schema, not in code:
--   workspace_budgets CHECK (reserved_credits + spent_credits <= allocated_credits)
-- Every RPC below is written so the post-state satisfies it BY CONSTRUCTION
-- (the metered-overrun commit clamps and writes an org_usage_variance ledger
-- row rather than raising past the CHECK).
--
-- THE PERSONAL PATH DOES NOT MOVE. reserve_credits gains one trailing
-- `p_workspace_id uuid DEFAULT NULL` parameter (old signature dropped first —
-- PostgREST resolves overloads by argument names, two functions of this name
-- is a runtime ambiguity, exactly as migration 311 handled its own new
-- parameter). The workspace branch is a self-contained early block; below it
-- the 311 body appears VERBATIM — diff it against 311 in the PR. Same shape
-- for commit_credits / refund_credits: their SELECT gains the two payer
-- columns, the workspace branch returns early, the personal remainder is the
-- 176 / 171 text untouched. The only deliberate config change on the three
-- redefined functions: search_path is pinned `public, pg_temp` (the hardened
-- form this axis requires; CREATE OR REPLACE resets config, so it must be
-- restated here anyway — the 194 lesson).
--
-- Lock ordering (deadlock-free by hierarchy, every RPC obeys it):
--   usage_logs row -> organization_credit_accounts -> workspace_budgets
--     -> workspace_member_spend
--   reserve:  budgets -> member_spend
--   commit/refund: usage_logs -> budgets -> member_spend
--   allocate: org account -> budgets
--   grant/clawback: org account only
--
-- Stable RAISE prefixes (the wire contract P14's mapReserveError will map;
-- the concurrency proof asserts losers get BUDGET_EXCEEDED, never a
-- serialization error): WORKSPACE_NOT_FOUND:, WORKSPACE_ARCHIVED:,
-- MEMBER_SUSPENDED:, MEMBER_CAP_EXCEEDED:, BUDGET_EXCEEDED:,
-- ORG_POOL_EXCEEDED:, RECLAIM_EXCEEDS_AVAILABLE:, WORKSPACE_NOT_IN_ORG:,
-- ORG_NOT_FOUND:, MEMBER_NOT_FOUND:.
--
-- Two documented decisions where the design text under-specified the schema:
--   * transactions.user_id stays NOT NULL (the design relaxes only
--     stripe_customers.user_id). An org grant therefore stamps the
--     ORGANIZATION OWNER's user id on the claim row, and the org-ness of the
--     row is carried by org_id — the clawback branch keys on
--     `org_id IS NOT NULL`, never on user_id.
--   * credit_transactions.credit_type CHECK gains 'org' — the column is NOT
--     NULL and none of subscription/topup/mixed is true for an org-pool row;
--     writing 'mixed' would be a lie the reports would repeat.
--
-- Idempotent end to end: the migration-behavior CI job re-applies the newest
-- migration after the first pass, so every statement here re-runs cleanly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization_credit_accounts (
  org_id                     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- The unallocated pool. Allocation MOVES credits out of here into a
  -- workspace budget (move semantics, design §8.2) — the two never double-count.
  available_credits          integer NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  lifetime_purchased_credits bigint  NOT NULL DEFAULT 0,
  lifetime_allocated_credits bigint  NOT NULL DEFAULT 0,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_budgets (
  workspace_id       uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  allocated_credits  integer NOT NULL DEFAULT 0 CHECK (allocated_credits >= 0),
  reserved_credits   integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  spent_credits      integer NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- The hard guarantee, in the schema itself.
  CHECK (reserved_credits + spent_credits <= allocated_credits)
);

CREATE TABLE IF NOT EXISTS workspace_member_spend (
  workspace_id      uuid NOT NULL,
  user_id           uuid NOT NULL,
  reserved_credits  integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  spent_credits     integer NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
  reset_at          timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  -- Composite FK: a member row cannot be removed while spend is attributed to
  -- it; removing the member cascades the attribution. Implicit admins (org
  -- owner/admin with no workspace_members row) never get a row here — the FK
  -- would refuse it, and the reserve branch below never tries.
  FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

-- RLS. Reads for the people the numbers belong to; writes are service-role
-- only (no write policy exists, and the RPCs below are the only writers).
ALTER TABLE organization_credit_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_credit_accounts_select ON organization_credit_accounts;
CREATE POLICY org_credit_accounts_select ON organization_credit_accounts FOR SELECT
  USING (org_role(org_id) IN ('owner','admin'));

ALTER TABLE workspace_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_budgets_select ON workspace_budgets;
CREATE POLICY workspace_budgets_select ON workspace_budgets FOR SELECT
  USING (workspace_role(workspace_id) IS NOT NULL);

ALTER TABLE workspace_member_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_member_spend_select ON workspace_member_spend;
CREATE POLICY workspace_member_spend_select ON workspace_member_spend FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR workspace_role(workspace_id) = 'admin');

-- ----------------------------------------------------------------------------
-- 2. Stripe: a customer is EITHER a user OR an organization.
-- ----------------------------------------------------------------------------

ALTER TABLE stripe_customers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE stripe_customers ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'stripe_customers_one_owner' AND conrelid = 'stripe_customers'::regclass) THEN
    ALTER TABLE stripe_customers ADD CONSTRAINT stripe_customers_one_owner
      CHECK ((user_id IS NULL) <> (org_id IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_customers_org ON stripe_customers(org_id) WHERE org_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Ledger columns + the source / credit_type CHECKs, re-stated in FULL.
-- ----------------------------------------------------------------------------

ALTER TABLE transactions        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS workspace_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_org        ON transactions(org_id)        WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_tx_org           ON credit_transactions(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_tx_workspace     ON credit_transactions(workspace_id) WHERE workspace_id IS NOT NULL;
-- Clawback idempotency: one org_refund ledger row per Stripe event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_org_refund_event
  ON credit_transactions(stripe_transaction_id) WHERE source = 'org_refund';

-- Drop-and-re-add with the FULL list (the current list is 083's; adding
-- values one at a time is how a CHECK ends up describing half of what it
-- admits). 'stripe_refund' is included because TypeScript already emits it
-- and the constraint never allowed it.
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_created', 'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    'app_markup', 'app_earnings',
    'stripe_refund',
    'org_purchase', 'org_admin_grant', 'org_allocation', 'org_reclaim',
    'org_usage', 'org_refund', 'org_usage_variance',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  ));

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_credit_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_credit_type_check
  CHECK (credit_type IN ('subscription', 'topup', 'mixed', 'org'));

-- ----------------------------------------------------------------------------
-- 4. reserve_credits — one function, one new trailing parameter.
--    The old 9-parameter signature is dropped first (311's own pattern) so
--    PostgREST never sees an overload.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN);
-- FOUND BY THIS MIGRATION'S OWN BEHAVIOR PROOF, first run on a real Postgres:
-- a STALE six-parameter reserve_credits survived every later redefinition
-- (060/308/311 each dropped only the immediately-previous signature) — and it
-- was still EXECUTE-granted to anon and authenticated: an anonymous,
-- SECURITY DEFINER credit mutation reachable through PostgREST. Nothing can
-- be calling it (a six-named-argument rpc would be ambiguous against the
-- defaulted signature above and error), so dropping it closes the hole and
-- restores the one-function-per-name invariant the header promises.
DROP FUNCTION IF EXISTS reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL,
  p_display_cost_usd NUMERIC DEFAULT NULL,
  p_is_app_run BOOLEAN DEFAULT FALSE,
  p_daily_limit INTEGER DEFAULT NULL,
  p_web_free_mode BOOLEAN DEFAULT FALSE,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF v_pool_restricted THEN
    -- Web spending draws the free pool only; the top-up pool is reserved
    -- for the developer surfaces. The guard maps this prefix to the
    -- subscription_required 403 (approved modal) rather than a plain 402.
    IF v_sub_credits < p_credits THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: web spending draws only free-pool credits: need %, free pool has %',
        p_credits, v_sub_credits;
    END IF;
    v_from_sub := p_credits;
  ELSE
    IF (v_sub_credits + v_topup_credits) < p_credits THEN
      RAISE EXCEPTION 'Insufficient credits: need %, have %', p_credits, (v_sub_credits + v_topup_credits);
    END IF;

    -- Deduct from subscription first, then topup
    IF v_sub_credits >= p_credits THEN
      v_from_sub := p_credits;
    ELSE
      v_from_sub := v_sub_credits;
      v_from_topup := p_credits - v_from_sub;
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

  INSERT INTO usage_logs (user_id, job_id, action, provider, credits_used, cost_usd, status, metadata)
  VALUES (
    p_user_id,
    p_job_id,
    COALESCE(p_model_identifier, 'generate'),
    'reserved',
    p_credits,
    p_provider_cost_usd,
    'reserved',
    jsonb_build_object(
      'model', p_model_identifier,
      'display_cost', p_display_cost_usd,
      'from_sub', v_from_sub,
      'from_topup', v_from_topup,
      'is_app_run', p_is_app_run,
      'allowance_delta', v_allowance_delta,
      'web_free_mode', v_pool_restricted
    )
  )
  RETURNING id INTO v_usage_log_id;

  RETURN v_usage_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. commit_credits — the payer is read from the usage_logs row BEFORE
--    anything is written. Workspace branch first; the personal remainder is
--    migration 176's text verbatim.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
BEGIN
  SELECT user_id, credits_used, metadata, workspace_id, org_id
  INTO v_user_id, v_reserved, v_metadata, v_workspace_id, v_org_id
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
  -- PERSONAL PAYER — migration 176's body, verbatim. Do not edit.
  -- ==========================================================================
  -- If actual < reserved, refund the surplus to the originating pool(s) AND
  -- reverse the surplus portion of the daily-cap counter + app allowance.
  IF v_actual < v_reserved THEN
    v_diff := v_reserved - v_actual;

    v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
    v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);

    IF v_from_sub + v_from_topup = 0 THEN
      -- Legacy row without pool metadata → preserve prior all-to-topup behavior.
      v_refund_topup := v_diff;
      v_refund_sub := 0;
    ELSE
      -- Refund the LAST-deducted pool first (topup), so the kept `actual` stays
      -- attributed subscription-first. Clamp to each pool's contribution.
      v_refund_topup := LEAST(v_diff, v_from_topup);
      v_refund_sub := v_diff - v_refund_topup;
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
      credits_charged = v_actual
  WHERE id = p_usage_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. refund_credits — same shape: payer read first, workspace branch early,
--    the personal remainder is migration 171's text verbatim.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refund_credits(p_usage_log_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_allowance_delta INTEGER;
  -- Workspace-payer branch only:
  v_workspace_id UUID;
BEGIN
  SELECT user_id, credits_used, metadata, workspace_id
  INTO v_user_id, v_credits, v_metadata, v_workspace_id
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
  -- PERSONAL PAYER — migration 171's body, verbatim. Do not edit.
  -- ==========================================================================
  -- Restore to original pools using metadata from reserve_credits
  v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
  v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);

  -- Fallback: if metadata doesn't have pool info, refund all to topup
  IF v_from_sub + v_from_topup = 0 THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.refund_credits(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credits(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_credits(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. allocate_workspace_credits — org account row FIRST, then the budget row,
--    always that order (two callers taking the same two locks in opposite
--    orders is a deadlock that only appears under load).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_workspace_credits(
  p_org_id UUID,
  p_workspace_id UUID,
  p_delta INTEGER,
  p_actor_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ws_org UUID;
  v_available INTEGER;
  v_b_allocated INTEGER;
  v_b_reserved INTEGER;
  v_b_spent INTEGER;
  v_reclaim INTEGER;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Allocation delta must be non-zero';
  END IF;

  SELECT org_id INTO v_ws_org FROM workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND: no workspace %', p_workspace_id;
  END IF;
  IF (v_ws_org = p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_IN_ORG: workspace % does not belong to organization %', p_workspace_id, p_org_id;
  END IF;

  -- Lazily create both rows, then lock in the fixed order.
  INSERT INTO organization_credit_accounts (org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
  SELECT available_credits INTO v_available
  FROM organization_credit_accounts WHERE org_id = p_org_id FOR UPDATE;

  INSERT INTO workspace_budgets (workspace_id) VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;
  SELECT allocated_credits, reserved_credits, spent_credits
  INTO v_b_allocated, v_b_reserved, v_b_spent
  FROM workspace_budgets WHERE workspace_id = p_workspace_id FOR UPDATE;

  IF p_delta > 0 THEN
    IF v_available < p_delta THEN
      RAISE EXCEPTION 'ORG_POOL_EXCEEDED: available %, need %', v_available, p_delta;
    END IF;
    UPDATE organization_credit_accounts
    SET available_credits = available_credits - p_delta,
        lifetime_allocated_credits = lifetime_allocated_credits + p_delta,
        updated_at = now()
    WHERE org_id = p_org_id;
    UPDATE workspace_budgets
    SET allocated_credits = allocated_credits + p_delta, updated_at = now()
    WHERE workspace_id = p_workspace_id;
  ELSE
    -- Reclaim: the allocation may come down only to what is already reserved
    -- or spent — never below, so in-flight reservations keep their headroom
    -- and the budget CHECK cannot be violated by this statement.
    v_reclaim := -p_delta;
    IF v_reclaim > (v_b_allocated - v_b_reserved - v_b_spent) THEN
      RAISE EXCEPTION 'RECLAIM_EXCEEDS_AVAILABLE: allocated %, reserved %, spent %, reclaimable %',
        v_b_allocated, v_b_reserved, v_b_spent, GREATEST(v_b_allocated - v_b_reserved - v_b_spent, 0);
    END IF;
    UPDATE workspace_budgets
    SET allocated_credits = allocated_credits - v_reclaim, updated_at = now()
    WHERE workspace_id = p_workspace_id;
    UPDATE organization_credit_accounts
    SET available_credits = available_credits + v_reclaim, updated_at = now()
    WHERE org_id = p_org_id;
  END IF;

  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, workspace_id)
  VALUES (
    p_actor_id,
    p_delta,
    'org',
    CASE WHEN p_delta > 0 THEN 'org_allocation' ELSE 'org_reclaim' END,
    CASE WHEN p_delta > 0
      THEN 'Allocated ' || p_delta || ' credits to workspace ' || p_workspace_id
      ELSE 'Reclaimed ' || v_reclaim || ' credits from workspace ' || p_workspace_id
    END,
    p_org_id,
    p_workspace_id
  );

  SELECT allocated_credits - reserved_credits - spent_credits INTO v_b_allocated
  FROM workspace_budgets WHERE workspace_id = p_workspace_id;
  RETURN v_b_allocated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_workspace_credits(UUID, UUID, INTEGER, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_workspace_credits(UUID, UUID, INTEGER, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_workspace_credits(UUID, UUID, INTEGER, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_workspace_credits(UUID, UUID, INTEGER, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. grant_org_credits_idempotent — money (or an admin grant) into the pool,
--    exactly once per external id, mirroring grant_topup_credits_idempotent:
--    the transactions row is the claim, taken before anything is granted.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_org_credits_idempotent(
  p_org_id UUID,
  p_credits INTEGER,
  p_external_id TEXT,
  p_source TEXT,
  p_amount_usd NUMERIC DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner UUID;
  v_rows INTEGER;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;
  IF p_source NOT IN ('org_purchase', 'org_admin_grant') THEN
    RAISE EXCEPTION 'Invalid org grant source: %', p_source;
  END IF;

  -- transactions.user_id is NOT NULL by long-standing schema; the org's OWNER
  -- is stamped on the claim row (a row filter for accounting, not an identity
  -- claim — org-ness is carried by org_id, which is what the clawback branch
  -- keys on).
  SELECT owner_user_id INTO v_owner FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND: no organization %', p_org_id;
  END IF;

  INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted, org_id, status)
  VALUES (v_owner, p_external_id, 'topup', p_amount_usd, p_credits, p_org_id, 'completed')
  ON CONFLICT (stripe_transaction_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Duplicate delivery / replay: the claim already exists → do NOT re-grant.
    RETURN FALSE;
  END IF;

  INSERT INTO organization_credit_accounts (org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
  UPDATE organization_credit_accounts
  SET available_credits = available_credits + p_credits,
      lifetime_purchased_credits = lifetime_purchased_credits + p_credits,
      updated_at = now()
  WHERE org_id = p_org_id;

  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, stripe_transaction_id)
  VALUES (
    v_owner,
    p_credits,
    'org',
    p_source,
    CASE WHEN p_source = 'org_purchase'
      THEN 'Organization credit pack purchase (' || p_external_id || ')'
      ELSE 'Platform-admin credit grant (' || p_external_id || ')'
    END,
    p_org_id,
    p_external_id
  );

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_org_credits_idempotent(UUID, INTEGER, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_org_credits_idempotent(UUID, INTEGER, TEXT, TEXT, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_org_credits_idempotent(UUID, INTEGER, TEXT, TEXT, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_org_credits_idempotent(UUID, INTEGER, TEXT, TEXT, NUMERIC) TO service_role;

-- ----------------------------------------------------------------------------
-- 9. Member cap + spend reset. Both act on the EXPLICIT membership — an
--    implicit admin has no row to cap and no row to reset, and that is the
--    design, not a gap.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_member_credit_cap(
  p_workspace_id UUID,
  p_user_id UUID,
  p_cap INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_cap IS NOT NULL AND p_cap < 0 THEN
    RAISE EXCEPTION 'Cap must be NULL (uncapped) or >= 0, got %', p_cap;
  END IF;
  UPDATE workspace_members SET credit_cap = p_cap
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: user % has no explicit membership in workspace % (implicit admins cannot be capped)',
      p_user_id, p_workspace_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_member_credit_cap(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_member_credit_cap(UUID, UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_credit_cap(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_credit_cap(UUID, UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_member_spend(
  p_workspace_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only `spent` resets. `reserved` tracks in-flight work — zeroing it would
  -- desynchronize the row from reservations that will still commit or refund
  -- against it. No row means no spend: a silent no-op is the honest answer.
  UPDATE workspace_member_spend
  SET spent_credits = 0, reset_at = now(), updated_at = now()
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_member_spend(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_member_spend(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_member_spend(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_member_spend(UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. claw_back_org_credits — a Stripe refund/dispute takes back from the
--     pool, floored at zero (the org may already have spent what was
--     refunded — the shortfall is recorded, the pool never goes negative).
--     Idempotent per Stripe event: the org_refund ledger row is the claim,
--     enforced by uq_credit_tx_org_refund_event.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claw_back_org_credits(
  p_org_id UUID,
  p_amount INTEGER,
  p_stripe_event_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner UUID;
  v_available INTEGER;
  v_shortfall INTEGER;
  v_rows INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Clawback amount must be positive, got %', p_amount;
  END IF;

  SELECT owner_user_id INTO v_owner FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND: no organization %', p_org_id;
  END IF;

  -- Claim first (idempotency): a redelivered refund event finds its ledger
  -- row already written and changes nothing.
  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, stripe_transaction_id)
  VALUES (v_owner, -p_amount, 'org', 'org_refund',
          'Stripe refund/dispute clawback (' || p_stripe_event_id || ')',
          p_org_id, p_stripe_event_id)
  ON CONFLICT (stripe_transaction_id) WHERE source = 'org_refund' DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO organization_credit_accounts (org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
  SELECT available_credits INTO v_available
  FROM organization_credit_accounts WHERE org_id = p_org_id FOR UPDATE;

  v_shortfall := GREATEST(p_amount - v_available, 0);
  UPDATE organization_credit_accounts
  SET available_credits = GREATEST(available_credits - p_amount, 0),
      updated_at = now()
  WHERE org_id = p_org_id;

  IF v_shortfall > 0 THEN
    UPDATE credit_transactions
    SET description = description || ' — SHORTFALL ' || v_shortfall || ': the pool held only ' || v_available
    WHERE stripe_transaction_id = p_stripe_event_id AND source = 'org_refund' AND org_id = p_org_id;
  END IF;

  RETURN v_shortfall;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claw_back_org_credits(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claw_back_org_credits(UUID, INTEGER, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claw_back_org_credits(UUID, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claw_back_org_credits(UUID, INTEGER, TEXT) TO service_role;
