-- Engine environments (Trends, spec D17): staging and production share ONE
-- database but each pins its own @nodaroai/cloud-plugins build, so "does the
-- engine support this trend?" has one answer per environment. Each API server
-- records, at boot, what its loaded plugins declare (`supports()`, merged by
-- the loader) and which build that is; publishing a trend checks every
-- environment's row before it goes live.
--
-- One row per environment, keyed by the Railway environment name (upserted on
-- every boot, so `updated_at` is written by the API, not only defaulted).
--
-- Server-only, reached only through the API with the service role: RLS on,
-- no client grants, no policy (the migration-518 posture).

CREATE TABLE IF NOT EXISTS public.engine_environments (
  env              TEXT PRIMARY KEY CHECK (env ~ '^[a-z0-9-]{1,40}$'),
  plugin_build_id  TEXT,
  supports         JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.engine_environments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engine_environments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.engine_environments TO service_role;
