-- Deployment user allowances: the per-user ledger, and the three money RPCs
-- redefined to enforce it inside the transaction that debits the payer.
-- (Track A, spec 2026-09-04-sai-per-user-balances-and-billing-account §6.2 and
-- §7, decisions D1-D4, D7, D8, D13, D16. Rollout step 2 — DARK: nothing passes
-- the two new parameters until step 3, and nothing sets p_enforce_allowance
-- until the step-8 flip.)
--
-- Depends on 381 (`deployment_payer_settings`, the singleton this file reads
-- for the payer id and the default allocation).
--
-- ============================================================================
-- WHAT AN ALLOWANCE IS, AND WHAT IT IS NOT
-- ============================================================================
-- On a deployment-payer instance ONE account pays for every generation, so
-- every requester spends someone else's pool and nothing bounds any single
-- user's share of it. An allowance is that bound: a materialised
-- granted/reserved/spent row per requester, held in NODARO CREDITS.
--
-- It is a QUOTA, NEVER MONEY. Nodaro's real exposure is the payer's `profiles`
-- balance, which `reserve_credits` has always enforced atomically and still
-- does — an exhausted allowance protects nobody's money, it only stops one
-- user consuming the customer's whole pool. Nothing in this file may be read
-- as a second wallet.
--
-- WHY MATERIALISED, not `SUM(usage_logs.credits_used) WHERE on_behalf_of = …`:
-- 362's own header calls that column "ATTRIBUTION ONLY … stamped best-effort
-- after the reserve", i.e. allowed to be missing. Money must never be derived
-- from a column that is allowed to be missing — a failed stamp would silently
-- hand a user free credits. (This file also RETIRES that weakness: the column
-- moves into the RPC's own INSERT, so attribution stops being a second
-- statement that can fail. See the COMMENT rewrite at the end of section 3.)
--
-- WHY CREDITS, not SAI display units: `unitRate` is display configuration.
-- A ledger in units would be wrong the day the rate moved, and enforcement
-- would have to convert on the hot path against `pricing.creditCost`, which is
-- in credits. Units exist at exactly two boundaries — route input and render.
--
-- ============================================================================
-- MAINLINE IS BYTE-IDENTICAL WITHOUT A PAYER
-- ============================================================================
-- The existing 10-argument call leaves `p_on_behalf_of` NULL and
-- `p_enforce_allowance` FALSE, so: the allowance block is skipped entirely (no
-- table is read or written), `on_behalf_of` is written NULL, the metadata gets
-- `|| '{}'::jsonb` and therefore NO `payer` key AT ALL — the key absent, not
-- present-and-null, which is the only form of byte-identity a JSONB column can
-- be checked for — and commit/refund branch on
-- `metadata.payer.allowance_enforced`, which a mainline row never carries.
-- `supabase/tests/deployment-allowance.behavior.sql` case 9 asserts exactly
-- that, key list included.
--
-- ============================================================================
-- TWO SWITCHES, NOT ONE (D3) — and why the rollout needs both
-- ============================================================================
--   p_on_behalf_of      = ATTRIBUTION. Stamp the requester into usage_logs.
--   p_enforce_allowance = ENFORCEMENT.  Additionally run the allowance block.
--
-- Rollout step 3 makes every call site pass `p_on_behalf_of` while no default
-- allocation has been configured yet (that happens at step 6). With ONE
-- combined condition that window would create a zero-granted row on every
-- requester's first reserve and refuse the entire instance. With two, step 3
-- is provably a no-op on the allowance tables — behaviour case 6.
--
-- ============================================================================
-- THE DISCIPLINE THIS FILE COPIES FROM 351
-- ============================================================================
--   * DROP the CURRENT signature before redefining, so PostgREST never sees an
--     overload (351:171-193 found a stale 6-arg reserve_credits still
--     EXECUTE-granted to anon — an anonymous SECURITY DEFINER credit mutation).
--   * The personal remainders stay VERBATIM. They were lifted from this file's
--     351 text unedited; the only edits anywhere in them are the two named in
--     section 4 (the `on_behalf_of` column and the `||`-concatenated payer
--     object) and the `p_credits <= 0` guard is DUPLICATED above the allowance
--     block rather than hoisted out of the verbatim body.
--   * `SET search_path` restated, REVOKE/GRANT re-issued at the new arity.
--   * Lock order is ALLOWANCE -> PROFILES in reserve, commit and refund alike
--     (the deadlock discipline 351 states at allocate_workspace_credits,
--     351:694-697). Two callers taking the same two locks in opposite orders
--     is a deadlock that only appears under load.
--   * The invariant lives in the schema as a CHECK, and commit keeps it true
--     BY CONSTRUCTION with 351's clamp (351:515-535) rather than by aborting.

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
-- One row per requester, created LAZILY at the first ENFORCED reserve (D7) —
-- no signup hook (`handle_new_user()` stays untouched, the 365 lesson) and no
-- backfill. A user who has never generated therefore has NO ROW, and every
-- read surface must answer `granted = remaining = default_allowance_credits`
-- for them rather than zero; that rule lives once, in
-- `ee/billing/deployment-allowance-service.ts`. Zero is a real value here and
-- it means "exhausted".
CREATE TABLE IF NOT EXISTS public.deployment_user_allowances (
  user_id          uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_credits  integer NOT NULL DEFAULT 0 CHECK (granted_credits  >= 0),
  reserved_credits integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  spent_credits    integer NOT NULL DEFAULT 0 CHECK (spent_credits    >= 0),
  -- Reserved for a future periodic variant (D16). Unused in v1 — shipped now
  -- so "monthly" is a later migration and not a rewrite;
  -- `workspace_member_spend` carries exactly such a column (351:88).
  reset_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- The guarantee, in the schema itself (351:79). One architect wanted this
  -- dropped, fearing a metered overrun (`p_actual > reserved`) would abort
  -- commit_credits and strand the payer's real debit in `reserved` forever.
  -- The fear is real; 351 already solved it, and commit_credits below copies
  -- the arithmetic: the overrun is CLAMPED and recorded as an audit row.
  CHECK (reserved_credits + spent_credits <= granted_credits)
);

-- Append-only audit, and the reconciliation:
--   granted_credits = SUM(credits) WHERE kind IN ('default','topup','correction')
-- for every user, always. 'overrun' rows are AUDIT-ONLY and excluded from that
-- sum — they record a metered overrun the clamp absorbed and they never move
-- `granted_credits`. Only `grant_deployment_allowance` and the lazy-provision
-- insert may write `granted_credits`, and both write the matching grant row in
-- the same transaction, so the two cannot diverge.
CREATE TABLE IF NOT EXISTS public.deployment_allowance_grants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credits    integer NOT NULL,          -- negative only for 'overrun'/'correction'
  kind       text NOT NULL CHECK (kind IN ('default','topup','correction','overrun')),
  granted_by uuid NOT NULL,             -- always the payer id, 'default' included
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_allowance_grants_user
  ON public.deployment_allowance_grants (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. RLS and privileges.
-- ---------------------------------------------------------------------------
-- TABLE-LEVEL REVOKE FIRST, THEN THE COLUMN GRANT. The 347 lesson (347:16-26),
-- verified empirically on PG15 and PG17: a column-level revoke under a live
-- table grant does nothing, because Postgres checks the table ACL first.
-- Supabase's default privileges hand anon/authenticated table-level SELECT on
-- every new public table, so the revoke is not optional.
--
-- Granting only the four columns the browser needs also inverts the drift
-- direction: a future column is private until somebody deliberately grants it
-- (`reset_at` is the first such column, and the behaviour proof asserts it is
-- unreadable), so forgetting breaks loudly instead of leaking quietly.
ALTER TABLE public.deployment_user_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deployment_user_allowances FROM anon, authenticated;
GRANT SELECT (user_id, granted_credits, reserved_credits, spent_credits)
  ON public.deployment_user_allowances TO authenticated;

-- Own row only, and NO write policy of any kind: PostgREST must not be able to
-- write this table under any role. The RPCs below (service role, which
-- bypasses RLS) are the only writers — exactly the posture 351 takes for
-- workspace_budgets (351:97-113).
DROP POLICY IF EXISTS "Users can view own allowance" ON public.deployment_user_allowances;
CREATE POLICY "Users can view own allowance" ON public.deployment_user_allowances
  FOR SELECT USING (user_id = (select auth.uid()));

-- The grants table names the PAYER in `granted_by` and records the billing
-- account's actions, so it gets no browser policy at all. It is read through
-- guarded service-role routes only (the payer's own page).
ALTER TABLE public.deployment_allowance_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deployment_allowance_grants FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Attribution stops being best-effort.
-- ---------------------------------------------------------------------------
-- 362 stamped `on_behalf_of` in a SEPARATE post-RPC UPDATE at three call sites
-- and its COMMENT tolerated a failed stamp. From this migration the column is
-- written inside `reserve_credits`' own INSERT, in the same transaction as the
-- debit, and the three post-hoc UPDATEs are deleted from the TypeScript. The
-- tolerance therefore applies to HISTORICAL ROWS ONLY.
COMMENT ON COLUMN public.usage_logs.on_behalf_of IS
  'The requester a deployment-payer run was made for (usage_logs.user_id is the payer, who holds the debit). Written inside reserve_credits'' own INSERT since migration 382, so it is transactional with the debit and never missing on a row written after it. 362''s "best-effort, may be absent" contract applies to HISTORICAL ROWS ONLY. Still ATTRIBUTION, never settlement: commit_credits and refund_credits key on the row id, and decide whether to touch the allowance from metadata.payer.allowance_enforced (stamped at reserve time), never from this column being non-NULL.';

-- ---------------------------------------------------------------------------
-- 4. reserve_credits — two new trailing parameters, and the allowance block.
-- ---------------------------------------------------------------------------
-- The CURRENT signature is dropped first (351's own pattern) so PostgREST
-- never sees an overload. Everything below the allowance block is 351's text,
-- unedited, except the two changes named at the INSERT.
DROP FUNCTION IF EXISTS public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID);

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
  p_workspace_id UUID DEFAULT NULL,
  -- ATTRIBUTION: the requester a deployment-payer run is made for. Passed
  -- whenever the billing context is `payer: "deployment"`. Stamps the
  -- usage_logs row and nothing else.
  p_on_behalf_of UUID DEFAULT NULL,
  -- ENFORCEMENT: additionally run the allowance block. Defaults FALSE so
  -- every existing caller — and every mainline deployment — is unaffected.
  p_enforce_allowance BOOLEAN DEFAULT FALSE
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

  RETURN v_usage_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID, UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER, BOOLEAN, UUID, UUID, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. commit_credits — no new parameter.
-- ---------------------------------------------------------------------------
-- It already reads `metadata` and `user_id` from the usage_logs row BEFORE it
-- writes anything (351:492-497), so it learns its payer and now its requester
-- from the row. Only `on_behalf_of` is added to that SELECT; the arity, and
-- therefore every caller, is unchanged.
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
  -- Deployment-allowance branch only (382):
  v_on_behalf_of UUID;
  v_a_granted INTEGER;
  v_a_reserved INTEGER;
  v_a_spent INTEGER;
  v_a_remaining_reserved INTEGER;
  v_a_spend_delta INTEGER;
  v_a_shortfall INTEGER;
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

-- Re-issued at the unchanged arity, per 351's discipline — harmless, and it
-- keeps the privilege statement next to the definition it protects.
REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_credits(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. refund_credits — release, spend nothing.
-- ---------------------------------------------------------------------------
-- Same flag, same order. Refunds give the SAI balance back FOR FREE, because
-- the balance is reserved/spent and not derived from log status — and because
-- every abort path already funnels through `refundReservedCreditsForJob`
-- (backend/src/lib/credits-job-lifecycle.ts:27) and the stuck-reservation
-- cron, no new call site is needed anywhere in the application.
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
  -- Deployment-allowance branch only (382):
  v_on_behalf_of UUID;
  v_a_reserved INTEGER;
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

-- ---------------------------------------------------------------------------
-- 7. grant_deployment_allowance — the ONLY writer of granted_credits
--    outside the lazy provision above.
-- ---------------------------------------------------------------------------
-- One `_grants` INSERT plus one `granted_credits` increment, in one
-- transaction, so the reconciliation cannot diverge.
--
-- THE ACTOR CHECK IS A DATABASE-LEVEL RESTATEMENT OF DECISION (3): only the
-- billing account may change an allowance, and that does not depend on the
-- route guard being correct. SAI runs its own IdP and mints its own admins, so
-- a role-based gate on this function would be downstream of the party it is
-- meant to constrain; the payer id is resolved at boot from operator-owned
-- config and is not writable from inside the product.
--
-- One database object rather than a trigger (§17 row 12): the same guarantee,
-- and it lives beside the arithmetic it protects.
-- Dropped first, then created: 351's no-overload discipline, and the only form
-- that is idempotent when a parameter's name or default changes (CREATE OR
-- REPLACE refuses to remove a default). The GRANTs below are re-issued because
-- a DROP takes them with it.
DROP FUNCTION IF EXISTS public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.grant_deployment_allowance(
  p_user_id UUID,
  p_credits INTEGER,
  p_actor_id UUID,
  -- No DEFAULTs on these two, deliberately (spec §7.4's shape): a defaulted
  -- `kind` on the ONLY writer of `granted_credits` would let a caller that
  -- forgot the argument silently perform a top-up.
  p_kind TEXT,
  p_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payer UUID;
  v_default INTEGER;
  v_inserted UUID;
  v_granted INTEGER;
  v_reserved INTEGER;
  v_spent INTEGER;
BEGIN
  SELECT payer_user_id, default_allowance_credits INTO v_payer, v_default
  FROM deployment_payer_settings WHERE id = true;
  IF NOT FOUND OR v_payer IS NULL THEN
    RAISE EXCEPTION 'ALLOWANCE_UNCONFIGURED: deployment_payer_settings names no payer';
  END IF;
  IF p_actor_id IS DISTINCT FROM v_payer THEN
    RAISE EXCEPTION 'ALLOWANCE_ACTOR_NOT_PAYER: only the deployment billing account may change an allowance';
  END IF;

  -- 'default' belongs to the lazy provision below and nowhere else; 'overrun'
  -- rows are audit-only and are EXCLUDED from `granted = SUM(grants)` — letting
  -- either through this function, which increments `granted_credits`, would
  -- break the reconciliation permanently and silently.
  IF p_kind IS NULL OR p_kind NOT IN ('topup', 'correction') THEN
    RAISE EXCEPTION 'ALLOWANCE_KIND_INVALID: kind % cannot be granted here (topup or correction only)',
      COALESCE(p_kind, '<null>');
  END IF;
  IF p_credits IS NULL OR p_credits = 0 THEN
    RAISE EXCEPTION 'ALLOWANCE_ZERO_GRANT: a grant must move the allowance by a non-zero amount';
  END IF;

  -- The row may not exist yet: the payer can top somebody up BEFORE that
  -- person has ever generated. Seed it with the DEFAULT and write the matching
  -- 'default' grant, exactly as the lazy provision in reserve_credits does —
  -- seeding 0 here would leave a topped-up user with LESS than an untouched
  -- one, and reserve_credits would then never write their default at all.
  INSERT INTO deployment_user_allowances (user_id, granted_credits)
  VALUES (p_user_id, v_default)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by)
    VALUES (p_user_id, v_default, 'default', v_payer);
  END IF;

  SELECT granted_credits, reserved_credits, spent_credits
    INTO v_granted, v_reserved, v_spent
    FROM deployment_user_allowances WHERE user_id = p_user_id FOR UPDATE;

  -- A negative correction REFUSES, it never clamps. Clamping would silently
  -- invalidate a job that is already running against the reserved credits —
  -- a support incident, where a refusal is a message the payer can act on.
  IF (v_granted + p_credits) < (v_reserved + v_spent) THEN
    RAISE EXCEPTION 'ALLOWANCE_BELOW_COMMITTED: granted would become %, below reserved % + spent %',
      v_granted + p_credits, v_reserved, v_spent;
  END IF;

  UPDATE deployment_user_allowances
     SET granted_credits = v_granted + p_credits, updated_at = now()
   WHERE user_id = p_user_id;

  INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by, note)
  VALUES (p_user_id, p_credits, p_kind, v_payer, p_note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT) TO service_role;
