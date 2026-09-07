-- The allowance VERBS: `set`, `renew`, the pending grant, and the audit line
-- that says which credential moved a quota.
-- The companion TypeScript — `setAllowance`, `writePendingAllowance`,
-- `applyPendingAllowance` and the two SSO-subject lookups — ships in the same
-- PR, together with the routes that call them.
--
-- Depends on 381 (`deployment_payer_settings`, the singleton this file reads
-- for the payer id and the default), 382 (the ledger, the grants table and
-- `grant_deployment_allowance`, which this file re-declares at a new arity)
-- and 386 (`deployment_integration_keys`, the credential the audit line
-- names).
--
-- ============================================================================
-- WHAT THIS FILE ADDS, AND WHY THE LEDGER NEEDED VERBS AT ALL
-- ============================================================================
-- 382 shipped ONE write verb: `grant_deployment_allowance`, an ADDITIVE move
-- ("give this user 10 more credits"). That is the right shape for a person on
-- a page, who is looking at the current figure while they type. It is the
-- wrong shape for an integration: a back office knows "this customer's plan is
-- 50 000 credits", not the delta from a number it never read, and computing
-- the delta on its side means a retry after a timeout silently doubles the
-- allocation. So this file adds the two verbs a machine actually has:
--
--   set    — "the plan IS x". The SERVER computes the delta, so a replay of
--            the same call is a no-op rather than a second top-up.
--   renew  — "a new period started at x". Sets `granted`, ZEROES `spent`,
--            keeps `reserved`, and stamps `reset_at`.
--
-- Both refuse below what is already committed, for 382's reason: a downgrade
-- that clamps would invalidate a job already running against the reserved
-- credits, and a refusal is a message the payer can act on where a clamp is a
-- support incident. `set` refuses below `reserved + spent`; `renew` refuses
-- below `reserved` alone, because zeroing `spent` is the whole point of a new
-- period and only the in-flight reservation still has to fit.
--
-- ZERO IS A LEGAL TARGET for both (and only for these two). "The plan was
-- cancelled" is the quota becoming 0, and a verb that cannot express it would
-- push the customer's own cancellation state into a note. `grant_deployment
-- _allowance` keeps refusing a zero MOVE (`ALLOWANCE_ZERO_GRANT`): a delta of
-- nothing is a caller bug, a target of nothing is a fact.
--
-- ============================================================================
-- THE RECONCILIATION, RESTATED — IT NOW HAS A FOURTH KIND
-- ============================================================================
--   granted_credits = SUM(credits) WHERE kind IN
--                     ('default','topup','correction','renewal')
-- for every user, always. `renewal` joins the set because a renewal MOVES
-- `granted_credits` (to the new target) and must therefore be reconcilable
-- from the audit trail like every other move; its `credits` is
-- `target − granted`, which may be positive, negative, or — uniquely — ZERO,
-- so that a renewal at the same plan still leaves a row saying the period
-- turned over.
--
-- `overrun` stays EXCLUDED and audit-only, exactly as 382 left it: those rows
-- record a metered overrun that commit's clamp absorbed and they never move
-- `granted_credits`. Letting a renewal into the audit-only set (or an overrun
-- into the reconciled set) would break the invariant permanently and silently,
-- which is why the CHECK below names all five kinds explicitly rather than
-- being dropped.
--
-- ============================================================================
-- ROLLBACK CAUTION — READ BEFORE REVERTING THE PLATFORM BELOW 387
-- ============================================================================
-- Section 4 DROPS the five-argument `grant_deployment_allowance` and recreates
-- it with six (the `p_credential_id` audit line). The image that ships with
-- this migration calls the SIX-argument form, and `grant_deployment_allowance`
-- declares NO defaults, so the two are not interchangeable: PostgREST resolves
-- an RPC by its named-argument set and answers "function not found" for a
-- mismatch.
--
-- Therefore: ROLLING THE PLATFORM IMAGE BACK BELOW THIS MIGRATION WHILE THE
-- SIX-ARGUMENT FUNCTION IS STILL IN THE DATABASE BREAKS THE BILLING PAGE'S
-- TOP-UP — the old image calls five arguments and gets a 404 from PostgREST,
-- which the page renders as a failed grant. A database rollback must therefore
-- RE-APPLY THE FIVE-ARGUMENT SIGNATURE (382's section 7, verbatim, including
-- its REVOKE/GRANT block) in the same step that reverts the image. Reverting
-- the image alone is the broken state; reverting neither is safe.
--
-- Everything else here is additive (a new kind in a CHECK, two nullable
-- columns, a new table, three new functions) and survives an image rollback
-- untouched.
--
-- ============================================================================
-- MAINLINE IS BYTE-IDENTICAL WITHOUT A PAYER (R2)
-- ============================================================================
-- Every function here refuses before it touches a row when
-- `deployment_payer_settings` names no payer (`ALLOWANCE_UNCONFIGURED`), and
-- the TypeScript that calls them is gated on `deploymentPayerActive()`, which
-- is false whenever the surface profile carries no `billing.payerAccount`. On
-- a mainline deployment this migration adds two nullable columns nothing
-- writes, one empty service-role-only table nothing reads, and three functions
-- nothing calls. `grant_deployment_allowance` changes arity on every
-- deployment — but it is service-role-only and is called from exactly one
-- module, which this PR updates in the same commit.
--
-- IDEMPOTENT ON A SECOND APPLY, like its neighbours: CI applies the whole
-- chain to a fresh database and this file must also survive being replayed
-- against a database that already has it (`IF NOT EXISTS`, guarded ALTERs,
-- DROP-then-CREATE for every function).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The grants table: a fourth reconciled kind, and the credential line.
-- ---------------------------------------------------------------------------
-- The kind CHECK is INLINE in 382, so its name is auto-generated. The expected
-- name is `deployment_allowance_grants_kind_check` — but this block does not
-- rely on that: it LOOKS THE NAME UP and drops whatever CHECK on this table
-- constrains `kind`, then adds the replacement under an explicit name. On a
-- second apply it finds the explicitly-named constraint from the first apply
-- and does the same thing again, which is why this is idempotent without an
-- `IF NOT EXISTS` the ALTER does not have.
--
-- Verified in the runner before this file was written:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.deployment_allowance_grants'::regclass
--      AND contype = 'c';
DO $$
DECLARE v_conname text;
BEGIN
  FOR v_conname IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public.deployment_allowance_grants'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.deployment_allowance_grants DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.deployment_allowance_grants
  ADD CONSTRAINT deployment_allowance_grants_kind_check
  CHECK (kind IN ('default', 'topup', 'correction', 'overrun', 'renewal'));

-- WHICH CREDENTIAL acted, never WHO: `granted_by` stays the payer's uuid on
-- every row (the actor assertion in section 4 still refuses anything else), so
-- every existing audit read keeps its meaning. NULL means the billing
-- account's own browser session — the page — which is what every row written
-- before this migration is.
--
-- ON DELETE SET NULL, not CASCADE: revoking a key must never delete the
-- history of what it allocated. The row survives and degrades to "the page",
-- and the page's history renders the key name only while the key exists.
ALTER TABLE public.deployment_allowance_grants
  ADD COLUMN IF NOT EXISTS credential_id uuid NULL
    REFERENCES public.deployment_integration_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.deployment_allowance_grants.credential_id IS
  'The billing integration key that performed this move, or NULL for the billing account''s own browser session. Audit only: granted_by remains the payer on every row, so the actor assertion in grant_deployment_allowance / set_deployment_allowance is unchanged. ON DELETE SET NULL — revoking a key must never delete the record of what it allocated.';

-- ---------------------------------------------------------------------------
-- 2. The ledger table: no new columns.
-- ---------------------------------------------------------------------------
-- `reset_at` already exists (382:97-100), shipped unused so that a periodic
-- variant would be a migration and not a rewrite. `renew` below is that
-- variant, and it is the first writer of the column.
--
-- ITS COLUMN PRIVILEGE DOES NOT CHANGE. 382 granted `authenticated` SELECT on
-- four named columns and deliberately left this one out, so that a future
-- column is private until somebody grants it on purpose; the behaviour proof
-- asserts it is unreadable (`12s`). The period figure reaches a browser
-- through the guarded service-role routes that render it, never through
-- PostgREST. Do not "complete" the grant here.

-- ---------------------------------------------------------------------------
-- 3. The settings singleton: the low-balance threshold.
-- ---------------------------------------------------------------------------
-- RAW Nodaro credits, like every other figure in this schema (the pool is not
-- in display units — the one exception the display rule names). NULL means the
-- payer has not set one, and the balance read answers `lowBalance: false`
-- rather than inventing a threshold: a fabricated alarm level would either cry
-- wolf on every small deployment or stay silent on every large one.
--
-- Here rather than in `app_settings` for 381's reason: this value is owned by
-- the BILLING ACCOUNT (the customer), and `app_settings` is the table whose
-- whole invariant is that every write is operator-only.
ALTER TABLE public.deployment_payer_settings
  ADD COLUMN IF NOT EXISTS low_balance_threshold_credits integer NULL
    CONSTRAINT deployment_payer_settings_low_balance_nonneg
    CHECK (low_balance_threshold_credits >= 0);

COMMENT ON COLUMN public.deployment_payer_settings.low_balance_threshold_credits IS
  'The pool balance, in RAW Nodaro credits, below which the balance read answers lowBalance = true. NULL = the payer has not set one, and lowBalance is then false — never a fabricated default.';

-- ---------------------------------------------------------------------------
-- 4. Pending allowances: the purchase that precedes the first sign-in.
-- ---------------------------------------------------------------------------
-- A customer buys a plan and the integration allocates the quota BY
-- CONSTRUCTION before that person has ever signed in — there is no studio uuid
-- to name yet, and often no account at all. The two answers are "refuse, retry
-- after their first login" (which pushes ledger state into the back office and
-- loses it when the retry never comes) and this one: store the INTENT, keyed
-- by the identity the IdP will assert, and apply it the moment the account
-- exists.
--
-- KEYED BY SUBJECT AND/OR EMAIL, never by uuid: a uuid is what this table
-- exists because the caller does not have. At least one must be present (the
-- CHECK), and the apply below matches either.
--
-- THE UNIQUE INDEXES ARE PARTIAL, on `applied_at IS NULL`. Unapplied intents
-- are unique per identity, so a replayed write REPLACES rather than queues (the
-- route decides how); applied rows are history and many may exist for one
-- person. `lower(email)` because an IdP's casing is not stable and the same
-- address in two cases is one person.
--
-- EXPIRES. A plan bought for somebody who never arrives must not sit in this
-- table forever waiting to be applied to whoever eventually claims that
-- address; `expires_at` is set by the writer (90 days by default) and the
-- apply below ignores anything past it.
--
-- RLS ON with NO POLICY and the table-level REVOKE first (the 347 lesson,
-- restated at 382:133-138 and 386): this table names a customer's purchase
-- intent for an identity that may not have an account yet. No browser role has
-- any business reading it under any row; the service role bypasses RLS, which
-- is the route's path and the apply function's path.
CREATE TABLE IF NOT EXISTS public.deployment_allowance_pending (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The IdP's stable subject, matched against auth.users' TRUSTED
  -- app_metadata copy (section 8). NULL when the caller knows only an address.
  sso_subject    text,
  -- Matched case-insensitively. Not `citext` — the extension is not enabled on
  -- this schema and `lower()` in the index and the predicate is the same
  -- guarantee with no dependency.
  email          text,
  -- RAW Nodaro credits. Zero is legal (a cancelled plan is a quota of 0).
  target_credits integer NOT NULL CHECK (target_credits >= 0),
  mode           text NOT NULL CHECK (mode IN ('set', 'renew')),
  note           text,
  -- Always the payer. Asserted at write by `writePendingAllowance`, which
  -- refuses any other actor before a row exists — the same restatement of
  -- "only the billing account may change an allowance" the two RPCs make in
  -- SQL. No foreign key, for 381's reason (`payer_user_id`, 381:52-56).
  created_by     uuid NOT NULL,
  credential_id  uuid REFERENCES public.deployment_integration_keys(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  applied_at     timestamptz,
  applied_user_id uuid,
  CONSTRAINT deployment_allowance_pending_names_someone
    CHECK (sso_subject IS NOT NULL OR email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_allowance_pending_subject
  ON public.deployment_allowance_pending (sso_subject) WHERE applied_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_allowance_pending_email
  ON public.deployment_allowance_pending (lower(email)) WHERE applied_at IS NULL;

ALTER TABLE public.deployment_allowance_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deployment_allowance_pending FROM anon, authenticated;

COMMENT ON TABLE public.deployment_allowance_pending IS
  'An allowance intended for someone who has no studio account yet, keyed by SSO subject and/or email. Applied by apply_pending_deployment_allowance() at their first successful SSO sign-in and then kept as history (applied_at stamped). Expired rows are never applied.';

-- ---------------------------------------------------------------------------
-- 5. grant_deployment_allowance — same body, one more argument.
-- ---------------------------------------------------------------------------
-- The credential has to be stamped INSIDE the function, not by a follow-up
-- UPDATE from the caller: a second statement that can fail is exactly the
-- weakness 382 retired for `on_behalf_of` (382:169-176), and here it would
-- leave an allocation whose audit row silently claims the page did it.
--
-- So the arity changes, and it changes with 351's discipline (351:171-193):
-- DROP the CURRENT signature FIRST so PostgREST never sees an overload — the
-- migration that skipped this left a stale, anon-executable, SECURITY DEFINER
-- credit mutation behind for four generations. The GRANTs are re-issued at the
-- new arity because the DROP takes them with it.
--
-- The body below is 382's section 7 VERBATIM in every executable line. The
-- only edit is the final INSERT, which now carries `credential_id`; two
-- comments are reworded where they named a document rather than a rule.
-- `p_credential_id` gets NO DEFAULT for the same reason `p_kind` and `p_note`
-- have none: on the only writer of `granted_credits`, an omitted argument must
-- be a loud "function not found", never a silent write with a guessed value.
DROP FUNCTION IF EXISTS public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.grant_deployment_allowance(
  p_user_id UUID,
  p_credits INTEGER,
  p_actor_id UUID,
  -- No DEFAULTs on these three, deliberately: a defaulted `kind` on the ONLY
  -- writer of `granted_credits` would let a caller that forgot the argument
  -- silently perform a top-up, and a defaulted credential would let one
  -- silently claim the page did it.
  p_kind TEXT,
  p_note TEXT,
  p_credential_id UUID
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
  -- rows are audit-only and are EXCLUDED from `granted = SUM(grants)`; and
  -- 'renewal' belongs to `set_deployment_allowance`, which zeroes `spent` and
  -- stamps `reset_at` in the same transaction — letting any of them through
  -- this function, which only increments `granted_credits`, would break the
  -- reconciliation or the period permanently and silently.
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

  INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by, note, credential_id)
  VALUES (p_user_id, p_credits, p_kind, v_payer, p_note, p_credential_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. set_deployment_allowance — the two verbs a machine has.
-- ---------------------------------------------------------------------------
-- The SECOND writer of `granted_credits` outside the lazy provision, and it
-- carries every one of the first's guarantees: the actor assertion, the lazy
-- seed at the settings default, the refusal below what is committed, and one
-- grant row per move so the reconciliation cannot diverge.
--
-- NO DEFAULTS on any argument — the rule every writer of `granted_credits`
-- follows: the caller states the mode, the target, the actor, the note and the
-- credential every single time.
--
-- RETURNS THE ROW, not void, and that is not a convenience. `set` is idempotent
-- by construction — a replay computes a delta of zero and writes nothing — so
-- the caller cannot tell "I applied it" from "it was already applied" by the
-- absence of an error. `applied` says which happened ('set', 'renew', 'noop'),
-- and the three figures plus `reset_at` are what the database now holds, so the
-- route renders the truth rather than the arithmetic it hoped for.
--
-- ON THE OUT-PARAMETER NAMES: `granted_credits`, `reserved_credits`,
-- `spent_credits` and `reset_at` are also COLUMN names of the table this body
-- reads, so every reference to the table inside the body is ALIASED (`a.`).
-- An unqualified one raises `column reference "granted_credits" is ambiguous`
-- at runtime, not at CREATE time — which is the kind of fault that reaches
-- production. The behaviour proof exercises every branch for exactly that
-- reason.
DROP FUNCTION IF EXISTS public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.set_deployment_allowance(
  p_user_id UUID,
  p_target_credits INTEGER,
  p_actor_id UUID,
  p_mode TEXT,
  p_note TEXT,
  p_credential_id UUID
)
RETURNS TABLE (
  applied TEXT,
  granted_credits INTEGER,
  reserved_credits INTEGER,
  spent_credits INTEGER,
  reset_at TIMESTAMPTZ
)
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
  v_delta INTEGER;
  v_applied TEXT;
BEGIN
  -- The two argument refusals come FIRST, before the settings read: a caller
  -- that sent a nonsense mode learns that, not that the deployment has no
  -- payer.
  IF p_mode IS NULL OR p_mode NOT IN ('set', 'renew') THEN
    RAISE EXCEPTION 'ALLOWANCE_MODE_INVALID: mode % is not one of set, renew',
      COALESCE(p_mode, '<null>');
  END IF;
  -- Zero IS legal here (a cancelled plan is a quota of 0) — the refusal is for
  -- NULL and for negatives, which are a caller bug and never a plan.
  IF p_target_credits IS NULL OR p_target_credits < 0 THEN
    RAISE EXCEPTION 'ALLOWANCE_TARGET_INVALID: target % must be zero or a positive whole number of credits',
      COALESCE(p_target_credits::text, '<null>');
  END IF;

  SELECT s.payer_user_id, s.default_allowance_credits INTO v_payer, v_default
  FROM deployment_payer_settings s WHERE s.id = true;
  IF NOT FOUND OR v_payer IS NULL THEN
    RAISE EXCEPTION 'ALLOWANCE_UNCONFIGURED: deployment_payer_settings names no payer';
  END IF;
  -- The database-level restatement of "only the billing account may change an
  -- allowance" (382:950-952). It does not depend on the route guard, and it is
  -- what makes an integration key safe: the key resolves to the payer's uuid,
  -- so this assertion is satisfied by the credential's identity and by nothing
  -- else the customer's own IdP can mint.
  IF p_actor_id IS DISTINCT FROM v_payer THEN
    RAISE EXCEPTION 'ALLOWANCE_ACTOR_NOT_PAYER: only the deployment billing account may change an allowance';
  END IF;

  -- The lazy seed, verbatim from the grant RPC (382:966-975): the target may
  -- never have generated, and seeding 0 would leave them with LESS than an
  -- untouched user while reserve_credits never writes their default at all.
  INSERT INTO deployment_user_allowances (user_id, granted_credits)
  VALUES (p_user_id, v_default)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by)
    VALUES (p_user_id, v_default, 'default', v_payer);
  END IF;

  SELECT a.granted_credits, a.reserved_credits, a.spent_credits
    INTO v_granted, v_reserved, v_spent
    FROM deployment_user_allowances a WHERE a.user_id = p_user_id FOR UPDATE;

  IF p_mode = 'set' THEN
    v_delta := p_target_credits - v_granted;
    IF v_delta = 0 THEN
      -- A REPLAY. An integration retries on a timeout it cannot tell from a
      -- failure, so "the plan is already x" must be a success that changes
      -- nothing — no grant row, and no `updated_at` churn that would make the
      -- page show an edit nobody made.
      v_applied := 'noop';
    ELSE
      IF p_target_credits < (v_reserved + v_spent) THEN
        RAISE EXCEPTION 'ALLOWANCE_BELOW_COMMITTED: granted would become %, below reserved % + spent %',
          p_target_credits, v_reserved, v_spent;
      END IF;
      UPDATE deployment_user_allowances a
         SET granted_credits = p_target_credits, updated_at = now()
       WHERE a.user_id = p_user_id;
      -- The delta is what the audit row carries, so the Σ-grants
      -- reconciliation still equals `granted` after a `set`: a raise is a
      -- `topup` and a cut is a `correction`, the same two kinds the page
      -- writes, so the history reads identically whoever moved it.
      INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by, note, credential_id)
      VALUES (p_user_id, v_delta,
              CASE WHEN v_delta > 0 THEN 'topup' ELSE 'correction' END,
              v_payer, p_note, p_credential_id);
      v_applied := 'set';
    END IF;
  ELSE
    -- RENEW. Only `reserved` still has to fit: zeroing `spent` is the whole
    -- meaning of a new period (the `reset_member_spend` reasoning, 351:919-921
    -- — `reserved` tracks in-flight work and zeroing it would desynchronise the
    -- row from reservations that will still commit or refund against it).
    IF p_target_credits < v_reserved THEN
      RAISE EXCEPTION 'ALLOWANCE_BELOW_COMMITTED: renewal target %, below reserved %',
        p_target_credits, v_reserved;
    END IF;
    UPDATE deployment_user_allowances a
       SET granted_credits = p_target_credits,
           spent_credits = 0,
           reset_at = now(),
           updated_at = now()
     WHERE a.user_id = p_user_id;
    -- `credits` may be zero here, and this is the ONE kind for which that is
    -- allowed: a renewal at the same plan moves nothing but must still leave a
    -- row saying the period turned over. It may also be negative (a downgrade
    -- at renewal), like a correction.
    INSERT INTO deployment_allowance_grants (user_id, credits, kind, granted_by, note, credential_id)
    VALUES (p_user_id, p_target_credits - v_granted, 'renewal', v_payer, p_note, p_credential_id);
    v_applied := 'renew';
  END IF;

  RETURN QUERY
    SELECT v_applied, a.granted_credits, a.reserved_credits, a.spent_credits, a.reset_at
      FROM deployment_user_allowances a WHERE a.user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.set_deployment_allowance(UUID, INTEGER, UUID, TEXT, TEXT, UUID) IS
  'Set a user''s allowance to an absolute target in RAW Nodaro credits. mode = set (server computes the delta; a replay is a noop) or renew (also zeroes spent and stamps reset_at, keeping reserved). Refuses below what is committed rather than clamping. Zero is a legal target. Raises ALLOWANCE_MODE_INVALID, ALLOWANCE_TARGET_INVALID, ALLOWANCE_UNCONFIGURED, ALLOWANCE_ACTOR_NOT_PAYER, ALLOWANCE_BELOW_COMMITTED.';

-- ---------------------------------------------------------------------------
-- 7. apply_pending_deployment_allowance — at the first sign-in, and every one
--    after it.
-- ---------------------------------------------------------------------------
-- Called from the SSO path once the identity is settled, for BOTH outcomes
-- (an account newly provisioned and an existing account linked). Two reasons
-- it is not provision-only: an intent written between an account's creation
-- and its owner's first sign-in would otherwise never apply, and an apply that
-- failed once (a transient database error on a best-effort call) heals on the
-- next sign-in instead of stranding a paid-for quota forever.
--
-- IDEMPOTENT BY THE PREDICATE, not by a flag the caller keeps: `applied_at IS
-- NULL` is both the selection and the effect, so a second call the same second
-- selects nothing and returns 0.
--
-- FOR UPDATE SKIP LOCKED: two sign-ins racing (two tabs, a retry) must not
-- both apply the same intent, and the loser must not block — it skips, returns
-- a smaller count, and the intent is already applied by the winner in the same
-- transaction.
--
-- Each intent goes through `set_deployment_allowance`, never through a direct
-- UPDATE: the actor assertion, the seed, the refusal and the audit row are all
-- properties of that function, and a second path into `granted_credits` would
-- have to restate every one of them correctly forever.
--
-- ============================================================================
-- MARKED DECISION: ALL-OR-NOTHING, AND WHAT IT COSTS
-- ============================================================================
-- There is no per-row subtransaction here, so ONE refusable intent takes the
-- whole call down: `set_deployment_allowance` raises (say a `set` below
-- `reserved + spent` — the target has a job running against more than the new
-- plan allows), the RAISE propagates, everything this call did rolls back, the
-- TypeScript caller logs and answers 0, and the sign-in proceeds. The costs
-- are real and are accepted deliberately for this cut:
--
--   * the refused row is re-attempted and refused again on EVERY sign-in until
--     it expires, and
--   * a SIBLING row that would have applied cleanly is blocked behind it,
--     because the loop never reaches it.
--
-- Fail-closed is still the right default: the alternative is a partial apply
-- whose failure nobody sees, and an allowance that silently did not land is
-- worse than one that visibly has not landed yet. The refusals that reach here
-- are also self-healing in the common case — the job finishes, `reserved`
-- drops, and the next sign-in applies the intent.
--
-- THE ALTERNATIVE, when this stops being acceptable: wrap the PERFORM in a
-- per-row `BEGIN … EXCEPTION WHEN OTHERS` subtransaction that records the
-- refusal on the row (a `refused_at` / `refusal` column pair, added in that
-- same migration) and CONTINUEs, so one bad intent cannot block a good one and
-- the state is legible to the page rather than only to a log. That is a
-- schema change plus a surface that shows it, which is why it is not in this
-- one.
--
-- Until then the exception below carries the pending row's id, so the log line
-- names WHICH intent is stuck and why — without that, the operator sees a
-- refusal with no way to find the row it came from. The `BEGIN … EXCEPTION`
-- block that adds it re-raises, so the all-or-nothing behaviour above is
-- unchanged: it buys the message, not a partial apply.
DROP FUNCTION IF EXISTS public.apply_pending_deployment_allowance(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.apply_pending_deployment_allowance(
  p_user_id UUID,
  p_sso_subject TEXT,
  p_email TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payer UUID;
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  SELECT s.payer_user_id INTO v_payer
  FROM deployment_payer_settings s WHERE s.id = true;
  IF NOT FOUND OR v_payer IS NULL THEN
    RAISE EXCEPTION 'ALLOWANCE_UNCONFIGURED: deployment_payer_settings names no payer';
  END IF;

  FOR v_row IN
    SELECT p.id, p.target_credits, p.mode, p.note, p.credential_id
      FROM deployment_allowance_pending p
     WHERE p.applied_at IS NULL
       AND p.expires_at > now()
       AND ( (p_sso_subject IS NOT NULL AND p.sso_subject = p_sso_subject)
          OR (p_email IS NOT NULL AND lower(p.email) = lower(p_email)) )
     ORDER BY p.created_at
     FOR UPDATE SKIP LOCKED
  LOOP
    -- The actor is the PAYER, not the signing-in user: the intent was the
    -- billing account's, and `granted_by` must keep naming it (invariant C-B).
    --
    -- The handler RE-RAISES (see the marked decision above): it exists to name
    -- the row, not to skip it. SQLERRM carries the original refusal — prefix
    -- included — so the log line says both which intent is stuck and why.
    BEGIN
      PERFORM * FROM set_deployment_allowance(
        p_user_id, v_row.target_credits, v_payer, v_row.mode, v_row.note, v_row.credential_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ALLOWANCE_PENDING_REFUSED: pending % (mode %, target %) was refused: %',
        v_row.id, v_row.mode, v_row.target_credits, SQLERRM;
    END;
    UPDATE deployment_allowance_pending p
       SET applied_at = now(), applied_user_id = p_user_id
     WHERE p.id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pending_deployment_allowance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_pending_deployment_allowance(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_pending_deployment_allowance(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_deployment_allowance(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The SSO subject lookups.
-- ---------------------------------------------------------------------------
-- The integration names a person by the identity its own IdP asserts, and the
-- TRUSTED copy of that subject lives in `auth.users.raw_app_meta_data`, which
-- only the service-role admin API writes (`lib/sso-linking.ts` stamps both
-- copies; the server-authoritative gate trusts this one because a public
-- `signUp({ options: { data } })` can forge the `user_metadata` twin).
--
-- A FUNCTION, NOT A DENORMALISED `profiles.sso_subject` COLUMN. A second copy
-- would need a writer on every link, provision and IdP change, and the day one
-- of those is missed the lookup answers a stale identity — for a credential
-- whose whole job is allocating quotas to the right person. The trusted copy
-- stays where the SSO path put it and this is the only reader.
--
-- SECURITY DEFINER because `authenticated` cannot read `auth.users` at all,
-- and STABLE so the planner may reuse it within a statement. EXECUTE is
-- revoked from PUBLIC, anon and authenticated in the named shape the 381
-- lesson requires (an explicit anon=X entry survives a `FROM PUBLIC`-only
-- revoke, and these functions map an IdP subject to a studio uuid — an
-- enumeration oracle if a browser could call them).
--
-- NO INDEX IN THIS MIGRATION. At pilot scale the scan is nothing, and an index
-- on `auth`-schema tables is a heavier commitment than a lookup that runs once
-- per customer per integration and once per sign-in. If EXPLAIN ever shows a
-- sequential scan that matters here, the index to add is:
--   CREATE INDEX CONCURRENTLY idx_auth_users_sso_subject
--     ON auth.users ((raw_app_meta_data->>'sso_subject'));
DROP FUNCTION IF EXISTS public.find_user_by_sso_subject(TEXT);

CREATE OR REPLACE FUNCTION public.find_user_by_sso_subject(p_subject TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ids uuid[];
BEGIN
  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RETURN NULL;
  END IF;
  -- TWO ANSWERS, NOT ONE. "No account carries this subject" and "two accounts
  -- do" are different facts and the caller does opposite things with them: the
  -- first is a person who has not signed in yet, and the route stores a
  -- PENDING intent against the identity their IdP will assert. Returning NULL
  -- for the second made that intent land on whichever of the duplicated
  -- accounts signed in first — a customer's paid quota on an arbitrary half of
  -- a split identity, which is the failure this function exists to prevent.
  --
  -- So the duplicate RAISES. Fail closed either way: the function never
  -- chooses between two accounts, it just stops calling that "no account".
  SELECT array_agg(u.id) INTO v_ids
    FROM (SELECT id FROM auth.users
           WHERE raw_app_meta_data->>'sso_subject' = p_subject) u;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  IF array_length(v_ids, 1) > 1 THEN
    -- The count is exact (no LIMIT above), because the operator reading this
    -- line has to go and merge exactly that many accounts. The predicate is
    -- unindexed either way, so the scan is the same one.
    RAISE EXCEPTION 'SSO_SUBJECT_AMBIGUOUS: subject % matches % accounts',
      p_subject, array_length(v_ids, 1);
  END IF;
  RETURN v_ids[1];
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_sso_subject(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_user_by_sso_subject(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_user_by_sso_subject(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_sso_subject(TEXT) TO service_role;

COMMENT ON FUNCTION public.find_user_by_sso_subject(TEXT) IS
  'The studio uuid whose auth.users.raw_app_meta_data->>''sso_subject'' equals the argument, or NULL when no account carries it. RAISES SSO_SUBJECT_AMBIGUOUS when more than one does — never chooses between them. Service-role only.';

-- The batch form, so a page of users costs one query rather than one per row.
-- Rows with no subject are simply absent from the result — the caller renders
-- "not federated", which is a different fact from "unknown".
DROP FUNCTION IF EXISTS public.sso_subjects_for(UUID[]);

CREATE OR REPLACE FUNCTION public.sso_subjects_for(p_ids UUID[])
RETURNS TABLE (id UUID, sso_subject TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  -- Aliased for the same reason section 6 is: `id` and `sso_subject` are OUT
  -- parameters here.
  RETURN QUERY
    SELECT u.id, u.raw_app_meta_data->>'sso_subject'
      FROM auth.users u
     WHERE u.id = ANY(p_ids)
       AND u.raw_app_meta_data->>'sso_subject' IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sso_subjects_for(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sso_subjects_for(UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sso_subjects_for(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sso_subjects_for(UUID[]) TO service_role;

COMMENT ON FUNCTION public.sso_subjects_for(UUID[]) IS
  'The trusted IdP subject for each of the given studio uuids that has one. Reads auth.users.raw_app_meta_data (the service-role-only copy). Service-role only.';
