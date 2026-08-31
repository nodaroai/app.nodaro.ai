-- 361: admin availability overrides (B5) — the runtime layer of the
-- node/model availability funnel. One row per kind holds the full enabled
-- set; an ABSENT row means "factory" (the deployment surface profile's
-- allow/deny). "Reset to factory settings" in the admin UI deletes the row.
--
-- Service-role only: the backend cache reads it and the admin routes write
-- it. RLS is enabled with NO policies, so anon/authenticated clients cannot
-- touch it through PostgREST at all.

CREATE TABLE IF NOT EXISTS availability_overrides (
  kind TEXT PRIMARY KEY CHECK (kind IN ('nodes', 'models')),
  enabled TEXT[] NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
