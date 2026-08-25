-- usage_logs carries Nodaro's own USD valuation. Take it out of the browser's
-- reach entirely.
--
-- reserve_credits (newest definition 311_payg_web_free_pool.sql:140-157) writes
-- `cost_usd` from p_provider_cost_usd and stuffs 'display_cost' into `metadata`.
-- The table's RLS (032_consolidate_rls_and_indexes.sql:194-195) is ROW-level
-- only -- USING ((select auth.uid()) = user_id OR is_admin()) -- and no
-- migration has ever GRANTed or REVOKEd on this table, so the Supabase platform
-- default applies: any signed-in user could read their own rows' cost_usd AND
-- metadata straight over PostgREST with the browser anon client
-- (frontend/src/lib/supabase.ts:11-16).
--
-- Redacting the REST route (GET /v1/credits/transactions, done in the same PR)
-- does not close that, and cannot: cost_usd is a COLUMN, unreachable from a
-- response projection. Only the grant closes it.
--
-- Nothing first-party reads this table from a browser: `.from("usage_logs")`
-- has zero hits in frontend/src and packages/. The admin Usage page goes
-- through get_admin_usage_logs -- a SECURITY DEFINER function
-- (099_admin_usage_users_indexes.sql:83) that executes with its OWNER's
-- privileges, is is_admin()-gated internally, and returns no cost_usd and no
-- metadata column -- so a table-level revoke does not touch it. Every backend
-- reader uses the service-role client (backend/src/lib/supabase.ts:4), and
-- reserve/commit/refund are RPCs, not direct table writes from a browser.
-- No Realtime subscription names usage_logs.
--
-- Shape and precedent: 334_recast_audio_rescore_transactions.sql:19-22 -- REVOKE
-- from PUBLIC *and* anon *and* authenticated explicitly, because Supabase grants
-- anon separately and `REVOKE ... FROM PUBLIC` alone leaves it standing
-- (336_workflow_copilot.sql:110 says the same).
--
-- The 032 row policy is intentionally LEFT IN PLACE. It is now belt-and-braces
-- behind a privilege denial; dropping it would remove the second lock for no
-- gain, and would have to be re-created if a future admin surface ever needs a
-- SECURITY INVOKER path.

REVOKE ALL ON TABLE public.usage_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.usage_logs FROM anon;
REVOKE ALL ON TABLE public.usage_logs FROM authenticated;

-- Explicit rather than implied: the backend must keep full access, and saying
-- so here means a future `REVOKE ALL ... FROM PUBLIC` cannot quietly take it.
GRANT ALL ON TABLE public.usage_logs TO service_role;
