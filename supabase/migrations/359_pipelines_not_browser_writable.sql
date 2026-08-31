-- pipelines.config now carries the pipeline's resolved payer (the
-- billingContext stamp written at creation). Take the whole table out of the
-- browser's reach entirely.
--
-- The table's RLS (121_pipelines.sql:313-314) is ROW-level only — an owner
-- policy FOR ALL — and no migration has ever GRANTed or REVOKEd on this
-- table, so the Supabase platform default applies: the row owner could
-- UPDATE their own row's `config` straight over PostgREST with the browser
-- anon client, replacing the payer stamp after creation. The application
-- funnel (stampPipelineConfig) strips a caller-supplied stamp at create /
-- seed / branch time, but a funnel cannot guard a directly writable column —
-- only the grant closes it. The same door also let an owner rewrite
-- create-time-validated config picks (e.g. pinned models) after the tier
-- guard had passed.
--
-- Nothing first-party touches this table from a browser: `.from("pipelines")`
-- has zero hits in frontend/src and packages/, and no Realtime subscription
-- names it. Every backend reader/writer uses the service-role client, and
-- the pipeline routes/MCP tools are the only application surface.
--
-- Shape and precedent: 346_usage_logs_not_browser_readable.sql — REVOKE from
-- PUBLIC *and* anon *and* authenticated explicitly, because Supabase grants
-- anon separately and `REVOKE ... FROM PUBLIC` alone leaves it standing.
--
-- The 121 row policy is intentionally LEFT IN PLACE: belt-and-braces behind
-- the privilege denial, and the second lock if a future surface ever needs a
-- SECURITY INVOKER path.

REVOKE ALL ON TABLE public.pipelines FROM PUBLIC;
REVOKE ALL ON TABLE public.pipelines FROM anon;
REVOKE ALL ON TABLE public.pipelines FROM authenticated;

-- Explicit rather than implied: the backend must keep full access, and saying
-- so here means a future `REVOKE ALL ... FROM PUBLIC` cannot quietly take it.
GRANT ALL ON TABLE public.pipelines TO service_role;
