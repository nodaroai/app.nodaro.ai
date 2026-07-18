-- 261_app_reports.sql
-- Generic diagnostic reports written by platform nodes (and, via them, client
-- apps): a single admin-reviewed inbox for cross-cutting signals that don't
-- warrant a dedicated table. First kinds: 'missing-picker' (per-incident
-- describe-to-picker gap detail with the image link — the aggregate lives in
-- picker_catalog_gaps) and 'model-rejection' (failed jobs whose provider error
-- is a content-policy block, swept from jobs). Service-role write, admin read —
-- mirrors picker_catalog_gaps / admin_actions.

CREATE TABLE IF NOT EXISTS app_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Originating client app slug ('person', 'studio', 'vcp', …); NULL when the
  -- reporter is platform-internal or the origin is unknown.
  app_slug TEXT,
  -- The reporter: which node/process wrote this ('describe-to-picker',
  -- 'rejection-sweep', …).
  node TEXT NOT NULL,
  -- Open vocabulary; new kinds need no migration.
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_reports_status_created ON app_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_reports_kind ON app_reports (kind);
CREATE INDEX IF NOT EXISTS idx_app_reports_app ON app_reports (app_slug) WHERE app_slug IS NOT NULL;
-- One report per (kind, job): makes job-derived reporters (the rejection
-- sweep) idempotent — a re-scan can't duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_reports_kind_job ON app_reports (kind, job_id) WHERE job_id IS NOT NULL;

ALTER TABLE app_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_reports' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON app_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_reports' AND policyname = 'admin_read') THEN
    CREATE POLICY "admin_read" ON app_reports FOR SELECT TO authenticated USING (is_admin());
  END IF;
END $$;
