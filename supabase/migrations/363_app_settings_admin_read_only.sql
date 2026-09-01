-- app_settings was ADMIN-WRITABLE from the browser.
--
-- 005_add_app_settings.sql:26-30 created "Admins can manage settings" FOR ALL
-- USING (is_admin()), and 024_critical_security_fixes.sql:247-249 re-created it
-- in the same shape. A FOR ALL policy with no WITH CHECK reuses its USING
-- expression as the INSERT/UPDATE check, so any authenticated JWT for which
-- is_admin() holds could INSERT, UPDATE or DELETE any row in this table
-- directly over PostgREST, with the browser's anon client.
--
-- WHY THAT IS A MONEY HOLE. Two rows in this table are price levers:
-- `cost_markup_percent` and `service_margin_percent` are read by
-- getAppSettings() (backend/src/lib/app-settings.ts) and multiplied into every
-- credit charge via effectiveMarkupPercent() (backend/src/ee/billing/
-- service-margin.ts). The route that edits them, PUT /v1/admin/settings/:key,
-- is now gated by requirePlatformOperator — the deployment-payer boundary whose
-- whole claim is that on an instance whose IdP the CUSTOMER runs, only the
-- platform operator may change what things cost. That claim was false one layer
-- down: a customer admin could skip the route and write the row. The route's
-- own 0..500 Zod bound was bypassable the same way (app-settings.ts clamps
-- `service_margin_percent` entries on read but takes `cost_markup_percent` as
-- given), so a direct write could set the global markup to 0 and buy Nodaro
-- compute at base cost out of the deployment payer's prepaid wallet.
--
-- Blast radius: none. Every app_settings writer in the repo uses the
-- SERVICE-ROLE client (backend/src/lib/supabase.ts), which bypasses RLS
-- entirely; the admin UI edits settings through the backend route, never
-- through supabase-js (frontend/src's only mentions of the table are the
-- generated database.types.ts and a comment). So dropping the write half
-- removes a capability nothing in the product uses.
--
-- Reads are LEFT AS THEY WERE, deliberately: this is the same one-mechanism,
-- least-surprise posture as 345_model_pricing_admin_read_only.sql — an admin
-- PostgREST read keeps working and returns rows, rather than failing with an
-- opaque 42501 from a table-level REVOKE.
--
-- is_admin() is the SECURITY DEFINER helper from 019_fix_functions_and_usage_
-- logs.sql:60-71, search_path pinned at 033_security_audit_fixes.sql:72,
-- fail-closed (any exception → FALSE, and anon has a NULL auth.uid()).

-- The drop must use the EXACT policy name from 005/024 — a near-miss silently
-- no-ops and leaves the write path live while the migration reports success.
DROP POLICY IF EXISTS "Admins can manage settings" ON public.app_settings;

-- Guarded create, not a bare one: CI re-applies the newest migration to prove
-- idempotency, and a second CREATE POLICY would abort with 42710.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'app_settings'
       AND policyname = 'Admins can read settings'
  ) THEN
    CREATE POLICY "Admins can read settings" ON public.app_settings
      FOR SELECT USING (is_admin());
  END IF;
END $$;

COMMENT ON TABLE public.app_settings IS
  'Deployment settings incl. the price levers cost_markup_percent and service_margin_percent. '
  'Admin-READABLE over PostgREST; writes are service-role only (migration 363) so the money '
  'levers cannot be moved around requirePlatformOperator by an admin the customer''s IdP minted.';
