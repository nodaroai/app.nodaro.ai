-- Deployment payer identity: the settings singleton, the RLS helper, and the
-- one `profiles` row an admin must stop being able to read.
-- (Track A, spec 2026-09-04-sai-per-user-balances-and-billing-account §6.1,
-- decisions D6 and D11. Rollout step 1 — the only step with a deadline.)
--
-- ============================================================================
-- WHY THIS FILE EXISTS FIRST, AND ALONE
-- ============================================================================
-- On a deployment-payer instance (`billing.payerAccount` on the surface
-- profile) ONE designated account pays for every generation. That account's
-- `profiles` row holds the deployment's real Nodaro credits — and today any
-- signed-in user whose `profiles.role` is 'admin' can read it straight over
-- PostgREST from the browser, because the profiles SELECT policy
-- (032_consolidate_rls_and_indexes.sql:120-121) is
-- `(select auth.uid()) = id OR is_admin()`. On the hosted SAI instance the
-- CUSTOMER mints its own admins through its own IdP, so "admin" is downstream
-- of the customer: the customer's own staff can read the operator's balance,
-- and no route change closes that, because the leak is not a route.
--
-- The proportionate fix is ROW-level, because the leak is exactly one row.
-- Migration 347's table-REVOKE + column-GRANT shape is the decisive one, but
-- it reaches every browser reader of `profiles` — Nodaro Cloud's own admin
-- pages included — which is far outside this track.
--
-- THE POLICY BELOW IS INERT UNTIL `payer_user_id` IS NON-NULL, and the ONLY
-- writer of that column is `configureDeploymentPayer()`'s boot upsert
-- (backend/src/lib/deployment-payer.ts). That TypeScript ships in the SAME PR
-- as this file, deliberately: a migration-only step would announce a leak fix
-- that closes nothing. Do not "tidy" the two apart.
--
-- DEPLOY ORDER, on an instance that already has a payer: this migration must be
-- applied BEFORE the image that carries the upsert boots, or the upsert fails on
-- a missing relation and the API refuses to boot (exit 1 — the D6 posture, a
-- deliberate refusal rather than a silent NULL that re-opens this leak).
--
-- ============================================================================
-- MAINLINE IS BYTE-IDENTICAL
-- ============================================================================
-- With no `billing.payerAccount`, `configureDeploymentPayer()` returns before
-- its first query, nothing ever inserts into the settings table, the helper
-- answers NULL, and the `IS NULL` disjunct collapses the new policy to exactly
-- 032's predicate. `supabase/tests/profiles-payer-row-hidden.behavior.sql`
-- asserts that state, not just the payer state.

-- ---------------------------------------------------------------------------
-- 1. The singleton. The ONLY place Postgres can learn who the payer is.
-- ---------------------------------------------------------------------------
-- NOT in `app_settings`: 363 made that table service-role-WRITE-only precisely
-- because two of its rows are price levers, and the invariant bought with that
-- migration is "every app_settings write is operator-only". `default_allowance
-- _credits` is editable by the BILLING ACCOUNT (the customer), so putting it
-- there would muddy a boundary that cost a migration to draw.
--
-- `payer_user_id` carries NO foreign key on purpose: it is refreshed from the
-- surface profile on every boot and must be writable before anything downstream
-- exists; a dangling id answers the same as NULL to every consumer.
CREATE TABLE IF NOT EXISTS public.deployment_payer_settings (
  -- Singleton by construction: PK on a boolean that CHECKs true, so a second
  -- row is a unique violation and `WHERE id = true` is the whole table.
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  payer_user_id             uuid,                      -- refreshed EVERY boot
  -- Nodaro CREDITS, never display units. Seeded once from the surface profile's
  -- `billing.defaultAllowanceUnits / billing.unitRate`; thereafter owned by the
  -- billing account. Written ONLY on first insert (D6) — an upsert that also
  -- updated this column would revert the customer's value on every deploy.
  default_allowance_credits integer NOT NULL DEFAULT 0
                              CHECK (default_allowance_credits >= 0),
  enforcement_note          text,
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- RLS ON with NO POLICY AT ALL: the table names the payer, so no browser role
-- may read it under any row. The service role (the backend's client) bypasses
-- RLS, which is the boot upsert's path and the RPCs' path in 382.
ALTER TABLE public.deployment_payer_settings ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of "no policy": Supabase's default privileges grant
-- anon/authenticated table-level SELECT on new public tables, and a table grant
-- with RLS on would still expose the column list and the row count through
-- error shapes. Table-level, per the 347 lesson (347:16-26) — a column-level
-- revoke under a live table grant does nothing.
REVOKE ALL ON TABLE public.deployment_payer_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The RLS helper.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the policy that calls it runs as `authenticated`,
-- which (by section 1) cannot read the settings table. STABLE so the planner
-- may reuse it within a statement. `SET search_path` pins the schema so a
-- caller-controlled path cannot redirect the lookup.
--
-- FAIL CLOSED, exactly like is_admin() (019_missing_functions.sql:60-71):
-- any error — the table missing on a half-applied chain, a permission change,
-- a future rename — returns NULL, and NULL means "no payer configured", which
-- makes the policy below behave as 032's. That is the SAFE direction here: the
-- alternative (raising) would make every `profiles` SELECT fail closed on the
-- whole product for a fault in a feature almost no deployment uses.
--
-- ACCEPTED SIDE EFFECT: EXECUTE stays available to `anon` and `authenticated`.
-- For `authenticated` it MUST — the policy in section 3 is evaluated as that
-- role, and an EXECUTE denial inside a USING expression RAISES rather than
-- yielding NULL, which would take every `profiles` row from every admin on
-- every mainline deployment. So a caller holding the publishable anon key (it
-- ships in the browser bundle) can call this through PostgREST and learn the
-- payer's uuid.
--
-- THE UUID IS INERT ONLY BECAUSE SECTION 2b MAKES IT SO. An earlier draft of
-- this comment certified a property the database did not have — "the row it
-- names is precisely the row this migration hides" — and that was FALSE. The
-- narrowed policy below closes ONE read path (a browser-direct SELECT on
-- `profiles`); RLS does not constrain a SECURITY DEFINER function at all, and
-- two pre-existing ones read `profiles` BY UUID with EXECUTE granted to
-- anon/authenticated. Composed with the uuid handed out here they returned the
-- payer's exact balance, unauthenticated. Section 2b revokes both. Do not add
-- a third PUBLIC-executable reader of `profiles` by uuid without revoking it
-- too — and the behaviour proof asserts exactly that, so you will be told.
CREATE OR REPLACE FUNCTION public.deployment_payer_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (SELECT payer_user_id FROM public.deployment_payer_settings WHERE id = true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.deployment_payer_user_id() IS
  'The deployment payer''s user id, or NULL when no payer is configured. Fail-closed (returns NULL on any error) like is_admin(). Read by the profiles SELECT policy so an admin cannot read the payer''s balance.';

-- ---------------------------------------------------------------------------
-- 2b. The two SECURITY DEFINER readers of `profiles` BY UUID.
-- ---------------------------------------------------------------------------
-- Without this block section 2 is a disclosure, not a side effect.
--
-- `get_total_credits(uuid)` (017_billing_schema.sql:216) returns
-- `subscription_credits + topup_credits` for ANY uuid.
-- `check_credits(uuid, integer)` (022_fix_critical_and_high_issues.sql:62)
-- returns the same figure in its `balance` field — and leaks more besides: its
-- body reads `tier`/`subscription_tier` and `daily_spent_credits`, and its
-- "Daily credit limit exceeded" branch discloses the payer's tier through the
-- tier_config lookup. Both are SECURITY DEFINER, so no policy reaches them,
-- and both carry Supabase's platform default EXECUTE grants. Composed with the
-- helper above, anyone holding the publishable anon key — no account, no
-- sign-in, no admin role — reads the deployment's real pool, and by polling,
-- its burn rate. That is precisely the leak this migration exists to close.
--
-- `FROM PUBLIC` ALONE IS NOT ENOUGH, which is why the roles are named. The ACL
-- carries EXPLICIT `anon=X/postgres` and `authenticated=X/postgres` entries;
-- revoking only the PUBLIC grant leaves both standing and the leak fully open.
-- 382 revokes `reserve_credits` in this same named shape.
--
-- THIS REVERSES A DECISION, deliberately: 024_critical_security_fixes.sql:25-26
-- left both open ("Keep check_credits for frontend use"). Nothing calls either
-- from a browser any more — there is no `.rpc("get_total_credits")` and no
-- `.rpc("check_credits")` in backend/src, frontend/src or packages/client/src.
-- The backend reads balances through the SERVICE ROLE, whose own explicit
-- `service_role=X/postgres` grant this block does not touch (asserted in the
-- proof, so the revoke cannot quietly widen).
--
-- MAINLINE: these are grants, not policy, so the revoke applies with or without
-- a payer. No shipped caller loses anything; the disclosure closes everywhere.
REVOKE EXECUTE ON FUNCTION public.get_total_credits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_credits(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The narrowed profiles SELECT policy.
-- ---------------------------------------------------------------------------
-- Replaces 032:117-121. The only change is the parenthesised conjunct on the
-- admin disjunct; the "own row" disjunct is untouched, so the payer still reads
-- its own profile and every non-admin user is entirely unaffected.
--
-- THE `IS NULL` DISJUNCT IS MANDATORY, not defensive. `id <> NULL` evaluates to
-- NULL, and a policy whose USING expression is NULL denies the row — so without
-- it, EVERY admin on EVERY mainline deployment (where the helper always answers
-- NULL) would lose EVERY row of `profiles`, silently, at the moment this
-- migration applied. The behaviour proof asserts the mainline case first for
-- exactly that reason.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (
    (select auth.uid()) = id
    OR (is_admin() AND (deployment_payer_user_id() IS NULL
                        OR id <> deployment_payer_user_id()))
  );
