-- model_pricing was world-readable.
--
-- 017_billing_schema.sql:167-170 created "Anyone can read model pricing" with
-- USING (true), inside an idempotent pg_policies guard, and no later migration
-- ever dropped it. RLS IS enabled on the table (017:143) and that policy is the
-- ONLY policy the table has ever had, so every anon/authenticated PostgREST
-- caller could SELECT the whole table -- including provider_cost_usd, which is
-- Nodaro's own provider economics, not a customer-facing credit price.
--
-- Blast radius: none. All nine `.from("model_pricing")` sites in the repo use
-- the SERVICE-ROLE client (backend/src/lib/supabase.ts:4), which bypasses RLS;
-- eight are additionally behind requireAdmin. frontend/src never queries the
-- table -- the browser gets prices over REST (GET /v1/credits/model-cost,
-- POST /v1/credits/model-costs -> CreditsService.getModelCreditBaseCost,
-- credits.ts:1622, also service-role), so PostgREST visibility is invisible to
-- the product. No SQL function or view reads the table either.
--
-- The table has no INSERT/UPDATE/DELETE policy, so writes were already
-- service-role-only; this changes READ visibility only, which is the leak.
--
-- is_admin() is the SECURITY DEFINER helper from 019_fix_functions_and_usage_
-- logs.sql:60-71 with search_path pinned at 033_security_audit_fixes.sql:72. It
-- is fail-closed (any exception -> FALSE) and for anon auth.uid() is NULL, so a
-- denied caller gets zero rows rather than an error. It is the same helper the
-- jobs SELECT policy already uses (032:103-108) -- no new mechanism.
--
-- WHY A POLICY AND NOT A GRANT REVOKE: a table-level `REVOKE ALL ... FROM anon,
-- authenticated` would be strictly tighter, but it would also make this policy
-- dead code -- privilege checks precede RLS, and an admin's JWT is the Postgres
-- role `authenticated` like everyone else's. Doing both halves would mean a
-- future admin-facing PostgREST read fails with an opaque 42501 "permission
-- denied" instead of an empty result. One mechanism, guarded by a behavioral
-- proof that a non-admin reads zero rows.
--
-- NOT DONE HERE -- dropping model_pricing.provider_cost_usd. No migration and no
-- backend write path ever populates it (every INSERT column list across every
-- migration that touches the table omits it; both backend upserts omit it), but
-- production has drifted from the migration history: backend/src/ee/routes/
-- admin.ts upserts `display_name`, and backend/src/scripts/kling3-pricing.sql
-- names `our_cost`, `markup`, `provider` -- none of which any migration creates.
-- So "never written" is repo-verified only. Discriminating pre-check for a
-- future column-drop PR, run against prod:
--   SELECT count(*) FROM model_pricing WHERE provider_cost_usd IS NOT NULL;

-- The drop must use the EXACT policy name from 017 -- a near-miss silently
-- no-ops and leaves the leak live while the migration reports success.
DROP POLICY IF EXISTS "Anyone can read model pricing" ON model_pricing;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'model_pricing'
       AND policyname = 'Admins read model pricing'
  ) THEN
    CREATE POLICY "Admins read model pricing" ON model_pricing
      FOR SELECT USING (is_admin());
  END IF;
END $$;
